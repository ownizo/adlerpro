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
