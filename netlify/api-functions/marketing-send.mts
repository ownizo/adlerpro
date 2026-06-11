import type { Context } from '@netlify/functions'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import { resolveMarketingRecipients } from '../../src/lib/data'

const FROM_EMAIL = 'Adler & Rochefort <insurance@adlerrochefort.com>'
const REPLY_TO = 'insurance@adlerrochefort.com'
const BATCH_SIZE = 100

// ── Brand tokens (espelham src/lib/email/templates/BaseLayout.tsx) ───────────
const NAVY = '#1B2B4B'
const GOLD = '#C9A84C'

// ── Helpers de HTML (tabelas + inline-styles; compatível com Gmail/Outlook/Apple Mail) ─────────

function emailWrap(inner: string): string {
  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Adler &amp; Rochefort</title>
</head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#F4F6F9;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background:#ffffff;border-radius:4px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
        ${inner}
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function emailHeader(): string {
  return `
  <tr>
    <td style="background:${NAVY};padding:24px 32px;">
      <table cellpadding="0" cellspacing="0" role="presentation" width="100%"><tr>
        <td style="width:44px;vertical-align:middle;">
          <div style="width:36px;height:36px;background:${GOLD};border-radius:4px;text-align:center;line-height:36px;">
            <span style="color:#ffffff;font-size:20px;font-weight:900;font-family:Arial,sans-serif;">A</span>
          </div>
        </td>
        <td style="vertical-align:middle;padding-left:12px;">
          <div style="color:#ffffff;font-size:16px;font-weight:700;letter-spacing:.06em;line-height:1.2;font-family:Arial,sans-serif;">ADLER &amp; ROCHEFORT</div>
          <div style="color:${GOLD};font-size:9px;letter-spacing:.18em;text-transform:uppercase;line-height:1.4;font-family:Arial,sans-serif;">Mediadores de Seguros</div>
        </td>
      </tr></table>
    </td>
  </tr>`
}

function subBanner(text: string, bg: string, fg = '#ffffff'): string {
  return `
  <tr>
    <td style="background:${bg};padding:11px 32px;text-align:center;">
      <span style="color:${fg};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-family:Arial,sans-serif;">${text}</span>
    </td>
  </tr>`
}

function emailFooter(): string {
  return `
  <tr>
    <td style="background:#F8F8F8;padding:20px 32px;border-top:1px solid #eeeeee;">
      <p style="font-size:11px;color:#aaaaaa;margin:0 0 3px;line-height:1.6;font-family:Arial,sans-serif;"><strong style="color:#666666;">Adler &amp; Rochefort</strong> · Mediadores de Seguros</p>
      <p style="font-size:11px;color:#aaaaaa;margin:0 0 3px;line-height:1.6;font-family:Arial,sans-serif;">Tel. +351 928 226 570 &nbsp;·&nbsp; <a href="mailto:insurance@adlerrochefort.com" style="color:#aaaaaa;text-decoration:none;">insurance@adlerrochefort.com</a> &nbsp;·&nbsp; <a href="https://adlerrochefort.com" style="color:#aaaaaa;text-decoration:none;">adlerrochefort.com</a></p>
      <p style="font-size:11px;color:#aaaaaa;margin:0 0 10px;line-height:1.6;font-family:Arial,sans-serif;">Mediador registado na ASF sob o n.º 425591790/3</p>
      <p style="font-size:10px;color:#bbbbbb;margin:0;line-height:1.5;font-family:Arial,sans-serif;">Se não pretende receber comunicações de marketing, responda a este email com a palavra <strong style="color:#999999;">Remover</strong>.</p>
    </td>
  </tr>`
}

function ctaButton(label: string, url: string): string {
  return `
  <tr>
    <td style="padding:4px 32px 28px;text-align:center;">
      <a href="${url}" style="display:inline-block;background:${GOLD};color:#ffffff;font-size:14px;font-weight:700;padding:14px 36px;border-radius:4px;text-decoration:none;letter-spacing:.03em;font-family:Arial,sans-serif;">${label} &#8594;</a>
    </td>
  </tr>`
}

// ── Templates ────────────────────────────────────────────────────────────────

function tplFeedback(name: string, vars: Record<string, unknown>): string {
  const salutation = name ? `Olá ${name},` : 'Olá,'
  const intro =
    (vars.intro as string | undefined) ??
    'Obrigado por confiar na <strong>Adler &amp; Rochefort</strong> para gerir os seus seguros. ' +
      'A sua satisfação é a nossa maior recompensa — e a sua opinião ajuda-nos a melhorar continuamente o nosso serviço.'
  const googleUrl =
    (vars.googleUrl as string | undefined) ?? 'https://g.page/r/CXBg1laCXvghEBM/review'
  const ctaLabel = (vars.ctaLabel as string | undefined) ?? 'Deixar avaliação'

  return emailWrap(
    emailHeader() +
      subBanner('&#9733;&nbsp; A SUA OPINIÃO É VALIOSA PARA NÓS', GOLD, NAVY) +
      `
  <tr><td style="padding:32px 32px 20px;font-family:Arial,sans-serif;">
    <p style="font-size:15px;color:#222222;margin:0 0 16px;font-weight:600;">${salutation}</p>
    <p style="font-size:14px;color:#555555;line-height:1.75;margin:0 0 24px;">${intro}</p>
    <p style="font-size:32px;color:${GOLD};letter-spacing:6px;margin:0 0 16px;text-align:center;line-height:1;">&#9733;&#9733;&#9733;&#9733;&#9733;</p>
    <p style="font-size:14px;color:#777777;line-height:1.75;margin:0 0 8px;text-align:center;">Levaria apenas <strong style="color:#444444;">um minuto</strong> — e significaria muito para a nossa equipa.</p>
  </td></tr>` +
      ctaButton(ctaLabel, googleUrl) +
      emailFooter(),
  )
}

function tplRenewal(name: string, vars: Record<string, unknown>): string {
  const salutation = name ? `Olá ${name},` : 'Olá,'
  const intro =
    (vars.intro as string | undefined) ??
    'A sua apólice aproxima-se da data de renovação. Este é o momento ideal para rever as suas ' +
      'coberturas, garantir que continuam adequadas às suas necessidades actuais e, se quiser, ' +
      'explorar alternativas no mercado segurador.'
  const ctaLabel = (vars.ctaLabel as string | undefined) ?? 'Falar connosco'
  const ctaUrl =
    (vars.ctaUrl as string | undefined) ?? 'mailto:insurance@adlerrochefort.com'

  return emailWrap(
    emailHeader() +
      subBanner('Renovação de Apólice — Estamos Aqui para Ajudar', NAVY) +
      `
  <tr><td style="padding:32px 32px 8px;font-family:Arial,sans-serif;">
    <p style="font-size:15px;color:#222222;margin:0 0 16px;font-weight:600;">${salutation}</p>
    <p style="font-size:14px;color:#555555;line-height:1.75;margin:0 0 20px;">${intro}</p>
    <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;margin:0 0 20px;">
      <tr><td style="padding:8px 0;font-size:14px;color:#333333;line-height:1.5;border-bottom:1px solid #f0f0f0;font-family:Arial,sans-serif;">
        <span style="color:${GOLD};font-weight:700;margin-right:10px;">&#10003;</span>Rever coberturas e condições da apólice
      </td></tr>
      <tr><td style="padding:8px 0;font-size:14px;color:#333333;line-height:1.5;border-bottom:1px solid #f0f0f0;font-family:Arial,sans-serif;">
        <span style="color:${GOLD};font-weight:700;margin-right:10px;">&#10003;</span>Comparar alternativas no mercado segurador
      </td></tr>
      <tr><td style="padding:8px 0;font-size:14px;color:#333333;line-height:1.5;font-family:Arial,sans-serif;">
        <span style="color:${GOLD};font-weight:700;margin-right:10px;">&#10003;</span>Garantir continuidade e sem lacunas de proteção
      </td></tr>
    </table>
    <p style="font-size:14px;color:#555555;line-height:1.75;margin:0 0 24px;">Fale connosco — tratamos de tudo, sem custos adicionais para si.</p>
  </td></tr>` +
      ctaButton(ctaLabel, ctaUrl) +
      emailFooter(),
  )
}

function tplPresentation(name: string, vars: Record<string, unknown>): string {
  const salutation = name ? `Olá ${name},` : 'Olá,'
  const intro =
    (vars.intro as string | undefined) ??
    'Somos a <strong>Adler &amp; Rochefort</strong>, mediadores de seguros independentes. ' +
      'Trabalhamos exclusivamente do seu lado — sem vínculos a nenhuma seguradora — para encontrar ' +
      'as melhores coberturas ao melhor preço para si e para a sua empresa.'
  const ctaLabel = (vars.ctaLabel as string | undefined) ?? 'Conhecer os nossos serviços'
  const ctaUrl = (vars.ctaUrl as string | undefined) ?? 'https://adlerrochefort.com'
  const defaultBullets = [
    'Multirriscos Empresarial e Habitação',
    'Automóvel e Frotas',
    'Vida e Saúde',
    'Responsabilidade Civil',
    'Acidentes de Trabalho',
    'Cyber, Directors &amp; Officers e Ramos Técnicos',
  ]
  const bullets = (vars.bullets as string[] | undefined) ?? defaultBullets
  const bulletRows = bullets
    .map(
      (b) => `
      <tr><td style="padding:6px 0;font-size:14px;color:#333333;line-height:1.5;font-family:Arial,sans-serif;vertical-align:top;">
        <span style="display:inline-block;width:7px;height:7px;background:${GOLD};border-radius:50%;margin-right:10px;vertical-align:middle;"></span>${b}
      </td></tr>`,
    )
    .join('')

  return emailWrap(
    emailHeader() +
      subBanner('Mediadores de Seguros Independentes', NAVY) +
      `
  <tr><td style="padding:32px 32px 8px;font-family:Arial,sans-serif;">
    <p style="font-size:15px;color:#222222;margin:0 0 16px;font-weight:600;">${salutation}</p>
    <p style="font-size:14px;color:#555555;line-height:1.75;margin:0 0 24px;">${intro}</p>

    <p style="font-size:11px;color:#888888;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin:0 0 10px;font-family:Arial,sans-serif;">Ramos que trabalhamos</p>
    <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;margin:0 0 24px;">
      ${bulletRows}
    </table>

    <div style="background:#F4F6F9;border-left:3px solid ${GOLD};border-radius:0 4px 4px 0;padding:16px 20px;margin:0 0 24px;">
      <p style="font-size:11px;color:#888888;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin:0 0 10px;font-family:Arial,sans-serif;">Porque escolher-nos?</p>
      <p style="font-size:14px;color:#444444;line-height:1.7;margin:0 0 7px;font-family:Arial,sans-serif;">&#8594;&nbsp; Aconselhamento independente e imparcial</p>
      <p style="font-size:14px;color:#444444;line-height:1.7;margin:0 0 7px;font-family:Arial,sans-serif;">&#8594;&nbsp; Comparação entre múltiplas seguradoras</p>
      <p style="font-size:14px;color:#444444;line-height:1.7;margin:0;font-family:Arial,sans-serif;">&#8594;&nbsp; Acompanhamento dedicado em caso de sinistro</p>
    </div>
  </td></tr>` +
      ctaButton(ctaLabel, ctaUrl) +
      emailFooter(),
  )
}

function tplSeasonal(name: string, vars: Record<string, unknown>): string {
  const salutation = name ? `Olá ${name},` : 'Olá,'
  const headline = (vars.headline as string | undefined) ?? 'Uma mensagem da nossa equipa'
  const body = (vars.body as string | undefined) ?? ''
  const bannerBg = (vars.bannerColor as string | undefined) ?? NAVY
  const ctaLabel = vars.ctaLabel as string | undefined
  const ctaUrl = vars.ctaUrl as string | undefined

  return emailWrap(
    emailHeader() +
      subBanner(headline, bannerBg) +
      `
  <tr><td style="padding:32px 32px 24px;font-family:Arial,sans-serif;">
    <p style="font-size:15px;color:#222222;margin:0 0 16px;font-weight:600;">${salutation}</p>
    <div style="font-size:14px;color:#555555;line-height:1.75;">${body}</div>
  </td></tr>` +
      (ctaLabel && ctaUrl ? ctaButton(ctaLabel, ctaUrl) : '') +
      emailFooter(),
  )
}

// ── Dispatch por template_key — assinatura mantida da slice 3 ────────────────
function renderMarketingEmail(
  templateKey: string,
  vars: Record<string, unknown>,
  recipientName: string,
  _recipientEmail: string,
): string {
  const name = recipientName?.trim() ?? ''
  switch (templateKey) {
    case 'feedback':
      return tplFeedback(name, vars)
    case 'renewal':
      return tplRenewal(name, vars)
    case 'presentation':
      return tplPresentation(name, vars)
    case 'seasonal':
      return tplSeasonal(name, vars)
    default:
      return tplSeasonal(name, vars)
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
    .select('id, subject, template_key, audience, template_vars, single_recipient_email')
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
  const singleRecipientEmail = campaign.single_recipient_email as string | null

  // ── RESOLVER DESTINATÁRIOS ─────────────────────────────────────────────────────────────────
  // Quando single_recipient_email está presente (lido da BD — nunca do payload da chamada),
  // a audience é IGNORADA por completo. O destinatário é construído exclusivamente a partir
  // do registo em individual_clients verificado aqui no servidor.
  let recipients: Awaited<ReturnType<typeof resolveMarketingRecipients>>['recipients']

  if (singleRecipientEmail) {
    const { data: ic } = await sb
      .from('individual_clients')
      .select('full_name, email, marketing_opt_out')
      .eq('email', singleRecipientEmail)
      .maybeSingle()

    if (!ic) {
      await sb.from('marketing_campaigns').update({ status: 'draft' }).eq('id', campaignId)
      return resp({ error: `Destinatário único não encontrado: ${singleRecipientEmail}` }, 422)
    }

    const icRow = ic as { full_name: string | null; email: string; marketing_opt_out: boolean }
    if (icRow.marketing_opt_out) {
      await sb.from('marketing_campaigns').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        total_recipients: 0,
        total_sent: 0,
        total_errors: 0,
      }).eq('id', campaignId)
      return resp({ totalRecipients: 0, sent: 0, errors: 0 }, 200)
    }

    recipients = [{ email: icRow.email, name: icRow.full_name ?? '', type: 'individual_client' as const, refId: '' }]
  } else {
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
      replyTo: REPLY_TO,
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
            replyTo: REPLY_TO,
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
