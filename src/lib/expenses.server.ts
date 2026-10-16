import { createHash, randomBytes } from 'node:crypto'
import { supabaseAdmin } from './supabase-admin'
import { captureUrl } from './expense-capture.ts'
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

// ── Phone capture links ──────────────────────────────────────────────────────

export type CaptureLink = {
  id: string
  label: string
  sent_to: string | null
  created_at: string
  expires_at: string
  revoked_at: string | null
  last_used_at: string | null
  uploads_count: number
}

const LINK_COLUMNS = 'id, label, sent_to, created_at, expires_at, revoked_at, last_used_at, uploads_count'

export function hashCaptureToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

async function emailCaptureLink(to: string, label: string, url: string, expiresAt: Date) {
  const { resendClient, FROM_EMAIL } = await import('./email/client')
  if (!process.env.RESEND_API_KEY) throw new Error('Email não configurado.')
  const until = expiresAt.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const html = `<!doctype html><html><body style="margin:0;background:#F6F4EF;font-family:Montserrat,Arial,sans-serif;color:#17243D">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:12px">
  <tr><td style="background:#17243D;border-radius:12px 12px 0 0;padding:20px 24px;color:#fff;font-weight:700">Adler &amp; Rochefort <span style="color:#C8961A;font-weight:400">· Despesas</span></td></tr>
  <tr><td style="padding:24px">
  <p style="margin:0 0 12px;font-size:16px;font-weight:700">Link para fotografar faturas</p>
  <p style="margin:0 0 20px;font-size:14px;line-height:1.5">Abra este email no telemóvel e toque no botão. Abre-se uma página para tirar a foto da fatura, que é lida automaticamente e arquivada no backoffice. Pode usar o link sempre que precisar.</p>
  <p style="margin:0 0 24px;text-align:center"><a href="${escapeHtml(url)}" style="display:inline-block;background:#17243D;color:#fff;text-decoration:none;font-weight:700;padding:16px 28px;border-radius:10px;font-size:16px">📷 Fotografar fatura</a></p>
  <p style="margin:0;font-size:12px;color:#667085;line-height:1.5">Link «${escapeHtml(label)}», válido até ${until}. Não reencaminhe este email: quem tiver o link pode enviar faturas. Pode desativá-lo no backoffice em Despesas.</p>
  </td></tr></table></td></tr></table></body></html>`
  const { error } = await resendClient.emails.send({
    from: FROM_EMAIL.replace(/^[^<]*</, 'Adler & Rochefort <'),
    to: [to],
    subject: 'Link para fotografar faturas — Despesas',
    html,
    text: `Link para fotografar faturas (válido até ${until}):\n${url}`,
  })
  if (error) throw new Error(error.message)
}

export async function createCaptureLink(input: { label: string; email: string | null; expiryDays: number }, userId: string, origin: string) {
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + input.expiryDays * 24 * 60 * 60 * 1000)
  const { data, error } = await supabaseAdmin.from('expense_capture_links').insert({
    token_hash: hashCaptureToken(token),
    label: input.label,
    sent_to: input.email,
    created_by: userId,
    expires_at: expires.toISOString(),
  }).select(LINK_COLUMNS).single()
  if (error || !data) throw new Error('Não foi possível criar o link.')
  const url = captureUrl(origin, token)
  let emailError: string | null = null
  if (input.email) {
    try { await emailCaptureLink(input.email, input.label, url, expires) } catch (err) {
      console.error('[capture-link] email failed', err)
      emailError = 'Não foi possível enviar o email. Use o código QR ou copie o link.'
    }
  }
  return { link: data as CaptureLink, url, emailed: !!input.email && !emailError, emailError }
}

export async function listCaptureLinks(): Promise<CaptureLink[]> {
  const { data, error } = await supabaseAdmin.from('expense_capture_links')
    .select(LINK_COLUMNS)
    .order('created_at', { ascending: false }).limit(50)
  if (error) throw new Error('Não foi possível carregar os links.')
  return (data ?? []) as CaptureLink[]
}

export async function revokeCaptureLink(id: string) {
  const { error } = await supabaseAdmin.from('expense_capture_links')
    .update({ revoked_at: new Date().toISOString() }).eq('id', id).is('revoked_at', null)
  if (error) throw new Error('Não foi possível desativar o link.')
  return { id }
}
