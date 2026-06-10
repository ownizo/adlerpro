import type { Context } from '@netlify/functions'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import { resolveMarketingRecipients } from '../../src/lib/data'

const FROM_EMAIL = 'Adler Pro <noreply@adlerrochefort.com>'
const BATCH_SIZE = 100

// ── Ponto de extensão — slice 4 substitui cada case pelo template completo ──
// renderMarketingEmail é a única função que a slice 4 precisa de preencher;
// o resto da lógica de envio não muda.
function renderMarketingEmail(
  templateKey: string,
  vars: Record<string, unknown>,
  recipientName: string,
  recipientEmail: string,
): string {
  const name = recipientName || 'Cliente'
  const unsubUrl = `https://adlerrochefort.com/unsubscribe?email=${encodeURIComponent(recipientEmail)}`
  const bodyText =
    (vars.body as string | undefined) ??
    (vars.subject as string | undefined) ??
    templateKey

  switch (templateKey) {
    case 'feedback':
    case 'renewal':
    case 'presentation':
    case 'seasonal':
    default:
      return `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8"><title>Adler Pro</title></head>
<body style="margin:0;padding:32px;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;margin:0 auto;border-radius:4px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
    <tr><td style="background:#111111;padding:20px 32px;text-align:center;">
      <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.05em;">ADLER PRO</span>
    </td></tr>
    <tr><td style="padding:32px;">
      <p style="font-size:15px;color:#333333;margin:0 0 12px;font-weight:600;">Caro(a) ${name},</p>
      <p style="font-size:14px;color:#555555;line-height:1.7;margin:0 0 24px;">${bodyText}</p>
    </td></tr>
    <tr><td style="background:#f8f8f8;padding:16px 32px;border-top:1px solid #eeeeee;">
      <p style="font-size:11px;color:#aaaaaa;margin:0;line-height:1.6;">
        <strong style="color:#666666;">Adler &amp; Rochefort</strong> · Mediadores de Seguros<br>
        <a href="${unsubUrl}" style="color:#aaaaaa;">Cancelar subscrição</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`
  }
}

export const config = {
  path: '/api/marketing-send',
}

export default async function handler(req: Request, _context: Context) {
  // ── Auth: Bearer ADMIN_SECRET — falha segura se a variável não estiver configurada ───────────
  // Sem fallback: se ADMIN_SECRET não existir, a função recusa-se a correr (500) em vez de
  // aceitar o segredo hardcoded que qualquer leitor do repositório conheceria.
  const adminSecret = process.env.ADMIN_SECRET
  if (!adminSecret) {
    return resp({ error: 'ADMIN_SECRET não configurado no servidor' }, 500)
  }

  const isAdmin = req.headers.get('authorization') === `Bearer ${adminSecret}`
  if (!isAdmin) {
    return resp({ error: 'Não autorizado' }, 401)
  }

  let campaignId: string
  try {
    const body = await req.json()
    campaignId = body?.campaignId
    if (!campaignId || typeof campaignId !== 'string') throw new Error()
  } catch {
    return resp({ error: 'campaignId obrigatório no body' }, 400)
  }

  if (!process.env.RESEND_API_KEY) {
    return resp({ error: 'RESEND_API_KEY não configurada' }, 500)
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // ── TRAVA ATÓMICA: draft → sending ─────────────────────────────────────────────────────────
  // UPDATE ... WHERE status='draft' é atómica no PostgreSQL: dois pedidos concorrentes competem
  // pela mesma linha; só um obtém o RETURNING. O segundo vê 0 linhas → 409, sem envio duplo.
  const { data: campaign } = await sb
    .from('marketing_campaigns')
    .update({ status: 'sending' })
    .eq('id', campaignId)
    .eq('status', 'draft')
    .select('id, subject, template_key, audience, template_vars')
    .maybeSingle()

  if (!campaign) {
    return resp(
      { error: 'Campanha já foi enviada ou está a ser enviada (duplo-envio prevenido)' },
      409,
    )
  }

  const subject = campaign.subject as string
  const templateKey = campaign.template_key as string
  const audience = campaign.audience as
    | 'companies'
    | 'company_users'
    | 'individual_clients'
    | 'all'
  const vars = (campaign.template_vars as Record<string, unknown>) ?? {}

  // ── RESOLVER DESTINATÁRIOS (função partilhada da slice 2) ──────────────────────────────────
  let recipients: Awaited<ReturnType<typeof resolveMarketingRecipients>>['recipients']
  try {
    const resolved = await resolveMarketingRecipients(audience)
    recipients = resolved.recipients
  } catch (err) {
    // Reverte para draft se a resolução falhar — campanha pode ser resubmetida
    await sb.from('marketing_campaigns').update({ status: 'draft' }).eq('id', campaignId)
    return resp(
      { error: `Erro ao resolver destinatários: ${err instanceof Error ? err.message : String(err)}` },
      500,
    )
  }

  const totalRecipients = recipients.length

  if (totalRecipients === 0) {
    await sb
      .from('marketing_campaigns')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        total_recipients: 0,
        total_sent: 0,
        total_errors: 0,
      })
      .eq('id', campaignId)
    return resp({ totalRecipients: 0, sent: 0, errors: 0 }, 200)
  }

  // ── INSERIR TODOS OS DESTINATÁRIOS em marketing_sends (status='pending') ───────────────────
  // Bulk insert em lotes de 500 para não exceder limites de payload do Supabase
  const pendingRows = recipients.map((r) => ({
    campaign_id: campaignId,
    recipient_email: r.email,
    recipient_name: r.name || null,
    recipient_type: r.type,
    recipient_ref_id: r.refId,
    status: 'pending',
  }))
  for (let i = 0; i < pendingRows.length; i += 500) {
    await sb.from('marketing_sends').insert(pendingRows.slice(i, i + 500))
  }

  // ── ENVIO EM LOTES ─────────────────────────────────────────────────────────────────────────
  // Estratégia: resend.batch.send (até 100 por chamada API).
  // Se um batch inteiro falhar (erro de rede, rate-limit, etc.), cai back para envios
  // individuais com Promise.allSettled — cada email é tratado independentemente,
  // uma falha individual NUNCA aborta os restantes.
  let totalSent = 0
  let totalErrors = 0

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batchRecipients = recipients.slice(i, i + BATCH_SIZE)
    const sentAt = new Date().toISOString()

    const batchPayload = batchRecipients.map((r) => ({
      from: FROM_EMAIL,
      to: [r.email] as [string],
      subject,
      html: renderMarketingEmail(templateKey, vars, r.name, r.email),
    }))

    const { data: batchData, error: batchErr } = await resend.batch.send(batchPayload)

    if (!batchErr && batchData) {
      // Batch enviado com sucesso — atualiza todas as linhas em paralelo
      await Promise.all(
        batchRecipients.map((r, j) =>
          sb
            .from('marketing_sends')
            .update({
              status: 'sent',
              resend_id: batchData.data[j]?.id ?? null,
              sent_at: sentAt,
            })
            .eq('campaign_id', campaignId)
            .eq('recipient_email', r.email),
        ),
      )
      totalSent += batchRecipients.length
    } else {
      // Batch falhou — tenta envios individuais para não perder os que teriam sucesso
      const individualResults = await Promise.allSettled(
        batchRecipients.map((r) =>
          resend.emails.send({
            from: FROM_EMAIL,
            to: [r.email],
            subject,
            html: renderMarketingEmail(templateKey, vars, r.name, r.email),
          }),
        ),
      )

      await Promise.all(
        individualResults.map((result, j) => {
          const r = batchRecipients[j]
          if (result.status === 'fulfilled' && !result.value.error) {
            totalSent++
            return sb
              .from('marketing_sends')
              .update({
                status: 'sent',
                resend_id: result.value.data?.id ?? null,
                sent_at: sentAt,
              })
              .eq('campaign_id', campaignId)
              .eq('recipient_email', r.email)
          } else {
            totalErrors++
            const errMsg =
              result.status === 'rejected'
                ? String(result.reason)
                : String(result.value.error?.message ?? 'erro desconhecido')
            return sb
              .from('marketing_sends')
              .update({ status: 'error', error_message: errMsg })
              .eq('campaign_id', campaignId)
              .eq('recipient_email', r.email)
          }
        }),
      )
    }

    // Pausa de 100ms entre lotes para respeitar rate limits do Resend
    if (i + BATCH_SIZE < recipients.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
    }
  }

  // ── FINALIZAR CAMPANHA ─────────────────────────────────────────────────────────────────────
  await sb
    .from('marketing_campaigns')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      total_recipients: totalRecipients,
      total_sent: totalSent,
      total_errors: totalErrors,
    })
    .eq('id', campaignId)

  return resp({ totalRecipients, sent: totalSent, errors: totalErrors }, 200)
}

function resp(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
