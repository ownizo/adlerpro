import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader, getCookies } from '@tanstack/react-start/server'
import { supabaseAdmin } from './supabase-admin'
import * as db from './data'
import type { DashboardStats, AdminFinancialDashboardData } from './types'
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
    return db.getPolicies(scope.companyId ?? undefined)
  })

export const fetchPolicy = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: string) => d)
  .handler(async ({ data: id }) => {
    const scope = await getViewerScope()
    const policy = await db.getPolicy(id)
    if (!policy) return undefined
    if (scope.companyId && policy.companyId !== scope.companyId) return undefined
    return policy
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
    const [companies, companyUsers, userEvents, apiConnections, policies, claims, documents, individualClients] = await Promise.all([
      db.getCompanies(),
      db.getCompanyUsers(),
      db.getUserMetricEvents(),
      db.getApiConnections(),
      db.getPolicies(),
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
    const timeline = Array.from({ length: 12 }, (_, index) => {
      const month = index + 1
      const date = new Date(Date.UTC(selectedYear, index, 1))
      return {
        month,
        monthKey: `${selectedYear}-${String(month).padStart(2, '0')}`,
        label: monthFormatter.format(date).replace('.', ''),
        premiumsCents: 0,
        commissionsCents: 0,
      }
    })
    const timelineByKey = new Map(timeline.map((point) => [point.monthKey, point]))

    const filteredPolicies = policies.filter((policy) => {
      if (selectedCompanyId && policy.companyId !== selectedCompanyId) return false
      if (selectedInsurer && policy.insurer.trim().toLowerCase() !== selectedInsurer) return false
      return true
    })

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
        const key = monthKeyFromDate(periodDate)
        const point = timelineByKey.get(key)
        if (!point) continue
        point.premiumsCents += premiumSlices[periodIndex] ?? 0
        point.commissionsCents += commissionSlices[periodIndex] ?? 0
      }
    }

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

    return {
      summary: {
        totalPremiums: totalPremiumsCents / 100,
        totalCommissions: totalCommissionsCents / 100,
        projectedCommissions: projectedCommissionsCents / 100,
        activePolicies,
      },
      timeline: timeline.map((point) => ({
        month: point.month,
        monthKey: point.monthKey,
        label: point.label,
        premiums: point.premiumsCents / 100,
        commissions: point.commissionsCents / 100,
      })),
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
