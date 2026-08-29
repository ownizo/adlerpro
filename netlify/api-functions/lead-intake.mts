import type { Context } from '@netlify/functions'
import {
  findOrCreateIndividualClientByEmail,
  createWebsiteLead,
} from '../../src/lib/data'
import { parseLeadIntakePayload } from './lib/lead-intake-shared'

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

  try {
    const { id: clientId, created: clientCreated } = await findOrCreateIndividualClientByEmail({
      email: lead.email,
      fullName: lead.name,
      phone: lead.phone,
    })
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

    if (!leadResult.created) {
      logEvent('DUPLICATE_SUBMISSION', { submissionId: lead.submissionId })
      return resp({ ok: true, clientId, clientCreated: false, leadCreated: false, duplicateSubmission: true }, 200)
    }

    logEvent('LEAD_CREATED', { submissionId: lead.submissionId })
    return resp({ ok: true, clientId, clientCreated, leadCreated: true }, 200)
  } catch (err) {
    logEvent('CRM_SYNC_FAILED', { reason: 'internal_error', submissionId: lead.submissionId })
    console.error('[lead-intake] internal error:', err instanceof Error ? err.message : err)
    return resp({ error: 'internal_error' }, 500)
  }
}
