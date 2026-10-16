// Browser-only: builds the accountant Excel file and the ZIP pack.
import { accountantWorkbookRows, packFileName } from './expense-export'
import { fetchExpenseFileUrl } from './expenses.functions'
import type { Expense } from './expense-validation'

function download(data: Uint8Array | string, name: string, type: string) {
  const blob = new Blob([data as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

async function buildWorkbook(expenses: Expense[], periodLabel: string, withFiles: boolean): Promise<Uint8Array> {
  const XLSX = await import('xlsx')
  const sheets = accountantWorkbookRows(expenses, withFiles)
  const wb = XLSX.utils.book_new()

  const money = '#,##0.00 €'
  const ws = XLSX.utils.aoa_to_sheet(sheets.expenses, { cellDates: true })
  ws['!cols'] = [8, 11, 30, 13, 16, 18, 16, 24, 9, 34, 14, 12, 14, 7, 14, 14, 12, 48].map((wch) => ({ wch }))
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: sheets.expenses.length - 2, c: 17 } }) }
  for (let r = 1; r < sheets.expenses.length; r++) {
    const date = ws[XLSX.utils.encode_cell({ r, c: 1 })]
    if (date && date.t === 'd') date.z = 'dd/mm/yyyy'
    for (const c of [10, 11, 12]) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell && cell.t === 'n') cell.z = money
    }
  }
  XLSX.utils.book_append_sheet(wb, ws, 'Despesas')

  const wa = XLSX.utils.aoa_to_sheet(sheets.byAccount)
  wa['!cols'] = [32, 10, 14, 16, 14, 16].map((wch) => ({ wch }))
  for (let r = 1; r < sheets.byAccount.length; r++) for (const c of [3, 4, 5]) {
    const cell = wa[XLSX.utils.encode_cell({ r, c })]
    if (cell && cell.t === 'n') cell.z = money
  }
  XLSX.utils.book_append_sheet(wb, wa, 'Resumo por conta')

  const wr = XLSX.utils.aoa_to_sheet(sheets.byRate)
  wr['!cols'] = [20, 16, 14].map((wch) => ({ wch }))
  for (let r = 1; r < sheets.byRate.length; r++) for (const c of [1, 2]) {
    const cell = wr[XLSX.utils.encode_cell({ r, c })]
    if (cell && cell.t === 'n') cell.z = money
  }
  XLSX.utils.book_append_sheet(wb, wr, 'IVA por taxa')

  wb.Props = { Title: `Despesas — ${periodLabel}`, Author: 'Adler & Rochefort', Company: 'Ownizo, Unipessoal Lda.' }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer
  return new Uint8Array(out)
}

export async function exportExcel(expenses: Expense[], periodLabel: string, fileSuffix: string) {
  const bytes = await buildWorkbook(expenses, periodLabel, false)
  download(bytes, `despesas-${fileSuffix}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
}

/** ZIP with the Excel workbook plus every original invoice, named consistently. */
export async function exportAccountantPack(expenses: Expense[], periodLabel: string, fileSuffix: string, onProgress?: (done: number, total: number) => void) {
  const { zipSync } = await import('fflate')
  const files: Record<string, Uint8Array> = {}
  files[`despesas-${fileSuffix}.xlsx`] = await buildWorkbook(expenses, periodLabel, true)
  const missing: string[] = []
  let done = 0
  const queue = [...expenses]
  const worker = async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      try {
        const { url } = await fetchExpenseFileUrl({ data: { id: e.id } })
        const res = await fetch(url)
        if (!res.ok) throw new Error(String(res.status))
        files[packFileName(e)] = new Uint8Array(await res.arrayBuffer())
      } catch {
        missing.push(`${e.supplier_name ?? e.file_name} (${e.invoice_number ?? e.id})`)
      }
      onProgress?.(++done, expenses.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, expenses.length) }, worker))
  if (missing.length) {
    files['FICHEIROS-EM-FALTA.txt'] = new TextEncoder().encode(`Não foi possível incluir:\n${missing.join('\n')}\n`)
  }
  // Images/PDFs are already compressed: store them, deflate only the text files.
  const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([name, data]) => [name, [data, { level: /\.(xlsx|txt)$/.test(name) ? 6 : 0 }]])) as any)
  download(zipped, `despesas-${fileSuffix}-contabilista.zip`, 'application/zip')
  return { missing: missing.length }
}
