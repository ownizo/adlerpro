/**
 * carrier-excel-workbook.ts — a única peça da pipeline de import manual de
 * portfolio (CRM3 Block 3) que não é 100% pura: lê bytes de um ficheiro
 * .xlsx/.xls e devolve linhas em bruto (Record<string, unknown>[]), sem
 * qualquer mapeamento de seguradora.
 *
 * Usa a mesma biblioteca `xlsx` já usada no projeto (exportToExcel em
 * src/routes/admin.tsx) — nenhuma dependência nova foi necessária. Import
 * dinâmico (`await import('xlsx')`), mesmo padrão já usado nesse ficheiro,
 * em vez de um import estático no topo — é o padrão comprovado a
 * funcionar neste bundler para este pacote CJS.
 *
 * GARANTIAS:
 *   - Só lê valores de célula já guardados (`sheet_to_json` nunca
 *     reavalia fórmulas — devolve o valor em cache que o próprio Excel
 *     gravou; ver requisito "Do not parse formulas dynamically").
 *   - Nunca executa macros — a biblioteca `xlsx` (SheetJS) é um parser de
 *     dados puro, sem qualquer motor de execução de VBA.
 *   - SEMPRE corre server-side (chamado só a partir de
 *     src/lib/server-fns.ts) — nunca expõe a credencial service-role ao
 *     browser, que nunca vê esta função.
 */

export const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB — um portfolio broker típico tem poucos milhares de linhas
export const MAX_IMPORT_ROW_COUNT = 5000

export type ParseWorkbookResult =
  | { ok: true; rows: Array<Record<string, unknown>> }
  | { ok: false; error: string }

export async function parsePortfolioWorkbook(buffer: Buffer, filename: string): Promise<ParseWorkbookResult> {
  if (!/\.(xlsx|xls)$/i.test(filename)) {
    return { ok: false, error: 'Only .xlsx or .xls files are accepted' }
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
    // cellDates: true — datas nativas do Excel vêm como objetos Date, não
    // como número de série, para que parseImportDateSafely as reconheça
    // sem ambiguidade. bookVBA: false (default) — nunca interpreta macros.
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, bookVBA: false })
  } catch {
    return { ok: false, error: 'Could not read this file as an Excel workbook' }
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
