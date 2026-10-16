import { supabaseAdmin } from './supabase-admin'
import { monthOf } from './expense-categories.ts'
import {
  completeExpenseFields, normaliseExpenseFields, safeFileName,
  type Expense, type ExpenseFields, type StartUploadInput,
} from './expense-validation.ts'

const TABLE = 'company_expenses'
const BUCKET = 'expenses'

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function mapRow(row: Record<string, any>): Expense {
  return {
    ...row,
    net_amount: toNumber(row.net_amount),
    vat_amount: toNumber(row.vat_amount),
    total_amount: toNumber(row.total_amount),
    vat_lines: Array.isArray(row.vat_lines) ? row.vat_lines : [],
    line_items: Array.isArray(row.line_items) ? row.line_items : [],
  } as Expense
}

export type ExpenseListFilter = { from?: string; to?: string; category?: string }

export async function listExpenses(filter: ExpenseListFilter): Promise<Expense[]> {
  let query = supabaseAdmin
    .from(TABLE)
    .select('*')
    .order('reference_month', { ascending: false, nullsFirst: true })
    .order('invoice_date', { ascending: false, nullsFirst: true })
    .order('created_at', { ascending: false })
    .limit(1000)
  // Rows still being processed have no month yet; always show them.
  if (filter.from) query = query.or(`reference_month.gte.${filter.from},reference_month.is.null`)
  if (filter.to) query = query.or(`reference_month.lte.${filter.to},reference_month.is.null`)
  if (filter.category) query = query.eq('category', filter.category)
  const { data, error } = await query
  if (error) throw new Error('Não foi possível carregar as despesas.')
  return (data ?? []).map(mapRow)
}

export async function startExpenseUpload(input: StartUploadInput, userId: string) {
  const id = crypto.randomUUID()
  const now = new Date()
  const path = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}/${safeFileName(input.fileName)}`
  const { error: insertError } = await supabaseAdmin.from(TABLE).insert({
    id,
    status: 'processing',
    file_path: path,
    file_name: input.fileName.slice(0, 255),
    file_mime: input.mime,
    file_size: input.size,
    reference_month: monthOf(now.toISOString().slice(0, 10)),
    created_by: userId,
  })
  if (insertError) throw new Error('Não foi possível registar a despesa.')
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) {
    await supabaseAdmin.from(TABLE).delete().eq('id', id)
    throw new Error('Não foi possível preparar o envio do ficheiro.')
  }
  return { id, path, token: data.token }
}

export async function getExpense(id: string): Promise<Expense> {
  const { data, error } = await supabaseAdmin.from(TABLE).select('*').eq('id', id).maybeSingle()
  if (error || !data) throw new Error('Despesa não encontrada.')
  return mapRow(data)
}

export async function updateExpense(id: string, input: Record<string, unknown>, confirm: boolean): Promise<Expense> {
  const current = await getExpense(id)
  const fields: ExpenseFields = completeExpenseFields(normaliseExpenseFields(input))
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { ...fields, updated_at: now }
  if (confirm) {
    patch.status = 'confirmed'
    patch.confirmed_at = now
  } else if (current.status === 'failed' || current.status === 'processing') {
    // Manual edits on an unread document move it to review.
    patch.status = 'review'
  }
  const { data, error } = await supabaseAdmin.from(TABLE).update(patch).eq('id', id).select('*').maybeSingle()
  if (error || !data) throw new Error('Não foi possível guardar a despesa.')
  return mapRow(data)
}

export async function reopenExpense(id: string): Promise<Expense> {
  const { data, error } = await supabaseAdmin.from(TABLE)
    .update({ status: 'review', confirmed_at: null, updated_at: new Date().toISOString() })
    .eq('id', id).select('*').maybeSingle()
  if (error || !data) throw new Error('Não foi possível reabrir a despesa.')
  return mapRow(data)
}

export async function deleteExpense(id: string) {
  const expense = await getExpense(id)
  const { error: storageError } = await supabaseAdmin.storage.from(BUCKET).remove([expense.file_path])
  if (storageError) throw new Error('Não foi possível apagar o ficheiro da fatura.')
  const { error } = await supabaseAdmin.from(TABLE).delete().eq('id', id)
  if (error) throw new Error('Não foi possível apagar a despesa.')
  return { id }
}

export async function expenseFileUrl(id: string, download: boolean) {
  const expense = await getExpense(id)
  const { data, error } = await supabaseAdmin.storage.from(BUCKET)
    .createSignedUrl(expense.file_path, 600, download ? { download: expense.file_name } : undefined)
  if (error || !data) throw new Error('Não foi possível abrir o ficheiro.')
  return { url: data.signedUrl, mime: expense.file_mime, name: expense.file_name }
}
