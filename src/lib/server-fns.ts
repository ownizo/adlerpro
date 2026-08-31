import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader, getCookies } from '@tanstack/react-start/server'
import { createElement } from 'react'
import { render } from 'react-email'
import { getStore } from '@netlify/blobs'
import { eq } from 'drizzle-orm'
import { resendClient, FROM_EMAIL } from './email/client'
import { DocumentEmail } from './email/templates/DocumentEmail'
import { supabaseAdmin } from './supabase-admin'
import * as db from './data'
import { netlifyDb } from '../../db/index'
import { policyDocuments } from '../../db/schema'
import { getClaimOperationalData, saveClaimOperationalData, updateClaimOperationalData } from './claim-ops'
import { claimMessageToTicketMessage, mergeClaimMessages } from './claim-message-sync'
import { normalizeClaimsByPolicy, selectPreferredClaimForPolicy } from './claim-resolution'
import type {
  DashboardStats,
  AdminFinancialDashboardData,
  RenewalAlertsResponse,
  RenewalAlertItem,
  RenewalAlertHistoryItem,
  RenewalAlertStatus,
  Claim,
  ClaimMessage,
  ClaimOperationalData,
  ClaimTimelineEvent,
  ClaimParticipant,
  ClaimTicketMessage,
  ClaimFileRef,
  ClientNote,
  ClientTask,
  SalesOpportunityStage,
  SalesOpportunityEditableUpdate,
  Json,
} from './types'
import { isValidCarrierProvider } from './carrier-providers'
import { parsePortfolioWorkbook } from './carrier-excel-workbook'
import { mapPortfolioRows } from './carrier-import-mappers'
import { computeImportFingerprint } from './carrier-import-fingerprint'
import { matchPortfolioRows, classifyStagedRowForCounts } from './carrier-import-matching'
import { computeRunApplyReadiness, type ApplyActionRowState, type CustomerApplyAction, type PolicyApplyAction } from './carrier-apply-actions'
import type { CarrierImportRecord, CarrierRunApplyStatus } from './types'
import { buildOpportunityTitle, pickWebsiteLeadContextFields } from './sales-opportunity-rules'
import { requireAuthMiddleware, requireRoleMiddleware } from '@/middleware/identity'
import { createIdentityUserWithConfirmation, updateIdentityUserPasswordByEmail, deleteIdentityUserByEmail, createIndividualIdentityUser, generateStrongPassword, deleteIdentityUserById } from './identity-admin'

function extractAccessToken(): string | null {
  try {
    const authHeader = getRequestHeader('authorization')
    if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7)

    const cookies = getCookies()

    // Helper to parse a cookie value from @supabase/ssr
    // @supabase/ssr stores cookies with "base64-" prefix followed by base64-encoded JSON
    function parseCookieValue(value: string): string | null {
      try {
        const decoded = decodeURIComponent(value)
        // @supabase/ssr stores cookies as "base64-<base64encodedJSON>"
        if (decoded.startsWith('base64-')) {
          const b64 = decoded.slice(7)
          const json = atob(b64)
          const parsed = JSON.parse(json)
          if (parsed?.access_token) return parsed.access_token
          return null
        }
        // Legacy format: plain JSON
        const parsed = JSON.parse(decoded)
        if (typeof parsed === 'string') return parsed
        if (Array.isArray(parsed) && parsed[0]) return parsed[0]
        if (parsed?.access_token) return parsed.access_token
        return null
      } catch {
        return value
      }
    }

    for (const [name, value] of Object.entries(cookies)) {
      if (name.match(/^sb-[^-]+-auth-token$/) && value) {
        const token = parseCookieValue(value)
        if (token) return token
      }
    }

    // Handle chunked cookies (sb-xxx-auth-token.0, .1, etc.)
    const chunkNames = Object.keys(cookies)
      .filter((name) => name.match(/^sb-[^-]+-auth-token\.\d+$/))
      .sort()
    if (chunkNames.length > 0) {
      const full = chunkNames.map((n) => cookies[n]).join('')
      const token = parseCookieValue(full)
      if (token) return token
    }

    return null
  } catch {
    return null
  }
}

// Cache em memória por token para evitar chamadas repetidas ao Supabase Auth na mesma request
const _scopeCache = new Map<string, { scope: Awaited<ReturnType<typeof _resolveScope>>; ts: number }>()

async function _resolveScope(token: string) {
  const { data: { user: supaUser }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !supaUser) throw new Error('Authentication required')

  const meta = supaUser.user_metadata ?? {}
  const appMeta = supaUser.app_metadata ?? {}
  const user = {
    id: supaUser.id,
    email: supaUser.email,
    name: meta.full_name ?? meta.name ?? supaUser.email,
    roles: appMeta.roles as string[] | undefined,
  }

  const isAdmin = Boolean(user.roles?.includes('admin'))
  if (isAdmin) {
    return {
      user,
      isAdmin: true as const,
      companyId: null as string | null,
      individualClientId: null as string | null,
    }
  }

  const [companyUser, individualClient] = await Promise.all([
    user.email ? db.getCompanyUserByEmail(user.email) : Promise.resolve(undefined),
    resolveIndividualClientScope(user),
  ])
  return {
    user,
    isAdmin: false as const,
    companyId: companyUser?.companyId ?? null,
    individualClientId: individualClient?.id ?? null,
  }
}

async function getViewerScope() {
  const token = extractAccessToken()
  if (!token) throw new Error('Authentication required')

  // Cache válido por 30 segundos para evitar chamadas duplicadas na mesma navegação
  const cached = _scopeCache.get(token)
  if (cached && Date.now() - cached.ts < 30_000) return cached.scope

  const scope = await _resolveScope(token)
  _scopeCache.set(token, { scope, ts: Date.now() })
  // Limpar entradas antigas (> 2 min) para não acumular memória
  if (_scopeCache.size > 50) {
    const cutoff = Date.now() - 120_000
    for (const [k, v] of _scopeCache) {
      if (v.ts < cutoff) _scopeCache.delete(k)
    }
  }
  return scope
}

async function resolveIndividualClientScope(user: { id: string; email?: string | null }) {
  const byAuthId = await supabaseAdmin
    .from('individual_clients')
    .select('id, full_name, email')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (byAuthId.data?.id) return byAuthId.data

  if (user.email) {
    const byEmail = await supabaseAdmin
      .from('individual_clients')
      .select('id, full_name, email')
      .ilike('email', user.email)
      .maybeSingle()
    if (byEmail.data?.id) return byEmail.data
  }

  return null
}

/**
 * Segmento do viewer — valor DERIVADO (não persistido) a partir dos
 * vínculos que getViewerAccessContext já resolve:
 *   - 'b2b'     → existe companyId (cliente empresarial via company_users)
 *   - 'b2c'     → existe individualClientId e NÃO existe companyId
 *   - 'unknown' → nenhum vínculo resolvido (tratado explicitamente, não silenciado)
 * Precedência 'b2b' no caso (improvável) de coexistirem ambos os vínculos.
 * Não introduz nova fonte de dados nem mexe no role (app_metadata/profiles).
 */
export type ViewerSegment = 'b2b' | 'b2c' | 'unknown'

function deriveSegment(scope: { companyId: string | null; individualClientId: string | null }): ViewerSegment {
  if (scope.companyId) return 'b2b'
  if (scope.individualClientId) return 'b2c'
  return 'unknown'
}

async function getViewerAccessContext() {
  const token = extractAccessToken()
  if (!token) throw new Error('Authentication required')

  const { data: { user: supaUser }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !supaUser) throw new Error('Authentication required')

  const meta = supaUser.user_metadata ?? {}
  const appMeta = supaUser.app_metadata ?? {}
  const user = {
    id: supaUser.id,
    email: supaUser.email,
    name: meta.full_name ?? meta.name ?? supaUser.email ?? 'Utilizador',
    roles: appMeta.roles as string[] | undefined,
  }

  const isAdmin = Boolean(user.roles?.includes('admin'))
  const companyUser = user.email ? await db.getCompanyUserByEmail(user.email) : undefined
  const individualClient = await resolveIndividualClientScope(user)

  const companyId = companyUser?.companyId ?? null
  const individualClientId = individualClient?.id ?? null

  return {
    user,
    isAdmin,
    companyId,
    individualClientId,
    individualClientName: individualClient?.full_name ?? null,
    individualClientEmail: individualClient?.email ?? null,
    segment: deriveSegment({ companyId, individualClientId }),
  }
}

/**
 * getMySegment — server function leve para a próxima fase (routing).
 * Reutiliza getViewerAccessContext (mesma lógica e fonte de dados) e expõe
 * apenas o segmento derivado e os dois vínculos. Regra: ver deriveSegment.
 */
export const getMySegment = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async (): Promise<{ segment: ViewerSegment; companyId: string | null; individualClientId: string | null }> => {
    const ctx = await getViewerAccessContext()
    return {
      segment: ctx.segment,
      companyId: ctx.companyId,
      individualClientId: ctx.individualClientId,
    }
  })

function canAccessClaimByContext(claim: Claim, ctx: Awaited<ReturnType<typeof getViewerAccessContext>>) {
  if (ctx.isAdmin) return true
  if (ctx.companyId && claim.companyId && claim.companyId === ctx.companyId) return true
  if (ctx.individualClientId && claim.individualClientId && claim.individualClientId === ctx.individualClientId) return true
  return false
}

function buildTimelineEvent(data: Omit<ClaimTimelineEvent, 'id' | 'createdAt'>): ClaimTimelineEvent {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...data,
  }
}

async function sendClaimMessageEmail(params: {
  to?: string | null
  claimId: string
  senderName: string
  senderRole: 'admin' | 'client'
  body: string
}) {
  const to = params.to?.trim()
  const templateId = process.env['RESEND_TEMPLATE_CLAIMS']
  if (!to || !process.env['RESEND_API_KEY'] || !templateId) return

  const roleLabel = params.senderRole === 'admin' ? 'Admin' : 'Cliente'
  const message = params.body.length > 2000 ? `${params.body.slice(0, 1997)}...` : params.body

  try {
    await resendClient.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject: `Atualização de sinistro ${params.claimId}`,
      template: {
        id: templateId,
        variables: {
          TITLE: `Nova mensagem no sinistro ${params.claimId}`,
          DETAIL: `Remetente: ${params.senderName} (${roleLabel})`,
          MESSAGE: message,
        },
      },
    })
  } catch (error) {
    console.error('[sendClaimMessageEmail] error:', error)
  }
}

async function getLegacyClaimMessages(claim: Claim): Promise<ClaimMessage[]> {
  return db.getClaimMessages(claim.id)
}

function claimMessageIdentity(message: Pick<ClaimMessage, 'senderType' | 'senderName' | 'message' | 'createdAt'>) {
  return [
    message.senderType,
    message.senderName.trim().replace(/\s+/g, ' '),
    message.message.trim().replace(/\s+/g, ' '),
    message.createdAt,
  ].join('::')
}

async function persistClaimMessage(params: {
  claim: Claim
  senderType: 'admin' | 'client'
  senderName: string
  senderUserId?: string
  message: string
  createdAt: string
  readAt?: string | null
}) {
  await db.createClaimMessage({
    id: crypto.randomUUID(),
    claimId: params.claim.id,
    senderType: params.senderType,
    senderName: params.senderName,
    senderUserId: params.senderUserId,
    message: params.message,
    createdAt: params.createdAt,
  })
}

async function backfillClaimMessagesFromOperationalData(claim: Claim): Promise<ClaimMessage[]> {
  const [storedMessages, ops] = await Promise.all([
    getLegacyClaimMessages(claim),
    getClaimOperationalData(claim.id),
  ])

  if (ops.messages.length === 0) return storedMessages

  const mergedMessages = mergeClaimMessages({
    claimId: claim.id,
    companyId: claim.companyId,
    individualClientId: claim.individualClientId,
    legacyMessages: storedMessages,
    ticketMessages: ops.messages,
  })

  const existingKeys = new Set(storedMessages.map((message) => claimMessageIdentity(message)))
  const missingMessages = mergedMessages.filter((message) => !existingKeys.has(claimMessageIdentity(message)))

  for (const message of missingMessages) {
    await persistClaimMessage({
      claim,
      senderType: message.senderType,
      senderName: message.senderName,
      senderUserId: message.senderUserId,
      message: message.message,
      createdAt: message.createdAt,
      readAt: message.readAt,
    })
  }

  return missingMessages.length > 0 ? getLegacyClaimMessages(claim) : storedMessages
}

async function getCanonicalClaimMessages(claim: Claim): Promise<ClaimMessage[]> {
  return backfillClaimMessagesFromOperationalData(claim)
}

async function getCanonicalClaimOperationalData(claim: Claim): Promise<ClaimOperationalData> {
  const [ops, canonicalMessages] = await Promise.all([
    getClaimOperationalData(claim.id),
    getCanonicalClaimMessages(claim),
  ])

  const mappedMessages = canonicalMessages.map(claimMessageToTicketMessage)
  const lastMessageAt = mappedMessages[mappedMessages.length - 1]?.createdAt
  const updatedAt = [ops.updatedAt, lastMessageAt]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
    .at(-1) ?? ops.updatedAt

  return {
    ...ops,
    messages: mappedMessages,
    updatedAt,
  }
}

async function getOrCreateClaimByPolicy(input: {
  policyId: string
  buildNewClaim: (claimId: string, nowIso: string) => Claim
  updatesIfExisting?: Partial<Claim>
}) {
  const existingClaims = await db.getClaimsByPolicyId(input.policyId)
  const existing = selectPreferredClaimForPolicy(existingClaims)

  if (existing) {
    if (input.updatesIfExisting && Object.keys(input.updatesIfExisting).length > 0) {
      await db.updateClaim(existing.id, input.updatesIfExisting)
      return {
        claim: {
          ...existing,
          ...input.updatesIfExisting,
        },
        created: false as const,
      }
    }

    return { claim: existing, created: false as const }
  }

  const nowIso = new Date().toISOString()
  const claimId = `clm_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
  const claim = input.buildNewClaim(claimId, nowIso)
  await db.createClaim(claim)
  return { claim, created: true as const }
}

// Dashboard — endpoint unificado: retorna stats + alertas + apólices numa só chamada
export const fetchDashboardAll = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    const scope = await getViewerScope()
    if (!scope.isAdmin && !scope.companyId) {
      return { stats: { activePolicies: 0, annualPremiums: 0, renewalsIn90Days: 0, openClaims: 0 }, alerts: [], policies: [] }
    }
    const companyId = scope.companyId ?? undefined

    const [policies, claims, alerts] = await Promise.all([
      db.getPolicies(companyId),
      db.getClaims(companyId),
      db.getAlerts(companyId),
    ])

    const activePolicies = policies.filter((p) => p.status === 'active' || p.status === 'expiring').length
    const annualPremiums = policies
      .filter((p) => p.status === 'active' || p.status === 'expiring')
      .reduce((sum, p) => sum + p.annualPremium, 0)

    const now = new Date()
    const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
    const renewalsIn90Days = policies.filter((p) => {
      const endDate = new Date(p.endDate)
      return endDate >= now && endDate <= in90Days && (p.status === 'active' || p.status === 'expiring')
    }).length

    const openClaims = claims.filter(
      (c) => !['approved', 'denied', 'paid'].includes(c.status)
    ).length

    const stats: DashboardStats = { activePolicies, annualPremiums, renewalsIn90Days, openClaims }
    return { stats, alerts, policies }
  })

// Manter para compatibilidade
export const fetchDashboardStats = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(
  async (): Promise<DashboardStats> => {
    const scope = await getViewerScope()
    if (!scope.isAdmin && !scope.companyId) {
      return { activePolicies: 0, annualPremiums: 0, renewalsIn90Days: 0, openClaims: 0 }
    }
    const [policies, claims] = await Promise.all([
      db.getPolicies(scope.companyId ?? undefined),
      db.getClaims(scope.companyId ?? undefined),
    ])

    const activePolicies = policies.filter((p) => p.status === 'active' || p.status === 'expiring').length
    const annualPremiums = policies
      .filter((p) => p.status === 'active' || p.status === 'expiring')
      .reduce((sum, p) => sum + p.annualPremium, 0)

    const now = new Date()
    const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
    const renewalsIn90Days = policies.filter((p) => {
      const endDate = new Date(p.endDate)
      return endDate >= now && endDate <= in90Days && (p.status === 'active' || p.status === 'expiring')
    }).length

    const openClaims = claims.filter(
      (c) => !['approved', 'denied', 'paid'].includes(c.status)
    ).length

    return { activePolicies, annualPremiums, renewalsIn90Days, openClaims }
  }
)

export const fetchPolicies = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    const scope = await getViewerScope()
    if (scope.isAdmin) return db.getPolicies()
    if (scope.companyId) return db.getPolicies(scope.companyId)
    if (scope.individualClientId) return db.getPoliciesByIndividualClientId(scope.individualClientId)
    return []
  })

export const fetchPolicy = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: string) => d)
  .handler(async ({ data: id }) => {
    const scope = await getViewerScope()
    const policy = await db.getPolicy(id)
    if (!policy) return undefined
    if (!scope.isAdmin && !scope.companyId && !scope.individualClientId) return undefined
    if (scope.companyId && policy.companyId !== scope.companyId) return undefined
    if (scope.individualClientId && policy.individualClientId !== scope.individualClientId) return undefined
    return policy
  })

export const fetchClaims = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    const scope = await getViewerScope()
    if (!scope.isAdmin && !scope.companyId) return []
    const claims = await db.getClaims(scope.companyId ?? undefined)
    return normalizeClaimsByPolicy(claims)
  })

export const fetchClaim = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: string) => d)
  .handler(async ({ data: id }) => {
    const scope = await getViewerScope()
    const claim = await db.getClaim(id)
    if (!claim) return undefined
    if (!scope.isAdmin && !scope.companyId) return undefined
    if (scope.companyId && claim.companyId !== scope.companyId) return undefined
    return claim
  })

export const submitClaim = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator(
    (d: {
      policyId: string
      companyId?: string
      title: string
      description: string
      incidentDate: string
      estimatedValue: number
    }) => d
  )
  .handler(async ({ data }) => {
    const scope = await getViewerScope()
    const companyId = scope.companyId ?? data.companyId
    if (!companyId) throw new Error('Empresa não associada ao utilizador')

    const { claim, created } = await getOrCreateClaimByPolicy({
      policyId: data.policyId,
      buildNewClaim: (id, nowIso) => ({
        id,
        policyId: data.policyId,
        companyId,
        title: data.title,
        description: data.description,
        claimDate: nowIso.split('T')[0],
        incidentDate: data.incidentDate,
        estimatedValue: data.estimatedValue,
        status: 'submitted',
        steps: [{ status: 'submitted', date: nowIso.split('T')[0], notes: 'Sinistro participado' }],
        createdAt: nowIso,
      }),
      updatesIfExisting: {
        companyId,
        title: data.title,
        description: data.description,
        incidentDate: data.incidentDate,
        estimatedValue: data.estimatedValue,
      },
    })
    const now = new Date().toISOString()
    if (created) {
      await persistClaimMessage({
        claim,
        senderType: 'client',
        senderName: scope.user.name || scope.user.email || 'Cliente',
        senderUserId: scope.user.id,
        message: 'Sinistro submetido pelo cliente.',
        createdAt: now,
        readAt: now,
      })
    }
    return { id: claim.id, reused: !created }
  })

export const fetchIndividualClaims = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    const ctx = await getViewerAccessContext()
    if (!ctx.individualClientId) return []
    const claims = await db.getClaimsByIndividualClientId(ctx.individualClientId)
    return normalizeClaimsByPolicy(claims)
  })

export const submitIndividualClaim = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: {
    policyId: string
    title: string
    description: string
    incidentDate: string
    estimatedValue?: number
  }) => d)
  .handler(async ({ data }) => {
    const ctx = await getViewerAccessContext()
    if (!ctx.individualClientId) throw new Error('Cliente individual não identificado')

    const policy = await db.getPolicy(data.policyId)
    if (!policy) throw new Error('Apólice não encontrada')
    if (policy.individualClientId !== ctx.individualClientId) throw new Error('Sem acesso a esta apólice')

    const { claim, created } = await getOrCreateClaimByPolicy({
      policyId: data.policyId,
      buildNewClaim: (id, nowIso) => ({
        id,
        policyId: data.policyId,
        individualClientId: ctx.individualClientId,
        title: data.title,
        description: data.description,
        claimDate: nowIso.split('T')[0],
        incidentDate: data.incidentDate,
        estimatedValue: Number(data.estimatedValue || 0),
        status: 'submitted',
        steps: [{ status: 'submitted', date: nowIso.split('T')[0], notes: 'Sinistro submetido pelo cliente' }],
        createdAt: nowIso,
      }),
      updatesIfExisting: {
        individualClientId: ctx.individualClientId,
        title: data.title,
        description: data.description,
        incidentDate: data.incidentDate,
        estimatedValue: Number(data.estimatedValue || 0),
      },
    })

    return { id: claim.id, reused: !created }
  })

export const updateClaimDetails = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { claimId: string; description: string; estimatedValue: number }) => d)
  .handler(async ({ data }) => {
    const scope = await getViewerScope()
    if (!scope.isAdmin && !scope.companyId) throw new Error('Sem permissões para editar sinistros')
    const claim = await db.getClaim(data.claimId)
    if (!claim) throw new Error('Sinistro não encontrado')
    if (scope.companyId && claim.companyId !== scope.companyId) throw new Error('Sem permissões para editar este sinistro')

    await db.updateClaim(data.claimId, {
      description: data.description,
      estimatedValue: data.estimatedValue,
    })
    return { success: true }
  })

export const fetchClaimDocuments = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: string) => d)
  .handler(async ({ data: claimId }) => {
    const scope = await getViewerScope()
    if (!scope.isAdmin && !scope.companyId) return []
    const claim = await db.getClaim(claimId)
    if (!claim) return []
    if (scope.companyId && claim.companyId !== scope.companyId) return []
    return db.getClaimDocuments(claimId, scope.companyId ?? claim.companyId)
  })

export const fetchClaimMessages = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: string) => d)
  .handler(async ({ data: claimId }) => {
    const ctx = await getViewerAccessContext()
    const claim = await db.getClaim(claimId)
    if (!claim) return []
    if (!canAccessClaimByContext(claim, ctx)) return []
    return getCanonicalClaimMessages(claim)
  })

export const sendClaimMessage = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { claimId: string; message: string }) => d)
  .handler(async ({ data }) => {
    const ctx = await getViewerAccessContext()
    const claim = await db.getClaim(data.claimId)
    if (!claim) throw new Error('Sinistro não encontrado')
    if (!canAccessClaimByContext(claim, ctx)) throw new Error('Sem acesso a este sinistro')

    const message = data.message.trim()
    if (!message) throw new Error('Mensagem vazia')

    const now = new Date().toISOString()
    const senderType = ctx.isAdmin ? 'admin' : 'client'
    const senderName = ctx.user.name || ctx.user.email || (ctx.isAdmin ? 'Admin' : 'Cliente')
    await persistClaimMessage({
      claim,
      senderType,
      senderName,
      senderUserId: ctx.user.id,
      message,
      createdAt: now,
      readAt: ctx.isAdmin ? null : now,
    })

    await updateClaimOperationalData(data.claimId, (current) => ({
      ...current,
      timeline: [
        ...current.timeline,
        buildTimelineEvent({
          type: 'message',
          message: `${senderType === 'admin' ? 'Admin' : 'Cliente'} adicionou uma mensagem`,
          actorName: senderName,
          actorRole: senderType,
        }),
      ],
    }))

    if (claim.companyId) {
      await db.createAlert({
        id: crypto.randomUUID(),
        companyId: claim.companyId,
        type: 'claim_update',
        title: `Nova mensagem no sinistro ${claim.id.slice(-8).toUpperCase()}`,
        message: senderType === 'admin' ? message : 'O cliente enviou uma nova mensagem.',
        read: false,
        createdAt: now,
      })
    }

    const recipientEmail = senderType === 'admin'
      ? (claim.individualClientId ? (await db.getIndividualClient(claim.individualClientId))?.email : (claim.companyId ? (await db.getCompany(claim.companyId))?.contactEmail : undefined))
      : (claim.companyId ? (await db.getCompany(claim.companyId))?.contactEmail : process.env['CLAIMS_NOTIFICATIONS_TO'])

    await sendClaimMessageEmail({
      to: recipientEmail,
      claimId: claim.id,
      senderName,
      senderRole: senderType,
      body: message,
    })

    return { success: true }
  })

export const markClaimMessagesAsRead = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: string) => d)
  .handler(async ({ data: claimId }) => {
    const ctx = await getViewerAccessContext()
    const claim = await db.getClaim(claimId)
    if (!claim || !canAccessClaimByContext(claim, ctx)) return { success: true }

    if (ctx.companyId && claim.companyId === ctx.companyId) {
      await db.markClaimMessagesReadForClient(claimId)
    } else if (ctx.individualClientId && claim.individualClientId === ctx.individualClientId) {
      await db.markClaimMessagesReadForIndividualClient(claimId)
    }

    return { success: true }
  })

export const fetchDocuments = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    const scope = await getViewerScope()
    if (!scope.isAdmin && !scope.companyId) return []
    return db.getDocuments(scope.companyId ?? undefined)
  })

export const deleteDocument = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const [scope, document] = await Promise.all([getViewerScope(), db.getDocument(id)])
    if (!document) return { success: true }
    const canDelete = scope.isAdmin
      || Boolean(scope.companyId && document.companyId === scope.companyId)
      || Boolean(scope.individualClientId && document.individualClientId === scope.individualClientId)
    if (!canDelete) throw new Error('Sem acesso a este documento')

    if (document.storagePath) {
      const { error } = await supabaseAdmin.storage.from('documents').remove([document.storagePath])
      if (error) throw new Error(error.message)
    }
    await db.deleteDocument(id)
    return { success: true }
  })

export const fetchAlerts = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    const scope = await getViewerScope()
    if (!scope.isAdmin && !scope.companyId) return []
    return db.getAlerts(scope.companyId ?? undefined)
  })

export const clearAlerts = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    const scope = await getViewerScope()
    if (scope.companyId) {
      await db.clearAlertsForCompany(scope.companyId)
    } else if (scope.isAdmin) {
      await db.clearAlerts()
    }
    return { success: true }
  })

export const markAlertAsRead = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: string) => d)
  .handler(async ({ data: id }) => {
    await db.markAlertRead(id)
    return { success: true }
  })

export const fetchCompanies = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    const scope = await getViewerScope()
    if (scope.companyId) {
      const company = await db.getCompany(scope.companyId)
      return company ? [company] : []
    }
    if (!scope.isAdmin) return []
    return db.getCompanies()
  })

export const fetchCompany = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: string) => d)
  .handler(async ({ data: id }) => {
    const scope = await getViewerScope()
    if (!scope.isAdmin && !scope.companyId) return undefined
    if (scope.companyId && scope.companyId !== id) return undefined
    return db.getCompany(id)
  })

export const fetchRiskReports = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    const scope = await getViewerScope()
    if (!scope.isAdmin && !scope.companyId) return []
    return db.getRiskReports(scope.companyId ?? undefined)
  })

export const fetchCompanyUsers = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    const scope = await getViewerScope()
    if (!scope.isAdmin && !scope.companyId) return []
    return db.getCompanyUsers(scope.companyId ?? undefined)
  })

export const fetchUserMetricEvents = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    const scope = await getViewerScope()
    if (!scope.isAdmin && !scope.companyId) return []
    return db.getUserMetricEvents(scope.companyId ?? undefined)
  })

export const fetchCurrentUserCompanyProfile = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    const scope = await getViewerScope()
    const email = scope.user.email?.toLowerCase()
    const companyUser = email ? await db.getCompanyUserByEmail(email) : undefined
    const company = companyUser ? await db.getCompany(companyUser.companyId) : undefined
    return {
      company,
      companyUser,
    }
  })

export const fetchApiConnections = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .handler(async () => db.getApiConnections())

// Admin — endpoint unificado: retorna todos os dados do painel admin numa só chamada
export const fetchAdminAll = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .handler(async () => {
    const [companies, companyUsers, userEvents, apiConnections, policies, rawClaims, documents, individualClients, managedPolicyDocuments, websiteLeadClientIdsSet] = await Promise.all([
      db.getCompanies(),
      db.getCompanyUsers(),
      db.getUserMetricEvents(),
      db.getApiConnections(),
      db.getPolicies(),
      db.getClaims(),
      db.getDocuments(),
      db.getIndividualClients(),
      netlifyDb.select().from(policyDocuments),
      db.getWebsiteLeadIndividualClientIds(),
    ])
    const claims = normalizeClaimsByPolicy(rawClaims)
    const claimOperationalSummary = Object.fromEntries(
      await Promise.all(
        claims.map(async (claim) => {
          const ops = await getCanonicalClaimOperationalData(claim)
          const lastMessage = ops.messages[ops.messages.length - 1]
          return [
            claim.id,
            {
              responsibleName: ops.responsible?.name,
              messagesCount: ops.messages.length,
              documentsCount: ops.documents.length,
              lastMessageAt: lastMessage?.createdAt,
              updatedAt: ops.updatedAt,
            },
          ] as const
        }),
      ),
    )

    const normalizeNif = (value?: string | null) => (value ?? '').replace(/\D/g, '')
    const normalizeEmail = (value?: string | null) => (value ?? '').trim().toLowerCase()

    const companyNifs = new Set(companies.map((company) => normalizeNif(company.nif)).filter(Boolean))
    const companyEmails = new Set(
      [
        ...companies.flatMap((company) => [company.contactEmail, company.accessEmail]),
        ...companyUsers.map((companyUser) => companyUser.email),
      ]
        .map((email) => normalizeEmail(email))
        .filter(Boolean)
    )

    const filteredIndividualClients = individualClients.filter((client) => {
      const clientNif = normalizeNif(client.nif)
      const clientEmail = normalizeEmail(client.email)
      const matchesCompanyNif = clientNif && companyNifs.has(clientNif)
      const matchesCompanyEmail = clientEmail && companyEmails.has(clientEmail)
      return !matchesCompanyNif && !matchesCompanyEmail
    })

    return {
      companies,
      companyUsers,
      userEvents,
      apiConnections,
      policies,
      claims,
      claimOperationalSummary,
      documents: [
        ...managedPolicyDocuments.map((document) => ({
          id: document.id,
          companyId: document.companyId || undefined,
          individualClientId: document.individualClientId || undefined,
          name: document.fileName,
          category: 'policy' as const,
          size: document.size,
          mimeType: document.contentType,
          uploadedBy: document.uploadedByUserId,
          uploadedByType: 'client' as const,
          uploadedAt: document.createdAt.toISOString(),
          storagePath: `netlify:${document.id}`,
        })),
        ...documents,
      ],
      individualClients: filteredIndividualClients,
      // Só os ids — usado para o indicador "Origem: Website" na listagem;
      // o detalhe de cada lead é lido à parte (fetchWebsiteLeads) quando a
      // ficha do cliente é aberta.
      websiteLeadClientIds: [...websiteLeadClientIdsSet],
    }
  })

function normalizePaymentFrequency(value?: string): 'monthly' | 'quarterly' | 'semiannual' | 'annual' {
  const normalized = (value ?? '').trim().toLowerCase()
  if (!normalized) return 'annual'
  if (normalized.includes('mens')) return 'monthly'
  if (normalized.includes('trim')) return 'quarterly'
  if (normalized.includes('semes')) return 'semiannual'
  if (normalized.includes('quarter')) return 'quarterly'
  if (normalized.includes('semi')) return 'semiannual'
  if (normalized.includes('month')) return 'monthly'
  return 'annual'
}

function getDistributionRule(frequency: 'monthly' | 'quarterly' | 'semiannual' | 'annual') {
  if (frequency === 'monthly') return { periods: 12, stepMonths: 1 }
  if (frequency === 'quarterly') return { periods: 4, stepMonths: 3 }
  if (frequency === 'semiannual') return { periods: 2, stepMonths: 6 }
  return { periods: 1, stepMonths: 12 }
}

function splitCents(totalCents: number, parts: number): number[] {
  const safeParts = Math.max(parts, 1)
  const base = Math.floor(totalCents / safeParts)
  const remainder = totalCents % safeParts
  return Array.from({ length: safeParts }, (_, index) => base + (index < remainder ? 1 : 0))
}

function parseDateToUtc(dateStr?: string): Date | null {
  if (!dateStr) return null
  const [year, month, day] = dateStr.split('-').map((part) => Number(part))
  if (!year || !month || !day) return null
  return new Date(Date.UTC(year, month - 1, day))
}

function addMonthsUtc(baseDate: Date, months: number): Date {
  return new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth() + months, 1))
}

function monthKeyFromDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function isPolicyActiveInMonth(policy: { startDate: string; endDate: string; status: string }, year: number, month: number): boolean {
  if (!['active', 'expiring'].includes(policy.status)) return false
  const policyStart = parseDateToUtc(policy.startDate)
  const policyEnd = parseDateToUtc(policy.endDate)
  if (!policyStart || !policyEnd) return true
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
  return policyStart <= monthEnd && policyEnd >= monthStart
}

function toDeltaPct(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null
  return ((current - previous) / previous) * 100
}

const DEFAULT_RENEWAL_ALERT_STATUS: RenewalAlertStatus = 'pending'

interface RenewalAlertStateRecord {
  key: string
  policyId: string | null
  status: RenewalAlertStatus
  assignedTo: string | null
  nextAction: string | null
  updatedAt: string
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

async function readRenewalAlertStateMap() {
  const { data, error } = await supabaseAdmin
    .from('renewal_alerts_state')
    .select('alert_key, policy_id, status, assigned_to, next_action, updated_at')

  if (error) {
    console.error('[readRenewalAlertStateMap] supabase error:', error)
    return {}
  }

  const stateMap: Record<string, RenewalAlertStateRecord> = {}
  for (const row of data ?? []) {
    const alertKey = typeof row.alert_key === 'string' ? row.alert_key : ''
    if (!alertKey) continue

    const status = row.status as RenewalAlertStatus
    const normalizedStatus: RenewalAlertStatus =
      status === 'pending' || status === 'negotiating' || status === 'renewed'
        ? status
        : DEFAULT_RENEWAL_ALERT_STATUS
    stateMap[alertKey] = {
      key: alertKey,
      policyId: typeof row.policy_id === 'string' ? row.policy_id : null,
      status: normalizedStatus,
      assignedTo: normalizeOptionalText(row.assigned_to),
      nextAction: normalizeOptionalText(row.next_action),
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
    }
  }

  return stateMap
}

async function readRenewalAlertHistoryMap(alertKeys: string[]) {
  if (alertKeys.length === 0) return {}

  const { data, error } = await supabaseAdmin
    .from('renewal_alerts_history')
    .select('id, alert_key, policy_id, old_status, new_status, old_assigned_to, new_assigned_to, old_next_action, new_next_action, changed_at')
    .in('alert_key', alertKeys)
    .order('changed_at', { ascending: false })

  if (error) {
    console.error('[readRenewalAlertHistoryMap] supabase error:', error)
    return {}
  }

  const historyMap: Record<string, RenewalAlertHistoryItem[]> = {}
  for (const row of data ?? []) {
    const alertKey = normalizeOptionalText(row.alert_key)
    if (!alertKey) continue

    const newStatusCandidate = row.new_status as RenewalAlertStatus
    const newStatus: RenewalAlertStatus =
      newStatusCandidate === 'pending' || newStatusCandidate === 'negotiating' || newStatusCandidate === 'renewed'
        ? newStatusCandidate
        : DEFAULT_RENEWAL_ALERT_STATUS

    const prevStatusCandidate = row.old_status as RenewalAlertStatus | null
    const previousStatus: RenewalAlertStatus | null =
      prevStatusCandidate === 'pending' || prevStatusCandidate === 'negotiating' || prevStatusCandidate === 'renewed'
        ? prevStatusCandidate
        : null

    if (!historyMap[alertKey]) historyMap[alertKey] = []
    historyMap[alertKey].push({
      id: String(row.id),
      alertKey,
      policyId: normalizeOptionalText(row.policy_id),
      previousStatus,
      newStatus,
      previousAssignedTo: normalizeOptionalText(row.old_assigned_to),
      newAssignedTo: normalizeOptionalText(row.new_assigned_to),
      previousNextAction: normalizeOptionalText(row.old_next_action),
      newNextAction: normalizeOptionalText(row.new_next_action),
      changedAt: typeof row.changed_at === 'string' ? row.changed_at : new Date().toISOString(),
    })
  }

  return historyMap
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addYearsUtc(baseDate: Date, years: number): Date {
  return new Date(Date.UTC(baseDate.getUTCFullYear() + years, baseDate.getUTCMonth(), baseDate.getUTCDate()))
}

function computeUpcomingRenewalDate(startDate: Date, todayUtc: Date): Date {
  let renewalDate = addYearsUtc(startDate, 1)
  while (renewalDate < todayUtc) {
    renewalDate = addYearsUtc(renewalDate, 1)
  }
  return renewalDate
}

function getUtcDayDiff(targetDate: Date, todayUtc: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  return Math.round((targetDate.getTime() - todayUtc.getTime()) / MS_PER_DAY)
}

export const getRenewalAlerts = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async (): Promise<RenewalAlertsResponse> => {
    const scope = await getViewerScope()
    if (!scope.isAdmin && !scope.companyId) {
      return {
        generatedAt: new Date().toISOString(),
        total: 0,
        alerts: [],
        byUrgency: { 30: [], 60: [], 90: [] },
        summary: { totalRenewals: 0, totalValueAtRisk: 0, countsByStatus: { pending: 0, negotiating: 0, renewed: 0 } },
      }
    }
    const todayUtc = startOfUtcDay(new Date())

    const [policies, companies, individualClients] = await Promise.all([
      db.getPolicies(scope.companyId ?? undefined),
      scope.companyId
        ? db.getCompany(scope.companyId).then((company) => (company ? [company] : []))
        : db.getCompanies(),
      scope.isAdmin ? db.getIndividualClients() : [],
    ])
    const alertStateMap = await readRenewalAlertStateMap()

    const companyById = new Map(companies.map((company) => [company.id, company]))
    const individualClientById = new Map(individualClients.map((client) => [client.id, client]))
    const dedupe = new Set<string>()
    const alerts: RenewalAlertItem[] = []

    for (const policy of policies) {
      if (!['active', 'expiring'].includes(policy.status)) continue
      const startDate = parseDateToUtc(policy.startDate)
      if (!startDate) continue

      const renewalDate = computeUpcomingRenewalDate(startDate, todayUtc)
      const daysUntilRenewal = getUtcDayDiff(renewalDate, todayUtc)
      if (daysUntilRenewal < 0 || daysUntilRenewal > 90) continue

      const urgency: 30 | 60 | 90 = daysUntilRenewal <= 30 ? 30 : daysUntilRenewal <= 60 ? 60 : 90
      const key = `${policy.id}_${renewalDate.getUTCFullYear()}`
      if (dedupe.has(key)) continue
      dedupe.add(key)

      const company = policy.companyId ? companyById.get(policy.companyId) : undefined
      const individualClient = policy.individualClientId
        ? individualClientById.get(policy.individualClientId)
        : undefined
      const stateRecord = alertStateMap[key]

      alerts.push({
        key,
        policyId: policy.id,
        policyNumber: policy.policyNumber,
        client: individualClient?.fullName || company?.contactName || company?.name || 'Cliente não identificado',
        company: company?.name || 'Cliente individual',
        policyType: policy.type,
        insurer: policy.insurer,
        value: policy.annualPremium || 0,
        startDate: policy.startDate,
        renewalDate: renewalDate.toISOString().slice(0, 10),
        daysUntilRenewal,
        urgency,
        status: stateRecord?.status ?? DEFAULT_RENEWAL_ALERT_STATUS,
        assignedTo: stateRecord?.assignedTo ?? undefined,
        nextAction: stateRecord?.nextAction ?? undefined,
        history: [],
        contactEmail: individualClient?.email || company?.contactEmail || company?.accessEmail,
        contactPhone: individualClient?.phone || company?.contactPhone,
      })
    }

    alerts.sort((a, b) => {
      if (a.daysUntilRenewal !== b.daysUntilRenewal) return a.daysUntilRenewal - b.daysUntilRenewal
      if (a.value !== b.value) return b.value - a.value
      if (a.renewalDate !== b.renewalDate) return a.renewalDate.localeCompare(b.renewalDate)
      return a.policyNumber.localeCompare(b.policyNumber)
    })

    const historyMap = await readRenewalAlertHistoryMap(alerts.map((alert) => alert.key))
    for (const alert of alerts) {
      alert.history = historyMap[alert.key] ?? []
    }

    const byUrgency: RenewalAlertsResponse['byUrgency'] = { 30: [], 60: [], 90: [] }
    const countsByStatus: RenewalAlertsResponse['summary']['countsByStatus'] = {
      pending: 0,
      negotiating: 0,
      renewed: 0,
    }
    let totalValueAtRisk = 0
    for (const alert of alerts) {
      byUrgency[alert.urgency].push(alert)
      countsByStatus[alert.status] += 1
      if (alert.status !== 'renewed') totalValueAtRisk += alert.value
    }

    return {
      generatedAt: new Date().toISOString(),
      total: alerts.length,
      alerts,
      byUrgency,
      summary: {
        totalRenewals: alerts.length,
        totalValueAtRisk,
        countsByStatus,
      },
    }
  })

export const adminUpdateRenewalAlertStatus = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { key: string; status?: RenewalAlertStatus; assignedTo?: string | null; nextAction?: string | null }) => d)
  .handler(async ({ data }) => {
    const key = data.key?.trim()
    if (!key) throw new Error('Chave de alerta inválida')
    const fallbackPolicyId = key.split('_')[0]?.trim() || null

    const validStatuses: RenewalAlertStatus[] = ['pending', 'negotiating', 'renewed']
    if (data.status && !validStatuses.includes(data.status)) throw new Error('Estado de alerta inválido')

    const { data: existing, error: findError } = await supabaseAdmin
      .from('renewal_alerts_state')
      .select('alert_key, policy_id, status, assigned_to, next_action')
      .eq('alert_key', key)
      .maybeSingle()

    if (findError) {
      throw new Error(`Erro ao localizar estado do alerta: ${findError.message}`)
    }

    const previousStatus = existing?.status as RenewalAlertStatus | null
    const previousAssignedTo = normalizeOptionalText(existing?.assigned_to)
    const previousNextAction = normalizeOptionalText(existing?.next_action)

    const policyId = normalizeOptionalText(existing?.policy_id) ?? fallbackPolicyId
    const status = data.status ?? (validStatuses.includes(previousStatus as RenewalAlertStatus) ? (previousStatus as RenewalAlertStatus) : DEFAULT_RENEWAL_ALERT_STATUS)
    const assignedTo = data.assignedTo === undefined ? previousAssignedTo : normalizeOptionalText(data.assignedTo)
    const nextAction = data.nextAction === undefined ? previousNextAction : normalizeOptionalText(data.nextAction)

    const payload = {
      alert_key: key,
      policy_id: policyId,
      status,
      assigned_to: assignedTo,
      next_action: nextAction,
      updated_at: new Date().toISOString(),
    }

    if (existing?.alert_key) {
      const { error: updateError } = await supabaseAdmin
        .from('renewal_alerts_state')
        .update(payload)
        .eq('alert_key', key)
      if (updateError) {
        throw new Error(`Erro ao atualizar estado do alerta: ${updateError.message}`)
      }
    } else {
      const { error: insertError } = await supabaseAdmin
        .from('renewal_alerts_state')
        .insert(payload)
      if (insertError) {
        throw new Error(`Erro ao guardar estado do alerta: ${insertError.message}`)
      }
    }

    const hasStateChange =
      previousStatus !== status ||
      previousAssignedTo !== assignedTo ||
      previousNextAction !== nextAction

    if (hasStateChange) {
      const { error: historyError } = await supabaseAdmin
        .from('renewal_alerts_history')
        .insert({
          alert_key: key,
          policy_id: policyId,
          old_status: previousStatus,
          new_status: status,
          old_assigned_to: previousAssignedTo,
          new_assigned_to: assignedTo,
          old_next_action: previousNextAction,
          new_next_action: nextAction,
          changed_at: new Date().toISOString(),
        })
      if (historyError) {
        throw new Error(`Erro ao guardar histórico do alerta: ${historyError.message}`)
      }
    }

    return { ok: true }
  })

export const fetchAdminFinancialDashboard = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { year?: number; month?: number; companyId?: string; insurer?: string }) => d)
  .handler(async ({ data }): Promise<AdminFinancialDashboardData> => {
    const policies = await db.getPolicies()
    const now = new Date()
    const selectedYear = data.year && Number.isFinite(data.year) ? data.year : now.getUTCFullYear()
    const selectedMonth = data.month && data.month >= 1 && data.month <= 12 ? data.month : undefined
    const selectedCompanyId = data.companyId?.trim() || undefined
    const selectedInsurer = data.insurer?.trim().toLowerCase() || undefined

    const yearSet = new Set<number>([now.getUTCFullYear()])
    const insurerSet = new Set<string>()

    for (const policy of policies) {
      const start = parseDateToUtc(policy.startDate)
      const end = parseDateToUtc(policy.endDate)
      if (start) yearSet.add(start.getUTCFullYear())
      if (end) yearSet.add(end.getUTCFullYear())
      if (policy.insurer?.trim()) insurerSet.add(policy.insurer.trim())
    }

    const monthFormatter = new Intl.DateTimeFormat('pt-PT', { month: 'short' })
    const buildTimelineSkeleton = (year: number) => Array.from({ length: 12 }, (_, index) => {
      const month = index + 1
      const date = new Date(Date.UTC(year, index, 1))
      return {
        month,
        monthKey: `${year}-${String(month).padStart(2, '0')}`,
        label: monthFormatter.format(date).replace('.', ''),
        premiumsCents: 0,
        commissionsCents: 0,
        policies: [] as Array<{
          policyId: string
          policyNumber: string
          insurer: string
          companyId?: string
          type: string
          paymentFrequency: string
          startDate: string
          endDate: string
          status: string
          premiumCents: number
          commissionCents: number
        }>,
      }
    })

    const filteredPolicies = policies.filter((policy) => {
      if (selectedCompanyId && policy.companyId !== selectedCompanyId) return false
      if (selectedInsurer && policy.insurer.trim().toLowerCase() !== selectedInsurer) return false
      return true
    })

    const distributeToTimeline = (
      timeline: ReturnType<typeof buildTimelineSkeleton>,
      targetYear: number
    ) => {
      const timelineByKey = new Map(timeline.map((point) => [point.monthKey, point]))
      for (const policy of filteredPolicies) {
        const start = parseDateToUtc(policy.startDate)
        if (!start) continue

        const premiumCents = Math.round((policy.annualPremium || 0) * 100)
        const commissionSource =
          typeof policy.commissionValue === 'number' && Number.isFinite(policy.commissionValue)
            ? policy.commissionValue
            : typeof policy.commissionPercentage === 'number' && Number.isFinite(policy.commissionPercentage)
              ? ((policy.annualPremium || 0) * policy.commissionPercentage) / 100
              : 0
        const commissionCents = Math.round(commissionSource * 100)
        const frequency = normalizePaymentFrequency(policy.paymentFrequency)
        const { periods, stepMonths } = getDistributionRule(frequency)
        const premiumSlices = splitCents(premiumCents, periods)
        const commissionSlices = splitCents(commissionCents, periods)

        for (let periodIndex = 0; periodIndex < periods; periodIndex += 1) {
          const periodDate = addMonthsUtc(start, periodIndex * stepMonths)
          if (periodDate.getUTCFullYear() !== targetYear) continue
          const key = monthKeyFromDate(periodDate)
          const point = timelineByKey.get(key)
          if (!point) continue
          const premiumSlice = premiumSlices[periodIndex] ?? 0
          const commissionSlice = commissionSlices[periodIndex] ?? 0
          point.premiumsCents += premiumSlice
          point.commissionsCents += commissionSlice
          point.policies.push({
            policyId: policy.id,
            policyNumber: policy.policyNumber,
            insurer: policy.insurer,
            companyId: policy.companyId || undefined,
            type: policy.type,
            paymentFrequency: policy.paymentFrequency ?? 'annual',
            startDate: policy.startDate,
            endDate: policy.endDate,
            status: policy.status,
            premiumCents: premiumSlice,
            commissionCents: commissionSlice,
          })
        }
      }
    }

    const timeline = buildTimelineSkeleton(selectedYear)
    distributeToTimeline(timeline, selectedYear)
    const previousYearTimeline = buildTimelineSkeleton(selectedYear - 1)
    distributeToTimeline(previousYearTimeline, selectedYear - 1)

    const referenceMonth = selectedMonth
      ?? (selectedYear < now.getUTCFullYear() ? 12 : selectedYear > now.getUTCFullYear() ? 1 : now.getUTCMonth() + 1)

    const activePolicies = filteredPolicies.filter((policy) =>
      isPolicyActiveInMonth(policy, selectedYear, referenceMonth)
    ).length

    const totalPremiumsCents = selectedMonth
      ? timeline[selectedMonth - 1]?.premiumsCents ?? 0
      : timeline.reduce((sum, point) => sum + point.premiumsCents, 0)
    const totalCommissionsCents = selectedMonth
      ? timeline[selectedMonth - 1]?.commissionsCents ?? 0
      : timeline.reduce((sum, point) => sum + point.commissionsCents, 0)

    const projectionStartMonth =
      selectedMonth
      ?? (selectedYear > now.getUTCFullYear() ? 1 : selectedYear < now.getUTCFullYear() ? 13 : now.getUTCMonth() + 1)
    const projectedCommissionsCents =
      projectionStartMonth > 12
        ? 0
        : timeline
            .filter((point) => point.month >= projectionStartMonth)
            .reduce((sum, point) => sum + point.commissionsCents, 0)

    const previousMonthYear = selectedMonth && selectedMonth === 1 ? selectedYear - 1 : selectedYear
    const previousMonthTimeline = previousMonthYear === selectedYear
      ? timeline
      : previousYearTimeline
    const previousMonthIndex = selectedMonth
      ? (selectedMonth === 1 ? 11 : selectedMonth - 2)
      : Math.max(referenceMonth - 2, -1)
    const previousMonthPoint = previousMonthIndex >= 0 ? previousMonthTimeline[previousMonthIndex] : null

    const previousYearReferencePoint = selectedMonth
      ? previousYearTimeline[selectedMonth - 1] ?? null
      : null

    const previousYearTotalPremiumsCents = previousYearTimeline.reduce((sum, point) => sum + point.premiumsCents, 0)
    const previousYearTotalCommissionsCents = previousYearTimeline.reduce((sum, point) => sum + point.commissionsCents, 0)
    const previousYearProjectedCommissionsCents =
      projectionStartMonth > 12
        ? 0
        : previousYearTimeline
            .filter((point) => point.month >= projectionStartMonth)
            .reduce((sum, point) => sum + point.commissionsCents, 0)

    const previousMonthActivePolicies = previousMonthPoint
      ? filteredPolicies.filter((policy) =>
          isPolicyActiveInMonth(policy, previousMonthYear, previousMonthPoint.month)
        ).length
      : null
    const previousYearActivePolicies = selectedMonth
      ? filteredPolicies.filter((policy) =>
          isPolicyActiveInMonth(policy, selectedYear - 1, selectedMonth)
        ).length
      : filteredPolicies.filter((policy) =>
          isPolicyActiveInMonth(policy, selectedYear - 1, referenceMonth)
        ).length

    const currentPremiumBase = totalPremiumsCents / 100
    const currentCommissionBase = totalCommissionsCents / 100
    const currentProjectedBase = projectedCommissionsCents / 100
    const currentActiveBase = activePolicies
    const previousMonthPremiumBase = previousMonthPoint
      ? previousMonthPoint.premiumsCents / 100
      : null
    const previousMonthCommissionBase = previousMonthPoint
      ? previousMonthPoint.commissionsCents / 100
      : null
    const previousMonthProjectedBase = previousMonthPoint
      ? previousMonthPoint.commissionsCents / 100
      : null
    const previousYearPremiumBase = selectedMonth
      ? (previousYearReferencePoint ? previousYearReferencePoint.premiumsCents / 100 : null)
      : previousYearTotalPremiumsCents / 100
    const previousYearCommissionBase = selectedMonth
      ? (previousYearReferencePoint ? previousYearReferencePoint.commissionsCents / 100 : null)
      : previousYearTotalCommissionsCents / 100
    const previousYearProjectedBase = selectedMonth
      ? (previousYearReferencePoint ? previousYearReferencePoint.commissionsCents / 100 : null)
      : previousYearProjectedCommissionsCents / 100
    const currentMonthInSelectedYear = selectedYear === now.getUTCFullYear() ? now.getUTCMonth() + 1 : null

    const projectionHighlights = timeline
      .filter((point) => point.month >= projectionStartMonth && point.commissionsCents > 0)
      .sort((a, b) => b.commissionsCents - a.commissionsCents)
      .slice(0, 3)
      .map((point) => ({
        month: point.month,
        monthKey: point.monthKey,
        label: point.label,
        premiums: point.premiumsCents / 100,
        commissions: point.commissionsCents / 100,
      }))

    return {
      summary: {
        totalPremiums: currentPremiumBase,
        totalCommissions: currentCommissionBase,
        projectedCommissions: currentProjectedBase,
        activePolicies: currentActiveBase,
        comparisons: {
          totalPremiums: {
            current: currentPremiumBase,
            previousMonth: previousMonthPremiumBase,
            previousYear: previousYearPremiumBase,
            momDeltaPct: toDeltaPct(currentPremiumBase, previousMonthPremiumBase),
            yoyDeltaPct: toDeltaPct(currentPremiumBase, previousYearPremiumBase),
          },
          totalCommissions: {
            current: currentCommissionBase,
            previousMonth: previousMonthCommissionBase,
            previousYear: previousYearCommissionBase,
            momDeltaPct: toDeltaPct(currentCommissionBase, previousMonthCommissionBase),
            yoyDeltaPct: toDeltaPct(currentCommissionBase, previousYearCommissionBase),
          },
          projectedCommissions: {
            current: currentProjectedBase,
            previousMonth: previousMonthProjectedBase,
            previousYear: previousYearProjectedBase,
            momDeltaPct: toDeltaPct(currentProjectedBase, previousMonthProjectedBase),
            yoyDeltaPct: toDeltaPct(currentProjectedBase, previousYearProjectedBase),
          },
          activePolicies: {
            current: currentActiveBase,
            previousMonth: previousMonthActivePolicies,
            previousYear: previousYearActivePolicies,
            momDeltaPct: toDeltaPct(currentActiveBase, previousMonthActivePolicies),
            yoyDeltaPct: toDeltaPct(currentActiveBase, previousYearActivePolicies),
          },
        },
      },
      timeline: timeline.map((point) => ({
        month: point.month,
        monthKey: point.monthKey,
        label: point.label,
        premiums: point.premiumsCents / 100,
        commissions: point.commissionsCents / 100,
        isHistorical:
          selectedYear < now.getUTCFullYear()
            ? true
            : selectedYear > now.getUTCFullYear()
              ? false
              : point.month <= (currentMonthInSelectedYear ?? 0),
        isProjected:
          selectedYear > now.getUTCFullYear()
            ? true
            : selectedYear < now.getUTCFullYear()
              ? false
              : point.month > (currentMonthInSelectedYear ?? 12),
      })),
      monthlyDetails: timeline.map((point) => ({
        month: point.month,
        monthKey: point.monthKey,
        label: point.label,
        premiums: point.premiumsCents / 100,
        commissions: point.commissionsCents / 100,
        policiesCount: point.policies.length,
        policies: point.policies
          .slice()
          .sort((a, b) => b.commissionCents - a.commissionCents)
          .map((item) => ({
            policyId: item.policyId,
            policyNumber: item.policyNumber,
            insurer: item.insurer,
            companyId: item.companyId,
            type: item.type,
            paymentFrequency: item.paymentFrequency,
            startDate: item.startDate,
            endDate: item.endDate,
            status: item.status,
            premium: item.premiumCents / 100,
            commission: item.commissionCents / 100,
          })),
      })),
      projectionHighlights,
      context: {
        selectedViewMonth: referenceMonth,
        currentMonthInSelectedYear,
      },
      availableFilters: {
        years: Array.from(yearSet).sort((a, b) => b - a),
        insurers: Array.from(insurerSet).sort((a, b) => a.localeCompare(b)),
      },
      appliedFilters: {
        year: selectedYear,
        month: selectedMonth,
        companyId: selectedCompanyId,
        insurer: selectedInsurer,
      },
    }
  })

// Admin functions
export const adminCreatePolicy = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator(
    (d: {
      companyId?: string
      individualClientId?: string
      type: string
      insurer: string
      policyNumber: string
      description: string
      startDate: string
      endDate: string
      annualPremium: number
      insuredValue: number
      paymentFrequency?: string
      commissionPercentage?: number
      commissionValue?: number
    }) => d
  )
  .handler(async ({ data }) => {
    const id = `pol_${Date.now()}`
    await db.createPolicy({
      id,
      ...data,
      companyId: data.companyId || '',
      individualClientId: data.individualClientId || undefined,
      type: data.type as any,
      status: 'active',
      createdAt: new Date().toISOString(),
    })
    return { id }
  })

export const adminUpdatePolicy = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string; updates: any }) => d)
  .handler(async ({ data }) => {
    await db.updatePolicy(data.id, data.updates)
    return { success: true }
  })

export const adminUploadPolicyDocument = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { policyId: string; companyId?: string; individualClientId?: string; name: string; storagePath: string; size: number; category: string }) => d)
  .handler(async ({ data }) => {
    await db.createDocument({
      id: crypto.randomUUID(),
      companyId: data.companyId ?? '',
      individualClientId: data.individualClientId,
      name: data.name,
      category: data.category as any,
      size: data.size,
      uploadedBy: 'admin',
      uploadedAt: new Date().toISOString(),
      storagePath: data.storagePath,
    })
    return { success: true }
  })

export const getDocumentUrl = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { storagePath: string }) => d)
  .handler(async ({ data }) => {
    if (data.storagePath.startsWith('netlify:')) {
      const documentId = data.storagePath.slice('netlify:'.length)
      const [document] = await netlifyDb
        .select()
        .from(policyDocuments)
        .where(eq(policyDocuments.id, documentId))
        .limit(1)
      if (!document || !(await fetchAccessiblePolicy(document.policyId))) {
        throw new Error('Sem acesso a este documento')
      }
      return { url: `/api/policy-document?documentId=${encodeURIComponent(documentId)}` }
    }
    const policyId = data.storagePath.split('/policies/')[1]?.split('/')[0]
    if (policyId && !(await fetchAccessiblePolicy(policyId))) {
      throw new Error('Sem acesso a este documento')
    }
    const { data: urlData, error } = await supabaseAdmin.storage
      .from('documents')
      .createSignedUrl(data.storagePath, 3600)
    if (error) throw new Error(error.message)
    return { url: urlData.signedUrl }
  })

export const getStorageUploadUrl = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { storagePath: string }) => d)
  .handler(async ({ data }) => {
    const parts = data.storagePath.split('/')
    const allowedTypes = ['claims', 'policies']
    // Reject empty first segment (leading slash), path traversal, and paths where neither
    // parts[0] nor parts[1] is a known type (covers both old format and companyId-prefix format)
    if (
      data.storagePath.includes('..') ||
      parts[0] === '' ||
      (!allowedTypes.includes(parts[0]) && !allowedTypes.includes(parts[1]))
    ) {
      throw new Error('Invalid storage path')
    }
    // For companyId-prefixed paths ({companyId}/policies/... or {companyId}/claims/...),
    // validate the companyId against the user's scope — admins may write to any company prefix
    if (!allowedTypes.includes(parts[0])) {
      const scope = await getViewerScope()
      if (!scope.isAdmin) {
        const expectedCompanyId = scope.companyId ?? 'general'
        if (parts[0] !== expectedCompanyId) throw new Error('Invalid storage path')
      }
    }
    const { data: urlData, error } = await supabaseAdmin.storage
      .from('documents')
      .createSignedUploadUrl(data.storagePath)
    if (error) throw new Error(error.message)
    return { token: urlData.token, path: urlData.path }
  })

// Keep alias for backwards compatibility
export const adminGetDocumentUrl = getDocumentUrl

export const fetchClientDocuments = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { individualClientId?: string }) => d)
  .handler(async ({ data }) => {
    const scope = await getViewerScope()
    // Admin can pass explicit clientId; individual client uses own ID from scope
    const clientId = scope.isAdmin ? data.individualClientId : scope.individualClientId
    if (!clientId) return []
    const { data: docs, error } = await supabaseAdmin
      .from('documents')
      .select('id, name, category, size, uploaded_by, uploaded_at, storage_path')
      .eq('individual_client_id', clientId)
      .order('uploaded_at', { ascending: false })
    if (error) throw new Error(error.message)
    return docs ?? []
  })

export const adminUpdateClaimStatus = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { claimId: string; status: string; notes?: string }) => d)
  .handler(async ({ data }) => {
    const scope = await getViewerScope()
    const claim = await db.getClaim(data.claimId)
    if (!claim) throw new Error('Sinistro não encontrado')
    const now = new Date().toISOString()
    const currentStatus = claim.status
    const statusLabel = String(data.status).replaceAll('_', ' ')
    const steps = [
      ...claim.steps,
      {
        status: data.status as any,
        date: now.split('T')[0],
        notes: data.notes,
      },
    ]
    await db.updateClaim(data.claimId, { status: data.status as any, steps })

    await updateClaimOperationalData(data.claimId, (current) => ({
      ...current,
      timeline: [
        ...current.timeline,
        buildTimelineEvent({
          type: 'status',
          message: `Estado alterado de ${currentStatus} para ${data.status}${data.notes ? ` (${data.notes})` : ''}`,
          actorName: scope.user.name || scope.user.email || 'Admin',
          actorRole: 'admin',
        }),
      ],
    }))

    await persistClaimMessage({
      claim,
      senderType: 'admin',
      senderName: scope.user.name || scope.user.email || 'Admin',
      senderUserId: scope.user.id,
      message: data.notes?.trim() || `Estado do sinistro atualizado para "${statusLabel}".`,
      createdAt: now,
      readAt: null,
    })
    if (claim.companyId) {
      await db.createAlert({
        id: `alt_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        companyId: claim.companyId,
        type: 'claim_update',
        title: `Sinistro ${claim.id} atualizado`,
        message: data.notes?.trim() || `Novo estado: ${statusLabel}`,
        read: false,
        createdAt: now,
      })
    }

    return { success: true }
  })

export const adminSendClaimMessage = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { claimId: string; message: string }) => d)
  .handler(async ({ data }) => {
    const scope = await getViewerScope()
    const claim = await db.getClaim(data.claimId)
    if (!claim) throw new Error('Sinistro não encontrado')

    const message = data.message.trim()
    if (!message) throw new Error('Mensagem vazia')

    const now = new Date().toISOString()
    const senderName = scope.user.name || scope.user.email || 'Admin'
    await persistClaimMessage({
      claim,
      senderType: 'admin',
      senderName,
      senderUserId: scope.user.id,
      message,
      createdAt: now,
      readAt: null,
    })

    await updateClaimOperationalData(data.claimId, (current) => ({
      ...current,
      timeline: [
        ...current.timeline,
        buildTimelineEvent({
          type: 'message',
          message: 'Admin adicionou uma mensagem',
          actorName: senderName,
          actorRole: 'admin',
        }),
      ],
    }))

    if (claim.companyId) {
      await db.createAlert({
        id: crypto.randomUUID(),
        companyId: claim.companyId,
        type: 'claim_update',
        title: `Nova mensagem no sinistro ${claim.id.slice(-8).toUpperCase()}`,
        message,
        read: false,
        createdAt: now,
      })
    }

    const recipientEmail = claim.individualClientId
      ? (await db.getIndividualClient(claim.individualClientId))?.email
      : (claim.companyId ? (await db.getCompany(claim.companyId))?.contactEmail : undefined)

    await sendClaimMessageEmail({
      to: recipientEmail,
      claimId: claim.id,
      senderName,
      senderRole: 'admin',
      body: message,
    })

    return { success: true }
  })

export const adminCreateClaim = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: {
    targetType: 'company' | 'individual'
    companyId?: string
    individualClientId?: string
    clientUserId?: string
    policyId: string
    type: string
    description: string
    incidentDate: string
    estimatedValue?: number
  }) => d)
  .handler(async ({ data }) => {
    if (data.targetType === 'company' && !data.companyId) {
      throw new Error('Empresa é obrigatória para este tipo de sinistro')
    }
    if (data.targetType === 'individual' && !data.individualClientId) {
      throw new Error('Cliente individual é obrigatório para este tipo de sinistro')
    }

    const policy = await db.getPolicy(data.policyId)
    if (!policy) throw new Error('Apólice não encontrada')

    if (data.targetType === 'company' && policy.companyId !== data.companyId) {
      throw new Error('A apólice selecionada não pertence à empresa indicada')
    }
    if (data.targetType === 'individual' && policy.individualClientId !== data.individualClientId) {
      throw new Error('A apólice selecionada não pertence ao cliente indicado')
    }

    const { claim, created } = await getOrCreateClaimByPolicy({
      policyId: data.policyId,
      buildNewClaim: (claimId, nowIso) => ({
        id: claimId,
        policyId: data.policyId,
        companyId: data.targetType === 'company' ? data.companyId : undefined,
        individualClientId: data.targetType === 'individual' ? data.individualClientId : undefined,
        title: data.type,
        description: data.description,
        claimDate: nowIso.slice(0, 10),
        incidentDate: data.incidentDate,
        estimatedValue: Number(data.estimatedValue || 0),
        status: 'submitted',
        steps: [{ status: 'submitted', date: nowIso.slice(0, 10), notes: 'Sinistro criado pelo Admin' }],
        createdAt: nowIso,
      }),
      updatesIfExisting: {
        companyId: data.targetType === 'company' ? data.companyId : undefined,
        individualClientId: data.targetType === 'individual' ? data.individualClientId : undefined,
        title: data.type,
        description: data.description,
        incidentDate: data.incidentDate,
        estimatedValue: Number(data.estimatedValue || 0),
      },
    })

    let responsible: ClaimParticipant | undefined
    if (data.clientUserId) {
      const companyUsers = await db.getCompanyUsers()
      const selected = companyUsers.find((user) => user.id === data.clientUserId)
      responsible = {
        id: data.clientUserId,
        name: selected?.name || 'Responsável',
        email: selected?.email,
        role: 'admin',
      }
    }

    if (created) {
      const nowIso = claim.createdAt
      await saveClaimOperationalData({
        claimId: claim.id,
        responsible,
        teamNotes: [],
        messages: [],
        documents: [],
        timeline: [
          buildTimelineEvent({
            type: 'created',
            message: `Sinistro criado (${data.type})`,
            actorName: 'Admin',
            actorRole: 'admin',
          }),
        ],
        updatedAt: nowIso,
      })
    } else if (responsible) {
      await updateClaimOperationalData(claim.id, (current) => ({
        ...current,
        responsible,
      }))
    }

    if (created && data.targetType === 'company' && data.companyId) {
      await db.createAlert({
        id: `alt_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        companyId: data.companyId,
        type: 'claim_update',
        title: `Novo sinistro ${claim.id}`,
        message: `Foi criado um novo sinistro (${data.type})`,
        read: false,
        createdAt: new Date().toISOString(),
      })
    }

    return { id: claim.id, reused: !created }
  })

export const fetchClaimWorkspace = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { claimId: string }) => d)
  .handler(async ({ data }) => {
    const ctx = await getViewerAccessContext()
    const claim = await db.getClaim(data.claimId)
    if (!claim) throw new Error('Sinistro não encontrado')
    if (!canAccessClaimByContext(claim, ctx)) throw new Error('Sem acesso a este sinistro')

    const [policy, company, individualClient, ops] = await Promise.all([
      db.getPolicy(claim.policyId),
      claim.companyId ? db.getCompany(claim.companyId) : Promise.resolve(undefined),
      claim.individualClientId ? db.getIndividualClient(claim.individualClientId) : Promise.resolve(undefined),
      getCanonicalClaimOperationalData(claim),
    ])

    return {
      claim,
      policy,
      company,
      individualClient,
      operations: ops,
    }
  })

export const adminAssignClaimResponsible = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { claimId: string; responsible?: { id: string; name: string; email?: string } }) => d)
  .handler(async ({ data }) => {
    const claim = await db.getClaim(data.claimId)
    if (!claim) throw new Error('Sinistro não encontrado')

    await updateClaimOperationalData(data.claimId, (current) => {
      const nextResponsible = data.responsible
        ? {
            id: data.responsible.id,
            name: data.responsible.name,
            email: data.responsible.email,
            role: 'admin' as const,
          }
        : undefined
      const timeline = [...current.timeline]
      timeline.push(
        buildTimelineEvent({
          type: 'assignment',
          message: nextResponsible ? `Responsável definido: ${nextResponsible.name}` : 'Responsável removido',
          actorName: 'Admin',
          actorRole: 'admin',
        }),
      )
      return { ...current, responsible: nextResponsible, timeline }
    })

    return { success: true }
  })

export const adminAddClaimTeamNote = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { claimId: string; note: string; authorName?: string }) => d)
  .handler(async ({ data }) => {
    const trimmed = data.note.trim()
    if (!trimmed) throw new Error('Nota vazia')
    const claim = await db.getClaim(data.claimId)
    if (!claim) throw new Error('Sinistro não encontrado')

    await updateClaimOperationalData(data.claimId, (current) => ({
      ...current,
      teamNotes: [
        ...current.teamNotes,
        {
          id: crypto.randomUUID(),
          note: trimmed,
          createdAt: new Date().toISOString(),
          authorName: data.authorName || 'Admin',
        },
      ],
      timeline: [
        ...current.timeline,
        buildTimelineEvent({
          type: 'note',
          message: 'Nota interna adicionada',
          actorName: data.authorName || 'Admin',
          actorRole: 'admin',
        }),
      ],
    }))

    return { success: true }
  })

export const addClaimMessage = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { claimId: string; body: string }) => d)
  .handler(async ({ data }) => {
    const body = data.body.trim()
    if (!body) throw new Error('Mensagem vazia')

    const ctx = await getViewerAccessContext()
    const claim = await db.getClaim(data.claimId)
    if (!claim) throw new Error('Sinistro não encontrado')
    if (!canAccessClaimByContext(claim, ctx)) throw new Error('Sem acesso a este sinistro')

    const senderRole: ClaimTicketMessage['senderRole'] = ctx.isAdmin ? 'admin' : 'client'
    const senderName = ctx.user.name || (ctx.isAdmin ? 'Admin' : 'Cliente')
    const createdAt = new Date().toISOString()

    await persistClaimMessage({
      claim,
      senderType: senderRole,
      senderName,
      senderUserId: ctx.user.id,
      message: body,
      createdAt,
      readAt: senderRole === 'client' ? createdAt : null,
    })

    const ops = await updateClaimOperationalData(data.claimId, (current) => ({
      ...current,
      timeline: [
        ...current.timeline,
        buildTimelineEvent({
          type: 'message',
          message: `${senderRole === 'admin' ? 'Admin' : 'Cliente'} adicionou uma mensagem`,
          actorName: senderName,
          actorRole: senderRole,
        }),
      ],
    }))

    if (claim.companyId) {
      await db.createAlert({
        id: `alt_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        companyId: claim.companyId,
        type: 'claim_update',
        title: `Nova mensagem no sinistro ${claim.id}`,
        message: senderRole === 'admin' ? 'Admin respondeu no ticket' : 'Cliente respondeu no ticket',
        read: false,
        createdAt: new Date().toISOString(),
      })
    }

    const recipientEmail = senderRole === 'admin'
      ? (claim.individualClientId ? (await db.getIndividualClient(claim.individualClientId))?.email : (await db.getCompany(claim.companyId || ''))?.contactEmail)
      : (claim.companyId ? (await db.getCompany(claim.companyId))?.contactEmail : process.env['CLAIMS_NOTIFICATIONS_TO'])

    await sendClaimMessageEmail({
      to: recipientEmail,
      claimId: claim.id,
      senderName,
      senderRole,
      body,
    })

    return { success: true, operations: ops }
  })

export const registerClaimDocument = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { claimId: string; name: string; contentType?: string; mimeType?: string; storagePath: string; size: number }) => d)
  .handler(async ({ data }) => {
    const ctx = await getViewerAccessContext()
    const claim = await db.getClaim(data.claimId)
    if (!claim) throw new Error('Sinistro não encontrado')
    if (!canAccessClaimByContext(claim, ctx)) throw new Error('Sem acesso a este sinistro')

    const uploadedByRole: ClaimFileRef['uploadedByRole'] = ctx.isAdmin ? 'admin' : 'client'
    const uploadedByName = ctx.user.name || (ctx.isAdmin ? 'Admin' : 'Cliente')
    const uploadedAt = new Date().toISOString()
    const contentType = data.contentType || data.mimeType || 'application/octet-stream'
    const fileRef: ClaimFileRef = {
      id: crypto.randomUUID(),
      claimId: claim.id,
      name: data.name,
      contentType,
      uploadedAt,
      uploadedByName,
      uploadedByRole,
      storagePath: data.storagePath,
      size: Number(data.size || 0),
    }

    await db.createDocument({
      id: fileRef.id,
      companyId: claim.companyId ?? '',
      individualClientId: claim.individualClientId,
      name: data.name,
      category: 'claim',
      size: fileRef.size,
      uploadedBy: uploadedByName,
      uploadedAt,
      storagePath: data.storagePath,
    })

    const ops = await updateClaimOperationalData(data.claimId, (current) => ({
      ...current,
      documents: [...current.documents, fileRef],
      timeline: [
        ...current.timeline,
        buildTimelineEvent({
          type: 'document',
          message: `Documento adicionado: ${data.name}`,
          actorName: uploadedByName,
          actorRole: uploadedByRole,
        }),
      ],
    }))

    return { success: true, operations: ops }
  })

export const removeClaimDocument = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { claimId: string; documentId: string }) => d)
  .handler(async ({ data }) => {
    const claim = await db.getClaim(data.claimId)
    if (!claim) throw new Error('Sinistro não encontrado')

    const ops = await updateClaimOperationalData(data.claimId, (current) => {
      const target = current.documents.find((item) => item.id === data.documentId)
      const documents = current.documents.filter((item) => item.id !== data.documentId)
      const timeline = [...current.timeline]
      if (target) {
        timeline.push(
          buildTimelineEvent({
            type: 'document',
            message: `Documento removido: ${target.name}`,
            actorName: 'Admin',
            actorRole: 'admin',
          }),
        )
      }
      return { ...current, documents, timeline }
    })

    return { success: true, operations: ops }
  })

export const getClaimDocumentUrl = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { claimId?: string; documentId: string }) => d)
  .handler(async ({ data }) => {
    const ctx = await getViewerAccessContext()

    const dbDocument = await db.getDocument(data.documentId)
    if (dbDocument?.storagePath) {
      if (ctx.companyId && dbDocument.companyId && dbDocument.companyId !== ctx.companyId) {
        throw new Error('Sem permissões para este documento')
      }

      const { data: urlData, error } = await supabaseAdmin.storage
        .from('documents')
        .createSignedUrl(dbDocument.storagePath, 3600)
      if (error) throw new Error(error.message)
      return { url: urlData.signedUrl, name: dbDocument.name }
    }

    if (!data.claimId) throw new Error('Sinistro não encontrado')

    const claim = await db.getClaim(data.claimId)
    if (!claim) throw new Error('Sinistro não encontrado')
    if (!canAccessClaimByContext(claim, ctx)) throw new Error('Sem acesso a este sinistro')

    const ops = await getClaimOperationalData(data.claimId)
    const doc = ops.documents.find((item) => item.id === data.documentId)
    if (!doc) throw new Error('Documento não encontrado')

    const { data: urlData, error } = await supabaseAdmin.storage
      .from('documents')
      .createSignedUrl(doc.storagePath, 3600)
    if (error) throw new Error(error.message)
    return { url: urlData.signedUrl, name: doc.name }
  })

export const adminCreateCompany = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator(
    (d: {
      name: string
      nif: string
      sector: string
      contactName: string
      contactEmail: string
      contactPhone: string
      accessEmail: string
      address: string
    }) => d
  )
  .handler(async ({ data }) => {
    const id = `comp_${Date.now()}`
    await db.createCompany({
      id,
      ...data,
      createdAt: new Date().toISOString(),
    })
    return { id }
  })

export const adminUpdateCompany = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string; updates: any }) => d)
  .handler(async ({ data }) => {
    await db.updateCompany(data.id, data.updates)
    return { success: true }
  })

export const adminDeleteCompany = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    await db.deleteCompanyRelations(id)
    await db.deleteCompany(id)
    return { success: true }
  })

export const adminCreateCompanyUser = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator(
    (d: {
      companyId: string
      name: string
      email: string
      role: 'owner' | 'manager' | 'employee'
      accessPassword: string
    }) => d
  )
  .handler(async ({ data }) => {
    const existing = await db.getCompanyUserByEmail(data.email)
    if (existing) throw new Error('Já existe um utilizador com este email')

    const id = `usr_${Date.now()}`
    const now = new Date().toISOString()
    const normalizedEmail = data.email.toLowerCase()
    const { accessPassword, ...safeCompanyUserData } = data
    await db.createCompanyUser({
      id,
      ...safeCompanyUserData,
      email: normalizedEmail,
      identityStatus: 'pending_confirmation',
      invitationSentAt: now,
      createdAt: now,
      updatedAt: now,
    })

    try {
      const result = await createIdentityUserWithConfirmation({
        email: normalizedEmail,
        password: accessPassword,
        fullName: data.name,
        companyId: data.companyId,
        companyUserId: id,
        companyRole: data.role,
      })

      if (result.created) {
        await db.updateCompanyUser(id, {
          identityStatus: 'active',
          updatedAt: new Date().toISOString(),
        })
      } else if (result.reason === 'already_exists') {
        await db.updateCompanyUser(id, {
          identityStatus: 'already_registered',
          updatedAt: new Date().toISOString(),
        })
      }
    } catch (error) {
      await db.deleteCompanyUser(id)
      throw error
    }

    await db.createUserMetricEvent({
      id: `evt_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
      companyId: data.companyId,
      userId: id,
      timestamp: now,
      type: 'profile_update',
      description: 'Utilizador criado no painel de administração',
    })
    return { id }
  })

export const adminUpdateCompanyUser = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string; updates: any }) => d)
  .handler(async ({ data }) => {
    const { accessPassword: updatedPassword, ...safeUpdates } = data.updates ?? {}
    if (typeof updatedPassword === 'string' && updatedPassword.length > 0) {
      const users = await db.getCompanyUsers()
      const current = users.find((user) => user.id === data.id)
      if (!current?.email) throw new Error('Utilizador não encontrado para atualizar password no Identity.')
      await updateIdentityUserPasswordByEmail(current.email, updatedPassword)
      // Garantir que o identity_status fica como active após reset de password
      if (!safeUpdates.identityStatus) {
        safeUpdates.identityStatus = 'active'
      }
    }

    await db.updateCompanyUser(data.id, {
      ...safeUpdates,
      updatedAt: new Date().toISOString(),
    })
    return { success: true }
  })

export const adminDeleteCompanyUser = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const users = await db.getCompanyUsers()
    const user = users.find((u) => u.id === id)
    if (user?.email) {
      try {
        await deleteIdentityUserByEmail(user.email)
      } catch (e) {
        console.error('Aviso: falha ao eliminar utilizador do Auth:', e)
      }
    }
    await db.deleteCompanyUser(id)
    return { success: true }
  })

export const adminRefreshApiConnection = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const connections = await db.getApiConnections()
    const connection = connections.find((conn) => conn.id === data.id)
    if (!connection) throw new Error('Ligação API não encontrada')

    const now = new Date().toISOString()
    const randomLatency = `${Math.floor(Math.random() * 240) + 40}ms`
    const status = connection.status === 'error' ? 'connected' : connection.status
    await db.updateApiConnection(data.id, {
      latency: randomLatency,
      status,
      lastSync: now,
    })

    return { success: true }
  })

export const adminCreateIndividualClient = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { fullName: string; nif?: string; email?: string; phone?: string; address?: string; status: string }) => d)
  .handler(async ({ data }) => db.createIndividualClient(data))

export const adminUpdateIndividualClient = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string; updates: any }) => d)
  .handler(async ({ data }) => {
    await db.updateIndividualClient(data.id, data.updates)
    return { success: true }
  })

export const adminDeleteIndividualClient = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    // Apagar o login do Auth ANTES de tocar na DB — se falhar, a DB fica intacta.
    // deleteIdentityUserById trata 404 como no-op (UUID já inexistente no Auth).
    const { data: clientRow } = await supabaseAdmin
      .from('individual_clients')
      .select('auth_user_id')
      .eq('id', id)
      .single()
    if (clientRow?.auth_user_id) {
      await deleteIdentityUserById(clientRow.auth_user_id as string)
    }
    await db.deleteIndividualClientRelations(id)
    await db.deleteIndividualClient(id)
    return { success: true }
  })

// ── Website Leads (histórico de pedidos do site público) ────────
// Só leitura — a escrita é exclusivamente via netlify/api-functions/lead-intake.mts.

export const fetchWebsiteLeads = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((individualClientId: string) => individualClientId)
  .handler(async ({ data: individualClientId }) => db.getWebsiteLeadsByIndividualClientId(individualClientId))

export const fetchClientNotes = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { companyId?: string; individualClientId?: string }) => d)
  .handler(async ({ data }) => db.getClientNotes(data))

export const adminCreateClientNote = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { companyId?: string; individualClientId?: string; body: string; category?: string }) => d)
  .handler(async ({ data }) => {
    const body = data.body.trim()
    if (!body) throw new Error('Nota vazia')
    const scope = await getViewerScope()
    const note: ClientNote = {
      id: crypto.randomUUID(),
      companyId: data.companyId,
      individualClientId: data.individualClientId,
      body,
      category: data.category,
      authorName: scope.user.name || scope.user.email || 'Admin',
      createdAt: new Date().toISOString(),
    }
    await db.createClientNote(note)
    return { success: true, note }
  })

export const adminDeleteClientNote = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    await db.deleteClientNote(id)
    return { success: true }
  })

// ── Client Tasks ─────────────────────────────────────────────

export const fetchClientTasks = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { companyId?: string; individualClientId?: string; status?: 'pending' | 'done' }) => d)
  .handler(async ({ data }) => db.getClientTasks(data, data.status ? { status: data.status } : undefined))

export const adminCreateClientTask = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: {
    companyId?: string
    individualClientId?: string
    title: string
    description?: string
    dueDate: string
  }) => d)
  .handler(async ({ data }) => {
    const title = data.title.trim()
    if (!title) throw new Error('Título vazio')
    const task: ClientTask = {
      id: crypto.randomUUID(),
      companyId: data.companyId,
      individualClientId: data.individualClientId,
      title,
      description: data.description,
      dueDate: data.dueDate,
      status: 'pending',
      createdAt: new Date().toISOString(),
      source: 'manual',
    }
    await db.createClientTask(task)
    return { success: true, task }
  })

export const adminUpdateClientTaskStatus = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string; status: 'pending' | 'done' }) => d)
  .handler(async ({ data }) => {
    await db.updateClientTaskStatus(data.id, data.status)
    return { success: true }
  })

export const adminDeleteClientTask = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    await db.deleteClientTask(id)
    return { success: true }
  })

export const fetchAllTasksByDueDate = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { status?: 'pending' | 'done' }) => d)
  .handler(async ({ data }) => db.getAllTasksByDueDate(data.status ? { status: data.status } : undefined))

// ── Sales Opportunities (CRM 2, fase 1) ──────────────────────────
// BACKOFFICE ONLY: toda a função aqui exige requireRoleMiddleware('admin'),
// nunca só requireAuthMiddleware — ver requisito "não permitir operações
// comerciais apenas com sessão autenticada". Nenhuma destas funções é
// chamada a partir de rotas /one/* nem de qualquer portal de cliente.

export const fetchSalesOpportunities = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: db.SalesOpportunityFilters = {}) => d)
  .handler(async ({ data }) => db.getSalesOpportunities(data))

export const fetchSalesOpportunity = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => db.getSalesOpportunity(id))

export const fetchSalesOpportunitiesByOwner = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { companyId?: string; individualClientId?: string }) => d)
  .handler(async ({ data }) => db.getSalesOpportunitiesByOwner(data))

export const adminCreateSalesOpportunity = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: {
    companyId?: string
    individualClientId?: string
    clientName: string
    product?: string
    market?: string
    stage?: SalesOpportunityStage
    source?: string
    sourceDetail?: string
    estimatedAnnualPremium?: number
    estimatedRevenue?: number
    currency?: string
    assignedTo?: string
    expectedCloseDate?: string
    nextFollowUpAt?: string
  }) => d)
  .handler(async ({ data }) => {
    const { id } = await db.createSalesOpportunity({
      companyId: data.companyId,
      individualClientId: data.individualClientId,
      title: buildOpportunityTitle(data.product, data.clientName),
      product: data.product,
      market: data.market,
      stage: data.stage ?? 'new',
      source: data.source ?? 'manual',
      sourceDetail: data.sourceDetail,
      estimatedAnnualPremium: data.estimatedAnnualPremium,
      estimatedRevenue: data.estimatedRevenue,
      currency: data.currency ?? 'EUR',
      assignedTo: data.assignedTo,
      expectedCloseDate: data.expectedCloseDate,
      nextFollowUpAt: data.nextFollowUpAt,
    })
    return { success: true, id }
  })

// Só os campos em SalesOpportunityEditableUpdate são aceites — owner
// (companyId/individualClientId), websiteLeadId, id, createdAt, closedAt e
// stage nunca passam por aqui, nem em TypeScript (este tipo já os exclui)
// nem em runtime (db.updateSalesOpportunity aplica a mesma allowlist outra
// vez do lado do data layer — ver requisito "validar update payload").
export const adminUpdateSalesOpportunity = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string; updates: SalesOpportunityEditableUpdate }) => d)
  .handler(async ({ data }) => {
    await db.updateSalesOpportunity(data.id, data.updates)
    return { success: true }
  })

export const adminUpdateSalesOpportunityStage = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string; stage: SalesOpportunityStage; lostReason?: string | null }) => d)
  .handler(async ({ data }) => {
    await db.updateSalesOpportunityStage(data.id, data.stage, { lostReason: data.lostReason })
    return { success: true }
  })

export const adminDeleteSalesOpportunity = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    await db.deleteSalesOpportunity(id)
    return { success: true }
  })

export const fetchSalesPipelineStats = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .handler(async () => db.getSalesPipelineStats())

// Follow-up: cria (ou reutiliza, se já houver uma pendente) uma client_task
// ligada à oportunidade — ver requisito "evitar duplicação de tarefas para o
// mesmo follow-up".
export const adminCreateOpportunityFollowUpTask = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { opportunityId: string; title: string; dueDate: string }) => d)
  .handler(async ({ data }) => {
    const opportunity = await db.getSalesOpportunity(data.opportunityId)
    if (!opportunity) throw new Error('Oportunidade não encontrada')
    const { created, task } = await db.ensureFollowUpTaskForOpportunity({
      opportunityId: data.opportunityId,
      title: data.title,
      dueDate: data.dueDate,
      companyId: opportunity.companyId,
      individualClientId: opportunity.individualClientId,
    })
    return { success: true, created, task }
  })

// Contexto seguro do website_lead associado a uma oportunidade — reutiliza
// getWebsiteLeadsByIndividualClientId (nada de novo em website_leads) e só
// devolve os campos permitidos em pickWebsiteLeadContextFields (form_name,
// source_url, utm_*, received_at) — nunca `metadata`, nunca o objeto
// completo. Ver requisito "website lead context".
export const fetchWebsiteLeadContextForOpportunity = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { individualClientId: string; websiteLeadId: string }) => d)
  .handler(async ({ data }) => {
    const leads = await db.getWebsiteLeadsByIndividualClientId(data.individualClientId)
    const lead = leads.find((l) => l.id === data.websiteLeadId)
    return lead ? pickWebsiteLeadContextFields(lead) : undefined
  })

export const adminGenerateRenewalTasks = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .handler(async () => {
    const result = await db.generateRenewalTasks()
    return { success: true, ...result }
  })

// Invoca /api/send-renewal-alerts de forma autenticada — o ADMIN_SECRET fica server-side
// e nunca entra no bundle do browser. O browser chama apenas esta server fn.
export const adminTriggerRenewalAlerts = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .handler(async (): Promise<{ sent: number; companies: number }> => {
    const baseUrl = process.env.URL ?? 'http://localhost:8888'
    const secret = process.env.ADMIN_SECRET
    if (!secret) throw new Error('ADMIN_SECRET não configurado no servidor')
    const res = await fetch(`${baseUrl}/api/send-renewal-alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? `Erro ao enviar alertas (HTTP ${res.status})`)
    return json as { sent: number; companies: number }
  })

export const adminActivateAdlerOne = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { clientId: string; email: string; fullName: string }) => d)
  .handler(async ({ data }) => {
    const { data: inviteData, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
      data: { full_name: data.fullName },
    })
    if (error) throw new Error(error.message)
    const userId = inviteData.user.id
    await supabaseAdmin
      .from('individual_clients')
      .update({ auth_user_id: userId })
      .eq('id', data.clientId)
    return { success: true, userId }
  })

export const adminPromoteToCompany = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { clientId: string }) => d)
  .handler(async ({ data }) => {
    // The ENTIRE promotion — resolving or creating the destination company,
    // re-parenting every child record (policies, claims, documents,
    // client_notes, client_tasks, sales_opportunities, website_leads), and
    // deleting the individual_clients row — happens inside a single atomic
    // RPC call/transaction. See migrations/20260830_fix_promote_client_to_company.sql.
    //
    // Deliberately no separate reads/inserts/updates here: an earlier
    // version of this fix resolved-or-created the company in TypeScript
    // before calling the (then relation-move-only) RPC, which meant a
    // failure inside the RPC could leave a newly created company behind
    // with nothing re-parented into it. This is the single mutation for
    // the whole operation.
    const result = await db.promoteIndividualClientToCompany(data.clientId)
    console.log('promoted individual_client to company:', data.clientId, '->', result.companyId, result)

    return {
      success: true,
      companyId: result.companyId,
      alreadyExisted: result.alreadyExisted,
      relationsMoved: {
        policies: result.policies,
        claims: result.claims,
        documents: result.documents,
        clientNotes: result.clientNotes,
        clientTasks: result.clientTasks,
        salesOpportunities: result.salesOpportunities,
        websiteLeads: result.websiteLeads,
      },
    }
  })

export const adminUpdateApiConnection = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string; updates: any }) => d)
  .handler(async ({ data }) => {
    await db.updateApiConnection(data.id, {
      ...data.updates,
      lastSync: data.updates?.lastSync ?? new Date().toISOString(),
    })
    return { success: true }
  })

export const createPolicy = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator(
    (d: {
      companyId?: string
      type: string
      insurer: string
      policyNumber: string
      description: string
      startDate: string
      endDate: string
      annualPremium: number
      insuredValue: number
      deductible?: number
      coverages?: string[]
      exclusions?: string[]
    }) => d
  )
  .handler(async ({ data }) => {
    const scope = await getViewerScope()
    const companyId = scope.companyId ?? (scope.isAdmin ? data.companyId : undefined)
    const individualClientId = scope.individualClientId ?? undefined
    if (!scope.isAdmin && !companyId && !individualClientId) {
      throw new Error('Cliente não associado ao utilizador')
    }

    const id = `pol_${Date.now()}`
    await db.createPolicy({
      id,
      ...data,
      companyId: companyId ?? '',
      individualClientId,
      type: data.type as any,
      status: 'active',
      createdAt: new Date().toISOString(),
    })
    return { id }
  })

export const updatePolicy = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator(
    (d: {
      id: string
      updates: any
    }) => d
  )
  .handler(async ({ data }) => {
    const policy = await fetchAccessiblePolicy(data.id)
    if (!policy) throw new Error('Sem acesso a esta apólice')
    await db.updatePolicy(data.id, data.updates)
    return { success: true }
  })

export const deletePolicy = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const policy = await fetchAccessiblePolicy(id)
    if (!policy) throw new Error('Sem acesso a esta apólice')
    const managedDocuments = await netlifyDb
      .select()
      .from(policyDocuments)
      .where(eq(policyDocuments.policyId, id))
    const store = getStore({ name: 'policy-documents', consistency: 'strong' })
    await Promise.all(managedDocuments.map((document) => store.delete(document.blobKey)))
    await netlifyDb.delete(policyDocuments).where(eq(policyDocuments.policyId, id))

    const legacyPrefix = `${policy.companyId || 'general'}/policies/${id}`
    const { data: legacyFiles } = await supabaseAdmin.storage
      .from('documents')
      .list(legacyPrefix, { limit: 100 })
    const legacyPaths = (legacyFiles ?? [])
      .filter((file) => file.name !== '.emptyFolderPlaceholder')
      .map((file) => `${legacyPrefix}/${file.name}`)
    if (legacyPaths.length > 0) {
      await supabaseAdmin.storage.from('documents').remove(legacyPaths)
    }

    await Promise.all([
      supabaseAdmin.from('renewal_alerts_state').delete().eq('policy_id', id),
      supabaseAdmin.from('renewal_alerts_history').delete().eq('policy_id', id),
      supabaseAdmin.from('documents').delete().eq('policy_id', id),
    ])
    await db.deletePolicy(id)
    return { success: true }
  })

// =====================================================================
// InvoiceXpress — Billing Module
// =====================================================================

import * as ix from './invoicexpress'

// --- Invoices ---

export const fetchIXInvoices = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async ({ context }) => {
    try {
      const result = await ix.listInvoices(1, 100)
      return { ok: true as const, invoices: result.invoices ?? [] }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

export const createIXInvoice = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { invoice: Partial<ix.IXInvoice> }) => d)
  .handler(async ({ data }) => {
    try {
      const result = await ix.createInvoice(data.invoice)
      return { ok: true as const, invoice: result.invoice }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

export const changeIXInvoiceState = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { id: number; state: ix.IXDocState }) => d)
  .handler(async ({ data }) => {
    try {
      await ix.changeInvoiceState(data.id, data.state)
      return { ok: true as const }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

export const sendIXInvoiceEmail = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { id: number; email: string; subject?: string; body?: string }) => d)
  .handler(async ({ data }) => {
    try {
      await ix.sendInvoiceByEmail(data.id, data.email, data.subject, data.body)
      return { ok: true as const }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

export const getIXInvoicePdf = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    try {
      const result = await ix.getInvoicePdf(data.id)
      return { ok: true as const, ...result }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

// --- Simplified Invoices ---

export const fetchIXSimplifiedInvoices = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    try {
      const result = await ix.listSimplifiedInvoices(1, 100)
      return { ok: true as const, invoices: result.simplified_invoices ?? [] }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

export const createIXSimplifiedInvoice = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { invoice: Partial<ix.IXInvoice> }) => d)
  .handler(async ({ data }) => {
    try {
      const result = await ix.createSimplifiedInvoice(data.invoice)
      return { ok: true as const, invoice: result.simplified_invoice }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

// --- Invoice Receipts ---

export const fetchIXInvoiceReceipts = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    try {
      const result = await ix.listInvoiceReceipts(1, 100)
      return { ok: true as const, invoices: result.invoice_receipts ?? [] }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

export const createIXInvoiceReceipt = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { invoice: Partial<ix.IXInvoice> }) => d)
  .handler(async ({ data }) => {
    try {
      const result = await ix.createInvoiceReceipt(data.invoice)
      return { ok: true as const, invoice: result.invoice_receipt }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

// --- Credit Notes ---

export const fetchIXCreditNotes = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    try {
      const result = await ix.listCreditNotes(1, 100)
      return { ok: true as const, notes: result.credit_notes ?? [] }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

export const createIXCreditNote = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { note: Partial<ix.IXCreditNote> }) => d)
  .handler(async ({ data }) => {
    try {
      const result = await ix.createCreditNote(data.note)
      return { ok: true as const, note: result.credit_note }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

export const changeIXCreditNoteState = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { id: number; state: ix.IXDocState }) => d)
  .handler(async ({ data }) => {
    try {
      await ix.changeCreditNoteState(data.id, data.state)
      return { ok: true as const }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

// --- Debit Notes ---

export const fetchIXDebitNotes = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    try {
      const result = await ix.listDebitNotes(1, 100)
      return { ok: true as const, notes: result.debit_notes ?? [] }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

export const createIXDebitNote = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { note: Partial<ix.IXDebitNote> }) => d)
  .handler(async ({ data }) => {
    try {
      const result = await ix.createDebitNote(data.note)
      return { ok: true as const, note: result.debit_note }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

export const changeIXDebitNoteState = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { id: number; state: ix.IXDocState }) => d)
  .handler(async ({ data }) => {
    try {
      await ix.changeDebitNoteState(data.id, data.state)
      return { ok: true as const }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

// --- Receipts ---

export const fetchIXReceipts = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    try {
      const result = await ix.listReceipts(1, 100)
      return { ok: true as const, receipts: result.receipts ?? [] }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

export const createIXReceipt = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { receipt: Partial<ix.IXReceipt> }) => d)
  .handler(async ({ data }) => {
    try {
      const result = await ix.createReceipt(data.receipt)
      return { ok: true as const, receipt: result.receipt }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

export const changeIXReceiptState = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { id: number; state: ix.IXDocState }) => d)
  .handler(async ({ data }) => {
    try {
      await ix.changeReceiptState(data.id, data.state)
      return { ok: true as const }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

// --- Estimates ---

export const fetchIXEstimates = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    try {
      const result = await ix.listEstimates(1, 100)
      return { ok: true as const, estimates: result.estimates ?? [] }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

export const createIXEstimate = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { estimate: Partial<ix.IXEstimate> }) => d)
  .handler(async ({ data }) => {
    try {
      const result = await ix.createEstimate(data.estimate)
      return { ok: true as const, estimate: result.estimate }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

export const changeIXEstimateState = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { id: number; state: 'finalized' | 'deleted' | 'canceled' | 'accepted' | 'refused' }) => d)
  .handler(async ({ data }) => {
    try {
      await ix.changeEstimateState(data.id, data.state)
      return { ok: true as const }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

export const sendIXEstimateEmail = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { id: number; email: string; subject?: string; body?: string }) => d)
  .handler(async ({ data }) => {
    try {
      await ix.sendEstimateByEmail(data.id, data.email, data.subject, data.body)
      return { ok: true as const }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

// --- Guides ---

export const fetchIXGuides = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    try {
      const result = await ix.listGuides(1, 100)
      return { ok: true as const, guides: result.guides ?? [] }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

export const createIXGuide = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { guide: Partial<ix.IXGuide> }) => d)
  .handler(async ({ data }) => {
    try {
      const result = await ix.createGuide(data.guide)
      return { ok: true as const, guide: result.guide }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

// --- Clients ---

export const fetchIXClients = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    try {
      const result = await ix.listClients(1, 100)
      return { ok: true as const, clients: result.clients ?? [] }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

export const createIXClient = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { client: Partial<ix.IXClient> }) => d)
  .handler(async ({ data }) => {
    try {
      const result = await ix.createClient(data.client)
      return { ok: true as const, client: result.client }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

export const updateIXClient = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { id: number; client: Partial<ix.IXClient> }) => d)
  .handler(async ({ data }) => {
    try {
      const result = await ix.updateClient(data.id, data.client)
      return { ok: true as const, client: result.client }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

// --- Items ---

export const fetchIXItems = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    try {
      const result = await ix.listItems(1, 100)
      return { ok: true as const, items: result.items ?? [] }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

export const createIXItem = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { item: Partial<ix.IXItem> }) => d)
  .handler(async ({ data }) => {
    try {
      const result = await ix.createItem(data.item)
      return { ok: true as const, item: result.item }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

export const updateIXItem = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { id: number; item: Partial<ix.IXItem> }) => d)
  .handler(async ({ data }) => {
    try {
      const result = await ix.updateItem(data.id, data.item)
      return { ok: true as const, item: result.item }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

// --- Taxes ---

export const fetchIXTaxes = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    try {
      const result = await ix.listTaxes()
      return { ok: true as const, taxes: result.taxes ?? [] }
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
  })

// ============================================================
// Policy Documents (Supabase Storage)
// ============================================================

async function fetchAccessiblePolicy(policyId: string) {
  const [scope, policy] = await Promise.all([getViewerScope(), db.getPolicy(policyId)])
  if (!policy) return undefined
  if (scope.isAdmin) return policy
  if (scope.companyId && policy.companyId === scope.companyId) return policy
  if (scope.individualClientId && policy.individualClientId === scope.individualClientId) return policy
  return undefined
}

export const fetchPolicyDocuments = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { policyId: string; companyId?: string }) => d)
  .handler(async ({ data }) => {
    const policy = await fetchAccessiblePolicy(data.policyId)
    if (!policy) throw new Error('Sem acesso a esta apólice')
    const companyId = policy.companyId || data.companyId || 'general'
    const prefix = `${companyId}/policies/${data.policyId}`
    const [{ data: files, error }, netlifyFiles] = await Promise.all([
      supabaseAdmin.storage
        .from('documents')
        .list(prefix, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } }),
      netlifyDb
        .select()
        .from(policyDocuments)
        .where(eq(policyDocuments.policyId, data.policyId)),
    ])
    if (error) console.error('fetchPolicyDocuments legacy storage:', error.message)
    const legacyDocuments = (files ?? [])
      .filter((f) => f.name !== '.emptyFolderPlaceholder')
      .map((f) => ({
        id: f.id ?? f.name,
        name: f.name,
        storagePath: `${prefix}/${f.name}`,
        size: (f.metadata as any)?.size ?? 0,
        mimeType: (f.metadata as any)?.mimetype ?? '',
        uploadedAt: f.created_at ?? '',
      }))
    const managedDocuments = netlifyFiles.map((file) => ({
      id: file.id,
      name: file.fileName,
      storagePath: `netlify:${file.id}`,
      size: file.size,
      mimeType: file.contentType,
      uploadedAt: file.createdAt.toISOString(),
    }))
    return [...managedDocuments, ...legacyDocuments]
  })

export const adminDeletePolicyDocument = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: { storagePath: string }) => d)
  .handler(async ({ data }) => {
    if (data.storagePath.startsWith('netlify:')) {
      const documentId = data.storagePath.slice('netlify:'.length)
      const [document] = await netlifyDb
        .select()
        .from(policyDocuments)
        .where(eq(policyDocuments.id, documentId))
        .limit(1)
      if (!document || !(await fetchAccessiblePolicy(document.policyId))) {
        throw new Error('Sem acesso a este documento')
      }
      await getStore({ name: 'policy-documents', consistency: 'strong' }).delete(document.blobKey)
      await netlifyDb.delete(policyDocuments).where(eq(policyDocuments.id, documentId))
      return { success: true }
    }

    const policyId = data.storagePath.split('/policies/')[1]?.split('/')[0]
    if (!policyId || !(await fetchAccessiblePolicy(policyId))) {
      throw new Error('Sem acesso a este documento')
    }
    const { error } = await supabaseAdmin.storage
      .from('documents')
      .remove([data.storagePath])
    if (error) throw new Error(error.message)
    await supabaseAdmin.from('documents').delete().eq('storage_path', data.storagePath)
    return { success: true }
  })

/**
 * Cria acesso ao portal "Os Meus Seguros" para um cliente individual com
 * password gerada pelo sistema. Não envia email de convite.
 *
 * A password é devolvida UMA ÚNICA VEZ no retorno e nunca é persistida.
 * Garante ligação atómica: auth_user_id é gravado imediatamente após criar
 * o utilizador no Auth, com rollback explícito em caso de falha.
 */
export const adminGrantIndividualClientAccess = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { clientId: string }) => d)
  .handler(async ({ data }): Promise<{ success: true; password: string }> => {
    // a) Validar cliente
    const { data: client, error: clientErr } = await supabaseAdmin
      .from('individual_clients')
      .select('id, email, full_name, auth_user_id')
      .eq('id', data.clientId)
      .single()

    if (clientErr || !client) {
      throw new Error('Cliente não encontrado.')
    }
    if (!client.email) {
      throw new Error('O cliente não tem email registado. Edite o cliente e adicione um email primeiro.')
    }
    if (client.auth_user_id) {
      throw new Error('Este cliente já tem acesso ao portal Os Meus Seguros. Para repor o acesso, utilize a função de reset de password.')
    }

    const email     = (client.email as string).toLowerCase()
    const fullName  = client.full_name as string | undefined

    // b) Verificar se o email já existe no Auth (ex: convite órfão de tentativa anterior)
    const { data: usersData, error: listErr } = await supabaseAdmin.auth.admin.listUsers()
    if (listErr) {
      throw new Error(`Falha ao verificar utilizadores no Auth: ${listErr.message}`)
    }
    const existingAuthUser = usersData.users.find((u) => u.email?.toLowerCase() === email)

    // c) Gerar password forte (~92 bits de entropia, charset legível sem O/I/l/0/1)
    const password = generateStrongPassword()

    let userId: string
    let userWasCreatedByUs = false

    if (existingAuthUser) {
      // d-edge) Email já existe no Auth (orphaned de tentativa anterior):
      //   reutilizar o user existente, actualizar a password. NÃO criar duplicado.
      userId = existingAuthUser.id
      const { error: updatePwErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password,
        app_metadata: { must_change_password: true },
      })
      if (updatePwErr) {
        throw new Error(`Falha ao actualizar password do utilizador existente no Auth: ${updatePwErr.message}`)
      }
    } else {
      // d-normal) Criar novo utilizador no Auth, sem metadata de empresa
      const created = await createIndividualIdentityUser(email, password, fullName)
      userId            = created.userId
      userWasCreatedByUs = true
    }

    // e) LIGAÇÃO ATÓMICA — verificar o erro (ao contrário do fluxo de convite antigo)
    const { error: linkErr } = await supabaseAdmin
      .from('individual_clients')
      .update({ auth_user_id: userId })
      .eq('id', data.clientId)

    if (linkErr) {
      if (userWasCreatedByUs) {
        // Rollback: apagar o user que criámos para não deixar órfão
        const { error: rollbackErr } = await supabaseAdmin.auth.admin.deleteUser(userId)
        if (rollbackErr) {
          throw new Error(
            `Falha crítica: utilizador criado no Auth (${userId}) mas não foi possível ligar ao cliente nem fazer rollback. Eliminar manualmente em Auth > Users.`,
          )
        }
      }
      throw new Error(`Falha ao ligar o acesso ao cliente: ${linkErr.message}`)
    }

    // f) Devolver password — apenas nesta resposta, nunca persistida
    return { success: true, password }
  })

export const adminResetIndividualClientPassword = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { clientId: string }) => d)
  .handler(async ({ data }): Promise<{ success: true; password: string }> => {
    // a) Validar cliente e confirmar que já tem acesso
    const { data: client, error: clientErr } = await supabaseAdmin
      .from('individual_clients')
      .select('id, auth_user_id')
      .eq('id', data.clientId)
      .single()

    if (clientErr || !client) {
      throw new Error('Cliente não encontrado.')
    }
    if (!client.auth_user_id) {
      throw new Error('Este cliente ainda não tem acesso ao portal.')
    }

    // b) Gerar nova password
    const password = generateStrongPassword()

    // c) Actualizar password directamente pelo UUID — seguro, não cria user novo
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
      client.auth_user_id as string,
      { password, app_metadata: { must_change_password: true } },
    )
    if (updateErr) {
      if (updateErr.message.toLowerCase().includes('not found') || updateErr.status === 404) {
        throw new Error(
          'Falha ao repor password: utilizador não encontrado no sistema de autenticação. Contacte suporte técnico para religar o acesso.',
        )
      }
      throw new Error(`Falha ao repor password: ${updateErr.message}`)
    }

    // d) Devolver password — apenas nesta resposta, nunca persistida
    return { success: true, password }
  })

export const adminRevokeIndividualClientAccess = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { clientId: string }) => d)
  .handler(async ({ data }): Promise<{ success: true }> => {
    // a) Validar cliente e confirmar que tem acesso activo
    const { data: client, error: clientErr } = await supabaseAdmin
      .from('individual_clients')
      .select('id, auth_user_id, full_name')
      .eq('id', data.clientId)
      .single()

    if (clientErr || !client) {
      throw new Error('Cliente não encontrado.')
    }
    if (!client.auth_user_id) {
      throw new Error('Este cliente não tem acesso para revogar.')
    }

    // b) ORDEM SEGURA: apagar o login PRIMEIRO.
    //    deleteIdentityUserById trata 404 como no-op — UUID órfão não bloqueia a limpeza do crachá.
    await deleteIdentityUserById(client.auth_user_id as string)

    // c) Limpar o crachá na DB (login já inexistente — badge inconsistente é preferível a login activo sem crachá)
    const { error: updateErr } = await supabaseAdmin
      .from('individual_clients')
      .update({ auth_user_id: null })
      .eq('id', data.clientId)

    if (updateErr) {
      throw new Error(`Falha ao limpar o acesso do cliente: ${updateErr.message}`)
    }

    return { success: true }
  })

export const clientClearMustChangePassword = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .handler(async (): Promise<{ success: true }> => {
    // Padrão do codebase: extrair token + getUser para obter o UUID do caller sem
    // depender do typing do context do TanStack Start (nenhum handler existente usa context).
    const token = extractAccessToken()
    if (!token) throw new Error('Authentication required')
    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token)
    if (userErr || !user) throw new Error('Authentication required')

    const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      app_metadata: { must_change_password: false },
    })
    if (error) throw new Error('Falha ao actualizar estado da conta.')
    return { success: true }
  })

export const getAdminNavBadgeCounts = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .handler(async (): Promise<{ tasksCount: number; alertsCount: number }> => {
    const scope = await getViewerScope()
    const adminUserId = scope.user.id

    const { data: navView } = await supabaseAdmin
      .from('admin_nav_views')
      .select('tasks_seen_at, alerts_seen_at')
      .eq('admin_user_id', adminUserId)
      .maybeSingle()

    const tasksSeen = navView?.tasks_seen_at ?? new Date(0).toISOString()
    const alertsSeen = navView?.alerts_seen_at ?? new Date(0).toISOString()

    const { count: tasksCount, error: tasksErr } = await supabaseAdmin
      .from('client_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .gt('created_at', tasksSeen)

    if (tasksErr) console.error('getAdminNavBadgeCounts tasks:', tasksErr.message)

    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const in60Days = new Date(today)
    in60Days.setUTCDate(in60Days.getUTCDate() + 60)
    const todayStr = today.toISOString().slice(0, 10)
    const in60DaysStr = in60Days.toISOString().slice(0, 10)

    // "entrou na janela após última visita" ↔ end_date > alerts_seen_at + 60 dias
    const alertsSeenDate = new Date(alertsSeen)
    alertsSeenDate.setUTCDate(alertsSeenDate.getUTCDate() + 60)
    const alertsSeenPlus60Str = alertsSeenDate.toISOString().slice(0, 10)

    const { count: alertsCount, error: alertsErr } = await supabaseAdmin
      .from('policies')
      .select('id', { count: 'exact', head: true })
      .in('status', ['active', 'expiring'])
      .not('end_date', 'is', null)
      .gte('end_date', todayStr)
      .lte('end_date', in60DaysStr)
      .gt('end_date', alertsSeenPlus60Str)

    if (alertsErr) console.error('getAdminNavBadgeCounts alerts:', alertsErr.message)

    return {
      tasksCount: tasksCount ?? 0,
      alertsCount: alertsCount ?? 0,
    }
  })

export const markAdminNavSeen = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { tab: 'tasks' | 'alerts' }) => d)
  .handler(async ({ data }): Promise<{ success: true }> => {
    const scope = await getViewerScope()
    const adminUserId = scope.user.id
    const now = new Date().toISOString()

    const row = data.tab === 'tasks'
      ? { admin_user_id: adminUserId, tasks_seen_at: now, updated_at: now }
      : { admin_user_id: adminUserId, alerts_seen_at: now, updated_at: now }

    const { error } = await supabaseAdmin
      .from('admin_nav_views')
      .upsert(row, { onConflict: 'admin_user_id' })

    if (error) throw new Error(`markAdminNavSeen: ${error.message}`)
    return { success: true }
  })

// ── Marketing ──────────────────────────────────────────────────────────────

const VALID_TEMPLATE_KEYS = ['feedback', 'renewal', 'presentation', 'seasonal'] as const
const VALID_AUDIENCES = ['companies', 'company_users', 'individual_clients', 'all'] as const
type MarketingTemplateKey = (typeof VALID_TEMPLATE_KEYS)[number]
type MarketingAudience = (typeof VALID_AUDIENCES)[number]

export const previewMarketingAudience = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { audience: MarketingAudience; singleRecipientEmail?: string }) => d)
  .handler(async ({ data }): Promise<{ totalRaw: number; afterOptOut: number; afterDedup: number; sample: string[] }> => {
    if (data.singleRecipientEmail) {
      const email = data.singleRecipientEmail.trim().toLowerCase()
      const { data: row } = await supabaseAdmin
        .from('individual_clients')
        .select('full_name, email, marketing_opt_out')
        .eq('email', email)
        .maybeSingle()
      if (!row) return { totalRaw: 0, afterOptOut: 0, afterDedup: 0, sample: [] }
      const ic = row as { full_name: string | null; email: string; marketing_opt_out: boolean }
      if (ic.marketing_opt_out) return { totalRaw: 1, afterOptOut: 0, afterDedup: 0, sample: [] }
      const display = ic.full_name ? `${ic.full_name} <${ic.email}>` : ic.email
      return { totalRaw: 1, afterOptOut: 1, afterDedup: 1, sample: [display] }
    }
    const resolved = await db.resolveMarketingRecipients(data.audience)
    return {
      totalRaw: resolved.totalRaw,
      afterOptOut: resolved.afterOptOut,
      afterDedup: resolved.afterDedup,
      sample: resolved.recipients.slice(0, 5).map((r) => r.email),
    }
  })

export const createMarketingCampaign = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: {
    title: string
    subject: string
    templateKey: MarketingTemplateKey
    audience: MarketingAudience
    templateVars?: Record<string, unknown>
    singleRecipientEmail?: string
  }) => d)
  .handler(async ({ data }): Promise<{ campaignId: string }> => {
    if (!data.title.trim()) throw new Error('Título obrigatório')
    if (!data.subject.trim()) throw new Error('Assunto obrigatório')
    if (!(VALID_TEMPLATE_KEYS as readonly string[]).includes(data.templateKey)) throw new Error('Template inválido')
    if (!(VALID_AUDIENCES as readonly string[]).includes(data.audience)) throw new Error('Audiência inválida')

    let singleRecipientEmail: string | null = null
    if (data.singleRecipientEmail) {
      const emailLower = data.singleRecipientEmail.trim().toLowerCase()
      if (!emailLower.includes('@')) throw new Error('Email de destinatário único inválido')
      const { data: ic } = await supabaseAdmin
        .from('individual_clients')
        .select('email')
        .eq('email', emailLower)
        .maybeSingle()
      if (!ic) throw new Error(`Cliente com email ${emailLower} não encontrado`)
      singleRecipientEmail = emailLower
    }

    const scope = await getViewerScope()

    const { data: row, error } = await supabaseAdmin
      .from('marketing_campaigns')
      .insert({
        title: data.title.trim(),
        subject: data.subject.trim(),
        template_key: data.templateKey,
        audience: singleRecipientEmail ? 'individual_clients' : data.audience,
        template_vars: data.templateVars ?? null,
        single_recipient_email: singleRecipientEmail,
        status: 'draft',
        created_by: scope.user.id,
      })
      .select('id')
      .single()

    if (error) throw new Error(`createMarketingCampaign: ${error.message}`)
    return { campaignId: row.id as string }
  })

export const fetchMarketingCampaigns = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from('marketing_campaigns')
      .select('id, title, subject, template_key, audience, status, created_at, sent_at, total_recipients, total_sent, total_errors')
      .order('created_at', { ascending: false })

    if (error) throw new Error(`fetchMarketingCampaigns: ${error.message}`)
    return (data ?? []) as Array<{
      id: string
      title: string
      subject: string
      template_key: string
      audience: string
      status: string
      created_at: string
      sent_at: string | null
      total_recipients: number | null
      total_sent: number | null
      total_errors: number | null
    }>
  })

export const fetchMarketingSends = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { campaignId: string }) => d)
  .handler(async ({ data }) => {
    const { data: rows, error } = await supabaseAdmin
      .from('marketing_sends')
      .select('recipient_email, recipient_name, recipient_type, status, error_message, sent_at')
      .eq('campaign_id', data.campaignId)
      .order('recipient_email', { ascending: true })

    if (error) throw new Error(`fetchMarketingSends: ${error.message}`)
    return (rows ?? []) as Array<{
      recipient_email: string
      recipient_name: string | null
      recipient_type: string | null
      status: string
      error_message: string | null
      sent_at: string | null
    }>
  })

export const searchIndividualClients = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { query: string }) => d)
  .handler(async ({ data }): Promise<Array<{ id: string; fullName: string; email: string }>> => {
    if (!data.query || data.query.trim().length < 2) return []
    const q = `%${data.query.trim()}%`
    const { data: rows, error } = await supabaseAdmin
      .from('individual_clients')
      .select('id, full_name, email')
      .or(`full_name.ilike.${q},email.ilike.${q}`)
      .not('email', 'is', null)
      .order('full_name', { ascending: true })
      .limit(8)
    if (error) throw new Error(`searchIndividualClients: ${error.message}`)
    return (rows ?? []).map((r) => ({
      id: r.id as string,
      fullName: (r.full_name as string | null) ?? '',
      email: r.email as string,
    }))
  })

// Invoca a Netlify function marketing-send de forma autenticada — o secret fica server-side
// e nunca entra no bundle do browser. O frontend (slice 5) chama apenas esta server fn.
export const adminTriggerMarketingSend = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { campaignId: string }) => d)
  .handler(async ({ data }): Promise<{ totalRecipients: number; sent: number; errors: number }> => {
    // process.env.URL é definido pelo Netlify (prod e netlify dev); fallback para porto local
    const baseUrl = process.env.URL ?? 'http://localhost:8888'
    const secret = process.env.ADMIN_SECRET
    if (!secret) throw new Error('ADMIN_SECRET não configurado no servidor')

    const res = await fetch(`${baseUrl}/api/marketing-send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ campaignId: data.campaignId }),
    })

    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? `Erro ao enviar campanha (HTTP ${res.status})`)
    return json as { totalRecipients: number; sent: number; errors: number }
  })

// ─── Envio transacional de documento de apólice ───────────────────────────────

const FROM_TRANSACTIONAL = 'Adler & Rochefort <insurance@adlerrochefort.com>'
const REPLY_TO_TRANSACTIONAL = 'insurance@adlerrochefort.com'
const BCC_ARCHIVE = 'insurance@adlerrochefort.com'

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

export const adminSendPolicyDocument = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: {
    policyId: string
    storagePath: string
    filename: string
    recipients: string[]
    message: string
  }) => d)
  .handler(async ({ data }) => {
    if (!data.recipients.length) throw new Error('Pelo menos um destinatário é obrigatório')
    const invalid = data.recipients.filter((e) => !e.includes('@'))
    if (invalid.length) throw new Error(`Email(s) inválido(s): ${invalid.join(', ')}`)

    const policy = await db.getPolicy(data.policyId)
    if (!policy) throw new Error('Apólice não encontrada')

    let clientName = ''
    if (policy.individualClientId) {
      const client = await db.getIndividualClient(policy.individualClientId)
      clientName = client?.fullName ?? ''
    } else if (policy.companyId) {
      const company = await db.getCompany(policy.companyId)
      clientName = company?.contactName || company?.name || ''
    }

    const { data: blob, error: storageErr } = await supabaseAdmin.storage
      .from('documents')
      .download(data.storagePath)
    if (storageErr || !blob) {
      throw new Error(`Erro ao aceder ao documento: ${storageErr?.message ?? 'ficheiro não encontrado'}`)
    }

    const buffer = Buffer.from(await blob.arrayBuffer())
    const ext = data.filename.split('.').pop()?.toLowerCase() ?? ''
    const mimeType = MIME_BY_EXT[ext] ?? 'application/octet-stream'

    const html = await render(
      createElement(DocumentEmail, {
        clientName,
        policyNumber: policy.policyNumber,
        insurer: policy.insurer,
        filename: data.filename,
        message: data.message,
      }),
    )

    const { data: sent, error: sendErr } = await resendClient.emails.send({
      from: FROM_TRANSACTIONAL,
      replyTo: REPLY_TO_TRANSACTIONAL,
      to: data.recipients,
      bcc: BCC_ARCHIVE,
      subject: `Documento: ${data.filename} — Apólice ${policy.policyNumber}`,
      html,
      attachments: [{ filename: data.filename, content: buffer, contentType: mimeType }],
    })

    if (sendErr) throw new Error(`Falha no envio: ${sendErr.message}`)

    return { ok: true as const, sent: data.recipients.length, emailId: sent?.id }
  })

// ============================================================
// CRM3 — Identity & Reconciliation (Block 2)
//
// Todas admin-only (requireAuthMiddleware + requireRoleMiddleware('admin')),
// nenhuma escrita fora de carrier_import_records/external_*_identities.
// Nenhuma cria/atualiza/apaga um individual_client/company/policy, nenhuma
// faz merge, nenhuma sincroniza campos de seguradora, nenhuma aceita
// automaticamente um match probable/ambiguous — ver requisito explícito da
// Block 2. Nenhuma chama uma API de seguradora nem lida com credenciais.
// ============================================================

export const adminListCarrierSyncRuns = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: db.CarrierSyncRunFilters = {}) => d)
  .handler(async ({ data }) => db.listCarrierSyncRuns(data))

export const adminGetCarrierSyncRun = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((runId: string) => runId)
  .handler(async ({ data: runId }) => db.getCarrierSyncRun(runId))

export const adminListCarrierImportRecords = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { runId: string } & db.CarrierImportRecordFilters) => d)
  .handler(async ({ data }) => {
    const { runId, ...filters } = data
    return db.listCarrierImportRecords(runId, filters)
  })

export const adminGetCarrierImportRecord = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((recordId: string) => recordId)
  .handler(async ({ data: recordId }) => db.getCarrierImportRecord(recordId))

// Resolves matched_individual_client_id/matched_company_id/matched_policy_id
// into review-safe summaries server-side — the route must never query
// Supabase directly from the browser (see db.getCarrierImportRecordReview
// for exactly which fields are exposed).
export const adminGetCarrierImportRecordReview = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((recordId: string) => recordId)
  .handler(async ({ data: recordId }) => db.getCarrierImportRecordReview(recordId))

// ── Link external identities — a separate, deliberate Admin action; never
// triggered automatically by Accept (see adminAcceptCarrierImportDecision
// below and the "Do NOT automatically link when Accept is clicked" requirement) ──

export const adminLinkCarrierClientIdentity = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: {
    individualClientId?: string
    companyId?: string
    provider: string
    externalClientId: string
    externalClientNumber?: string
    taxCountry?: string
    taxIdType?: string
    taxIdRaw?: string
    taxIdNormalized?: string
    metadata?: Record<string, Json>
  }) => d)
  .handler(async ({ data }) => db.createExternalClientIdentity(data))

// externalPolicyNumberNormalized is deliberately NOT accepted here — the
// browser/caller must never be trusted to supply it; db.createExternalPolicyIdentity
// derives it itself, server-side, via normalizePolicyNumber.
export const adminLinkCarrierPolicyIdentity = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: {
    policyId: string
    provider: string
    externalPolicyNumber: string
    externalPolicyId?: string
    metadata?: Record<string, Json>
  }) => d)
  .handler(async ({ data }) => db.createExternalPolicyIdentity(data))

// ── Import decisions — only ever update the staging record itself ──

export const adminAcceptCarrierImportDecision = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { recordId: string; decisionNote?: string }) => d)
  .handler(async ({ data }) => {
    await db.updateCarrierImportDecision(data.recordId, { decisionStatus: 'accepted', decisionNote: data.decisionNote })
    return { success: true }
  })

export const adminRejectCarrierImportDecision = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { recordId: string; decisionNote?: string }) => d)
  .handler(async ({ data }) => {
    await db.updateCarrierImportDecision(data.recordId, { decisionStatus: 'rejected', decisionNote: data.decisionNote })
    return { success: true }
  })

export const adminIgnoreCarrierImportDecision = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { recordId: string; decisionNote?: string }) => d)
  .handler(async ({ data }) => {
    await db.updateCarrierImportDecision(data.recordId, { decisionStatus: 'ignored', decisionNote: data.decisionNote })
    return { success: true }
  })

// ============================================================
// CRM3 Block 3 — Manual Portfolio Import
//
// Admin-only, no exceptions. Parses and matches entirely server-side —
// the service-role key never reaches the browser, and the browser never
// sees anything beyond this function's typed JSON result. Provider is
// validated against the allowlist here, server-side, BEFORE any parsing —
// the browser's provider value is never trusted blindly. Never writes to
// individual_clients/companies/policies; only ever creates a
// carrier_sync_runs row (mode='dry_run') and carrier_import_records rows.
// ============================================================

export const adminPreviewPortfolioImport = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { provider: string; filename: string; fileBase64: string }) => d)
  .handler(async ({ data }) => {
    if (!isValidCarrierProvider(data.provider)) {
      return { status: 'invalid_provider' as const }
    }
    const provider = data.provider

    let buffer: Buffer
    try {
      buffer = Buffer.from(data.fileBase64, 'base64')
    } catch {
      return { status: 'file_error' as const, error: 'Could not decode the uploaded file' }
    }

    const parsed = await parsePortfolioWorkbook(buffer, data.filename)
    if (!parsed.ok) {
      return { status: 'file_error' as const, error: parsed.error }
    }

    const mapped = mapPortfolioRows(provider, parsed.rows)
    if (!mapped.recognized) {
      return { status: 'unrecognized_format' as const, error: mapped.error ?? `File format not yet recognised for ${provider}` }
    }
    if (mapped.rows.length === 0) {
      return { status: 'unrecognized_format' as const, error: 'Workbook has no recognizable rows' }
    }

    const importFingerprint = computeImportFingerprint(provider, mapped.rows)

    const runResult = await db.createCarrierSyncRunForImport({
      provider,
      importFingerprint,
      recordsReceived: mapped.rows.length,
    })
    if (runResult.status === 'duplicate') {
      return { status: 'duplicate' as const, runId: runResult.run.id }
    }

    const runId = runResult.run.id
    try {
      const [{ individualClients, companies }, policies, externalClientIdentities, externalPolicyIdentities] =
        await Promise.all([
          db.listCandidateClients(),
          db.listCandidatePolicies(),
          db.listExternalClientIdentities(),
          db.listExternalPolicyIdentities(),
        ])

      const matches = matchPortfolioRows(provider, mapped.rows, {
        individualClients: individualClients.map((c) => ({ id: c.id, fullName: c.fullName, nif: c.nif, email: c.email, phone: c.phone, address: c.address })),
        companies: companies.map((c) => ({ id: c.id, name: c.name, nif: c.nif, contactEmail: c.contactEmail, contactPhone: c.contactPhone, address: c.address })),
        policies: policies.map((p) => ({ id: p.id, insurer: p.insurer, policyNumber: p.policyNumber, companyId: p.companyId, individualClientId: p.individualClientId, startDate: p.startDate, endDate: p.endDate, annualPremium: p.annualPremium })),
        externalClientIdentities: externalClientIdentities.map((i) => ({ provider: i.provider, externalClientId: i.externalClientId, individualClientId: i.individualClientId, companyId: i.companyId })),
        externalPolicyIdentities: externalPolicyIdentities.map((i) => ({ provider: i.provider, externalPolicyId: i.externalPolicyId, policyId: i.policyId })),
      })

      await db.stageCarrierImportRecords(runId, provider, matches)

      const counts = { exact: 0, review: 0, new: 0, error: 0 }
      for (const match of matches) counts[classifyStagedRowForCounts(match)]++
      await db.finalizeCarrierSyncRunCounts(runId, {
        recordsExactMatch: counts.exact,
        recordsReview: counts.review,
        recordsNew: counts.new,
        recordsError: counts.error,
      })

      return { status: 'created' as const, runId, counts }
    } catch (err) {
      // Never leave a run stuck in 'processing' with nothing staged —
      // clean it up so it isn't mistaken for a real pending import.
      await db.deleteCarrierSyncRun(runId).catch(() => {})
      throw err
    }
  })

// "Cancel import" (wrong insurer selected, etc.) — deletes the staging
// run entirely; carrier_import_records cascade automatically. Never
// touches individual_clients/companies/policies. Provider is immutable by
// design: there is no update-provider code path anywhere — the only way
// to "change" it is to delete this run and upload again.
export const adminCancelCarrierSyncRun = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((runId: string) => runId)
  .handler(async ({ data: runId }) => {
    await db.deleteCarrierSyncRun(runId)
    return { success: true }
  })

// ============================================================
// CRM3 Block 4 — Confirm & Apply Portfolio Import
//
// "Accepted" never implies an apply action — see the "CRITICAL
// principle" in migrations/20260831_crm3_apply_portfolio_import.sql.
// adminSetCarrierImportRecordApplyActions is a deliberate, separate
// step an Admin takes per accepted record (never triggered by Accept
// itself); adminApplyCarrierSyncRun then evaluates every accepted
// record's resolved actions and applies them one row at a time via
// db.applyCarrierImportRecord (each one its own atomic RPC
// transaction — see apply_carrier_import_record).
// ============================================================

function recordToApplyActionRowState(record: CarrierImportRecord): ApplyActionRowState {
  return {
    decisionStatus: record.decisionStatus,
    customerApplyAction: (record.customerApplyAction as CustomerApplyAction | undefined) ?? null,
    policyApplyAction: (record.policyApplyAction as PolicyApplyAction | undefined) ?? null,
    selectedIndividualClientId: record.selectedIndividualClientId ?? null,
    selectedCompanyId: record.selectedCompanyId ?? null,
    selectedPolicyId: record.selectedPolicyId ?? null,
    approvedPolicyChanges: (record.approvedPolicyChanges as Record<string, unknown> | undefined) ?? null,
  }
}

export const adminSetCarrierImportRecordApplyActions = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: {
    recordId: string
    customerApplyAction: string
    policyApplyAction: string
    selectedIndividualClientId?: string
    selectedCompanyId?: string
    selectedPolicyId?: string
    approvedPolicyChanges?: Record<string, Json>
  }) => d)
  .handler(async ({ data }) => {
    // db.setCarrierImportRecordApplyActions validates the action enum
    // values itself (isValidCustomerApplyAction/isValidPolicyApplyAction)
    // and throws on anything else — the browser-supplied strings are
    // never trusted blindly.
    await db.setCarrierImportRecordApplyActions(data.recordId, {
      customerApplyAction: data.customerApplyAction as CustomerApplyAction,
      policyApplyAction: data.policyApplyAction as PolicyApplyAction,
      selectedIndividualClientId: data.selectedIndividualClientId,
      selectedCompanyId: data.selectedCompanyId,
      selectedPolicyId: data.selectedPolicyId,
      approvedPolicyChanges: data.approvedPolicyChanges,
    })
    return { success: true }
  })

export interface AdminApplyCarrierSyncRunResult {
  accepted: number
  applied: number
  alreadyApplied: number
  skipped: number
  failed: number
  createdIndividuals: number
  createdCompanies: number
  createdPolicies: number
  linkedCustomers: number
  linkedPolicies: number
  updatedPolicies: number
  runApplyStatus: CarrierRunApplyStatus
  results: Array<{ recordId: string; status: string; error?: string }>
}

/**
 * The only way any carrier_import_record ever mutates the CRM.
 * Admin-only (requireRoleMiddleware('admin')). Loads the run, refuses a
 * deleted/nonexistent run, refuses a run that isn't a dry-run
 * reconciliation run, refuses re-applying an already-applied or
 * currently-applying run, and — critically — refuses to apply ANYTHING
 * if any accepted record is still missing an explicit apply action
 * (computeRunApplyReadiness is the single source of truth for this,
 * shared with the UI's own readiness summary so the two can never
 * disagree). Accepted records are then applied ONE BY ONE via
 * db.applyCarrierImportRecord — the run itself is not one giant
 * transaction, so one row's failure never blocks the rest (partial
 * failure is a normal, representable outcome: runApplyStatus becomes
 * 'partially_failed', never silently 'applied').
 *
 * Records that were never accepted (rejected/ignored/still pending) are
 * left untouched — "skipped" in the returned summary counts exactly
 * these, matching the per-row "Skipped" result the UI shows for them.
 */
export const adminApplyCarrierSyncRun = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((runId: string) => runId)
  .handler(async ({ data: runId, context }): Promise<AdminApplyCarrierSyncRunResult> => {
    const run = await db.getCarrierSyncRun(runId)
    if (!run) throw new Error('adminApplyCarrierSyncRun: run not found')
    if (run.mode !== 'dry_run') {
      throw new Error('adminApplyCarrierSyncRun: only a manual dry-run reconciliation run can be applied')
    }
    if (run.applyStatus === 'applied') {
      throw new Error('adminApplyCarrierSyncRun: this run has already been fully applied')
    }
    if (run.applyStatus === 'applying') {
      throw new Error('adminApplyCarrierSyncRun: this run is already being applied')
    }

    const records = await db.listCarrierImportRecords(runId)
    const readiness = computeRunApplyReadiness(records.map(recordToApplyActionRowState))
    if (readiness.unresolvedCount > 0) {
      throw new Error(`adminApplyCarrierSyncRun: ${readiness.unresolvedCount} accepted record(s) still need an apply action`)
    }
    const acceptedRecords = records.filter((r) => r.decisionStatus === 'accepted')
    if (acceptedRecords.length === 0) {
      throw new Error('adminApplyCarrierSyncRun: no accepted records to apply')
    }

    await db.updateCarrierSyncRunApplyState(runId, { applyStatus: 'applying', applyStartedAt: new Date().toISOString() })

    let applied = 0
    let alreadyApplied = 0
    let failed = 0
    let createdIndividuals = 0
    let createdCompanies = 0
    let createdPolicies = 0
    let linkedCustomers = 0
    let linkedPolicies = 0
    let updatedPolicies = 0
    const results: Array<{ recordId: string; status: string; error?: string }> = []

    for (const record of acceptedRecords) {
      const result = await db.applyCarrierImportRecord(record.id)
      results.push({ recordId: record.id, status: result.status, error: result.error })

      if (result.status === 'applied') {
        applied++
        if (record.customerApplyAction === 'create_individual') createdIndividuals++
        if (record.customerApplyAction === 'create_company') createdCompanies++
        if (record.customerApplyAction === 'link_existing_individual' || record.customerApplyAction === 'link_existing_company') linkedCustomers++
        if (record.policyApplyAction === 'create_policy') createdPolicies++
        if (record.policyApplyAction === 'link_existing_policy') linkedPolicies++
        if (record.policyApplyAction === 'update_existing_policy') updatedPolicies++
      } else if (result.status === 'already_applied') {
        alreadyApplied++
      } else {
        failed++
      }
    }

    const runApplyStatus: CarrierRunApplyStatus = failed > 0 ? 'partially_failed' : 'applied'
    await db.updateCarrierSyncRunApplyState(runId, {
      applyStatus: runApplyStatus,
      appliedAt: new Date().toISOString(),
      appliedBy: context.user.id,
    })

    return {
      accepted: acceptedRecords.length,
      applied,
      alreadyApplied,
      skipped: records.length - acceptedRecords.length,
      failed,
      createdIndividuals,
      createdCompanies,
      createdPolicies,
      linkedCustomers,
      linkedPolicies,
      updatedPolicies,
      runApplyStatus,
      results,
    }
  })
