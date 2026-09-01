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
      // Decode as UTF-8 text ourselves and pass type:'string' — passing
      // the raw Buffer with type:'buffer' makes SheetJS mis-decode
      // accented headers/values (mojibake — e.g. "APÓLICE" becomes
      // "APÃLICE"); an already-UTF-8-decoded JS string parses correctly
      // and keeps every Portuguese accented header intact for
      // normalizeHeaderName downstream.
      let text = buffer.toString('utf8')
      // Strip a leading UTF-8 BOM (U+FEFF) — common in "CSV UTF-8"
      // exports from Windows/Excel. Left in place it silently attaches
      // to the FIRST header's name, so that column would never match any
      // provider mapper's required keys (e.g. "apolice" would arrive as
      // "﻿apolice").
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
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
