import type { Context } from '@netlify/functions'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

const RESEND_API_KEY = process.env.RESEND_API_KEY!
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const FROM_EMAIL = 'Adler Pro <noreply@adlerrochefort.com>'

// Thresholds de alerta em dias
const ALERT_THRESHOLDS = [90, 60, 30, 14, 7]

function daysUntil(dateStr: string): number {
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' })
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value || 0)
}

const POLICY_TYPE_LABELS: Record<string, string> = {
  auto: 'Automóvel', health: 'Saúde', property: 'Propriedade',
  liability: 'Responsabilidade Civil', workers_comp: 'Acidentes de Trabalho',
  cyber: 'Cyber', directors_officers: 'D&O', business_interruption: 'Interrupção de Negócio',
  life: 'Vida', other: 'Outro',
}

const POLICY_TYPE_COLORS: Record<string, string> = {
  auto: '#3B82F6', health: '#22C55E', property: '#F97316',
  liability: '#A855F7', workers_comp: '#F43F5E', cyber: '#0EA5E9',
  directors_officers: '#78716C', business_interruption: '#F59E0B',
  life: '#16A34A', other: '#999999',
}

function urgencyConfig(days: number): { color: string; label: string; emoji: string } {
  if (days <= 7)  return { color: '#dc2626', label: 'URGENTE', emoji: '🚨' }
  if (days <= 14) return { color: '#dc2626', label: 'MUITO URGENTE', emoji: '⚠️' }
  if (days <= 30) return { color: '#d97706', label: 'ATENÇÃO', emoji: '⏰' }
  if (days <= 60) return { color: '#C8961A', label: 'AVISO', emoji: '📋' }
  return { color: '#555555', label: 'INFORMAÇÃO', emoji: '📅' }
}

function buildEmailHTML(companyName: string, policies: any[]): string {
  const policyRows = policies.map((p) => {
    const days = daysUntil(p.end_date)
    const urg = urgencyConfig(days)
    const typeColor = POLICY_TYPE_COLORS[p.type] || '#999999'
    const typeLabel = POLICY_TYPE_LABELS[p.type] || p.type
    return `
      <tr>
        <td style="padding: 12px 16px; border-bottom: 1px solid #f0f0f0;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${typeColor}; flex-shrink: 0;"></span>
            <div>
              <div style="font-weight: 600; font-size: 13px; color: #111111;">${typeLabel}</div>
              <div style="font-size: 11px; color: #888888;">${p.insurer} · ${p.policy_number || 'N/A'}</div>
            </div>
          </div>
        </td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #f0f0f0; font-size: 13px; color: #333333;">
          ${formatDate(p.end_date)}
        </td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #f0f0f0;">
          <span style="display: inline-block; background: ${urg.color}22; color: ${urg.color}; font-weight: 700; font-size: 12px; padding: 3px 10px; border-radius: 20px;">
            ${urg.emoji} ${days} dias
          </span>
        </td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #f0f0f0; font-size: 13px; font-weight: 600; color: #111111; text-align: right;">
          ${formatCurrency(p.annual_premium)}
        </td>
      </tr>
    `
  }).join('')

  const mostUrgentDays = Math.min(...policies.map((p) => daysUntil(p.end_date)))
  const topUrg = urgencyConfig(mostUrgentDays)

  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Alertas de Renovação — Adler Pro</title>
</head>
<body style="margin: 0; padding: 0; background: #f5f5f5; font-family: 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background: #f5f5f5; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background: #ffffff; border-radius: 4px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.08);">
          
          <!-- Header -->
          <tr>
            <td style="background: #111111; padding: 28px 32px; text-align: center;">
              <div style="display: inline-flex; align-items: center; gap: 12px;">
                <div style="width: 40px; height: 40px; background: #C8961A; border-radius: 4px; display: flex; align-items: center; justify-content: center;">
                  <span style="color: #ffffff; font-size: 20px; font-weight: 900;">A</span>
                </div>
                <div style="text-align: left;">
                  <div style="color: #ffffff; font-size: 18px; font-weight: 700; letter-spacing: 0.05em;">ADLER PRO</div>
                  <div style="color: #C8961A; font-size: 10px; font-weight: 300; letter-spacing: 0.15em; text-transform: uppercase;">Gestão de Seguros</div>
                </div>
              </div>
            </td>
          </tr>

          <!-- Alert Banner -->
          <tr>
            <td style="background: ${topUrg.color}; padding: 14px 32px; text-align: center;">
              <span style="color: #ffffff; font-size: 13px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;">
                ${topUrg.emoji} ${topUrg.label} — Apólices a Renovar
              </span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              <p style="font-size: 15px; color: #333333; margin: 0 0 8px; font-weight: 600;">
                Caro(a) ${companyName},
              </p>
              <p style="font-size: 14px; color: #666666; margin: 0 0 24px; line-height: 1.6;">
                A sua equipa da <strong>Adler &amp; Rochefort</strong> identificou ${policies.length === 1 ? 'uma apólice que necessita' : `${policies.length} apólices que necessitam`} de renovação nos próximos meses. Recomendamos que contacte o seu mediador para iniciar o processo de renovação com antecedência.
              </p>

              <!-- Policies Table -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #eeeeee; border-radius: 4px; overflow: hidden; margin-bottom: 24px;">
                <thead>
                  <tr style="background: #f8f8f8;">
                    <th style="padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 700; color: #888888; text-transform: uppercase; letter-spacing: 0.06em;">Apólice</th>
                    <th style="padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 700; color: #888888; text-transform: uppercase; letter-spacing: 0.06em;">Expira em</th>
                    <th style="padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 700; color: #888888; text-transform: uppercase; letter-spacing: 0.06em;">Prazo</th>
                    <th style="padding: 10px 16px; text-align: right; font-size: 11px; font-weight: 700; color: #888888; text-transform: uppercase; letter-spacing: 0.06em;">Prémio</th>
                  </tr>
                </thead>
                <tbody>
                  ${policyRows}
                </tbody>
              </table>

              <!-- CTA -->
              <div style="text-align: center; margin-bottom: 24px;">
                <a href="https://pro.adlerrochefort.com/policies" style="display: inline-block; background: #C8961A; color: #ffffff; font-size: 14px; font-weight: 700; padding: 14px 32px; border-radius: 4px; text-decoration: none; letter-spacing: 0.03em;">
                  Ver Apólices no Portal →
                </a>
              </div>

              <p style="font-size: 13px; color: #888888; line-height: 1.6; margin: 0;">
                Pode também utilizar o nosso <strong>Comparativo de Cotações IA</strong> para obter uma análise comparativa de propostas de diferentes seguradoras antes de renovar.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background: #f8f8f8; padding: 20px 32px; border-top: 1px solid #eeeeee;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="font-size: 11px; color: #aaaaaa; margin: 0; line-height: 1.6;">
                      <strong style="color: #666666;">Adler &amp; Rochefort</strong> · Mediadores de Seguros<br>
                      Este email foi enviado automaticamente pelo sistema Adler Pro.<br>
                      Para deixar de receber estas notificações, contacte o seu mediador.
                    </p>
                  </td>
                  <td style="text-align: right; vertical-align: middle;">
                    <div style="width: 32px; height: 32px; background: #111111; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center;">
                      <span style="color: #C8961A; font-size: 16px; font-weight: 900;">A</span>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export default async function handler(req: Request, context: Context) {
  // Verificar autorização — aceita pedidos do Netlify Scheduled Functions ou com token admin
  const authHeader = req.headers.get('authorization')
  const isScheduled = req.headers.get('x-netlify-scheduled') === 'true'
  const isAdmin = authHeader === `Bearer ${process.env.ADMIN_SECRET || 'adler-admin-2025'}`

  if (!isScheduled && !isAdmin) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY não configurada' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const resend = new Resend(RESEND_API_KEY)
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Buscar todas as apólices activas que expiram nos próximos 90 dias
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const in90Days = new Date(today); in90Days.setDate(in90Days.getDate() + 90)

  const { data: policies, error: policiesError } = await sb
    .from('policies')
    .select('*')
    .in('status', ['active', 'expiring'])
    .gte('end_date', today.toISOString().split('T')[0])
    .lte('end_date', in90Days.toISOString().split('T')[0])
    .order('end_date', { ascending: true })

  if (policiesError) {
    console.error('Erro ao buscar apólices:', policiesError)
    return new Response(JSON.stringify({ error: 'Erro ao buscar apólices' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!policies || policies.length === 0) {
    return new Response(JSON.stringify({ message: 'Nenhuma apólice a expirar nos próximos 90 dias', sent: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Agrupar apólices por empresa
  const byCompany: Record<string, any[]> = {}
  for (const policy of policies) {
    const companyId = policy.company_id
    if (!byCompany[companyId]) byCompany[companyId] = []
    byCompany[companyId].push(policy)
  }

  const companyIds = Object.keys(byCompany)

  // Buscar dados das empresas
  const { data: companies } = await sb
    .from('companies')
    .select('id, name, contact_email, access_email')
    .in('id', companyIds)

  // Buscar utilizadores das empresas (para enviar a todos os owners/managers)
  const { data: companyUsers } = await sb
    .from('company_users')
    .select('company_id, email, name, role')
    .in('company_id', companyIds)
    .in('role', ['owner', 'manager'])

  const results: { companyId: string; companyName: string; emailsSent: string[]; policiesCount: number }[] = []
  let totalSent = 0

  for (const companyId of companyIds) {
    const companyPolicies = byCompany[companyId]
    const company = companies?.find((c) => c.id === companyId)
    if (!company) continue

    const companyName = company.name || 'Cliente'

    // Destinatários: contact_email + access_email + owners/managers
    const recipientEmails = new Set<string>()
    if (company.contact_email) recipientEmails.add(company.contact_email)
    if (company.access_email) recipientEmails.add(company.access_email)
    const users = companyUsers?.filter((u) => u.company_id === companyId) || []
    for (const user of users) {
      if (user.email) recipientEmails.add(user.email)
    }

    if (recipientEmails.size === 0) {
      console.warn(`Empresa ${companyId} sem email de contacto`)
      continue
    }

    const emailHTML = buildEmailHTML(companyName, companyPolicies)
    const mostUrgentDays = Math.min(...companyPolicies.map((p) => daysUntil(p.end_date)))
    const urg = urgencyConfig(mostUrgentDays)

    const subject = companyPolicies.length === 1
      ? `${urg.emoji} Apólice a expirar em ${mostUrgentDays} dias — ${companyPolicies[0].insurer}`
      : `${urg.emoji} ${companyPolicies.length} apólices a renovar — Adler Pro`

    try {
      const emailList = Array.from(recipientEmails)
      await resend.emails.send({
        from: FROM_EMAIL,
        to: emailList,
        subject,
        html: emailHTML,
      })
      results.push({ companyId, companyName, emailsSent: emailList, policiesCount: companyPolicies.length })
      totalSent += emailList.length
      console.log(`✓ Email enviado para ${companyName} (${emailList.join(', ')}) — ${companyPolicies.length} apólice(s)`)
    } catch (err) {
      console.error(`✗ Erro ao enviar email para ${companyName}:`, err)
    }
  }

  return new Response(JSON.stringify({
    message: `Alertas enviados com sucesso`,
    sent: totalSent,
    companies: results.length,
    details: results,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
