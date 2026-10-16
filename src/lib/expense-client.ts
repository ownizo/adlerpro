// Browser-side helpers for the expenses module.
import { supabase } from './supabase'
import { beginExpenseUpload } from './expenses.functions'
import type { Expense } from './expense-validation'
import { invoiceMime, prepareInvoiceFile } from './expense-image'

/** Uploads the original document and returns the new expense id. */
export async function uploadInvoice(original: File): Promise<string> {
  const file = await prepareInvoiceFile(original)
  const { id, path, token } = await beginExpenseUpload({ data: { fileName: file.name, mime: invoiceMime(file), size: file.size } })
  const { error } = await supabase.storage.from('expenses').uploadToSignedUrl(path, token, file, { contentType: invoiceMime(file) })
  if (error) throw new Error('O envio do ficheiro falhou. Verifique a ligação e tente novamente.')
  return id
}

/** Asks the server to read the invoice with AI. Resolves with the updated expense. */
export async function extractInvoice(id: string): Promise<Expense> {
  const { data } = await supabase.auth.getSession()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`
  const res = await fetch('/api/expense-extract', { method: 'POST', headers, body: JSON.stringify({ id }) })
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json')
  const body = isJson ? await res.json() : null
  if (!res.ok || !body?.expense) throw new Error(body?.error || 'A leitura automática falhou. Pode preencher os dados manualmente.')
  return body.expense as Expense
}

const eur = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' })
export function formatMoney(value: number | null | undefined, currency = 'EUR'): string {
  if (value === null || value === undefined) return '—'
  if (currency === 'EUR') return eur.format(value)
  try { return new Intl.NumberFormat('pt-PT', { style: 'currency', currency }).format(value) } catch { return `${value.toFixed(2)} ${currency}` }
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const [y, m, d] = value.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
export function formatMonth(value: string | null | undefined): string {
  if (!value) return '—'
  const [y, m] = value.split('-')
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`
}
