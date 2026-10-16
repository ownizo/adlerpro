import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  completeExpenseFields, expenseWarnings, isValidPtNif, normaliseExpenseFields,
  parseAmount, safeFileName, validateStartUpload,
} from './expense-validation.ts'
import { parseExtractionReply } from './expense-extraction.ts'
import { expensesToCsv, totalsByCategory } from './expense-export.ts'
import { EXPENSE_CATEGORIES, monthOf } from './expense-categories.ts'

test('parseAmount handles Portuguese and plain formats', () => {
  assert.equal(parseAmount('1.234,56'), 1234.56)
  assert.equal(parseAmount('12,30'), 12.3)
  assert.equal(parseAmount('12.30'), 12.3)
  assert.equal(parseAmount('1,234.56'), 1234.56)
  assert.equal(parseAmount('€ 99,90'), 99.9)
  assert.equal(parseAmount(45.678), 45.68)
  assert.equal(parseAmount(''), null)
  assert.equal(parseAmount(null), null)
  assert.throws(() => parseAmount('abc'))
})

test('NIF check digit', () => {
  assert.equal(isValidPtNif('503504564'), true)
  assert.equal(isValidPtNif('503504565'), false)
  assert.equal(isValidPtNif('12345'), false)
})

test('safeFileName strips accents and odd characters', () => {
  assert.equal(safeFileName('Fatura Worten nº 12 (março).PDF'), 'Fatura-Worten-no-12-marco.pdf')
  assert.equal(safeFileName('???.pdf'), 'fatura.pdf')
  assert.match(safeFileName('../../etc/passwd'), /^[a-zA-Z0-9._-]+$/)
})

test('validateStartUpload enforces type and size', () => {
  assert.deepEqual(validateStartUpload({ fileName: 'a.pdf', mime: 'application/pdf', size: 10 }), { fileName: 'a.pdf', mime: 'application/pdf', size: 10 })
  assert.throws(() => validateStartUpload({ fileName: 'a.exe', mime: 'application/x-msdownload', size: 10 }))
  assert.throws(() => validateStartUpload({ fileName: 'a.pdf', mime: 'application/pdf', size: 30 * 1024 * 1024 }))
  assert.throws(() => validateStartUpload({ fileName: 'a.pdf', mime: 'application/pdf', size: 0 }))
})

test('normaliseExpenseFields validates category, dates and month', () => {
  const f = normaliseExpenseFields({ category: 'material_escritorio', invoice_date: '2026-10-03', reference_month: '2026-10', supplier_nif: '503 504 564' })
  assert.equal(f.category, 'material_escritorio')
  assert.equal(f.reference_month, '2026-10-01')
  assert.equal(f.supplier_nif, '503504564')
  assert.throws(() => normaliseExpenseFields({ category: 'nope' }))
  assert.throws(() => normaliseExpenseFields({ invoice_date: '03/10/2026' }))
  assert.deepEqual(normaliseExpenseFields({ unknown: 'x' }), {})
})

test('completeExpenseFields derives month and missing amounts', () => {
  const f = completeExpenseFields({ invoice_date: '2026-09-15', vat_lines: [{ rate: 23, base: 100, vat: 23 }, { rate: 6, base: 10, vat: 0.6 }] })
  assert.equal(f.reference_month, '2026-09-01')
  assert.equal(f.vat_amount, 23.6)
  assert.equal(f.net_amount, 110)
  assert.equal(f.total_amount, 133.6)
  const g = completeExpenseFields({ total_amount: 123, vat_amount: 23 })
  assert.equal(g.net_amount, 100)
})

test('expenseWarnings flags inconsistent totals', () => {
  const w = expenseWarnings({ net_amount: 100, vat_amount: 23, total_amount: 130, invoice_date: '2026-10-01', supplier_nif: '503504564', reference_month: '2026-10-01' })
  assert.deepEqual(w, ['Base + IVA não corresponde ao total.'])
})

test('parseExtractionReply keeps valid fields when one is invalid', () => {
  const reply = 'Aqui está:\n```json\n' + JSON.stringify({
    supplier_name: 'Staples Portugal', supplier_nif: '503504564', invoice_number: 'FT 2026A/77',
    invoice_date: '2026-10-02', category: 'not-a-category', total_amount: '61,50', vat_amount: 11.5,
    vat_lines: [{ rate: 23, base: 50, vat: 11.5 }], description: 'Toner HP',
  }) + '\n```'
  const { fields } = parseExtractionReply(reply)
  assert.equal(fields.supplier_name, 'Staples Portugal')
  assert.equal(fields.total_amount, 61.5)
  assert.equal(fields.net_amount, 50)
  assert.equal(fields.category, 'outros')
  assert.equal(fields.reference_month, '2026-10-01')
  assert.throws(() => parseExtractionReply('sem json'))
})

test('CSV export uses semicolons and decimal commas', () => {
  const csv = expensesToCsv([{
    id: 'x', status: 'confirmed', supplier_name: 'Loja; Lda', supplier_nif: '503504564', buyer_nif: null,
    document_type: 'Fatura', invoice_number: 'FT 1', atcud: null, invoice_date: '2026-10-02', due_date: null,
    reference_month: '2026-10-01', category: 'material_escritorio', description: 'Toner', currency: 'EUR',
    net_amount: 50, vat_amount: 11.5, total_amount: 61.5, vat_lines: [{ rate: 23, base: 50, vat: 11.5 }], line_items: [],
    payment_method: null, notes: null, file_path: 'p', file_name: 'f.pdf', file_mime: 'application/pdf', file_size: 1,
    ai_model: null, ai_error: null, extracted_at: null, created_at: '', updated_at: '', confirmed_at: null,
  }])
  const line = csv.split('\r\n')[1]
  assert.ok(line.startsWith('2026-10;02/10/2026;"Loja; Lda";503504564'))
  assert.ok(line.includes(';6233;'))
  assert.ok(line.includes(';50,00;11,50;61,50;EUR;23%;'))
})

test('categories are unique and totals group by category', () => {
  assert.equal(new Set(EXPENSE_CATEGORIES.map((c) => c.key)).size, EXPENSE_CATEGORIES.length)
  assert.equal(monthOf('2026-02-28'), '2026-02-01')
  const t = totalsByCategory([
    { category: 'material_escritorio', net_amount: 10, vat_amount: 2.3, total_amount: 12.3 },
    { category: 'material_escritorio', net_amount: 5, vat_amount: 1.15, total_amount: 6.15 },
    { category: 'mobiliario_equipamento', net_amount: 200, vat_amount: 46, total_amount: 246 },
  ] as any)
  assert.equal(t[0].key, 'mobiliario_equipamento')
  assert.equal(t[1].total, 18.45)
  assert.equal(t[1].count, 2)
})
