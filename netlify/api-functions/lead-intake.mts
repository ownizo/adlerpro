import type { Context } from '@netlify/functions'
import {
  findOrCreateIndividualClientByEmail,
  createWebsiteLead,
  createSalesOpportunityForWebsiteLead,
} from '../../src/lib/data'
import { parseLeadIntakePayload, buildLeadIntakeResponse } from './lib/lead-intake-shared'

// -----------------------------------------------------------------------------
// lead-intake.mts — porta de entrada server-to-server para leads de PESSOAS
// SINGULARES vindos do site público (adlerrochefort.com).
//
// Chamado por adlerrochefort/netlify/functions/submission-created.mjs,
// best-effort, DEPOIS de o email de notificação já ter sido enviado — nunca
// bloqueia nem substitui esse fluxo (ver arquitetura em submission-created.mjs
// nesse repo).
//
// Segurança: Bearer LEAD_INTAKE_SECRET dedicado — NÃO reutiliza ADMIN_SECRET
// (esse serve o admin autenticado por sessão; este serve um outro site
// inteiro, com o seu próprio ciclo de rotação). Fail closed: sem o segredo
// configurado no servidor, o endpoint recusa-se a correr (500), nunca aceita
// um fallback hardcoded.
//
// Nunca grava o payload em bruto — só os campos validados/allowlisted por
// parseLeadIntakePayload chegam à BD. Ver privacidade em
// migrations/20260829_website_leads.sql.
// -----------------------------------------------------------------------------

export const config = {
  path: '/api/lead-intake',
}

const MAX_BODY_BYTES = 16 * 1024 // generoso para o payload allowlisted; corta lixo/abuso cedo

function resp(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Log técnico apenas — nunca email, telefone, nome ou payload. submissionId
// (um UUID gerado pelo Netlify Forms) é o único correlacionador aceite.
function logEvent(event: string, fields: Record<string, string | boolean | undefined> = {}) {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
  console.log(`[lead-intake] ${event}${parts.length ? ' ' + parts.join(' ') : ''}`)
}

export default async function handler(req: Request, _context: Context) {
  if (req.method !== 'POST') {
    return resp({ error: 'method_not_allowed' }, 405)
  }

  // ── Auth: Bearer LEAD_INTAKE_SECRET — fail closed se a variável não existir ──
  const secret = process.env.LEAD_INTAKE_SECRET
  if (!secret) {
    logEvent('CRM_SYNC_FAILED', { reason: 'secret_not_configured' })
    return resp({ error: 'not_configured' }, 500)
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    logEvent('CRM_SYNC_FAILED', { reason: 'unauthorized' })
    return resp({ error: 'unauthorized' }, 401)
  }

  const contentType = req.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    return resp({ error: 'unsupported_media_type' }, 415)
  }

  const rawBody = await req.text()
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    logEvent('CRM_SYNC_FAILED', { reason: 'payload_too_large' })
    return resp({ error: 'payload_too_large' }, 413)
  }

  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(rawBody)
  } catch {
    return resp({ error: 'invalid_json' }, 400)
  }

  const validation = parseLeadIntakePayload(parsedBody)
  if (!validation.ok) {
    logEvent('CRM_SYNC_SKIPPED', { reason: validation.error })
    return resp({ error: validation.error }, validation.status)
  }
  const lead = validation.value

  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    logEvent('CRM_SYNC_FAILED', { reason: 'supabase_not_configured' })
    return resp({ error: 'not_configured' }, 500)
  }

  // ── Passos obrigatórios: cliente + website_lead ─────────────────────────
  // Uma falha aqui é um erro real do intake (500) — ao contrário da
  // oportunidade comercial abaixo, que é sempre best-effort.
  let clientId: string
  let clientCreated: boolean
  let leadCreated: boolean
  let leadId: string
  try {
    const clientResult = await findOrCreateIndividualClientByEmail({
      email: lead.email,
      fullName: lead.name,
      phone: lead.phone,
    })
    clientId = clientResult.id
    clientCreated = clientResult.created
    logEvent(clientCreated ? 'CLIENT_CREATED' : 'CLIENT_REUSED', { submissionId: lead.submissionId })

    const leadResult = await createWebsiteLead({
      individualClientId: clientId,
      submissionId: lead.submissionId,
      formName: lead.formName,
      market: lead.market,
      product: lead.product,
      source: lead.source,
      sourceUrl: lead.sourceUrl,
      utmSource: lead.utm.source,
      utmMedium: lead.utm.medium,
      utmCampaign: lead.utm.campaign,
      utmContent: lead.utm.content,
      utmTerm: lead.utm.term,
      metadata: lead.metadata,
      receivedAt: new Date().toISOString(),
    })
    leadCreated = leadResult.created
    leadId = leadResult.id
    logEvent(leadCreated ? 'LEAD_CREATED' : 'DUPLICATE_SUBMISSION', { submissionId: lead.submissionId })
  } catch (err) {
    logEvent('CRM_SYNC_FAILED', { reason: 'internal_error', submissionId: lead.submissionId })
    console.error('[lead-intake] internal error:', err instanceof Error ? err.message : err)
    return resp({ error: 'internal_error' }, 500)
  }

  // ── Passo best-effort: oportunidade comercial ───────────────────────────
  // Camada adicional sobre um intake que já teve sucesso — nunca pode fazer
  // falhar a resposta. Tentado SEMPRE, quer o website_lead seja novo ou
  // reutilizado (um retry depois de uma falha aqui tem de conseguir
  // recuperar e criar a oportunidade em falta) — a idempotência vem do
  // índice único parcial em website_lead_id
  // (sales_opportunities_website_lead_id_uidx), nunca de uma flag "já foi
  // tentado". Nunca apaga o cliente nem o website_lead já criados, e nunca
  // expõe a mensagem de erro interna/Supabase na resposta.
  let opportunityCreated = false
  try {
    const opportunityResult = await createSalesOpportunityForWebsiteLead({
      individualClientId: clientId,
      websiteLeadId: leadId,
      clientName: lead.name,
      market: lead.market,
      product: lead.product,
    })
    opportunityCreated = opportunityResult.created
    logEvent(opportunityResult.created ? 'OPPORTUNITY_CREATED' : 'OPPORTUNITY_REUSED', {
      submissionId: lead.submissionId,
    })
  } catch (err) {
    logEvent('OPPORTUNITY_CREATE_FAILED', { submissionId: lead.submissionId })
    console.error('[lead-intake] opportunity creation failed (non-fatal):', err instanceof Error ? err.message : err)
    // opportunityCreated fica false; client/website_lead já criados não são
    // desfeitos e a resposta continua ok:true — ver buildLeadIntakeResponse.
  }

  return resp(buildLeadIntakeResponse({ clientId, clientCreated, leadCreated, opportunityCreated }), 200)
}
