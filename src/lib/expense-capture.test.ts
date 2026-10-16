import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captureUrl, isCaptureToken } from './expense-capture.ts'
import { accountantWorkbookRows, packFileName } from './expense-export.ts'
import type { Expense } from './expense-validation.ts'

test('capture token format and URLs', () => {
  const token = 'a'.repeat(43)
  assert.equal(isCaptureToken(token), true)
  assert.equal(isCaptureToken('short'), false)
  assert.equal(isCaptureToken(`${'a'.repeat(42)}/`), false)
  assert.equal(captureUrl('https://admin.adlerrochefort.com/admin/expenses', token), `https://admin.adlerrochefort.com/despesa/${token}`)
})

const base: Expense = {
  id: '0123456789ab-0000-0000-0000-000000000000', status: 'confirmed', supplier_name: 'Worten – Equipamentos', supplier_nif: '503630330', buyer_nif: null,
  document_type: 'Fatura', invoice_number: 'FT 2026/55', atcud: null, invoice_date: '2026-10-02', due_date: null,
  reference_month: '2026-10-01', category: 'mobiliario_equipamento', description: 'Cadeira', currency: 'EUR',
  net_amount: 100, vat_amount: 23, total_amount: 123, vat_lines: [{ rate: 23, base: 100, vat: 23 }], line_items: [],
  payment_method: null, notes: null, file_path: 'p', file_name: 'IMG_1.JPG', file_mime: 'image/jpeg', file_size: 1,
  ai_model: null, ai_error: null, extracted_at: null, created_at: '', updated_at: '', confirmed_at: null,
}

test('pack file names are readable and unique per expense', () => {
  assert.equal(packFileName(base), 'faturas/2026-10/2026-10-02_Worten-Equipamentos_FT-2026-55_012345.jpg')
  assert.equal(packFileName({ ...base, invoice_date: null, supplier_name: null, invoice_number: null }), 'faturas/2026-10/2026-10-00_fornecedor_012345.jpg')
})

test('accountant workbook has totals, account summary and VAT by rate', () => {
  const other: Expense = { ...base, id: 'ffffff', category: 'material_escritorio', net_amount: 10, vat_amount: 0.6, total_amount: 10.6, vat_lines: [{ rate: 6, base: 10, vat: 0.6 }] }
  const wb = accountantWorkbookRows([base, other], true)
  assert.equal(wb.expenses.length, 4)
  assert.deepEqual(wb.expenses[3].slice(10, 13), [110, 23.6, 133.6])
  assert.ok(wb.expenses[1][1] instanceof Date)
  assert.equal(wb.byAccount.length, 4)
  assert.deepEqual(wb.byRate.slice(1), [['23%', 100, 23], ['6%', 10, 0.6]])
  assert.match(String(wb.expenses[1][17]), /^faturas\//)
})
