import { isExpenseCategory, monthOf } from './expense-categories.ts'

export const EXPENSE_MAX_FILE_BYTES = 20 * 1024 * 1024
export const EXPENSE_ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const
export const EXPENSE_STATUSES = ['processing', 'review', 'confirmed', 'failed'] as const
export type ExpenseStatus = typeof EXPENSE_STATUSES[number]

export type VatLine = { rate: number | null; base: number | null; vat: number | null }
export type LineItem = { description: string; quantity: number | null; total: number | null }

export type Expense = {
  id: string
  status: ExpenseStatus
  supplier_name: string | null
  supplier_nif: string | null
  buyer_nif: string | null
  document_type: string | null
  invoice_number: string | null
  atcud: string | null
  invoice_date: string | null
  due_date: string | null
  reference_month: string | null
  category: string
  description: string | null
  currency: string
  net_amount: number | null
  vat_amount: number | null
  total_amount: number | null
  vat_lines: VatLine[]
  line_items: LineItem[]
  payment_method: string | null
  notes: string | null
  file_path: string
  file_name: string
  file_mime: string
  file_size: number
  ai_model: string | null
  ai_error: string | null
  extracted_at: string | null
  created_at: string
  updated_at: string
  confirmed_at: string | null
  source?: 'admin' | 'capture'
  capture_link_id?: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function assertExpenseId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Despesa inválida.')
  return value
}

/** Storage-safe file name: keeps the extension, strips anything unusual. */
export function safeFileName(name: string): string {
  const trimmed = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').trim()
  const dot = trimmed.lastIndexOf('.')
  const base = (dot > 0 ? trimmed.slice(0, dot) : trimmed).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'fatura'
  const ext = (dot > 0 ? trimmed.slice(dot + 1) : '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)
  return ext ? `${base}.${ext}` : base
}

export type StartUploadInput = { fileName: string; mime: string; size: number }

export function validateStartUpload(data: unknown): StartUploadInput {
  const d = data as Partial<StartUploadInput> | null
  if (!d || typeof d.fileName !== 'string' || !d.fileName.trim() || d.fileName.length > 255) throw new Error('Nome de ficheiro inválido.')
  if (typeof d.mime !== 'string' || !(EXPENSE_ALLOWED_MIME as readonly string[]).includes(d.mime)) throw new Error('Formato não suportado. Use PDF, JPG, PNG ou WEBP.')
  if (typeof d.size !== 'number' || !Number.isInteger(d.size) || d.size <= 0) throw new Error('Ficheiro vazio.')
  if (d.size > EXPENSE_MAX_FILE_BYTES) throw new Error('O ficheiro excede 20 MB.')
  return { fileName: d.fileName.trim(), mime: d.mime, size: d.size }
}

function text(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Valor de texto inválido.')
  const s = String(value).trim()
  if (!s) return null
  if (s.length > max) throw new Error(`Texto demasiado longo (máx. ${max}).`)
  return s
}

function date(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) throw new Error(`${label}: data inválida.`)
  return value
}

/** Parses amounts written as 12.34, 12,34 or 1.234,56 (Portuguese format). */
export function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  let n: number
  if (typeof value === 'number') n = value
  else if (typeof value === 'string') {
    let s = value.replace(/[€\s]/g, '')
    if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
    else if (s.includes(',')) s = s.replace(',', '.')
    if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error('Montante inválido.')
    n = Number(s)
  } else throw new Error('Montante inválido.')
  if (!Number.isFinite(n) || Math.abs(n) > 9_999_999_999) throw new Error('Montante inválido.')
  return Math.round(n * 100) / 100
}

function vatLines(value: unknown): VatLine[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value) || value.length > 10) throw new Error('Quadro de IVA inválido.')
  return value.map((line) => {
    const l = (line ?? {}) as Record<string, unknown>
    return { rate: parseAmount(l.rate), base: parseAmount(l.base), vat: parseAmount(l.vat) }
  }).filter((l) => l.rate !== null || l.base !== null || l.vat !== null)
}

function lineItems(value: unknown): LineItem[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Linhas inválidas.')
  return value.slice(0, 50).map((item) => {
    const i = (item ?? {}) as Record<string, unknown>
    return { description: text(i.description, 300) ?? '', quantity: parseAmount(i.quantity), total: parseAmount(i.total) }
  }).filter((i) => i.description || i.total !== null)
}

export const EDITABLE_EXPENSE_FIELDS = [
  'supplier_name', 'supplier_nif', 'buyer_nif', 'document_type', 'invoice_number', 'atcud',
  'invoice_date', 'due_date', 'reference_month', 'category', 'description', 'currency',
  'net_amount', 'vat_amount', 'total_amount', 'vat_lines', 'line_items', 'payment_method', 'notes',
] as const

export type ExpenseFields = Partial<Pick<Expense, typeof EDITABLE_EXPENSE_FIELDS[number]>>

/** Normalises user- or AI-provided fields. Unknown keys are ignored. */
export function normaliseExpenseFields(input: Record<string, unknown>): ExpenseFields {
  const out: ExpenseFields = {}
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k)
  if (has('supplier_name')) out.supplier_name = text(input.supplier_name, 300)
  if (has('supplier_nif')) out.supplier_nif = text(input.supplier_nif, 30)?.replace(/\s+/g, '') ?? null
  if (has('buyer_nif')) out.buyer_nif = text(input.buyer_nif, 30)?.replace(/\s+/g, '') ?? null
  if (has('document_type')) out.document_type = text(input.document_type, 60)
  if (has('invoice_number')) out.invoice_number = text(input.invoice_number, 120)
  if (has('atcud')) out.atcud = text(input.atcud, 120)
  if (has('invoice_date')) out.invoice_date = date(input.invoice_date, 'Data da fatura')
  if (has('due_date')) out.due_date = date(input.due_date, 'Data de vencimento')
  if (has('reference_month')) {
    const raw = input.reference_month
    const v = typeof raw === 'string' && /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : raw
    out.reference_month = monthOf(date(v, 'Mês de referência'))
  }
  if (has('category')) {
    if (!isExpenseCategory(input.category)) throw new Error('Categoria inválida.')
    out.category = input.category
  }
  if (has('description')) out.description = text(input.description, 2000)
  if (has('currency')) {
    const c = (text(input.currency, 3) ?? 'EUR').toUpperCase()
    if (!/^[A-Z]{3}$/.test(c)) throw new Error('Moeda inválida.')
    out.currency = c
  }
  if (has('net_amount')) out.net_amount = parseAmount(input.net_amount)
  if (has('vat_amount')) out.vat_amount = parseAmount(input.vat_amount)
  if (has('total_amount')) out.total_amount = parseAmount(input.total_amount)
  if (has('vat_lines')) out.vat_lines = vatLines(input.vat_lines)
  if (has('line_items')) out.line_items = lineItems(input.line_items)
  if (has('payment_method')) out.payment_method = text(input.payment_method, 60)
  if (has('notes')) out.notes = text(input.notes, 4000)
  return out
}

/** Fills obvious gaps: month from the invoice date, net/VAT/total from each other. */
export function completeExpenseFields(fields: ExpenseFields): ExpenseFields {
  const out = { ...fields }
  if (!out.reference_month && out.invoice_date) out.reference_month = monthOf(out.invoice_date)
  const lines = out.vat_lines ?? []
  if (out.vat_amount == null && lines.length) {
    const sum = lines.reduce((acc, l) => acc + (l.vat ?? 0), 0)
    out.vat_amount = Math.round(sum * 100) / 100
  }
  if (out.net_amount == null && lines.length && lines.every((l) => l.base != null)) {
    out.net_amount = Math.round(lines.reduce((acc, l) => acc + (l.base ?? 0), 0) * 100) / 100
  }
  if (out.total_amount == null && out.net_amount != null && out.vat_amount != null) out.total_amount = Math.round((out.net_amount + out.vat_amount) * 100) / 100
  if (out.net_amount == null && out.total_amount != null && out.vat_amount != null) out.net_amount = Math.round((out.total_amount - out.vat_amount) * 100) / 100
  if (out.vat_amount == null && out.total_amount != null && out.net_amount != null) out.vat_amount = Math.round((out.total_amount - out.net_amount) * 100) / 100
  return out
}

/** Warnings shown to the reviewer before confirming (never blocks). */
export function expenseWarnings(e: Pick<Expense, 'net_amount' | 'vat_amount' | 'total_amount' | 'invoice_date' | 'supplier_nif' | 'reference_month'>): string[] {
  const warnings: string[] = []
  if (e.total_amount == null) warnings.push('Total amount missing.')
  if (!e.invoice_date) warnings.push('Invoice date missing.')
  if (!e.reference_month) warnings.push('Reference month missing.')
  if (e.net_amount != null && e.vat_amount != null && e.total_amount != null && Math.abs(e.net_amount + e.vat_amount - e.total_amount) > 0.02) {
    warnings.push('Net + VAT does not match the total.')
  }
  if (e.supplier_nif && /^\d{9}$/.test(e.supplier_nif) && !isValidPtNif(e.supplier_nif)) warnings.push('The supplier NIF fails the check digit.')
  return warnings
}

export function isValidPtNif(nif: string): boolean {
  if (!/^\d{9}$/.test(nif)) return false
  const digits = nif.split('').map(Number)
  const sum = digits.slice(0, 8).reduce((acc, d, i) => acc + d * (9 - i), 0)
  const check = 11 - (sum % 11)
  return (check >= 10 ? 0 : check) === digits[8]
}
