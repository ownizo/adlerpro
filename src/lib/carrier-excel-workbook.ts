/**
 * carrier-excel-workbook.ts — a única peça da pipeline de import manual de
 * portfolio (CRM3 Block 3) que não é 100% pura: lê bytes de um ficheiro
 * .xlsx/.xls/.csv e devolve linhas em bruto (Record<string, unknown>[]),
 * sem qualquer mapeamento de seguradora — CSV passa pelo MESMO caminho
 * normalizedRow -> provider mapper -> staging/dry-run que o Excel, nunca
 * uma implementação de reconciliação paralela (ver requisito "Do not
 * create a parallel reconciliation implementation").
 *
 * Usa a mesma biblioteca `xlsx` já usada no projeto (exportToExcel em
 * src/routes/admin.tsx) — nenhuma dependência nova foi necessária, também
 * para CSV: o SheetJS `xlsx` já inclui um parser CSV próprio (RFC4180 —
 * respeita valores entre aspas, incluindo um delimitador ou vírgula
 * dentro do valor citado — nunca um `line.split(';')` ingénuo) com
 * deteção automática do separador de campo a partir da linha de
 * cabeçalho, testado a suportar ponto-e-vírgula e vírgula. Import
 * dinâmico (`await import('xlsx')`), mesmo padrão já usado nesse
 * ficheiro, em vez de um import estático no topo — é o padrão comprovado
 * a funcionar neste bundler para este pacote CJS.
 *
 * GARANTIAS:
 *   - Só lê valores de célula já guardados (`sheet_to_json` nunca
 *     reavalia fórmulas — devolve o valor em cache que o próprio Excel
 *     gravou; ver requisito "Do not parse formulas dynamically"). CSV não
 *     tem fórmulas.
 *   - Nunca executa macros — a biblioteca `xlsx` (SheetJS) é um parser de
 *     dados puro, sem qualquer motor de execução de VBA. CSV não tem
 *     macros.
 *   - SEMPRE corre server-side (chamado só a partir de
 *     src/lib/server-fns.ts) — nunca expõe a credencial service-role ao
 *     browser, que nunca vê esta função. O buffer/texto bruto do CSV
 *     nunca é persistido tal e qual — só as linhas já convertidas para
 *     objetos seguem para o mapper/sanitização, exatamente como o Excel.
 */

export const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB — um portfolio broker típico tem poucos milhares de linhas
export const MAX_IMPORT_ROW_COUNT = 5000

export type ParseWorkbookResult =
  | { ok: true; rows: Array<Record<string, unknown>> }
  | { ok: false; error: string }

function isCsvFilename(filename: string): boolean {
  return /\.csv$/i.test(filename)
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])

/**
 * Decodifica os bytes de um CSV para texto — suporta tanto CSV UTF-8
 * (Excel "CSV UTF-8", a maioria dos exports modernos) como CSV
 * Windows-1252/Latin-1 (o export real Allianz POLRES.CSV, confirmado por
 * inspeção byte-a-byte contra o ficheiro real: um "Ó" grava como o byte
 * 0xD3, uma sequência UTF-8 inválida, mas um carácter Windows-1252 válido
 * — decodificar sempre como UTF-8 corrompe todo cabeçalho acentuado em
 * U+FFFD, exatamente o bug que fez o fingerprint Allianz falhar mesmo com
 * apolice/adesao/premio_com.s1 presentes no ficheiro real).
 *
 * Estratégia (nunca adivinha pela presença de U+FFFD no resultado — usa
 * TextDecoder('utf-8', { fatal: true }), que LANÇA em vez de substituir
 * silenciosamente, como o mecanismo determinístico de validade):
 *   1. Remove um BOM UTF-8 (EF BB BF) inicial, se presente — explicitamente,
 *      por corte de bytes ANTES de qualquer descodificação, nunca deixado
 *      para o comportamento implícito por omissão do TextDecoder (que
 *      também o remove, mas não de forma óbvia/testada aqui).
 *   2. Tenta descodificar os bytes restantes como UTF-8 estrito — se toda
 *      a sequência de bytes for UTF-8 válido, é isso que o ficheiro é.
 *   3. Se a descodificação estrita LANÇAR (bytes inválidos como UTF-8),
 *      volta a descodificar os MESMOS bytes (sem BOM) como Windows-1252 —
 *      windows-1252 tem um mapeamento para todos os 256 valores de byte,
 *      por isso nunca lança. Windows-1252 (não ISO-8859-1/Latin-1) é
 *      escolhido deliberadamente porque exports reais podem conter bytes
 *      na gama 0x80-0x9F (€, aspas tipográficas, etc.) que só têm
 *      significado em Windows-1252, não em ISO-8859-1 puro.
 *
 * Ficheiros CSV UTF-8 válidos (com ou sem BOM) continuam a descodificar
 * exatamente como antes — este helper nunca escolhe Windows-1252 para um
 * ficheiro que já é UTF-8 válido.
 */
function decodeCsvText(buffer: Buffer): string {
  const bytes = buffer.subarray(0, 3).equals(UTF8_BOM) ? buffer.subarray(3) : buffer
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/**
 * Remove padding NUL (U+0000) de transporte de um CSV de largura fixa —
 * confirmado por inspeção byte-a-byte contra o ficheiro real POLRES.CSV
 * (17 linhas físicas, 66 colunas, TODOS os campos entre aspas — nunca
 * apenas alguns).
 *
 * A inspeção byte-a-byte mostra DUAS zonas de padding distintas e
 * INDEPENDENTES por linha de dados — não uma única zona contígua da
 * coluna 60 até ao fim da linha, como uma primeira análise (apenas por
 * contagem de ";") tinha sugerido:
 *
 *   1. ADESÃO SUBST. (coluna 60, campo entre aspas) tem SEMPRE
 *      exatamente 5 bytes 0x00 como conteúdo INTEIRO desse campo — um
 *      sub-campo de largura fixa 5 (o mesmo comprimento de "00001") que,
 *      quando vazio, é gravado como NUL em vez de espaços/string vazia.
 *      As colunas seguintes (61-65: IBAN/BIC/AUTORIZAÇÃO/TDOC TOMADOR/
 *      TDOC PROPIETÁRIO) têm SEMPRE conteúdo real a seguir — nunca fazem
 *      parte do mesmo run de padding. É este run de 5 bytes, no MEIO do
 *      registo, que a SheetJS expõe como o VALOR da célula ADESÃO
 *      SUBST., preservado pelo mapper Allianz em sanitizedRaw.
 *   2. A 66ª coluna (cabeçalho vazio/malformado — já descartado por
 *      normalizeHeaderName, ver PR #105) tem SEMPRE ~243-245 bytes 0x00
 *      como conteúdo inteiro desse último campo, terminando mesmo antes
 *      do \r\n — este é o único padding que é literalmente "fim de
 *      registo físico".
 *
 * Ambos os casos partilham a mesma forma: um run de U+0000 que é o
 * conteúdo INTEIRO (ou o restolho final) de UM campo entre aspas — por
 * isso a condição para remover um run passou a ser "imediatamente antes
 * de uma aspa de fecho (fim de campo citado), de \r\n, de \n, ou do fim
 * do texto (EOF)" — não só "antes do fim da linha". Isto é o que produzia
 * uma string JSON com U+0000 em sanitizedRaw, que o Postgres jsonb
 * rejeita ("unsupported Unicode escape sequence") — stageCarrierImportRecords
 * falhava mesmo com parsing/reconhecimento já corretos (ver
 * REAL_SANITIZED_RAW_HAS_NUL no relatório de verificação: só ficou false
 * depois desta correção — uma primeira versão que só cobria o fim de
 * linha deixava o run de 5 bytes de ADESÃO SUBST. intacto).
 *
 * Continua a NUNCA remover um NUL genérico em qualquer posição do
 * documento: só um run que toque nessa fronteira de fim-de-campo/
 * fim-de-linha/EOF é removido — o que precede o run (aspa de abertura,
 * ";", carateres reais como em "ABC\0\0\0\r\n"/"ABC\0\0\0"") é irrelevante,
 * exatamente como já acontecia com o caso fim-de-linha. Um NUL embutido a
 * meio de uma célula, sem tocar nenhuma destas fronteiras (ex.: "A;B\0C;D"
 * ou um campo citado "AB\0CD"), nunca é tocado por este regex — fica como
 * dado de origem inválido detetável, não silenciosamente apagado (ver
 * requisito "should remain detectable as invalid source data rather than
 * being globally erased").
 *
 * Aplicado a TODO texto CSV já descodificado (decodeCsvText), independente
 * de ter sido UTF-8 ou Windows-1252 — o byte 0x00 é U+0000 em ambos, o
 * padding é um problema de transporte/formato de largura fixa, não de
 * codificação de carateres.
 */
export function stripTrailingCsvNulPadding(text: string): string {
  return text.replace(/\x00+(?="|\r?\n|$)/gm, '')
}

/**
 * Converte, em todas as folhas, as células numéricas com formato de data
 * (ex.: "m/d/yy") num objeto Date à meia-noite UTC do dia mostrado no
 * Excel.
 *
 * Porquê: com `cellDates: true` a SheetJS cria o Date no fuso horário
 * LOCAL do servidor (e ainda com um desvio de segundos herdado do LMT
 * histórico). Confirmado com o export real MyHiscox: "10/10/2026" num
 * processo com TZ=Europe/Lisbon vinha como 2026-10-09T23:00:45Z, e
 * parseImportDateSafely (que usa getUTC*) devolvia 2026-10-09 — um dia a
 * menos. Em UTC (Netlify) não se notava, mas o resultado não pode
 * depender do fuso horário da máquina. SSF.parse_date_code decompõe o
 * número de série em ano/mês/dia/hora sem passar por fuso nenhum.
 */
function convertExcelDateCellsToUtc(SSF: any, workbook: any): void {
  const date1904 = Boolean(workbook?.Workbook?.WBProps?.date1904)
  for (const sheetName of workbook?.SheetNames ?? []) {
    const sheet = workbook.Sheets?.[sheetName]
    if (!sheet) continue
    for (const address of Object.keys(sheet)) {
      if (address.startsWith('!')) continue
      const cell = sheet[address]
      if (!cell || cell.t !== 'n' || typeof cell.v !== 'number' || !cell.z) continue
      if (!SSF.is_date(cell.z)) continue
      const parts = SSF.parse_date_code(cell.v, { date1904 })
      if (!parts) continue
      cell.v = new Date(Date.UTC(parts.y, parts.m - 1, parts.d, parts.H, parts.M, Math.round(parts.S)))
      cell.t = 'd'
    }
  }
}

/** Quantas linhas iniciais, no máximo, podem ser "preâmbulo" (título)
 * antes da linha de cabeçalhos — mais do que isto nunca é um título, é um
 * ficheiro que não reconhecemos. */
const MAX_PREAMBLE_ROWS = 10

function countNonEmptyCells(row: unknown[]): number {
  let count = 0
  for (const cell of row) {
    if (cell === null || cell === undefined) continue
    if (typeof cell === 'string' && cell.trim() === '') continue
    count++
  }
  return count
}

/**
 * Devolve o índice ABSOLUTO (0-based, na folha) da linha de cabeçalhos.
 *
 * Alguns exports reais têm uma linha de título por cima dos cabeçalhos —
 * confirmado no export real "MyHiscox" (linha 1 = só "MyHiscox" na coluna
 * A; os cabeçalhos Referência/Tomador/NIPC/NIF/... estão na linha 2). Sem
 * isto, `sheet_to_json` usava a linha de título como cabeçalho e todas as
 * chaves passavam a "MyHiscox"/"__EMPTY_n" — o mapper nunca reconhecia o
 * ficheiro.
 *
 * Regra conservadora: só salta linhas iniciais com NO MÁXIMO uma célula
 * preenchida (um título, nunca uma linha de dados ou de cabeçalhos), até
 * MAX_PREAMBLE_ROWS. Ficheiros cujo cabeçalho já está na primeira linha
 * (MGEN, Allianz POLRES, qualquer CSV com 2+ colunas) devolvem
 * exatamente o mesmo índice de antes — comportamento inalterado. Se não
 * existir nenhuma linha com 2+ células nas primeiras linhas, mantém-se
 * também o comportamento anterior (primeira linha da folha).
 */
function findHeaderRowIndex(XLSX: any, sheet: any): number {
  const ref: string | undefined = sheet?.['!ref']
  if (!ref) return 0
  const startRow: number = XLSX.utils.decode_range(ref).s.r
  const leadingRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    blankrows: true,
    range: startRow,
  }) as unknown[][]

  const limit = Math.min(leadingRows.length, MAX_PREAMBLE_ROWS + 1)
  for (let i = 0; i < limit; i++) {
    const nonEmpty = countNonEmptyCells(leadingRows[i] ?? [])
    if (nonEmpty >= 2) return startRow + i
  }
  return startRow
}

export async function parsePortfolioWorkbook(buffer: Buffer, filename: string): Promise<ParseWorkbookResult> {
  const isCsv = isCsvFilename(filename)
  if (!isCsv && !/\.(xlsx|xls)$/i.test(filename)) {
    return { ok: false, error: 'Only .xlsx, .xls or .csv files are accepted' }
  }
  if (buffer.length === 0) {
    return { ok: false, error: 'File is empty' }
  }
  if (buffer.length > MAX_IMPORT_FILE_SIZE_BYTES) {
    return { ok: false, error: `File is too large (max ${Math.floor(MAX_IMPORT_FILE_SIZE_BYTES / (1024 * 1024))} MB)` }
  }

  const XLSX = await import('xlsx')

  let workbook: any
  try {
    if (isCsv) {
      // Decode as text ourselves (UTF-8 or Windows-1252 — see
      // decodeCsvText) and pass type:'string' — passing the raw Buffer
      // with type:'buffer' makes SheetJS assume UTF-8 too and mis-decode
      // accented headers/values (mojibake — e.g. "APÓLICE" becomes
      // "APÃLICE"); an already-correctly-decoded JS string parses
      // correctly and keeps every Portuguese accented header intact for
      // normalizeHeaderName downstream, regardless of source encoding.
      const text = stripTrailingCsvNulPadding(decodeCsvText(buffer))
      workbook = XLSX.read(text, { type: 'string', cellDates: true, raw: true })
    } else {
      // Datas nativas do Excel: lidas como número de série + formato
      // (cellNF) e convertidas para Date em UTC por convertExcelDateCellsToUtc
      // — ver o porquê nessa função. bookVBA: false (default) — nunca
      // interpreta macros.
      // Com `await import('xlsx')` o SSF só está exposto em `.default` (CJS
      // interop) — aceitam-se as duas formas. Se, num bundle futuro, não
      // estiver disponível, volta-se ao comportamento anterior
      // (cellDates: true) em vez de deixar as datas como números.
      const SSF = (XLSX as any).SSF ?? (XLSX as any).default?.SSF
      if (SSF?.is_date && SSF?.parse_date_code) {
        workbook = XLSX.read(buffer, { type: 'buffer', cellNF: true, bookVBA: false })
        convertExcelDateCellsToUtc(SSF, workbook)
      } else {
        workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, bookVBA: false })
      }
    }
  } catch {
    return { ok: false, error: isCsv ? 'Could not read this file as a CSV file' : 'Could not read this file as an Excel workbook' }
  }

  const firstSheetName = workbook.SheetNames?.[0]
  if (!firstSheetName) {
    return { ok: false, error: 'Workbook has no sheets' }
  }
  const sheet = workbook.Sheets[firstSheetName]
  const headerRowIndex = findHeaderRowIndex(XLSX, sheet)
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, range: headerRowIndex }) as Array<Record<string, unknown>>

  if (rows.length === 0) {
    return { ok: false, error: 'Workbook has no recognizable rows' }
  }
  if (rows.length > MAX_IMPORT_ROW_COUNT) {
    return { ok: false, error: `Too many rows (max ${MAX_IMPORT_ROW_COUNT})` }
  }

  return { ok: true, rows }
}
