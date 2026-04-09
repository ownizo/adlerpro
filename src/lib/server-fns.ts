import { createServerFn } from '@tanstack/react-start'
import { supabaseAdmin } from './supabase-admin'
import * as db from './data'
import type { DashboardStats } from './types'
import { requireAuthMiddleware, requireRoleMiddleware } from '@/middleware/identity'
import type { User } from '@/lib/identity-context'
import { createIdentityUserWithConfirmation, updateIdentityUserPasswordByEmail, deleteIdentityUserByEmail } from './identity-admin'

async function getViewerScope(user?: User | null) {
  if (!user) throw new Error('Authentication required')
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

type ViewerScope = Awaited<ReturnType<typeof getViewerScope>>

function resolveScopedCompanyId(scope: ViewerScope, requestedCompanyId?: string | null): string {
  if (scope.companyId) {
    return scope.companyId
  }
  if (!requestedCompanyId) throw new Error('Empresa não associada ao utilizador')
  return requestedCompanyId
}

function ensureTenantAccess(scope: ViewerScope, resourceCompanyId?: string | null) {
  if (scope.companyId && resourceCompanyId !== scope.companyId) {
    throw new Error('Operação não autorizada para esta empresa')
  }
}

// Dashboard — endpoint unificado: retorna stats + alertas + apólices numa só chamada
export const fetchDashboardAll = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async ({ context }) => {
    const scope = await getViewerScope(context?.user)
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
  async ({ context }): Promise<DashboardStats> => {
    const scope = await getViewerScope(context?.user)
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
  .handler(async ({ context }) => {
    const scope = await getViewerScope(context?.user)
    return db.getPolicies(scope.companyId ?? undefined)
  })

export const fetchPolicy = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: string) => d)
  .handler(async ({ data: id, context }) => {
    const scope = await getViewerScope(context?.user)
    const policy = await db.getPolicy(id)
    if (!policy) return undefined
    if (scope.companyId && policy.companyId !== scope.companyId) return undefined
    return policy
  })

export const fetchClaims = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async ({ context }) => {
    const scope = await getViewerScope(context?.user)
    return db.getClaims(scope.companyId ?? undefined)
  })

export const fetchClaim = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: string) => d)
  .handler(async ({ data: id, context }) => {
    const scope = await getViewerScope(context?.user)
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
  .handler(async ({ data, context }) => {
    const scope = await getViewerScope(context?.user)
    const companyId = resolveScopedCompanyId(scope, data.companyId)

    const policy = await db.getPolicy(data.policyId)
    if (!policy) throw new Error('Apólice não encontrada')
    if (policy.companyId !== companyId) {
      throw new Error('A apólice não pertence à empresa autenticada')
    }

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
  .handler(async ({ context }) => {
    const scope = await getViewerScope(context?.user)
    return db.getDocuments(scope.companyId ?? undefined)
  })

export const fetchAlerts = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async ({ context }) => {
    const scope = await getViewerScope(context?.user)
    return db.getAlerts(scope.companyId ?? undefined)
  })

export const clearAlerts = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .handler(async ({ context }) => {
    const scope = await getViewerScope(context?.user)
    if (scope.companyId) {
      await db.clearAlertsForCompany(scope.companyId)
    } else if (scope.isAdmin) {
      await db.clearAlerts()
    } else {
      throw new Error('Empresa não associada ao utilizador')
    }
    return { success: true }
  })

export const markAlertAsRead = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: string) => d)
  .handler(async ({ data: id, context }) => {
    const scope = await getViewerScope(context?.user)
    const alert = await db.getAlert(id)
    if (!alert) throw new Error('Alerta não encontrado')
    ensureTenantAccess(scope, alert.companyId)
    await db.markAlertRead(id)
    return { success: true }
  })

export const fetchCompanies = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async ({ context }) => {
    const scope = await getViewerScope(context?.user)
    if (scope.companyId) {
      const company = await db.getCompany(scope.companyId)
      return company ? [company] : []
    }
    return db.getCompanies()
  })

export const fetchCompany = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .inputValidator((d: string) => d)
  .handler(async ({ data: id, context }) => {
    const scope = await getViewerScope(context?.user)
    if (scope.companyId && scope.companyId !== id) return undefined
    return db.getCompany(id)
  })

export const fetchRiskReports = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async ({ context }) => {
    const scope = await getViewerScope(context?.user)
    return db.getRiskReports(scope.companyId ?? undefined)
  })

export const fetchCompanyUsers = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async ({ context }) => {
    const scope = await getViewerScope(context?.user)
    return db.getCompanyUsers(scope.companyId ?? undefined)
  })

export const fetchUserMetricEvents = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async ({ context }) => {
    const scope = await getViewerScope(context?.user)
    return db.getUserMetricEvents(scope.companyId ?? undefined)
  })

export const fetchCurrentUserCompanyProfile = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware])
  .handler(async ({ context }) => {
    const scope = await getViewerScope(context?.user)
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
      storagePath?: string
    }) => d
  )
  .handler(async ({ data }) => {
    const id = `pol_${Date.now()}`
    const { storagePath, ...policyData } = data
    const resolvedStoragePath = storagePath ?? ''
    await db.createPolicy({
      id,
      ...policyData,
      companyId: data.companyId ?? '',
      individualClientId: data.individualClientId || undefined,
      storagePath: resolvedStoragePath,
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
      storagePath: data.storagePath,
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
      storagePath?: string
    }) => d
  )
  .handler(async ({ data, context }) => {
    const scope = await getViewerScope(context?.user)
    const companyId = resolveScopedCompanyId(scope, data.companyId)
    const { storagePath, companyId: _companyId, ...policyData } = data
    const resolvedStoragePath = storagePath ?? ''

    const id = `pol_${Date.now()}`
    await db.createPolicy({
      id,
      ...policyData,
      companyId,
      storagePath: resolvedStoragePath,
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
  .handler(async ({ data, context }) => {
    const scope = await getViewerScope(context?.user)
    const policy = await db.getPolicy(data.id)
    if (!policy) throw new Error('Apólice não encontrada')
    ensureTenantAccess(scope, policy.companyId)

    const updates = { ...(data.updates ?? {}) }
    if (scope.companyId) {
      delete updates.companyId
      delete updates.company_id
    }

    const updated = await db.updatePolicy(data.id, updates, scope.companyId ?? undefined)
    if (!updated) throw new Error('Falha ao atualizar apólice para a empresa autenticada')
    return { success: true }
  })

export const deletePolicy = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware])
  .inputValidator((id: string) => id)
  .handler(async ({ data: id, context }) => {
    const scope = await getViewerScope(context?.user)
    const policy = await db.getPolicy(id)
    if (!policy) throw new Error('Apólice não encontrada')
    ensureTenantAccess(scope, policy.companyId)

    const deleted = await db.deletePolicy(id, scope.companyId ?? undefined)
    if (!deleted) throw new Error('Falha ao apagar apólice para a empresa autenticada')
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
