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
      const text = decodeCsvText(buffer)
      workbook = XLSX.read(text, { type: 'string', cellDates: true, raw: true })
    } else {
      // cellDates: true — datas nativas do Excel vêm como objetos Date, não
      // como número de série, para que parseImportDateSafely as reconheça
      // sem ambiguidade. bookVBA: false (default) — nunca interpreta macros.
      workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, bookVBA: false })
    }
  } catch {
    return { ok: false, error: isCsv ? 'Could not read this file as a CSV file' : 'Could not read this file as an Excel workbook' }
  }

  const firstSheetName = workbook.SheetNames?.[0]
  if (!firstSheetName) {
    return { ok: false, error: 'Workbook has no sheets' }
  }
  const sheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null }) as Array<Record<string, unknown>>

  if (rows.length === 0) {
    return { ok: false, error: 'Workbook has no recognizable rows' }
  }
  if (rows.length > MAX_IMPORT_ROW_COUNT) {
    return { ok: false, error: `Too many rows (max ${MAX_IMPORT_ROW_COUNT})` }
  }

  return { ok: true, rows }
}
