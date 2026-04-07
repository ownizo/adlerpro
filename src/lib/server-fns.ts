import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader, getCookies } from '@tanstack/react-start/server'
import { supabaseAdmin } from './supabase-admin'
import * as db from './data'
import type { DashboardStats } from './types'
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
    return { companies, companyUsers, userEvents, apiConnections, policies, claims, documents, individualClients }
  })

// Admin functions
export const adminCreatePolicy = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
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
    }) => d
  )
  .handler(async ({ data }) => {
    const id = `pol_${Date.now()}`
    await db.createPolicy({
      id,
      ...data,
      type: data.type as any,
      status: 'active',
      createdAt: new Date().toISOString(),
    })
    return { id }
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
