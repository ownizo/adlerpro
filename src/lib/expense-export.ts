import { expenseCategory } from './expense-categories.ts'
import type { Expense } from './expense-validation.ts'

const STATUS_LABELS: Record<Expense['status'], string> = {
  processing: 'A processar',
  review: 'Por rever',
  confirmed: 'Confirmada',
  failed: 'Leitura falhou',
}

export function expenseStatusLabel(status: Expense['status']): string {
  return STATUS_LABELS[status] ?? status
}

// The backoffice is English; the exports for the accountant stay Portuguese.
const STATUS_LABELS_EN: Record<Expense['status'], string> = {
  processing: 'Processing',
  review: 'To review',
  confirmed: 'Confirmed',
  failed: 'Reading failed',
}

export function expenseStatusLabelEn(status: Expense['status']): string {
  return STATUS_LABELS_EN[status] ?? status
}

function cell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function amount(value: number | null): string {
  return value === null ? '' : value.toFixed(2).replace('.', ',')
}

function date(value: string | null): string {
  if (!value) return ''
  const [y, m, d] = value.split('-')
  return `${d}/${m}/${y}`
}

/** Semicolon-separated CSV with decimal commas (opens directly in Excel PT). */
export function expensesToCsv(expenses: Expense[]): string {
  const header = ['Mês', 'Data', 'Fornecedor', 'NIF fornecedor', 'Tipo de documento', 'N.º documento', 'ATCUD', 'Categoria', 'Conta SNC', 'Descrição', 'Base tributável', 'IVA', 'Total', 'Moeda', 'Taxas de IVA', 'Pagamento', 'Estado', 'Ficheiro']
  const rows = expenses.map((e) => {
    const cat = expenseCategory(e.category)
    const rates = e.vat_lines.filter((l) => l.rate !== null).map((l) => `${l.rate}%`).join(' / ')
    return [
      e.reference_month ? e.reference_month.slice(0, 7) : '',
      date(e.invoice_date), e.supplier_name, e.supplier_nif, e.document_type, e.invoice_number, e.atcud,
      cat.label, cat.snc, e.description,
      amount(e.net_amount), amount(e.vat_amount), amount(e.total_amount), e.currency, rates,
      e.payment_method, expenseStatusLabel(e.status), e.file_name,
    ].map(cell).join(';')
  })
  return '﻿' + [header.map(cell).join(';'), ...rows].join('\r\n') + '\r\n'
}

export type CategoryTotal = { key: string; label: string; snc: string; count: number; net: number; vat: number; total: number }

export function totalsByCategory(expenses: Expense[]): CategoryTotal[] {
  const map = new Map<string, CategoryTotal>()
  for (const e of expenses) {
    const cat = expenseCategory(e.category)
    const t = map.get(cat.key) ?? { key: cat.key, label: cat.label, snc: cat.snc, count: 0, net: 0, vat: 0, total: 0 }
    t.count += 1
    t.net += e.net_amount ?? 0
    t.vat += e.vat_amount ?? 0
    t.total += e.total_amount ?? 0
    map.set(cat.key, t)
  }
  return [...map.values()]
    .map((t) => ({ ...t, net: Math.round(t.net * 100) / 100, vat: Math.round(t.vat * 100) / 100, total: Math.round(t.total * 100) / 100 }))
    .sort((a, b) => b.total - a.total)
}

// ── Accountant pack (Excel + invoice files) ─────────────────────────────────

/** Stable, readable file name for an invoice inside the accountant ZIP. */
export function packFileName(e: Pick<Expense, 'id' | 'invoice_date' | 'reference_month' | 'supplier_name' | 'invoice_number' | 'file_name'>): string {
  const clean = (s: string | null, max: number) => (s ?? '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max)
  const month = (e.reference_month ?? e.invoice_date ?? '').slice(0, 7) || 'sem-mes'
  const date = e.invoice_date ?? `${month}-00`
  const ext = (e.file_name.match(/\.([a-zA-Z0-9]{1,5})$/)?.[1] ?? 'pdf').toLowerCase()
  const parts = [date, clean(e.supplier_name, 40) || 'fornecedor', clean(e.invoice_number, 30), e.id.slice(0, 6)].filter(Boolean)
  return `faturas/${month}/${parts.join('_')}.${ext}`
}

type Cell = string | number | Date | null

function toDate(v: string | null): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null
  const [y, m, d] = v.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export type WorkbookSheets = {
  expenses: Cell[][]
  byAccount: Cell[][]
  byRate: Cell[][]
}

/** Builds the sheet rows for the accountant workbook (pure, testable). */
export function accountantWorkbookRows(expenses: Expense[], withFiles: boolean): WorkbookSheets {
  const head = ['Mês', 'Data', 'Fornecedor', 'NIF fornecedor', 'Tipo de documento', 'N.º documento', 'ATCUD', 'Tipo de despesa', 'Conta SNC', 'Descrição', 'Base tributável', 'IVA', 'Total', 'Moeda', 'Taxas de IVA', 'Pagamento', 'Estado', withFiles ? 'Ficheiro (no pacote)' : 'Ficheiro original']
  const rows: Cell[][] = expenses.map((e) => {
    const cat = expenseCategory(e.category)
    return [
      e.reference_month ? e.reference_month.slice(0, 7) : null,
      toDate(e.invoice_date), e.supplier_name, e.supplier_nif, e.document_type, e.invoice_number, e.atcud,
      cat.label, cat.snc, e.description,
      e.net_amount, e.vat_amount, e.total_amount, e.currency,
      e.vat_lines.filter((l) => l.rate !== null).map((l) => `${l.rate}%`).join(' / ') || null,
      e.payment_method, expenseStatusLabel(e.status),
      withFiles ? packFileName(e) : e.file_name,
    ]
  })
  const sum = (k: 'net_amount' | 'vat_amount' | 'total_amount') => Math.round(expenses.reduce((a, e) => a + (e[k] ?? 0), 0) * 100) / 100
  const totalRow: Cell[] = ['TOTAL', null, null, null, null, null, null, null, null, `${expenses.length} documentos`, sum('net_amount'), sum('vat_amount'), sum('total_amount'), null, null, null, null, null]

  const byAccount: Cell[][] = [
    ['Tipo de despesa', 'Conta SNC', 'N.º documentos', 'Base tributável', 'IVA', 'Total'],
    ...totalsByCategory(expenses).map((t) => [t.label, t.snc, t.count, t.net, t.vat, t.total] as Cell[]),
    ['TOTAL', null, expenses.length, sum('net_amount'), sum('vat_amount'), sum('total_amount')],
  ]

  const rates = new Map<string, { base: number; vat: number }>()
  for (const e of expenses) {
    const lines = e.vat_lines.filter((l) => l.rate !== null || l.vat !== null)
    if (!lines.length) {
      const key = 'Sem discriminação'
      const r = rates.get(key) ?? { base: 0, vat: 0 }
      r.base += e.net_amount ?? 0; r.vat += e.vat_amount ?? 0
      rates.set(key, r)
      continue
    }
    for (const l of lines) {
      const key = l.rate === null ? 'Sem taxa' : `${l.rate}%`
      const r = rates.get(key) ?? { base: 0, vat: 0 }
      r.base += l.base ?? 0; r.vat += l.vat ?? 0
      rates.set(key, r)
    }
  }
  const byRate: Cell[][] = [
    ['Taxa de IVA', 'Base tributável', 'IVA'],
    ...[...rates.entries()]
      .sort((a, b) => (parseFloat(b[0]) || -1) - (parseFloat(a[0]) || -1))
      .map(([k, v]) => [k, Math.round(v.base * 100) / 100, Math.round(v.vat * 100) / 100] as Cell[]),
  ]

  return { expenses: [head, ...rows, totalRow], byAccount, byRate }
}
