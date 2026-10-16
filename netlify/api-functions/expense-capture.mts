import type { Config } from '@netlify/functions'
import { createHash } from 'node:crypto'
import { EXPENSE_BUCKET, expenseAdminClient, extractExpense } from '../lib/expense-ai.mts'
import { CAPTURE_DAILY_LIMIT, isCaptureToken } from '../../src/lib/expense-capture.ts'
import { monthOf } from '../../src/lib/expense-categories.ts'
import { safeFileName, validateStartUpload } from '../../src/lib/expense-validation.ts'

// Public endpoint for the phone capture page (/despesa/<token>). The secret
// token in the link is the only credential: it is checked against its SHA-256
// hash, expiry and revocation on every call, and can only create and read
// the expenses it uploaded itself.

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> } catch { return json({ error: 'Pedido inválido.' }, 400) }
  if (!isCaptureToken(body.token)) return json({ error: 'Link inválido.' }, 404)

  const supabase = expenseAdminClient()
  const tokenHash = createHash('sha256').update(body.token).digest('hex')
  const { data: link } = await supabase.from('expense_capture_links')
    .select('id, label, created_by, expires_at, revoked_at')
    .eq('token_hash', tokenHash).maybeSingle()
  if (!link) return json({ error: 'Link inválido.' }, 404)
  if (link.revoked_at) return json({ error: 'Este link foi desativado. Peça um novo no backoffice.' }, 410)
  if (Date.parse(link.expires_at) < Date.now()) return json({ error: 'Este link expirou. Peça um novo no backoffice.' }, 410)

  const action = body.action

  if (action === 'check') {
    const { data: recent } = await supabase.from('company_expenses')
      .select('id, status, supplier_name, total_amount, currency, invoice_date, created_at')
      .eq('capture_link_id', link.id).order('created_at', { ascending: false }).limit(5)
    return json({ label: link.label, recent: recent ?? [] })
  }

  if (action === 'start') {
    let input
    try { input = validateStartUpload(body) } catch (err) { return json({ error: (err as Error).message }, 400) }
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count } = await supabase.from('company_expenses')
      .select('id', { count: 'exact', head: true })
      .eq('capture_link_id', link.id).gte('created_at', since)
    if ((count ?? 0) >= CAPTURE_DAILY_LIMIT) return json({ error: 'Limite diário de envios atingido. Tente amanhã.' }, 429)

    const id = crypto.randomUUID()
    const now = new Date()
    const path = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}/${safeFileName(input.fileName)}`
    const { error: insertError } = await supabase.from('company_expenses').insert({
      id,
      status: 'processing',
      source: 'capture',
      capture_link_id: link.id,
      file_path: path,
      file_name: input.fileName.slice(0, 255),
      file_mime: input.mime,
      file_size: input.size,
      reference_month: monthOf(now.toISOString().slice(0, 10)),
      created_by: link.created_by,
    })
    if (insertError) return json({ error: 'Não foi possível registar a despesa.' }, 500)
    const { data: signed, error: signError } = await supabase.storage.from(EXPENSE_BUCKET).createSignedUploadUrl(path)
    if (signError || !signed) {
      await supabase.from('company_expenses').delete().eq('id', id)
      return json({ error: 'Não foi possível preparar o envio.' }, 500)
    }
    return json({ id, path, token: signed.token })
  }

  if (action === 'process') {
    const id = typeof body.id === 'string' ? body.id : ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Despesa inválida.' }, 400)
    const { data: owned } = await supabase.from('company_expenses')
      .select('id').eq('id', id).eq('capture_link_id', link.id).maybeSingle()
    if (!owned) return json({ error: 'Despesa não encontrada.' }, 404)

    const now = new Date().toISOString()
    const { data: usage } = await supabase.from('expense_capture_links').select('uploads_count').eq('id', link.id).single()
    await supabase.from('expense_capture_links')
      .update({ last_used_at: now, uploads_count: (usage?.uploads_count ?? 0) + 1 }).eq('id', link.id)

    const result = await extractExpense(supabase, id, { autoConfirm: true })
    if (!result.ok) {
      // The photo is safely archived; it waits in the backoffice for manual review.
      return json({ archived: true, status: 'failed', error: result.error })
    }
    const e = result.expense
    return json({
      archived: true,
      status: e.status,
      supplier_name: e.supplier_name,
      invoice_date: e.invoice_date,
      total_amount: e.total_amount,
      currency: e.currency,
    })
  }

  if (action === 'cancel') {
    // Upload to storage failed on the phone: remove the empty placeholder row.
    const id = typeof body.id === 'string' ? body.id : ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Despesa inválida.' }, 400)
    await supabase.from('company_expenses').delete()
      .eq('id', id).eq('capture_link_id', link.id).eq('status', 'processing').is('extracted_at', null)
    return json({ ok: true })
  }

  return json({ error: 'Ação desconhecida.' }, 400)
}

export const config: Config = {
  path: '/api/expense-capture',
}
