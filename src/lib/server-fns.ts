import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader, getCookies } from '@tanstack/react-start/server'
import { supabaseAdmin } from './supabase-admin'
import * as db from './data'
import type {
  DashboardStats,
  AdminFinancialDashboardData,
  RenewalAlertsResponse,
  RenewalAlertItem,
  RenewalAlertHistoryItem,
  RenewalAlertStatus,
} from './types'
import { requireAuthMiddleware, requireRoleMiddleware } from '@/middleware/identity'
import { createIdentityUserWithConfirmation, updateIdentityUserPasswordByEmail, deleteIdentityUserByEmail } from './identity-admin'

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

  const isAdmin = user.roles?.includes('admin')
  if (isAdmin) return { user, isAdmin: true as const, companyId: null as string | null }

  if (!user.email) return { user, isAdmin: false as const, companyId: null as string | null }

  const companyUser = await db.getCompanyUserByEmail(user.email)
  return {
    user,
    isAdmin: false as const,
    companyId: companyUser?.companyId ?? null,
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

// Dashboard — endpoint unificado: retorna stats + alertas + apólices numa só chamada
export const fetchDashboardAll = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    const scope = await getViewerScope()
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
    const companyPolicies = scope.companyId
      ? await db.getPolicies(scope.companyId)
      : scope.isAdmin
        ? await db.getPolicies()
        : []
    const viewerEmail = scope.user.email?.trim().toLowerCase()
    if (!viewerEmail) return companyPolicies

    const companyUser = await db.getCompanyUserByEmail(viewerEmail)
    if (!companyUser) return companyPolicies

    const sharedRelations = await db.getPolicyUsersByUser(companyUser.id)
    if (!sharedRelations.length) return companyPolicies

    const sharedPolicies = await db.getPoliciesByIds(sharedRelations.map((item) => item.policyId))
    const deduped = new Map<string, (typeof companyPolicies)[number]>()
    for (const policy of companyPolicies) deduped.set(policy.id, policy)
    for (const policy of sharedPolicies) deduped.set(policy.id, policy)
    return Array.from(deduped.values())
  })

export const fetchPolicy = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: string) => d)
  .handler(async ({ data: id }) => {
    const scope = await getViewerScope()
    const policy = await db.getPolicy(id)
    if (!policy) return undefined
    if (scope.isAdmin) return policy
    if (scope.companyId && policy.companyId === scope.companyId) return policy

    const viewerEmail = scope.user.email?.trim().toLowerCase()
    const companyUser = viewerEmail ? await db.getCompanyUserByEmail(viewerEmail) : undefined
    if (!companyUser) return undefined
    const sharedRelations = await db.getPolicyUsersByUser(companyUser.id)
    if (sharedRelations.some((item) => item.policyId === id)) return policy
    return undefined
  })

export const fetchClaims = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    const scope = await getViewerScope()
    return db.getClaims(scope.companyId ?? undefined)
  })

export const fetchClaim = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: string) => d)
  .handler(async ({ data: id }) => {
    const scope = await getViewerScope()
    const claim = await db.getClaim(id)
    if (!claim) return undefined
    if (scope.companyId && claim.companyId !== scope.companyId) return undefined
    return claim
  })

export const submitClaim = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator(
    (d: {
      policyId: string
      companyId: string
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

    const id = `clm_${Date.now()}`
    const now = new Date().toISOString()
    await db.createClaim({
      id,
      policyId: data.policyId,
      companyId,
      title: data.title,
      description: data.description,
      claimDate: now.split('T')[0],
      incidentDate: data.incidentDate,
      estimatedValue: data.estimatedValue,
      status: 'submitted',
      steps: [{ status: 'submitted', date: now.split('T')[0], notes: 'Sinistro participado' }],
      createdAt: now,
    })
    return { id }
  })

export const fetchDocuments = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    const scope = await getViewerScope()
    return db.getDocuments(scope.companyId ?? undefined)
  })

export const fetchAlerts = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    const scope = await getViewerScope()
    return db.getAlerts(scope.companyId ?? undefined)
  })

export const clearAlerts = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    const scope = await getViewerScope()
    if (scope.companyId) {
      await db.clearAlertsForCompany(scope.companyId)
    } else {
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
    return db.getCompanies()
  })

export const fetchCompany = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: string) => d)
  .handler(async ({ data: id }) => {
    const scope = await getViewerScope()
    if (scope.companyId && scope.companyId !== id) return undefined
    return db.getCompany(id)
  })

export const fetchRiskReports = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    const scope = await getViewerScope()
    return db.getRiskReports(scope.companyId ?? undefined)
  })

export const fetchCompanyUsers = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    const scope = await getViewerScope()
    return db.getCompanyUsers(scope.companyId ?? undefined)
  })

export const fetchUserMetricEvents = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async () => {
    const scope = await getViewerScope()
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
    const [companies, companyUsers, userEvents, apiConnections, policies, policyUsers, claims, documents, individualClients] = await Promise.all([
      db.getCompanies(),
      db.getCompanyUsers(),
      db.getUserMetricEvents(),
      db.getApiConnections(),
      db.getPolicies(),
      db.getPolicyUsers(),
      db.getClaims(),
      db.getDocuments(),
      db.getIndividualClients(),
    ])

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
      policyUsers,
      claims,
      documents,
      individualClients: filteredIndividualClients,
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

const RENEWAL_ALERT_DAYS = [30, 60, 90] as const
const DEFAULT_RENEWAL_ALERT_STATUS: RenewalAlertStatus = 'pendente'

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
      status === 'pendente' || status === 'tratado' || status === 'em_negociacao' || status === 'renovado'
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
    .select('id, alert_key, policy_id, previous_status, new_status, previous_assigned_to, new_assigned_to, previous_next_action, new_next_action, changed_at')
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
      newStatusCandidate === 'pendente' || newStatusCandidate === 'tratado' || newStatusCandidate === 'em_negociacao' || newStatusCandidate === 'renovado'
        ? newStatusCandidate
        : DEFAULT_RENEWAL_ALERT_STATUS

    const prevStatusCandidate = row.previous_status as RenewalAlertStatus | null
    const previousStatus: RenewalAlertStatus | null =
      prevStatusCandidate === 'pendente' || prevStatusCandidate === 'tratado' || prevStatusCandidate === 'em_negociacao' || prevStatusCandidate === 'renovado'
        ? prevStatusCandidate
        : null

    if (!historyMap[alertKey]) historyMap[alertKey] = []
    historyMap[alertKey].push({
      id: String(row.id),
      alertKey,
      policyId: normalizeOptionalText(row.policy_id),
      previousStatus,
      newStatus,
      previousAssignedTo: normalizeOptionalText(row.previous_assigned_to),
      newAssignedTo: normalizeOptionalText(row.new_assigned_to),
      previousNextAction: normalizeOptionalText(row.previous_next_action),
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
    const todayUtc = startOfUtcDay(new Date())

    const [policies, companies, individualClients] = await Promise.all([
      db.getPolicies(scope.companyId ?? undefined),
      scope.companyId
        ? db.getCompany(scope.companyId).then((company) => (company ? [company] : []))
        : db.getCompanies(),
      db.getIndividualClients(),
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
      if (!RENEWAL_ALERT_DAYS.includes(daysUntilRenewal as (typeof RENEWAL_ALERT_DAYS)[number])) continue

      const urgency = daysUntilRenewal as 30 | 60 | 90
      const key = `${policy.id}:${urgency}:${renewalDate.toISOString().slice(0, 10)}`
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
      pendente: 0,
      tratado: 0,
      em_negociacao: 0,
      renovado: 0,
    }
    let totalValueAtRisk = 0
    for (const alert of alerts) {
      byUrgency[alert.urgency].push(alert)
      countsByStatus[alert.status] += 1
      if (alert.status !== 'renovado') totalValueAtRisk += alert.value
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
    const fallbackPolicyId = key.split(':')[0]?.trim() || null

    const validStatuses: RenewalAlertStatus[] = ['pendente', 'tratado', 'em_negociacao', 'renovado']
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
          previous_status: previousStatus,
          new_status: status,
          previous_assigned_to: previousAssignedTo,
          new_assigned_to: assignedTo,
          previous_next_action: previousNextAction,
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

export const adminDeletePolicy = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const policy = await db.getPolicy(data.id)
    if (!policy) throw new Error('Apólice não encontrada')

    await db.deletePolicyRelations(data.id)
    await db.deletePolicy(data.id)
    return { success: true }
  })

export const adminSetPolicyUsers = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { policyId: string; userIds: string[] }) => d)
  .handler(async ({ data }) => {
    const policy = await db.getPolicy(data.policyId)
    if (!policy) throw new Error('Apólice não encontrada')

    const companyUsers = await db.getCompanyUsers(policy.companyId)
    const validUserIds = new Set(companyUsers.map((item) => item.id))
    const sanitizedUserIds = data.userIds.filter((userId) => validUserIds.has(userId))

    await db.setPolicyUsers(data.policyId, sanitizedUserIds)
    return { success: true, assigned: sanitizedUserIds.length }
  })

export const adminAssociateDocument = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { documentId: string; policyId: string }) => d)
  .handler(async ({ data }) => {
    await db.updateDocument(data.documentId, { policyId: data.policyId })
    return { success: true }
  })

export const adminUploadPolicyDocument = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { policyId: string; companyId?: string; individualClientId?: string; name: string; storagePath: string; size: number; category: string }) => d)
  .handler(async ({ data }) => {
    await db.createDocument({
      id: crypto.randomUUID(),
      companyId: data.companyId ?? '',
      name: data.name,
      category: data.category as any,
      size: data.size,
      uploadedBy: 'admin',
      uploadedAt: new Date().toISOString(),
      blobKey: data.storagePath,
      policyId: data.policyId,
    })
    return { success: true }
  })

export const adminGetDocumentUrl = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { storagePath: string }) => d)
  .handler(async ({ data }) => {
    const { data: urlData, error } = await supabaseAdmin.storage
      .from('documents')
      .createSignedUrl(data.storagePath, 3600)
    if (error) throw new Error(error.message)
    return { url: urlData.signedUrl }
  })

export const adminUpdateClaimStatus = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { claimId: string; status: string; notes?: string }) => d)
  .handler(async ({ data }) => {
    const claim = await db.getClaim(data.claimId)
    if (!claim) throw new Error('Sinistro não encontrado')
    const steps = [
      ...claim.steps,
      {
        status: data.status as any,
        date: new Date().toISOString().split('T')[0],
        notes: data.notes,
      },
    ]
    await db.updateClaim(data.claimId, { status: data.status as any, steps })
    return { success: true }
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
    await db.createCompanyUser({
      id,
      ...data,
      email: normalizedEmail,
      identityStatus: 'pending_confirmation',
      invitationSentAt: now,
      createdAt: now,
      updatedAt: now,
    })

    try {
      const result = await createIdentityUserWithConfirmation({
        email: normalizedEmail,
        password: data.accessPassword,
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
    if (typeof data.updates?.accessPassword === 'string' && data.updates.accessPassword.length > 0) {
      const users = await db.getCompanyUsers()
      const current = users.find((user) => user.id === data.id)
      if (!current?.email) throw new Error('Utilizador não encontrado para atualizar password no Identity.')
      await updateIdentityUserPasswordByEmail(current.email, data.updates.accessPassword)
      // Garantir que o identity_status fica como active após reset de password
      if (!data.updates.identityStatus) {
        data.updates.identityStatus = 'active'
      }
    }

    await db.updateCompanyUser(data.id, {
      ...data.updates,
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
    await db.deleteIndividualClient(id)
    return { success: true }
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
    const { data: client, error: readErr } = await supabaseAdmin
      .from('individual_clients').select('*').eq('id', data.clientId).single()
    if (readErr || !client) throw new Error('Cliente não encontrado')

    // Check for existing company with same NIF to avoid duplicates
    let companyId: string
    let alreadyExisted = false
    const nif = client.nif ?? ''
    if (nif) {
      const { data: existing } = await supabaseAdmin
        .from('companies').select('id').eq('nif', nif).maybeSingle()
      if (existing) {
        companyId = existing.id
        alreadyExisted = true
      }
    }

    if (!alreadyExisted) {
      companyId = crypto.randomUUID()
      const now = new Date().toISOString()
      const { error: companyErr } = await supabaseAdmin.from('companies').insert({
        id: companyId,
        name: client.full_name,
        nif,
        sector: '',
        contact_name: client.full_name,
        contact_email: client.email ?? '',
        contact_phone: client.phone ?? '',
        address: client.address ?? '',
        created_at: now,
      })
      if (companyErr) throw new Error(companyErr.message)
    }

    // Move policies
    await supabaseAdmin
      .from('policies')
      .update({ company_id: companyId!, individual_client_id: null })
      .eq('individual_client_id', data.clientId)

    // Move documents (best-effort)
    await supabaseAdmin
      .from('documents')
      .update({ company_id: companyId! })
      .eq('individual_client_id', data.clientId)

    // Delete individual client — throw on error
    const { error: delErr } = await supabaseAdmin
      .from('individual_clients').delete().eq('id', data.clientId)
    if (delErr) throw new Error(`Erro ao apagar individual_client: ${delErr.message}`)
    console.log('deleted individual_client:', data.clientId)

    return { success: true, companyId: companyId!, alreadyExisted }
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
      companyId: string
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
      blobKey?: string
    }) => d
  )
  .handler(async ({ data }) => {
    const scope = await getViewerScope()
    const companyId = scope.companyId ?? data.companyId
    if (!companyId) throw new Error('Empresa não associada ao utilizador')

    const id = `pol_${Date.now()}`
    await db.createPolicy({
      id,
      ...data,
      companyId,
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
    await db.updatePolicy(data.id, data.updates)
    return { success: true }
  })

export const deletePolicy = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const scope = await getViewerScope()
    const policy = await db.getPolicy(id)
    if (!policy) throw new Error('Apólice não encontrada')

    const viewerEmail = scope.user.email?.trim().toLowerCase()
    const companyUser = viewerEmail ? await db.getCompanyUserByEmail(viewerEmail) : undefined
    const sharedRelations = companyUser ? await db.getPolicyUsersByUser(companyUser.id) : []
    const isSharedWithViewer = sharedRelations.some((item) => item.policyId === id)
    const allowedByCompany = !!scope.companyId && policy.companyId === scope.companyId
    if (!allowedByCompany && !isSharedWithViewer && !scope.isAdmin) {
      throw new Error('Sem permissões para eliminar esta apólice')
    }

    await db.deletePolicyRelations(id)
    await db.deletePolicy(id)
    return { success: true }
  })

// ── Social Hub ────────────────────────────────────────────────────────────────

export const fetchSocialPosts = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .handler(async () => {
    const posts = await db.getSocialPosts()
    return posts ?? []
  })

export const adminCreateSocialPost = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: {
    id: string
    topic: string
    networks: string[]
    contentInstagram?: string
    contentLinkedin?: string
    contentFacebook?: string
    scheduledAt?: string
    status: string
    createdAt: string
    updatedAt: string
  }) => d)
  .handler(async ({ data }) => {
    await db.createSocialPost({
      id: data.id,
      topic: data.topic,
      networks: data.networks as any,
      contentInstagram: data.contentInstagram,
      contentLinkedin: data.contentLinkedin,
      contentFacebook: data.contentFacebook,
      scheduledAt: data.scheduledAt || undefined,
      status: data.status as any,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    })
    return { success: true }
  })

export const adminUpdateSocialPost = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string; updates: Partial<{ topic: string; status: string; networks: string[]; contentInstagram: string; contentLinkedin: string; contentFacebook: string; scheduledAt: string }> }) => d)
  .handler(async ({ data }) => {
    await db.updateSocialPost(data.id, { ...data.updates as any, updatedAt: new Date().toISOString() })
    return { success: true }
  })

export const adminDeleteSocialPost = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    await db.deleteSocialPost(data.id)
    return { success: true }
  })

// ── SVG carousel helpers (must be defined before adminGenerateSocialContent) ──

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars) {
      if (current) lines.push(current.trim())
      current = word
    } else {
      current = (current + ' ' + word).trim()
    }
  }
  if (current) lines.push(current.trim())
  return lines
}

function escSvg(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildCarouselSlide(topic: string, text: string, slideNumber: number, totalSlides: number): string {
  const H = 1080
  const gold = '#C9A84C'
  const white = '#FFFFFF'
  const navy1 = '#0A1628'
  const navy2 = '#1B2B4B'
  const gradId = `g${slideNumber}`

  const rawLines = wrapText(text.replace(/\n/g, ' '), 28)
  const bodyTextLines = rawLines.slice(0, 6)
  const lineHeight = 56
  const totalTextH = bodyTextLines.length * lineHeight
  const startY = (H - totalTextH) / 2 + 20

  const bodyTextSvg = bodyTextLines.map((line, i) =>
    `<text x="540" y="${startY + i * lineHeight}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="42" font-weight="bold" fill="${white}" opacity="0.95">${escSvg(line)}</text>`
  ).join('\n  ')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${navy1}"/>
      <stop offset="100%" stop-color="${navy2}"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1080" fill="url(#${gradId})"/>
  <text x="540" y="80" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="32" letter-spacing="6" fill="${gold}" font-weight="normal">ADLER &amp; ROCHEFORT</text>
  <line x1="440" y1="110" x2="640" y2="110" stroke="${gold}" stroke-width="1.5" opacity="0.8"/>
  ${bodyTextSvg}
  <line x1="340" y1="960" x2="740" y2="960" stroke="${gold}" stroke-width="1" opacity="0.5"/>
  <text x="540" y="1000" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="24" fill="${gold}" opacity="0.7">adlerrochefort.com</text>
  <text x="1040" y="1060" text-anchor="end" font-family="Georgia, 'Times New Roman', serif" font-size="20" fill="${white}" opacity="0.4">${slideNumber}/${totalSlides}</text>
</svg>`
}

export const adminGenerateSocialContent = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { topic: string }) => d)
  .handler(async ({ data }) => {
    const topic = data.topic
    const apiKey = process.env['ANTHROPIC_API_KEY'] || process.env['VITE_ANTHROPIC_API_KEY']
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada')

    const systemPrompt = `És um especialista em marketing de conteúdo para a Adler & Rochefort, uma corretora de seguros de prestígio com sede em Lisboa e Lagos, Portugal.

Regras de escrita obrigatórias:
- Escreve sempre em Português de Portugal (ortografia e vocabulário portugueses — nunca brasileiros)
- Usa sempre "você" em vez de "tu" quando te dirigires ao leitor
- Tom profissional mas próximo: elegante, de confiança, nunca excessivamente informal ou comercial
- Emojis com moderação e elegância — no máximo 2 a 3 por publicação, apenas quando acrescentam valor; nunca uses emojis de forma exagerada ou juvenil
- A voz da marca é a de um parceiro de confiança que protege o que os clientes mais valorizam, não a de um vendedor agressivo
- A empresa trabalha com empresas e particulares e posiciona-se no segmento premium do mercado segurador português`

    const userPrompt = `Cria conteúdo para redes sociais sobre o seguinte tópico: "${topic}"

Responde APENAS com um JSON válido neste formato exato (sem markdown, sem texto antes ou depois):
{
  "instagram": "Texto envolvente de 3 a 5 frases, elegante e impactante. No final, numa linha separada, 5 a 8 hashtags relevantes em português (ex: #SeguroAuto #AdlerRochefort #Seguros).",
  "linkedin": "Texto profissional e estruturado de 150 a 200 palavras, dividido em parágrafos curtos. Foco em valor, credibilidade e utilidade para profissionais ou empresas. No final, numa linha separada, 2 a 3 hashtags adequados ao LinkedIn (ex: #Seguros #GestãoDeRisco #Empresas).",
  "facebook": "Texto conversacional de 100 a 150 palavras, próximo e acessível. Termina com uma pergunta directa ao leitor ou um CTA claro. No final, numa linha separada, 3 a 4 hashtags relevantes (ex: #Seguros #AdlerRochefort #Portugal)."
}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Anthropic API error: ${err}`)
    }

    const result = await response.json() as any
    const text = result.content?.[0]?.text ?? ''

    let parsed: { instagram: string; linkedin: string; facebook: string }
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON found')
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      throw new Error('Erro ao processar resposta da IA')
    }

    // Build carousel slides programmatically
    const instagramText = parsed.instagram || ''
    // Split off hashtag block (lines starting with #)
    const lines = instagramText.split('\n')
    const hashtagLine = lines.filter(l => l.trim().startsWith('#')).join(' ')
    const bodyLines = lines.filter(l => !l.trim().startsWith('#'))
    const body = bodyLines.join(' ').trim()
    const mid = Math.ceil(body.length / 2)
    const splitAt = body.indexOf(' ', mid)
    const bodyA = splitAt > 0 ? body.slice(0, splitAt).trim() : body
    const bodyB = splitAt > 0 ? body.slice(splitAt).trim() : ''

    const carouselSlides = [
      buildCarouselSlide(topic, topic, 1, 3),
      buildCarouselSlide(topic, bodyA || body, 2, 3),
      buildCarouselSlide(topic, (bodyB || body) + (hashtagLine ? '\n' + hashtagLine : ''), 3, 3),
    ]

    return { ...parsed, carouselSlides }
  })
