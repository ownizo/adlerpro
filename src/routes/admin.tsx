import { createFileRoute, Navigate, Link } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import {
  fetchAdminAll,
  adminCreatePolicy,
  adminUpdateClaimStatus,
  adminCreateCompany,
  adminUpdateCompany,
  adminDeleteCompany,
  adminCreateCompanyUser,
  adminDeleteCompanyUser,
  adminUpdateCompanyUser,
  adminRefreshApiConnection,
  adminUpdateApiConnection,
  adminCreateIndividualClient,
  adminUpdateIndividualClient,
  adminDeleteIndividualClient,
  adminActivateAdlerOne,
  adminPromoteToCompany,
  adminUpdatePolicy,
  adminAssociateDocument,
  adminUploadPolicyDocument,
  adminGetDocumentUrl,
  adminCreateClaim,
  fetchClaimWorkspace,
  adminAssignClaimResponsible,
  adminAddClaimTeamNote,
  adminSendClaimMessage,
  registerClaimDocument,
  removeClaimDocument,
  getClaimDocumentUrl,
  fetchSocialPosts,
  adminCreateSocialPost,
  adminUpdateSocialPost,
  adminDeleteSocialPost,
  adminGenerateSocialContent,
  fetchAdminFinancialDashboard,
  getRenewalAlerts,
  adminUpdateRenewalAlertStatus,
  adminDeletePolicyDocument,
  adminClearAllDocuments,
} from '@/lib/server-fns'
import { formatCurrency, formatDate } from '@/lib/utils'
import type {
  Company,
  Policy,
  Claim,
  Document as DocType,
  CompanyUser,
  UserMetricEvent,
  ApiConnection,
  IndividualClient,
  SocialPost,
  AdminFinancialDashboardData,
  RenewalAlertItem,
  RenewalAlertsResponse,
  RenewalAlertStatus,
  ClaimOperationalData,
} from '@/lib/types'
import { POLICY_TYPE_LABELS, CLAIM_STATUS_LABELS } from '@/lib/types'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useIdentity } from '@/lib/identity-context'
import { supabase } from '@/lib/supabase'

const ADMIN_TABS = ['dashboard', 'companies', 'individual_clients', 'policies', 'claims', 'social', 'api', 'profiles', 'alerts'] as const
type AdminTab = (typeof ADMIN_TABS)[number]
const RENEWAL_ALERT_STATUS_LABELS: Record<RenewalAlertStatus, string> = {
  pendente: 'Pendente',
  tratado: 'Tratado',
  em_negociacao: 'Em negociação',
  renovado: 'Renovado',
}

type RenewalKanbanColumnId = 'pending' | 'negotiating' | 'renewed'
type RenewalKanbanColumn = {
  id: RenewalKanbanColumnId
  title: string
}

const RENEWAL_KANBAN_COLUMNS: RenewalKanbanColumn[] = [
  { id: 'pending', title: 'Pending' },
  { id: 'negotiating', title: 'Negotiating' },
  { id: 'renewed', title: 'Renewed' },
]

const RENEWAL_KANBAN_TARGET_STATUS: Record<RenewalKanbanColumnId, RenewalAlertStatus> = {
  pending: 'pendente',
  negotiating: 'em_negociacao',
  renewed: 'renovado',
}

function renewalColumnByStatus(status: RenewalAlertStatus): RenewalKanbanColumnId {
  if (status === 'em_negociacao') return 'negotiating'
  if (status === 'renovado') return 'renewed'
  return 'pending'
}

function buildRenewalAlertsView(alerts: RenewalAlertItem[]) {
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
    total: alerts.length,
    byUrgency,
    summary: {
      totalRenewals: alerts.length,
      totalValueAtRisk,
      countsByStatus,
    },
  }
}

type RenewalRiskByPeriod = {
  urgency: 30 | 60 | 90
  alertsCount: number
  valueAtRisk: number
}

type RenewalTopRiskClient = {
  client: string
  company: string
  policiesCount: number
  valueAtRisk: number
}

type RenewalPipelineIntelligence = {
  totalAlerts: number
  renewedCount: number
  pendingOrNegotiatingCount: number
  renewalRatePct: number
  avgDaysPendingToRenewed: number | null
  avgDaysSampleSize: number
  valueAtRiskByPeriod: RenewalRiskByPeriod[]
  topRiskClients: RenewalTopRiskClient[]
  insights: string[]
}

function formatPctValue(value: number): string {
  return `${value.toFixed(1)}%`
}

function calculatePendingToRenewedDurationDays(alert: RenewalAlertItem): number | null {
  if (!alert.history.length) return null

  const sortedHistory = [...alert.history].sort((a, b) => {
    const ta = new Date(a.changedAt).getTime()
    const tb = new Date(b.changedAt).getTime()
    return ta - tb
  })

  let pendingAt: number | null = null
  for (const entry of sortedHistory) {
    const changedAt = new Date(entry.changedAt).getTime()
    if (!Number.isFinite(changedAt)) continue
    if (entry.newStatus === 'pendente' && pendingAt === null) pendingAt = changedAt
    if (entry.previousStatus === 'pendente' && pendingAt === null) pendingAt = changedAt
  }

  if (pendingAt === null) return null

  for (const entry of sortedHistory) {
    if (entry.newStatus !== 'renovado') continue
    const renewedAt = new Date(entry.changedAt).getTime()
    if (!Number.isFinite(renewedAt) || renewedAt < pendingAt) continue
    return (renewedAt - pendingAt) / (1000 * 60 * 60 * 24)
  }

  return null
}

function buildRenewalPipelineIntelligence(alerts: RenewalAlertItem[]): RenewalPipelineIntelligence {
  const totalAlerts = alerts.length
  const renewedCount = alerts.filter((alert) => alert.status === 'renovado').length
  const pendingOrNegotiatingCount = alerts.filter((alert) => alert.status !== 'renovado').length
  const renewalRatePct = totalAlerts > 0 ? (renewedCount / totalAlerts) * 100 : 0

  const durations = alerts
    .map(calculatePendingToRenewedDurationDays)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
  const avgDaysPendingToRenewed = durations.length
    ? durations.reduce((sum, value) => sum + value, 0) / durations.length
    : null

  const valueAtRiskByPeriod: RenewalRiskByPeriod[] = ([30, 60, 90] as const).map((urgency) => {
    const periodAlerts = alerts.filter((alert) => alert.urgency === urgency && alert.status !== 'renovado')
    return {
      urgency,
      alertsCount: periodAlerts.length,
      valueAtRisk: periodAlerts.reduce((sum, alert) => sum + alert.value, 0),
    }
  })

  const riskByClient = new Map<string, RenewalTopRiskClient>()
  for (const alert of alerts) {
    if (alert.status === 'renovado') continue
    const key = `${alert.client}::${alert.company}`
    const current = riskByClient.get(key)
    if (current) {
      current.valueAtRisk += alert.value
      current.policiesCount += 1
    } else {
      riskByClient.set(key, {
        client: alert.client,
        company: alert.company,
        policiesCount: 1,
        valueAtRisk: alert.value,
      })
    }
  }

  const topRiskClients = Array.from(riskByClient.values())
    .sort((a, b) => b.valueAtRisk - a.valueAtRisk)
    .slice(0, 3)

  const highestRiskPeriod = [...valueAtRiskByPeriod].sort((a, b) => b.valueAtRisk - a.valueAtRisk)[0]
  const overduePending = alerts.filter((alert) => alert.status !== 'renovado' && alert.daysUntilRenewal <= 30)
  const unassignedCount = alerts.filter((alert) => alert.status !== 'renovado' && !alert.assignedTo?.trim()).length

  const insights: string[] = []
  if (totalAlerts === 0) {
    insights.push('Sem alertas ativos no período atual para gerar insights.')
  } else {
    insights.push(`Taxa de renovação atual em ${formatPctValue(renewalRatePct)} (${renewedCount}/${totalAlerts}).`)
    if (highestRiskPeriod && highestRiskPeriod.valueAtRisk > 0) {
      insights.push(`Maior concentração de risco no D-${highestRiskPeriod.urgency}: ${formatCurrency(highestRiskPeriod.valueAtRisk)}.`)
    }
    if (topRiskClients[0]) {
      const topClient = topRiskClients[0]
      insights.push(`Maior risco financeiro concentrado em ${topClient.client} (${formatCurrency(topClient.valueAtRisk)}).`)
    }
    if (avgDaysPendingToRenewed !== null) {
      insights.push(`Tempo médio de transição pending → renewed em ${avgDaysPendingToRenewed.toFixed(1)} dias (${durations.length} casos).`)
    }
    if (overduePending.length > 0) {
      insights.push(`${overduePending.length} apólices com renovação em até 30 dias ainda sem estado renovado.`)
    }
    if (unassignedCount > 0) {
      insights.push(`${unassignedCount} apólices em risco ainda sem responsável definido.`)
    }
  }

  return {
    totalAlerts,
    renewedCount,
    pendingOrNegotiatingCount,
    renewalRatePct,
    avgDaysPendingToRenewed,
    avgDaysSampleSize: durations.length,
    valueAtRiskByPeriod,
    topRiskClients,
    insights,
  }
}

function isAdminTab(value: unknown): value is AdminTab {
  return typeof value === 'string' && ADMIN_TABS.includes(value as AdminTab)
}

export const Route = createFileRoute('/admin')({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: isAdminTab(search.tab) ? search.tab : undefined,
  }),
  component: AdminPage,
  head: () => ({ meta: [{ title: 'Adler Admin' }] }),
})

function AdminPage() {
  const { user, ready } = useIdentity()
  const { tab: searchTab } = Route.useSearch()
  const tab: AdminTab = searchTab ?? 'dashboard'
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([])
  const [userEvents, setUserEvents] = useState<UserMetricEvent[]>([])
  const [apiConnections, setApiConnections] = useState<ApiConnection[]>([])
  const [policies, setPolicies] = useState<Policy[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [claimOperationalSummary, setClaimOperationalSummary] = useState<Record<string, { responsibleName?: string; messagesCount: number; documentsCount: number; lastMessageAt?: string; updatedAt?: string }>>({})
  const [documents, setDocuments] = useState<DocType[]>([])
  const [individualClients, setIndividualClients] = useState<IndividualClient[]>([])
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewCompany, setShowNewCompany] = useState(false)
  const [showNewPolicy, setShowNewPolicy] = useState(false)
  const [showNewIndividualClient, setShowNewIndividualClient] = useState(false)
  const [editingIndividualClientId, setEditingIndividualClientId] = useState<string | null>(null)
  const [expandedIndividualClientId, setExpandedIndividualClientId] = useState<string | null>(null)
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null)
  const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(null)
  const [showUserFormForCompanyId, setShowUserFormForCompanyId] = useState<string | null>(null)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('')
  const [showNewClaim, setShowNewClaim] = useState(false)
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null)
  const [claimWorkspace, setClaimWorkspace] = useState<{
    claim: Claim
    policy?: Policy
    company?: Company
    individualClient?: IndividualClient
    operations: ClaimOperationalData
  } | null>(null)
  const [loadingClaimWorkspace, setLoadingClaimWorkspace] = useState(false)
  const [globalSearch, setGlobalSearch] = useState('')
  const [expandedClientPolicyId, setExpandedClientPolicyId] = useState<string | null>(null)
  const [expandedCompanyPolicyId, setExpandedCompanyPolicyId] = useState<string | null>(null)

  const reload = async () => {
    const { companies: c, companyUsers: u, userEvents: e, apiConnections: a, policies: p, claims: cl, claimOperationalSummary: cos, documents: d, individualClients: ic } = await fetchAdminAll()
    setCompanies(c)
    setCompanyUsers(u)
    setUserEvents(e)
    setApiConnections(a)
    setPolicies(p)
    setClaims(cl)
    setClaimOperationalSummary(cos ?? {})
    setDocuments(d)
    setIndividualClients(ic ?? [])
    try {
      const sp = await fetchSocialPosts()
      setSocialPosts(sp ?? [])
    } catch (err) {
      console.error('[reload] fetchSocialPosts error:', err)
      setSocialPosts([])
    }
  }

  useEffect(() => {
    if (!ready || !user || !user.roles?.includes('admin')) return
    reload()
      .then(() => setLoading(false))
      .catch((err) => {
        console.error('[AdminPage] reload error:', err)
        setLoading(false)
      })
  }, [ready, user])

  useEffect(() => {
    if (!selectedClaimId) {
      setClaimWorkspace(null)
      return
    }
    setLoadingClaimWorkspace(true)
    fetchClaimWorkspace({ data: { claimId: selectedClaimId } })
      .then((payload) => {
        setClaimWorkspace(payload as any)
      })
      .catch((err) => {
        console.error('[AdminPage] fetchClaimWorkspace error:', err)
        setClaimWorkspace(null)
      })
      .finally(() => setLoadingClaimWorkspace(false))
  }, [selectedClaimId, claims.length])

  if (!ready) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" />
  if (!user.roles?.includes('admin')) return <Navigate to="/dashboard" />

  const expiringPolicies = policies.filter((p) => {
    const endDate = new Date(p.endDate)
    const now = new Date()
    const diffTime = Math.abs(endDate.getTime() - now.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays <= 60 && (p.status === 'active' || p.status === 'expiring')
  })

  const metricsByUser = companyUsers.map((user) => {
    const events = userEvents.filter((event) => event.userId === user.id)
    const loginsThisMonth = events.filter((event) => {
      if (event.type !== 'login') return false
      const eventDate = new Date(event.timestamp)
      const now = new Date()
      return eventDate.getMonth() === now.getMonth() && eventDate.getFullYear() === now.getFullYear()
    }).length

    return {
      ...user,
      events,
      loginsThisMonth,
      lastActivityAt: events.length ? events[events.length - 1].timestamp : undefined,
    }
  })

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-navy-700">Painel de Administração</h1>
          <p className="text-navy-500 mt-1">Gestão de empresas, acessos, apólices, sinistros e integrações</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {(tab === 'companies' || tab === 'individual_clients' || tab === 'policies') && (
              <div className="mb-6">
                <input
                  type="text"
                  value={globalSearch}
                  onChange={(e) => setGlobalSearch(e.target.value)}
                  placeholder="Pesquisar por nome de cliente, apólice, seguradora..."
                  className="w-full px-4 py-2.5 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400 bg-white"
                />
              </div>
            )}

            {tab === 'dashboard' && (
              <AdminDashboardTab
                companies={companies}
                companyUsers={companyUsers}
                policies={policies}
                claims={claims}
                documents={documents}
                individualClients={individualClients}
                socialPosts={socialPosts}
                apiConnections={apiConnections}
              />
            )}

            {tab === 'companies' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-navy-700">Empresas ({companies.length})</h2>
                  <button
                    onClick={() => {
                      setEditingCompanyId(null)
                      setShowNewCompany(!showNewCompany)
                    }}
                    className="px-4 py-2 bg-gold-400 text-navy-700 font-semibold rounded-[2px] hover:bg-gold-300 transition-colors text-sm"
                  >
                    {showNewCompany ? 'Cancelar' : 'Nova Empresa'}
                  </button>
                </div>

                {showNewCompany && (
                  <CompanyForm
                    title={editingCompanyId ? 'Editar Empresa' : 'Nova Empresa'}
                    initial={editingCompanyId ? companies.find((c) => c.id === editingCompanyId) : undefined}
                    onSubmit={async (data) => {
                      if (editingCompanyId) {
                        await adminUpdateCompany({ data: { id: editingCompanyId, updates: data } })
                      } else {
                        await adminCreateCompany({ data })
                      }
                      await reload()
                      setShowNewCompany(false)
                      setEditingCompanyId(null)
                    }}
                  />
                )}

                <div className="grid gap-4">
                  {companies.filter((company) => {
                    if (!globalSearch.trim()) return true
                    const q = globalSearch.toLowerCase()
                    const companyPolicies = policies.filter((p) => p.companyId === company.id)
                    return (
                      company.name.toLowerCase().includes(q) ||
                      company.nif.toLowerCase().includes(q) ||
                      companyPolicies.some((p) =>
                        p.policyNumber.toLowerCase().includes(q) ||
                        p.insurer.toLowerCase().includes(q) ||
                        (POLICY_TYPE_LABELS[p.type as keyof typeof POLICY_TYPE_LABELS] ?? p.type).toLowerCase().includes(q)
                      )
                    )
                  }).map((company) => {
                    const companyPolicies = policies.filter((policy) => policy.companyId === company.id)
                    const companyDocs = documents.filter((doc) => doc.companyId === company.id)
                    const users = companyUsers.filter((user) => user.companyId === company.id)
                    const isExpanded = expandedCompanyId === company.id

                    return (
                      <div key={company.id} className="bg-white rounded-[4px] border border-navy-200 overflow-hidden">
                        <button
                          onClick={() => setExpandedCompanyId(isExpanded ? null : company.id)}
                          className="w-full p-6 text-left hover:bg-navy-50/50 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <h3 className="text-lg font-semibold text-navy-700">{company.name}</h3>
                              <p className="text-sm text-navy-500 mt-1">NIF {company.nif} · {company.sector}</p>
                              <p className="text-xs text-navy-400 mt-1">{company.address}</p>
                              <p className="text-xs text-navy-500 mt-2">Acesso da empresa: {company.accessEmail || '-'}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-medium text-navy-700">{users.length} utilizadores</p>
                              <p className="text-sm text-navy-500">{companyPolicies.length} apólices</p>
                              <p className="text-sm text-navy-500">{companyDocs.length} documentos</p>
                            </div>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="border-t border-navy-100 bg-navy-50/50 p-6 space-y-6">
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => {
                                  setEditingCompanyId(company.id)
                                  setShowNewCompany(true)
                                }}
                                className="px-3 py-1.5 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50"
                              >
                                Editar Empresa
                              </button>
                              <button
                                onClick={async () => {
                                  if (!confirm(`Eliminar a empresa ${company.name} e os respetivos dados?`)) return
                                  await adminDeleteCompany({ data: company.id })
                                  await reload()
                                  setExpandedCompanyId(null)
                                }}
                                className="px-3 py-1.5 text-xs bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100"
                              >
                                Eliminar Empresa
                              </button>
                              <button
                                onClick={() => setShowUserFormForCompanyId(showUserFormForCompanyId === company.id ? null : company.id)}
                                className="px-3 py-1.5 text-xs bg-gold-400 text-navy-700 border border-gold-500 rounded hover:bg-gold-300"
                              >
                                {showUserFormForCompanyId === company.id ? 'Cancelar Novo Utilizador' : 'Adicionar Utilizador'}
                              </button>
                            </div>

                            {showUserFormForCompanyId === company.id && (
                              <CompanyUserForm
                                companyId={company.id}
                                companyName={company.name}
                                onSubmit={async (payload) => {
                                  await adminCreateCompanyUser({ data: payload })
                                  await reload()
                                  setShowUserFormForCompanyId(null)
                                }}
                              />
                            )}

                            <div className="grid lg:grid-cols-2 gap-6">
                              <div>
                                <h4 className="text-sm font-semibold text-navy-700 mb-3">Utilizadores da Empresa</h4>
                                <div className="bg-white rounded-[4px] border border-navy-200 overflow-hidden">
                                  <table className="w-full">
                                    <thead>
                                      <tr className="bg-navy-50 border-b border-navy-200">
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Nome</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Email</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Perfil</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Ações</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-navy-100">
                                      {users.map((user) => (
                                        <tr key={user.id}>
                                          <td className="px-4 py-3 text-sm text-navy-700">{user.name}</td>
                                          <td className="px-4 py-3 text-sm text-navy-500">{user.email}</td>
                                          <td className="px-4 py-3 text-sm text-navy-500 capitalize">{user.role}</td>
                                          <td className="px-4 py-3">
                                            <div className="flex gap-1">
                                              <button
                                                onClick={async () => {
                                                  const newPassword = prompt('Nova password de acesso (Identity):')
                                                  if (!newPassword) return
                                                  await adminUpdateCompanyUser({
                                                    data: { id: user.id, updates: { accessPassword: newPassword } },
                                                  })
                                                  await reload()
                                                }}
                                                className="px-2 py-1 text-xs border border-navy-300 rounded hover:bg-navy-50"
                                              >
                                                Reset Password
                                              </button>
                                              <button
                                                onClick={async () => {
                                                  if (!confirm(`Eliminar utilizador ${user.name}?`)) return
                                                  await adminDeleteCompanyUser({ data: user.id })
                                                  await reload()
                                                }}
                                                className="px-2 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50"
                                              >
                                                Eliminar
                                              </button>
                                            </div>
                                          </td>
                                        </tr>
                                      ))}
                                      {users.length === 0 && (
                                        <tr>
                                          <td colSpan={4} className="px-4 py-4 text-sm text-navy-400 text-center">
                                            Sem utilizadores registados para esta empresa.
                                          </td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </div>

                              <div>
                                <h4 className="text-sm font-semibold text-navy-700 mb-3">Métricas e Histórico</h4>
                                <div className="space-y-3">
                                  {users.map((user) => {
                                    const events = userEvents.filter((event) => event.userId === user.id)
                                    const loginsThisMonth = events.filter((event) => {
                                      if (event.type !== 'login') return false
                                      const eventDate = new Date(event.timestamp)
                                      const now = new Date()
                                      return eventDate.getMonth() === now.getMonth() && eventDate.getFullYear() === now.getFullYear()
                                    }).length

                                    return (
                                      <div key={user.id} className="bg-white rounded-[4px] border border-navy-200 p-4">
                                        <p className="text-sm font-semibold text-navy-700">{user.name}</p>
                                        <p className="text-xs text-navy-500">Último login: {user.lastLoginAt ? formatDate(user.lastLoginAt) : '-'}</p>
                                        <p className="text-xs text-navy-500">Acessos no mês: {loginsThisMonth}</p>
                                        <p className="text-xs text-navy-500">Eventos totais: {events.length}</p>
                                        <div className="mt-2 text-xs text-navy-500 space-y-1 max-h-24 overflow-y-auto">
                                          {events.slice(-5).reverse().map((event) => (
                                            <p key={event.id}>• {formatDate(event.timestamp)} · {event.description}</p>
                                          ))}
                                          {events.length === 0 && <p>Sem histórico.</p>}
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            </div>

                            <div className="grid lg:grid-cols-2 gap-6">
                              <SimpleCollection
                                title="Documentos da Empresa"
                                rows={companyDocs.map((doc) => `${doc.name} · ${doc.category} · ${formatDate(doc.uploadedAt)}`)}
                                emptyMessage="Sem documentos carregados."
                              />
                              <div>
                                <h4 className="text-sm font-semibold text-navy-700 mb-3">Apólices da Empresa ({companyPolicies.length})</h4>
                                {companyPolicies.length === 0 ? (
                                  <p className="text-sm text-navy-400">Sem apólices associadas.</p>
                                ) : (
                                  <div className="space-y-2">
                                    {companyPolicies.map((p) => {
                                      const pDocs = documents.filter(d => d.policyId === p.id)
                                      const isPolExpanded = expandedCompanyPolicyId === p.id
                                      return (
                                        <div key={p.id} className="bg-white rounded border border-navy-200 overflow-hidden">
                                          <button
                                            onClick={() => setExpandedCompanyPolicyId(isPolExpanded ? null : p.id)}
                                            className="w-full px-4 py-3 text-left hover:bg-navy-50/50 transition-colors"
                                          >
                                            <div className="flex items-center justify-between gap-2">
                                              <div className="flex items-center gap-2">
                                                <span className="text-navy-400 text-xs">{isPolExpanded ? '▾' : '▸'}</span>
                                                <span className="text-sm font-medium text-navy-700">
                                                  {POLICY_TYPE_LABELS[p.type as keyof typeof POLICY_TYPE_LABELS] ?? p.type} — {p.insurer}
                                                </span>
                                              </div>
                                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                                p.status === 'active' ? 'bg-green-100 text-green-700' :
                                                p.status === 'expiring' ? 'bg-yellow-100 text-yellow-700' :
                                                'bg-red-100 text-red-700'
                                              }`}>{POLICY_STATUS_LABEL[p.status] ?? p.status}</span>
                                            </div>
                                            <p className="text-xs text-navy-500 mt-1 ml-5">Apólice {p.policyNumber} · {formatCurrency(p.annualPremium)}/ano</p>
                                          </button>
                                          {isPolExpanded && (
                                            <div className="border-t border-navy-100 bg-navy-50/30 px-4 py-3 space-y-2">
                                              <div className="grid grid-cols-2 gap-2 text-xs text-navy-600">
                                                <p><strong>Início:</strong> {formatDate(p.startDate)}</p>
                                                <p><strong>Fim:</strong> {formatDate(p.endDate)}</p>
                                                {p.renewalDate && <p><strong>Renovação:</strong> {formatDate(p.renewalDate)}</p>}
                                                {p.deductible != null && <p><strong>Franquia:</strong> {formatCurrency(p.deductible)}</p>}
                                                {p.paymentFrequency && <p><strong>Pagamento:</strong> {p.paymentFrequency}</p>}
                                                <p><strong>Capital Seguro:</strong> {formatCurrency(p.insuredValue)}</p>
                                              </div>
                                              {p.description && <p className="text-xs text-navy-500"><strong>Descrição:</strong> {p.description}</p>}
                                              {p.coverages && p.coverages.length > 0 && (
                                                <div className="text-xs text-navy-600">
                                                  <strong>Coberturas:</strong> {p.coverages.join(', ')}
                                                </div>
                                              )}
                                              {pDocs.length > 0 && (
                                                <div className="text-xs text-navy-600">
                                                  <strong>Documentos ({pDocs.length}):</strong>
                                                  <ul className="mt-1 space-y-1">
                                                    {pDocs.map(d => (
                                                      <li key={d.id} className="flex items-center gap-2">
                                                        <span>📄</span> <span>{d.name}</span>
                                                        <PolicyDocumentButtons storagePath={d.blobKey} name={d.name} />
                                                      </li>
                                                    ))}
                                                  </ul>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {tab === 'individual_clients' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-navy-700">Clientes Individuais ({individualClients.length})</h2>
                  <button
                    onClick={() => {
                      setEditingIndividualClientId(null)
                      setShowNewIndividualClient(!showNewIndividualClient)
                    }}
                    className="px-4 py-2 bg-gold-400 text-navy-700 font-semibold rounded-[2px] hover:bg-gold-300 transition-colors text-sm"
                  >
                    {showNewIndividualClient ? 'Cancelar' : 'Novo Cliente'}
                  </button>
                </div>

                {showNewIndividualClient && (
                  <IndividualClientForm
                    title={editingIndividualClientId ? 'Editar Cliente' : 'Novo Cliente Individual'}
                    initial={editingIndividualClientId ? individualClients.find((c) => c.id === editingIndividualClientId) : undefined}
                    onSubmit={async (data) => {
                      if (editingIndividualClientId) {
                        await adminUpdateIndividualClient({ data: { id: editingIndividualClientId, updates: data } })
                      } else {
                        await adminCreateIndividualClient({ data })
                      }
                      await reload()
                      setShowNewIndividualClient(false)
                      setEditingIndividualClientId(null)
                    }}
                  />
                )}

                <div className="bg-white rounded-[4px] border border-navy-200 overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-navy-50 border-b border-navy-200">
                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Nome</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">NIF</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Email</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Telefone</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Estado</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Tipo</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Portal</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-navy-100">
                      {individualClients.filter((client) => {
                        if (!globalSearch.trim()) return true
                        const q = globalSearch.toLowerCase()
                        const clientPolicies = policies.filter((p) => p.individualClientId === client.id)
                        return (
                          client.fullName.toLowerCase().includes(q) ||
                          (client.nif ?? '').toLowerCase().includes(q) ||
                          (client.email ?? '').toLowerCase().includes(q) ||
                          clientPolicies.some((p) =>
                            p.policyNumber.toLowerCase().includes(q) ||
                            p.insurer.toLowerCase().includes(q) ||
                            (POLICY_TYPE_LABELS[p.type as keyof typeof POLICY_TYPE_LABELS] ?? p.type).toLowerCase().includes(q)
                          )
                        )
                      }).map((client) => {
                        const clientPolicies = policies.filter((p) => p.individualClientId === client.id)
                        const isExpanded = expandedIndividualClientId === client.id
                        return (
                          <>
                            <tr
                              key={client.id}
                              className="hover:bg-navy-50/50 cursor-pointer"
                              onClick={() => setExpandedIndividualClientId(isExpanded ? null : client.id)}
                            >
                              <td className="px-4 py-3 text-sm font-medium text-navy-700">
                                <span className="mr-1 text-navy-400">{isExpanded ? '▾' : '▸'}</span>
                                {client.fullName}
                              </td>
                              <td className="px-4 py-3 text-sm text-navy-500">{client.nif || '—'}</td>
                              <td className="px-4 py-3 text-sm text-navy-500">{client.email || '—'}</td>
                              <td className="px-4 py-3 text-sm text-navy-500">{client.phone || '—'}</td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                  client.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                                }`}>
                                  {client.status === 'active' ? 'Ativo' : client.status}
                                </span>
                              </td>
                              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                <PromoteToCompanySelect client={client} onSuccess={async () => { setIndividualClients([]); await reload(); setExpandedIndividualClientId(null) }} />
                              </td>
                              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                <ActivateAdlerOneButton client={client} onSuccess={reload} />
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    onClick={() => {
                                      setEditingIndividualClientId(client.id)
                                      setShowNewIndividualClient(true)
                                      setExpandedIndividualClientId(null)
                                    }}
                                    className="px-2 py-1 text-xs border border-navy-300 rounded hover:bg-navy-50"
                                  >
                                    Editar
                                  </button>
                                  <button
                                    onClick={async () => {
                                      if (!confirm(`Eliminar cliente ${client.fullName}?`)) return
                                      await adminDeleteIndividualClient({ data: client.id })
                                      await reload()
                                      setExpandedIndividualClientId(null)
                                    }}
                                    className="px-2 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50"
                                  >
                                    Eliminar
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr key={`${client.id}-detail`}>
                                <td colSpan={8} className="bg-navy-50/50 px-6 py-4 border-b border-navy-100">
                                  <div className="mb-2">
                                    <p className="text-xs text-navy-500 mb-1">
                                      <strong>Morada:</strong> {client.address || '—'}
                                    </p>
                                  </div>
                                  <h4 className="text-sm font-semibold text-navy-700 mb-3">
                                    Apólices ({clientPolicies.length})
                                  </h4>
                                  {clientPolicies.length === 0 ? (
                                    <p className="text-sm text-navy-400">Sem apólices associadas.</p>
                                  ) : (
                                    <div className="grid gap-2">
                                      {clientPolicies.map((p) => {
                                        const pDocs = documents.filter(d => d.policyId === p.id)
                                        const isPolExpanded = expandedClientPolicyId === p.id
                                        return (
                                          <div key={p.id} className="bg-white rounded border border-navy-200 overflow-hidden">
                                            <button
                                              onClick={() => setExpandedClientPolicyId(isPolExpanded ? null : p.id)}
                                              className="w-full px-4 py-3 text-left hover:bg-navy-50/50 transition-colors"
                                            >
                                              <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="flex items-center gap-2">
                                                  <span className="text-navy-400 text-xs">{isPolExpanded ? '▾' : '▸'}</span>
                                                  <p className="text-sm font-medium text-navy-700">
                                                    {POLICY_TYPE_LABELS[p.type as keyof typeof POLICY_TYPE_LABELS] ?? p.type}
                                                    {' — '}{p.insurer}
                                                  </p>
                                                </div>
                                                <div className="text-right flex items-center gap-3">
                                                  <p className="text-sm font-semibold text-navy-700">{formatCurrency(p.annualPremium)}/ano</p>
                                                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                                                    p.status === 'active' ? 'bg-green-100 text-green-700' :
                                                    p.status === 'expiring' ? 'bg-yellow-100 text-yellow-700' :
                                                    'bg-red-100 text-red-700'
                                                  }`}>{POLICY_STATUS_LABEL[p.status] ?? p.status}</span>
                                                </div>
                                              </div>
                                              <p className="text-xs text-navy-500 ml-5">
                                                Apólice {p.policyNumber} · {formatDate(p.startDate)} → {formatDate(p.endDate)}
                                              </p>
                                            </button>
                                            {isPolExpanded && (
                                              <div className="border-t border-navy-100 bg-navy-50/30 px-4 py-3 space-y-2">
                                                <div className="grid grid-cols-2 gap-2 text-xs text-navy-600">
                                                  <p><strong>Início:</strong> {formatDate(p.startDate)}</p>
                                                  <p><strong>Fim:</strong> {formatDate(p.endDate)}</p>
                                                  {p.renewalDate && <p><strong>Renovação:</strong> {formatDate(p.renewalDate)}</p>}
                                                  {p.deductible != null && <p><strong>Franquia:</strong> {formatCurrency(p.deductible)}</p>}
                                                  {p.paymentFrequency && <p><strong>Pagamento:</strong> {p.paymentFrequency}</p>}
                                                  <p><strong>Capital Seguro:</strong> {formatCurrency(p.insuredValue)}</p>
                                                </div>
                                                {p.description && <p className="text-xs text-navy-500"><strong>Descrição:</strong> {p.description}</p>}
                                                {p.coverages && p.coverages.length > 0 && (
                                                  <div className="text-xs text-navy-600">
                                                    <strong>Coberturas:</strong> {p.coverages.join(', ')}
                                                  </div>
                                                )}
                                                {pDocs.length > 0 && (
                                                  <div className="text-xs text-navy-600">
                                                    <strong>Documentos ({pDocs.length}):</strong>
                                                    <ul className="mt-1 space-y-1">
                                                      {pDocs.map(d => (
                                                        <li key={d.id} className="flex items-center gap-2">
                                                          <span>📄</span> <span>{d.name}</span>
                                                          <PolicyDocumentButtons storagePath={d.blobKey} name={d.name} />
                                                        </li>
                                                      ))}
                                                    </ul>
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })}
                      {individualClients.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-sm text-navy-400 text-center">
                            Sem clientes individuais registados.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'policies' && (
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <div className="flex items-center gap-4">
                    <h2 className="text-lg font-semibold text-navy-700">Filtrar por Cliente:</h2>
                    <select
                      value={selectedCompanyId}
                      onChange={(e) => setSelectedCompanyId(e.target.value)}
                      className="px-4 py-2 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400 min-w-48"
                    >
                      <option value="">Todos os Clientes</option>
                      {companies.length > 0 && (
                        <optgroup label="── Empresas ──">
                          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </optgroup>
                      )}
                      {individualClients.length > 0 && (
                        <optgroup label="── Clientes Individuais ──">
                          {individualClients.map((c) => <option key={c.id} value={`ic:${c.id}`}>{c.fullName}</option>)}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowNewPolicy(!showNewPolicy)}
                      className="px-4 py-2 bg-gold-400 text-navy-700 font-semibold rounded-[2px] hover:bg-gold-300 transition-colors text-sm whitespace-nowrap"
                    >
                      {showNewPolicy ? 'Cancelar' : 'Nova Apólice'}
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm('Eliminar TODOS os documentos do sistema? Esta ação não pode ser revertida.')) return
                        await adminClearAllDocuments()
                        await reload()
                      }}
                      className="px-4 py-2 bg-red-50 text-red-600 border border-red-200 font-semibold rounded-[2px] hover:bg-red-100 transition-colors text-sm whitespace-nowrap"
                    >
                      Limpar Documentos
                    </button>
                  </div>
                </div>

                {showNewPolicy && (
                  <NewPolicyForm
                    companies={companies}
                    individualClients={individualClients}
                    onSubmit={async (data) => {
                      await adminCreatePolicy({ data })
                      await reload()
                      setShowNewPolicy(false)
                    }}
                  />
                )}

                <AdminPolicyList
                  policies={policies.filter((p) => {
                    const clientFilter = !selectedCompanyId ? true :
                      selectedCompanyId.startsWith('ic:') ? p.individualClientId === selectedCompanyId.slice(3) :
                      p.companyId === selectedCompanyId
                    if (!clientFilter) return false
                    if (!globalSearch.trim()) return true
                    const q = globalSearch.toLowerCase()
                    const clientName = companies.find(c => c.id === p.companyId)?.name
                      ?? individualClients.find(c => c.id === p.individualClientId)?.fullName ?? ''
                    return (
                      clientName.toLowerCase().includes(q) ||
                      p.policyNumber.toLowerCase().includes(q) ||
                      p.insurer.toLowerCase().includes(q) ||
                      (POLICY_TYPE_LABELS[p.type as keyof typeof POLICY_TYPE_LABELS] ?? p.type).toLowerCase().includes(q)
                    )
                  })}
                  documents={documents}
                  companies={companies}
                  individualClients={individualClients}
                  onReload={reload}
                />
              </div>
            )}

            {tab === 'claims' && (
              <div>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h2 className="text-lg font-semibold text-navy-700">Sinistros ({claims.length})</h2>
                  <button
                    onClick={() => setShowNewClaim((prev) => !prev)}
                    className="px-4 py-2 bg-gold-400 text-navy-700 font-semibold rounded-[2px] hover:bg-gold-300 transition-colors text-sm"
                  >
                    {showNewClaim ? 'Cancelar' : 'Novo Sinistro'}
                  </button>
                </div>

                {showNewClaim && (
                  <NewAdminClaimForm
                    companies={companies}
                    companyUsers={companyUsers}
                    policies={policies}
                    individualClients={individualClients}
                    onSubmit={async (data) => {
                      await adminCreateClaim({ data })
                      await reload()
                      setShowNewClaim(false)
                    }}
                  />
                )}

                <AdminClaimsBoard
                  claims={claims}
                  policies={policies}
                  companies={companies}
                  individualClients={individualClients}
                  summaryMap={claimOperationalSummary}
                  selectedClaimId={selectedClaimId}
                  onSelectClaim={setSelectedClaimId}
                  onQuickStatusUpdate={async (claimId, status, notes) => {
                    await adminUpdateClaimStatus({ data: { claimId, status, notes } })
                    await reload()
                  }}
                />

                {loadingClaimWorkspace ? (
                  <div className="mt-4 bg-white border border-navy-200 rounded-[4px] p-6 text-sm text-navy-500">
                    A carregar detalhe do sinistro...
                  </div>
                ) : claimWorkspace ? (
                  <AdminClaimWorkspace
                    key={claimWorkspace.claim.id}
                    workspace={claimWorkspace}
                    companyUsers={companyUsers}
                    onUpdated={async () => {
                      await reload()
                      if (selectedClaimId) {
                        const fresh = await fetchClaimWorkspace({ data: { claimId: selectedClaimId } })
                        setClaimWorkspace(fresh as any)
                      }
                    }}
                  />
                ) : (
                  <div className="mt-4 bg-white border border-navy-200 rounded-[4px] p-6 text-sm text-navy-500">
                    Selecionar um sinistro para abrir o detalhe operacional.
                  </div>
                )}
              </div>
            )}

            {tab === 'api' && (
              <div>
                <h2 className="text-lg font-semibold text-navy-700 mb-2">API & Ligações</h2>
                <p className="text-sm text-navy-500 mb-6">Serviços externos integrados na plataforma Adler Pro. Todas as chaves são configuradas como variáveis de ambiente no Netlify.</p>
                <div className="grid gap-4 mb-6">
                  {apiConnections.map((api) => (
                    <div key={api.id} className="bg-white rounded-[4px] border border-navy-200 p-5">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <h3 className="font-bold text-navy-700">{api.service}</h3>
                          <p className="text-xs text-navy-500">Endpoint: {api.endpoint}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={api.status}
                            onChange={async (e) => {
                              await adminUpdateApiConnection({ data: { id: api.id, updates: { status: e.target.value } } })
                              await reload()
                            }}
                            className="px-2 py-1 text-xs border border-navy-200 rounded"
                          >
                            <option value="connected">Ligado</option>
                            <option value="degraded">Degradado</option>
                            <option value="error">Erro</option>
                          </select>
                          <button
                            onClick={async () => {
                              await adminRefreshApiConnection({ data: { id: api.id } })
                              await reload()
                            }}
                            className="px-3 py-1.5 text-xs bg-gold-400 text-navy-700 rounded hover:bg-gold-300"
                          >
                            Atualizar Dados
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 text-sm text-navy-600 grid sm:grid-cols-3 gap-2">
                        <p><strong>Estado:</strong> {api.status}</p>
                        <p><strong>Latência:</strong> {api.latency}</p>
                        <p><strong>Última Sincronização:</strong> {formatDate(api.lastSync)}</p>
                      </div>
                    </div>
                  ))}
                  {apiConnections.length === 0 && (
                    <div className="bg-white rounded-[4px] border border-navy-200 p-5 text-sm text-navy-500">
                      Nenhuma ligação dinâmica encontrada em `api_connections`.
                    </div>
                  )}
                </div>

                <InvoiceExpressStatus apiConnections={apiConnections} />

                <div className="grid gap-4 mt-6">

                  {/* Anthropic Claude */}
                  <div className="bg-white rounded-[4px] border border-navy-200 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div style={{width:36,height:36,borderRadius:4,background:'#111',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                          <span style={{color:'#C8961A',fontWeight:700,fontSize:13}}>AI</span>
                        </div>
                        <div>
                          <h3 className="font-bold text-navy-700">Anthropic Claude</h3>
                          <p className="text-xs text-navy-500">Modelo: claude-3-5-haiku-20241022 · api.anthropic.com/v1</p>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span> Activo
                      </span>
                    </div>
                    <div className="mt-3 text-xs text-navy-500 bg-navy-50 rounded p-3">
                      <strong>Utilização:</strong> Extracção de dados de apólices por IA, comparativo de cotações, análise de risco de parceiros.<br/>
                      <strong>Variável Netlify:</strong> <code className="bg-navy-100 px-1 rounded">ANTHROPIC_API_KEY</code>
                    </div>
                  </div>

                  {/* IPMA */}
                  <div className="bg-white rounded-[4px] border border-navy-200 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div style={{width:36,height:36,borderRadius:4,background:'#2563eb',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                          <span style={{color:'#fff',fontWeight:700,fontSize:13}}>☁</span>
                        </div>
                        <div>
                          <h3 className="font-bold text-navy-700">IPMA — Instituto Português do Mar e da Atmosfera</h3>
                          <p className="text-xs text-navy-500">API pública gratuita · api.ipma.pt/open-data</p>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span> Activo
                      </span>
                    </div>
                    <div className="mt-3 text-xs text-navy-500 bg-navy-50 rounded p-3">
                      <strong>Utilização:</strong> Previsão meteorológica por localidade (36 cidades), avaliação de risco climático, certificados meteorológicos para sinistros.<br/>
                      <strong>Variável Netlify:</strong> Nenhuma (API pública sem chave)
                    </div>
                  </div>

                  {/* BizAPIs */}
                  <div className="bg-white rounded-[4px] border border-navy-200 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div style={{width:36,height:36,borderRadius:4,background:'#C8961A',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                          <span style={{color:'#fff',fontWeight:700,fontSize:13}}>BZ</span>
                        </div>
                        <div>
                          <h3 className="font-bold text-navy-700">BizAPIs — Dados Empresariais AT & Registo Comercial</h3>
                          <p className="text-xs text-navy-500">nifName (AT) + CPRC (Registo Comercial) + Matrículas · apigwws.bizapis.com</p>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span> Activo
                      </span>
                    </div>
                    <div className="mt-3 text-xs text-navy-500 bg-navy-50 rounded p-3">
                      <strong>Utilização:</strong> Risco de Parceiros (validação NIF, sócios, capital, CAE, penhoras) e consulta de Matrículas (marca, modelo, ano, combustível).<br/>
                      <strong>Variável Netlify:</strong> <code className="bg-navy-100 px-1 rounded">BIZAPIS_KEY</code>
                    </div>
                  </div>

                  {/* Resend */}
                  <div className="bg-white rounded-[4px] border border-navy-200 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div style={{width:36,height:36,borderRadius:4,background:'#111',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                          <span style={{color:'#fff',fontWeight:700,fontSize:13}}>✉</span>
                        </div>
                        <div>
                          <h3 className="font-bold text-navy-700">Resend — Email Transaccional</h3>
                          <p className="text-xs text-navy-500">Remetente: noreply@adlerrochefort.com · api.resend.com/v1</p>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span> Activo
                      </span>
                    </div>
                    <div className="mt-3 text-xs text-navy-500 bg-navy-50 rounded p-3">
                      <strong>Utilização:</strong> Alertas automáticos de renovação de apólices por email. Disparado a partir do painel Admin → Alertas.<br/>
                      <strong>Variável Netlify:</strong> <code className="bg-navy-100 px-1 rounded">RESEND_API_KEY</code>
                    </div>
                  </div>

                  {/* Supabase */}
                  <div className="bg-white rounded-[4px] border border-navy-200 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div style={{width:36,height:36,borderRadius:4,background:'#059669',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                          <span style={{color:'#fff',fontWeight:700,fontSize:13}}>SB</span>
                        </div>
                        <div>
                          <h3 className="font-bold text-navy-700">Supabase — Base de Dados & Autenticação</h3>
                          <p className="text-xs text-navy-500">PostgreSQL + Auth + Storage · VITE_SUPABASE_URL</p>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span> Activo
                      </span>
                    </div>
                    <div className="mt-3 text-xs text-navy-500 bg-navy-50 rounded p-3">
                      <strong>Utilização:</strong> Toda a persistência de dados — empresas, utilizadores, apólices, sinistros, documentos, alertas.<br/>
                      <strong>Variáveis Netlify:</strong> <code className="bg-navy-100 px-1 rounded">VITE_SUPABASE_URL</code> · <code className="bg-navy-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code> · <code className="bg-navy-100 px-1 rounded">SUPABASE_SERVICE_ROLE_KEY</code>
                    </div>
                  </div>

                </div>
              </div>
            )}

            {tab === 'profiles' && (
              <div>
                <h2 className="text-lg font-semibold text-navy-700 mb-4">Perfis e Métricas de Acesso</h2>
                <div className="bg-white rounded-[4px] border border-navy-200 overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-navy-50 border-b border-navy-200">
                        <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 uppercase">Utilizador</th>
                        <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 uppercase">Empresa</th>
                        <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 uppercase">Cargo</th>
                        <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 uppercase">Último Acesso</th>
                        <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 uppercase">Acessos (Mês)</th>
                        <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 uppercase">Eventos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-navy-100">
                      {metricsByUser.map((profile) => {
                        const company = companies.find((companyItem) => companyItem.id === profile.companyId)
                        return (
                          <tr key={profile.id} className="hover:bg-navy-50/50">
                            <td className="px-6 py-4 text-sm font-medium text-navy-700">{profile.name}</td>
                            <td className="px-6 py-4 text-sm text-navy-500">{company?.name || '-'}</td>
                            <td className="px-6 py-4 text-sm text-navy-500 capitalize">{profile.role}</td>
                            <td className="px-6 py-4 text-sm text-navy-500">{profile.lastLoginAt ? formatDate(profile.lastLoginAt) : '-'}</td>
                            <td className="px-6 py-4 text-sm font-medium text-navy-700">{profile.loginsThisMonth}</td>
                            <td className="px-6 py-4 text-sm text-navy-500">{profile.events.length}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'social' && (
              <SocialHubTab
                posts={socialPosts}
                onRefresh={async () => { const sp = await fetchSocialPosts(); setSocialPosts(sp ?? []) }}
              />
            )}

            {tab === 'alerts' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-navy-700">Apólices a Terminar (60 dias)</h2>
                  <SendRenewalAlertsButton />
                </div>
                {expiringPolicies.length === 0 ? (
                  <p className="text-navy-500">Não existem apólices a terminar nos próximos 60 dias.</p>
                ) : (
                  <div className="grid gap-4">
                    {expiringPolicies.map((p) => {
                      const company = companies.find((c) => c.id === p.companyId)
                      const endDate = new Date(p.endDate)
                      const now = new Date()
                      const diffTime = Math.abs(endDate.getTime() - now.getTime())
                      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

                      return (
                        <div key={p.id} className="bg-white rounded-[4px] border border-red-200 p-6 flex items-start gap-4">
                          <div className="w-10 h-10 rounded-full bg-red-100 flex flex-shrink-0 items-center justify-center text-red-600">!</div>
                          <div>
                            <h3 className="text-md font-bold text-navy-700">
                              {company?.name || 'Cliente Desconhecido'} - {POLICY_TYPE_LABELS[p.type]}
                            </h3>
                            <p className="text-sm text-navy-600 mt-1">
                              A apólice <strong>{p.policyNumber}</strong> da seguradora {p.insurer} expira em <strong>{diffDays} dias</strong> ({formatDate(p.endDate)}).
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  )
}

function AdminDashboardTab({
  companies,
  companyUsers,
  policies,
  claims,
  documents,
  individualClients,
  socialPosts,
  apiConnections,
}: {
  companies: Company[]
  companyUsers: CompanyUser[]
  policies: Policy[]
  claims: Claim[]
  documents: DocType[]
  individualClients: IndividualClient[]
  socialPosts: SocialPost[]
  apiConnections: ApiConnection[]
}) {
  const openClaims = claims.filter((c) => c.status !== 'paid' && c.status !== 'denied')
  const connectedApis = apiConnections.filter((a) => a.status === 'connected').length
  const scheduledPosts = socialPosts.filter((p) => p.status === 'scheduled').length
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getUTCFullYear())
  const [selectedMonth, setSelectedMonth] = useState<string>('')
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('')
  const [selectedInsurer, setSelectedInsurer] = useState<string>('')
  const [timelineMode, setTimelineMode] = useState<'historical' | 'projection'>('historical')
  const [drillDownMonth, setDrillDownMonth] = useState<number | null>(null)
  const [financialData, setFinancialData] = useState<AdminFinancialDashboardData | null>(null)
  const [financialLoading, setFinancialLoading] = useState(false)
  const [renewalAlerts, setRenewalAlerts] = useState<RenewalAlertsResponse | null>(null)
  const [renewalAlertsLoading, setRenewalAlertsLoading] = useState(false)
  const [updatingRenewalAlertKey, setUpdatingRenewalAlertKey] = useState<string | null>(null)
  const [draggingAlertKey, setDraggingAlertKey] = useState<string | null>(null)
  const [activeDropColumn, setActiveDropColumn] = useState<RenewalKanbanColumnId | null>(null)
  const [renewalRiskMinValue, setRenewalRiskMinValue] = useState<string>('')
  const [assigneeDraftByKey, setAssigneeDraftByKey] = useState<Record<string, string>>({})
  const [nextActionDraftByKey, setNextActionDraftByKey] = useState<Record<string, string>>({})

  useEffect(() => {
    let active = true
    setFinancialLoading(true)
    fetchAdminFinancialDashboard({
      data: {
        year: selectedYear,
        month: selectedMonth ? Number(selectedMonth) : undefined,
        companyId: selectedCompanyId || undefined,
        insurer: selectedInsurer || undefined,
      },
    })
      .then((result) => {
        if (!active) return
        setFinancialData(result)
      })
      .catch((error) => {
        console.error('[AdminDashboardTab] fetchAdminFinancialDashboard error:', error)
        if (!active) return
        setFinancialData(null)
      })
      .finally(() => {
        if (!active) return
        setFinancialLoading(false)
      })

    return () => {
      active = false
    }
  }, [selectedYear, selectedMonth, selectedCompanyId, selectedInsurer])

  useEffect(() => {
    setDrillDownMonth(selectedMonth ? Number(selectedMonth) : null)
  }, [selectedMonth])

  useEffect(() => {
    let active = true
    setRenewalAlertsLoading(true)
    getRenewalAlerts()
      .then((result) => {
        if (!active) return
        setRenewalAlerts(result)
      })
      .catch((error) => {
        console.error('[AdminDashboardTab] getRenewalAlerts error:', error)
        if (!active) return
        setRenewalAlerts(null)
      })
      .finally(() => {
        if (!active) return
        setRenewalAlertsLoading(false)
      })

    return () => {
      active = false
    }
  }, [policies])

  const reloadRenewalAlerts = async () => {
    setRenewalAlertsLoading(true)
    try {
      const result = await getRenewalAlerts()
      setRenewalAlerts(result)
    } catch (error) {
      console.error('[AdminDashboardTab] reloadRenewalAlerts error:', error)
      setRenewalAlerts(null)
    } finally {
      setRenewalAlertsLoading(false)
    }
  }

  const handleRenewalAlertStatusUpdate = async (
    key: string,
    updates: { status?: RenewalAlertStatus; assignedTo?: string | null; nextAction?: string | null }
  ) => {
    setUpdatingRenewalAlertKey(key)
    try {
      await adminUpdateRenewalAlertStatus({ data: { key, ...updates } })
      await reloadRenewalAlerts()
    } catch (error) {
      console.error('[AdminDashboardTab] adminUpdateRenewalAlertStatus error:', error)
      alert('Não foi possível atualizar o estado do alerta.')
      await reloadRenewalAlerts()
    } finally {
      setUpdatingRenewalAlertKey(null)
    }
  }

  const renewalAlertsView = useMemo(() => {
    if (!renewalAlerts) return null
    const minValue = Number(renewalRiskMinValue)
    if (!Number.isFinite(minValue) || minValue <= 0) return renewalAlerts

    const filteredAlerts = renewalAlerts.alerts.filter((alert) => alert.value >= minValue)
    const derived = buildRenewalAlertsView(filteredAlerts)
    return {
      ...renewalAlerts,
      alerts: filteredAlerts,
      byUrgency: derived.byUrgency,
      total: derived.total,
      summary: derived.summary,
    }
  }, [renewalAlerts, renewalRiskMinValue])

  const renewalAlertsByColumn = useMemo(() => {
    const grouped: Record<RenewalKanbanColumnId, RenewalAlertsResponse['alerts']> = {
      pending: [],
      negotiating: [],
      renewed: [],
    }

    for (const alert of renewalAlertsView?.alerts ?? []) {
      grouped[renewalColumnByStatus(alert.status)].push(alert)
    }

    for (const column of Object.keys(grouped) as RenewalKanbanColumnId[]) {
      grouped[column].sort((a, b) => {
        if (a.value !== b.value) return b.value - a.value
        return a.daysUntilRenewal - b.daysUntilRenewal
      })
    }

    return grouped
  }, [renewalAlertsView])

  const renewalIntelligence = useMemo(
    () => buildRenewalPipelineIntelligence(renewalAlertsView?.alerts ?? []),
    [renewalAlertsView]
  )

  const responsibleOptions = useMemo(() => {
    const unique = new Map<string, string>()
    for (const user of companyUsers) {
      const email = user.email?.trim()
      if (!email) continue
      if (!unique.has(email)) unique.set(email, user.name?.trim() || email)
    }
    return Array.from(unique.entries())
      .map(([email, name]) => ({ email, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [companyUsers])

  const responsibleLabelMap = useMemo(
    () => new Map(responsibleOptions.map((item) => [item.email, item.name])),
    [responsibleOptions]
  )

  const monthSelectOptions = [
    { value: '', label: 'Ano completo' },
    { value: '1', label: 'Janeiro' },
    { value: '2', label: 'Fevereiro' },
    { value: '3', label: 'Março' },
    { value: '4', label: 'Abril' },
    { value: '5', label: 'Maio' },
    { value: '6', label: 'Junho' },
    { value: '7', label: 'Julho' },
    { value: '8', label: 'Agosto' },
    { value: '9', label: 'Setembro' },
    { value: '10', label: 'Outubro' },
    { value: '11', label: 'Novembro' },
    { value: '12', label: 'Dezembro' },
  ]

  const visibleTimeline = financialData
    ? financialData.timeline.filter((point) =>
        timelineMode === 'historical' ? point.isHistorical : point.isProjected
      )
    : []
  const drillMonthValue = drillDownMonth ?? (selectedMonth ? Number(selectedMonth) : null)
  const selectedMonthDetails = financialData?.monthlyDetails.find((monthItem) => monthItem.month === drillMonthValue)

  return (
    <div>
      <h2 className="text-lg font-semibold text-navy-700 mb-4">Dashboard Administração</h2>
      <div className="bg-white rounded-[4px] border border-navy-200 p-4 mb-6">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-sm text-navy-600">
            <span className="block text-xs uppercase tracking-wide text-navy-500 mb-1">Ano</span>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="w-full px-3 py-2 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400"
            >
              {(financialData?.availableFilters.years ?? [selectedYear]).map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-navy-600">
            <span className="block text-xs uppercase tracking-wide text-navy-500 mb-1">Mês</span>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full px-3 py-2 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400"
            >
              {monthSelectOptions.map((monthOption) => (
                <option key={monthOption.value || 'all'} value={monthOption.value}>{monthOption.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-navy-600">
            <span className="block text-xs uppercase tracking-wide text-navy-500 mb-1">Empresa</span>
            <select
              value={selectedCompanyId}
              onChange={(e) => setSelectedCompanyId(e.target.value)}
              className="w-full px-3 py-2 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400"
            >
              <option value="">Todas</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>{company.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-navy-600">
            <span className="block text-xs uppercase tracking-wide text-navy-500 mb-1">Seguradora</span>
            <select
              value={selectedInsurer}
              onChange={(e) => setSelectedInsurer(e.target.value)}
              className="w-full px-3 py-2 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400"
            >
              <option value="">Todas</option>
              {(financialData?.availableFilters.insurers ?? []).map((insurer) => (
                <option key={insurer} value={insurer}>{insurer}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <MetricCard
          label="Prémios Totais"
          value={financialLoading || !financialData ? '...' : formatCurrency(financialData.summary.totalPremiums)}
          help={selectedMonth ? 'Valor do mês selecionado' : 'Soma anual distribuída por fracionamento'}
          momDeltaPct={financialData?.summary.comparisons.totalPremiums.momDeltaPct ?? null}
          yoyDeltaPct={financialData?.summary.comparisons.totalPremiums.yoyDeltaPct ?? null}
        />
        <MetricCard
          label="Comissões Totais"
          value={financialLoading || !financialData ? '...' : formatCurrency(financialData.summary.totalCommissions)}
          help={selectedMonth ? 'Comissão distribuída no mês' : 'Comissões distribuídas no ano'}
          momDeltaPct={financialData?.summary.comparisons.totalCommissions.momDeltaPct ?? null}
          yoyDeltaPct={financialData?.summary.comparisons.totalCommissions.yoyDeltaPct ?? null}
        />
        <MetricCard
          label="Comissões Previstas"
          value={financialLoading || !financialData ? '...' : formatCurrency(financialData.summary.projectedCommissions)}
          help="Cashflow futuro com base no fracionamento"
          momDeltaPct={financialData?.summary.comparisons.projectedCommissions.momDeltaPct ?? null}
          yoyDeltaPct={financialData?.summary.comparisons.projectedCommissions.yoyDeltaPct ?? null}
        />
        <MetricCard
          label="Apólices Ativas"
          value={financialLoading || !financialData ? '...' : financialData.summary.activePolicies}
          help="Ativas no período de referência"
          momDeltaPct={financialData?.summary.comparisons.activePolicies.momDeltaPct ?? null}
          yoyDeltaPct={financialData?.summary.comparisons.activePolicies.yoyDeltaPct ?? null}
        />
      </div>

      <div className="bg-white rounded-[4px] border border-navy-200 p-5 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-navy-700">Prémios vs Comissões (linha temporal mensal)</h3>
          <div className="inline-flex rounded border border-navy-200 overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setTimelineMode('historical')}
              className={`px-3 py-1.5 ${timelineMode === 'historical' ? 'bg-navy-700 text-white' : 'bg-white text-navy-600 hover:bg-navy-50'}`}
            >
              Histórico
            </button>
            <button
              type="button"
              onClick={() => setTimelineMode('projection')}
              className={`px-3 py-1.5 border-l border-navy-200 ${timelineMode === 'projection' ? 'bg-gold-400 text-navy-700 font-semibold' : 'bg-white text-navy-600 hover:bg-navy-50'}`}
            >
              Projeção
            </button>
          </div>
        </div>
        {financialData ? (
          visibleTimeline.length > 0 ? (
            <FinancialTimelineChart
              timeline={visibleTimeline}
              onSelectMonth={(month) => setDrillDownMonth(month)}
              selectedMonth={drillMonthValue}
            />
          ) : (
            <p className="text-sm text-navy-400">
              {timelineMode === 'historical'
                ? 'Sem histórico para o período selecionado.'
                : 'Sem projeção futura para o período selecionado.'}
            </p>
          )
        ) : (
          <p className="text-sm text-navy-400">{financialLoading ? 'A calcular cashflow...' : 'Sem dados financeiros para os filtros selecionados.'}</p>
        )}
      </div>

      <div className="bg-white rounded-[4px] border border-navy-200 p-5 mb-6">
        <h3 className="text-sm font-semibold text-navy-700 mb-3">Meses com Maior Receita Prevista</h3>
        {financialData?.projectionHighlights.length ? (
          <div className="grid sm:grid-cols-3 gap-3">
            {financialData.projectionHighlights.map((monthItem, index) => (
              <button
                type="button"
                key={monthItem.monthKey}
                onClick={() => setDrillDownMonth(monthItem.month)}
                className="text-left bg-amber-50 border border-amber-200 rounded px-3 py-2 hover:bg-amber-100 transition-colors"
              >
                <p className="text-xs text-amber-700 uppercase tracking-wide">Top {index + 1}</p>
                <p className="text-sm font-semibold text-navy-700 mt-1">{monthItem.label} {selectedYear}</p>
                <p className="text-xs text-navy-600 mt-1">Comissões: {formatCurrency(monthItem.commissions)}</p>
                <p className="text-xs text-navy-500">Prémios: {formatCurrency(monthItem.premiums)}</p>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-navy-400">Não existem meses futuros com receita prevista para os filtros aplicados.</p>
        )}
      </div>

      <div className="bg-white rounded-[4px] border border-navy-200 p-5 mb-6">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-navy-700">Drill-down por Mês (Apólices)</h3>
          <select
            value={drillMonthValue ?? ''}
            onChange={(e) => setDrillDownMonth(e.target.value ? Number(e.target.value) : null)}
            className="px-3 py-1.5 border border-navy-200 rounded-[2px] text-xs focus:outline-none focus:ring-2 focus:ring-gold-400"
          >
            <option value="">Selecionar mês</option>
            {monthSelectOptions.filter((item) => item.value).map((item) => (
              <option key={`drill_${item.value}`} value={item.value}>{item.label}</option>
            ))}
          </select>
        </div>
        {!selectedMonthDetails ? (
          <p className="text-sm text-navy-400">Selecione um mês para ver o detalhe de apólices distribuídas.</p>
        ) : selectedMonthDetails.policies.length === 0 ? (
          <p className="text-sm text-navy-400">Sem apólices com movimento financeiro em {selectedMonthDetails.label}.</p>
        ) : (
          <div className="space-y-3">
            <div className="bg-navy-50 border border-navy-100 rounded px-3 py-2 text-xs text-navy-600">
              <p><strong>{selectedMonthDetails.label} {selectedYear}</strong> · {selectedMonthDetails.policiesCount} apólices</p>
              <p>Prémios distribuídos: {formatCurrency(selectedMonthDetails.premiums)} · Comissões distribuídas: {formatCurrency(selectedMonthDetails.commissions)}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="bg-navy-50 border-b border-navy-200">
                    <th className="text-left px-3 py-2 text-xs font-semibold text-navy-500 uppercase">Apólice</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-navy-500 uppercase">Seguradora</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-navy-500 uppercase">Cliente</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-navy-500 uppercase">Fracionamento</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-navy-500 uppercase">Prémio</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-navy-500 uppercase">Comissão</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {selectedMonthDetails.policies.map((policyItem) => (
                    <tr key={`${selectedMonthDetails.monthKey}_${policyItem.policyId}`}>
                      <td className="px-3 py-2 text-xs text-navy-700">
                        <p className="font-semibold">{policyItem.policyNumber}</p>
                        <p className="text-navy-500">{POLICY_TYPE_LABELS[policyItem.type as keyof typeof POLICY_TYPE_LABELS] ?? policyItem.type}</p>
                      </td>
                      <td className="px-3 py-2 text-xs text-navy-600">{policyItem.insurer}</td>
                      <td className="px-3 py-2 text-xs text-navy-600">{companies.find((company) => company.id === policyItem.companyId)?.name ?? '—'}</td>
                      <td className="px-3 py-2 text-xs text-navy-600">{policyItem.paymentFrequency || 'anual'}</td>
                      <td className="px-3 py-2 text-xs text-navy-600">{formatCurrency(policyItem.premium)}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-navy-700">{formatCurrency(policyItem.commission)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-[4px] border border-navy-200 p-5">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
            <h3 className="text-sm font-semibold text-navy-700">Pipeline de Renovações</h3>
            <label className="text-xs text-navy-600">
              <span className="block mb-1">Filtro por valor mínimo (€)</span>
              <input
                type="number"
                min={0}
                step={100}
                value={renewalRiskMinValue}
                onChange={(event) => setRenewalRiskMinValue(event.target.value)}
                placeholder="Top risco financeiro"
                className="w-44 px-2 py-1.5 border border-navy-200 rounded-[2px] text-xs focus:outline-none focus:ring-2 focus:ring-gold-400"
              />
            </label>
          </div>
          {renewalAlertsLoading ? (
            <p className="text-sm text-navy-400">A carregar alertas de renovação...</p>
          ) : renewalAlertsView && renewalAlertsView.total > 0 ? (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-2">
                <div className="rounded border border-navy-200 bg-navy-50 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-navy-500">Número de renovações</p>
                  <p className="text-base font-semibold text-navy-700">{renewalAlertsView.summary.totalRenewals}</p>
                </div>
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-red-500">Valor total em risco</p>
                  <p className="text-base font-semibold text-red-700">{formatCurrency(renewalAlertsView.summary.totalValueAtRisk)}</p>
                </div>
              </div>
              <div className="grid xl:grid-cols-3 gap-2">
                <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-emerald-600">Taxa de renovação</p>
                  <p className="text-base font-semibold text-emerald-700">{formatPctValue(renewalIntelligence.renewalRatePct)}</p>
                  <p className="text-[11px] text-emerald-700/80">
                    {renewalIntelligence.renewedCount} renovadas de {renewalIntelligence.totalAlerts}
                  </p>
                </div>
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-amber-600">Tempo médio pending → renewed</p>
                  <p className="text-base font-semibold text-amber-700">
                    {renewalIntelligence.avgDaysPendingToRenewed === null
                      ? 'n/d'
                      : `${renewalIntelligence.avgDaysPendingToRenewed.toFixed(1)} dias`}
                  </p>
                  <p className="text-[11px] text-amber-700/80">
                    Base: {renewalIntelligence.avgDaysSampleSize} transições completas
                  </p>
                </div>
                <div className="rounded border border-navy-200 bg-navy-50 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-navy-500">Casos em risco</p>
                  <p className="text-base font-semibold text-navy-700">{renewalIntelligence.pendingOrNegotiatingCount}</p>
                  <p className="text-[11px] text-navy-600">Ainda não renovadas</p>
                </div>
              </div>
              <div className="grid xl:grid-cols-3 gap-2">
                {renewalIntelligence.valueAtRiskByPeriod.map((period) => (
                  <div key={period.urgency} className="rounded border border-red-200 bg-red-50 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-red-500">Risco D-{period.urgency}</p>
                    <p className="text-base font-semibold text-red-700">{formatCurrency(period.valueAtRisk)}</p>
                    <p className="text-[11px] text-red-600/90">{period.alertsCount} apólices em risco</p>
                  </div>
                ))}
              </div>
              <div className="rounded border border-navy-200 bg-white px-3 py-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-navy-700 mb-2">
                  Clientes com maior risco financeiro
                </h4>
                {renewalIntelligence.topRiskClients.length === 0 ? (
                  <p className="text-[11px] text-navy-500">Sem clientes em risco no período atual.</p>
                ) : (
                  <div className="space-y-1.5">
                    {renewalIntelligence.topRiskClients.map((client, index) => (
                      <div key={`${client.client}_${client.company}`} className="flex items-center justify-between gap-2 text-[11px] text-navy-600">
                        <p>
                          <strong className="text-navy-700">#{index + 1}</strong> {client.client} <span className="text-navy-400">({client.company})</span>
                        </p>
                        <p className="font-semibold text-red-700">
                          {formatCurrency(client.valueAtRisk)} · {client.policiesCount} apólices
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded border border-gold-200 bg-gold-50 px-3 py-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-navy-700 mb-2">
                  Insights automáticos
                </h4>
                <div className="space-y-1.5">
                  {renewalIntelligence.insights.map((insight, index) => (
                    <p key={`insight_${index}`} className="text-[11px] text-navy-700">
                      {insight}
                    </p>
                  ))}
                </div>
              </div>
              <div className="grid xl:grid-cols-3 gap-3">
                {RENEWAL_KANBAN_COLUMNS.map((column) => {
                  const items = renewalAlertsByColumn[column.id]
                  const columnValue = items.reduce((sum, alert) => sum + alert.value, 0)

                  return (
                    <section
                      key={column.id}
                      className={`rounded-[4px] border p-3 bg-navy-50/60 transition-colors ${
                        activeDropColumn === column.id ? 'border-gold-400 bg-gold-50/60' : 'border-navy-200'
                      }`}
                      onDragOver={(event) => {
                        if (!draggingAlertKey) return
                        event.preventDefault()
                        setActiveDropColumn(column.id)
                      }}
                      onDragLeave={() => {
                        if (!draggingAlertKey) return
                        setActiveDropColumn((current) => (current === column.id ? null : current))
                      }}
                      onDrop={async (event) => {
                        event.preventDefault()
                        const droppedKey = event.dataTransfer.getData('text/plain')
                        setActiveDropColumn(null)
                        setDraggingAlertKey(null)
                        if (!droppedKey) return
                        await handleRenewalAlertStatusUpdate(droppedKey, { status: RENEWAL_KANBAN_TARGET_STATUS[column.id] })
                      }}
                    >
                      <div className="mb-2">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-navy-700">{column.title}</h4>
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-navy-200 text-navy-700 font-semibold">
                            {items.length}
                          </span>
                        </div>
                        <p className="text-[11px] text-navy-500 mt-1">Total: {formatCurrency(columnValue)}</p>
                      </div>

                      {items.length === 0 ? (
                        <p className="text-[11px] text-navy-400 rounded border border-dashed border-navy-200 bg-white px-2 py-2">
                          Sem apólices nesta coluna.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {items.map((alert) => {
                            const urgencyPalette =
                              alert.urgency === 30
                                ? {
                                    border: 'border-red-300',
                                    badge: 'bg-red-100 text-red-700',
                                  }
                                : alert.urgency === 60
                                  ? {
                                      border: 'border-amber-300',
                                      badge: 'bg-amber-100 text-amber-700',
                                    }
                                  : {
                                      border: 'border-blue-300',
                                      badge: 'bg-blue-100 text-blue-700',
                                    }

                            const nextStatusActions: Array<{ label: string; status: RenewalAlertStatus; className: string }> = []
                            if (renewalColumnByStatus(alert.status) !== 'pending') {
                              nextStatusActions.push({
                                label: 'Mover para pending',
                                status: 'pendente',
                                className: 'border-navy-200 text-navy-700 bg-white hover:bg-navy-50',
                              })
                            }
                            if (renewalColumnByStatus(alert.status) !== 'negotiating') {
                              nextStatusActions.push({
                                label: 'Mover para negotiating',
                                status: 'em_negociacao',
                                className: 'border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100',
                              })
                            }
                            if (renewalColumnByStatus(alert.status) !== 'renewed') {
                              nextStatusActions.push({
                                label: 'Mover para renewed',
                                status: 'renovado',
                                className: 'border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100',
                              })
                            }

                            return (
                              <article
                                key={alert.key}
                                draggable={updatingRenewalAlertKey !== alert.key}
                                onDragStart={(event) => {
                                  event.dataTransfer.setData('text/plain', alert.key)
                                  event.dataTransfer.effectAllowed = 'move'
                                  setDraggingAlertKey(alert.key)
                                }}
                                onDragEnd={() => {
                                  setDraggingAlertKey(null)
                                  setActiveDropColumn(null)
                                }}
                                className={`text-xs text-navy-700 rounded border bg-white p-2 ${urgencyPalette.border} ${
                                  updatingRenewalAlertKey === alert.key ? 'opacity-70' : ''
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <p className="font-semibold">{alert.client}</p>
                                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${urgencyPalette.badge}`}>
                                    D-{alert.urgency}
                                  </span>
                                </div>
                                <p className="text-navy-600 mt-0.5">
                                  {alert.company} · {POLICY_TYPE_LABELS[alert.policyType]}
                                </p>
                                <p className="text-navy-600 mt-0.5">
                                  {alert.insurer} · {formatCurrency(alert.value)}
                                </p>
                                <p className="text-navy-500 mt-0.5">
                                  Apólice {alert.policyNumber} · Renovação em {alert.daysUntilRenewal} dias ({formatDate(alert.renewalDate)})
                                </p>
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                  {nextStatusActions.map((action) => (
                                    <button
                                      key={action.status}
                                      type="button"
                                      className={`px-2 py-1 text-[11px] rounded border disabled:opacity-50 ${action.className}`}
                                      disabled={updatingRenewalAlertKey === alert.key}
                                      onClick={() => handleRenewalAlertStatusUpdate(alert.key, { status: action.status })}
                                    >
                                      {action.label}
                                    </button>
                                  ))}
                                </div>
                                <div className="mt-2 rounded border border-navy-100 bg-navy-50/60 p-2 space-y-2">
                                  <div>
                                    <label className="text-[11px] text-navy-600">Responsável</label>
                                    <div className="flex gap-1.5 mt-1">
                                      <input
                                        list={`responsible_${alert.key}`}
                                        value={assigneeDraftByKey[alert.key] ?? alert.assignedTo ?? ''}
                                        onChange={(event) => {
                                          const value = event.target.value
                                          setAssigneeDraftByKey((current) => ({ ...current, [alert.key]: value }))
                                        }}
                                        placeholder="Email do responsável"
                                        className="flex-1 px-2 py-1 text-[11px] border border-navy-200 rounded-[2px] bg-white focus:outline-none focus:ring-2 focus:ring-gold-400"
                                      />
                                      <datalist id={`responsible_${alert.key}`}>
                                        {responsibleOptions.map((option) => (
                                          <option key={`${alert.key}_${option.email}`} value={option.email}>
                                            {option.name}
                                          </option>
                                        ))}
                                      </datalist>
                                      <button
                                        type="button"
                                        disabled={updatingRenewalAlertKey === alert.key}
                                        onClick={() => handleRenewalAlertStatusUpdate(alert.key, { assignedTo: assigneeDraftByKey[alert.key] ?? alert.assignedTo ?? null })}
                                        className="px-2 py-1 text-[11px] rounded border border-navy-200 bg-white text-navy-700 hover:bg-navy-100 disabled:opacity-50"
                                      >
                                        Guardar
                                      </button>
                                    </div>
                                    <p className="text-[11px] text-navy-500 mt-1">
                                      Atual: <strong>{alert.assignedTo ? (responsibleLabelMap.get(alert.assignedTo) ? `${responsibleLabelMap.get(alert.assignedTo)} (${alert.assignedTo})` : alert.assignedTo) : 'Sem responsável'}</strong>
                                    </p>
                                  </div>
                                  <div>
                                    <label className="text-[11px] text-navy-600">Próxima ação</label>
                                    <textarea
                                      value={nextActionDraftByKey[alert.key] ?? alert.nextAction ?? ''}
                                      onChange={(event) => {
                                        const value = event.target.value
                                        setNextActionDraftByKey((current) => ({ ...current, [alert.key]: value }))
                                      }}
                                      placeholder="Definir próxima ação para a apólice"
                                      rows={2}
                                      className="w-full mt-1 px-2 py-1 text-[11px] border border-navy-200 rounded-[2px] bg-white focus:outline-none focus:ring-2 focus:ring-gold-400 resize-y"
                                    />
                                    <div className="flex items-center justify-between mt-1">
                                      <p className="text-[11px] text-navy-500">
                                        Atual: <strong>{alert.nextAction || 'Sem ação definida'}</strong>
                                      </p>
                                      <button
                                        type="button"
                                        disabled={updatingRenewalAlertKey === alert.key}
                                        onClick={() => handleRenewalAlertStatusUpdate(alert.key, { nextAction: nextActionDraftByKey[alert.key] ?? alert.nextAction ?? null })}
                                        className="px-2 py-1 text-[11px] rounded border border-navy-200 bg-white text-navy-700 hover:bg-navy-100 disabled:opacity-50"
                                      >
                                        Guardar ação
                                      </button>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                  <Link
                                    to="/admin"
                                    search={{ tab: 'policies' }}
                                    className="px-2 py-1 text-[11px] rounded border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100"
                                  >
                                    Ver apólice
                                  </Link>
                                  {alert.contactEmail ? (
                                    <a
                                      href={`mailto:${alert.contactEmail}`}
                                      className="px-2 py-1 text-[11px] rounded border border-gold-300 text-navy-700 bg-gold-100 hover:bg-gold-200"
                                    >
                                      Contactar cliente
                                    </a>
                                  ) : alert.contactPhone ? (
                                    <a
                                      href={`tel:${alert.contactPhone}`}
                                      className="px-2 py-1 text-[11px] rounded border border-gold-300 text-navy-700 bg-gold-100 hover:bg-gold-200"
                                    >
                                      Contactar cliente
                                    </a>
                                  ) : (
                                    <span className="px-2 py-1 text-[11px] rounded border border-gray-200 text-gray-400 bg-gray-50">
                                      Sem contacto
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-navy-500 mt-2">
                                  Estado atual: <strong>{RENEWAL_ALERT_STATUS_LABELS[alert.status]}</strong>
                                </p>
                                <details className="mt-2 rounded border border-navy-100 bg-navy-50 px-2 py-1.5">
                                  <summary className="text-[11px] font-semibold text-navy-700 cursor-pointer">
                                    Histórico de alterações ({alert.history.length})
                                  </summary>
                                  <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
                                    {alert.history.length === 0 ? (
                                      <p className="text-[11px] text-navy-500">Sem histórico.</p>
                                    ) : (
                                      alert.history.map((entry) => (
                                        <div key={entry.id} className="text-[11px] text-navy-600 border-l-2 border-navy-200 pl-2 py-0.5">
                                          <p className="text-navy-700 font-medium">{formatDate(entry.changedAt)}</p>
                                          <p>
                                            Estado: <strong>{entry.previousStatus ? RENEWAL_ALERT_STATUS_LABELS[entry.previousStatus] : '—'}</strong> → <strong>{RENEWAL_ALERT_STATUS_LABELS[entry.newStatus]}</strong>
                                          </p>
                                          <p>
                                            Responsável: <strong>{entry.previousAssignedTo || '—'}</strong> → <strong>{entry.newAssignedTo || '—'}</strong>
                                          </p>
                                          <p>
                                            Próxima ação: <strong>{entry.previousNextAction || '—'}</strong> → <strong>{entry.newNextAction || '—'}</strong>
                                          </p>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </details>
                              </article>
                            )
                          })}
                        </div>
                      )}
                    </section>
                  )
                })}
              </div>
            </div>
          ) : (
            <p className="text-sm text-navy-400">
              {renewalRiskMinValue
                ? 'Sem alertas para o filtro de valor aplicado.'
                : 'Sem alertas ativos para D-90, D-60 ou D-30.'}
            </p>
          )}
        </div>

        <div className="bg-white rounded-[4px] border border-navy-200 p-5">
          <h3 className="text-sm font-semibold text-navy-700 mb-3">Resumo Operacional</h3>
          <div className="space-y-2 text-sm text-navy-600">
            <p>Empresas registadas: <strong>{companies.length}</strong></p>
            <p>Utilizadores empresariais: <strong>{companyUsers.length}</strong></p>
            <p>Clientes individuais: <strong>{individualClients.length}</strong></p>
            <p>Apólices totais: <strong>{policies.length}</strong></p>
            <p>Sinistros em aberto: <strong>{openClaims.length}</strong></p>
            <p>Ligações API ativas: <strong>{connectedApis}</strong> / {apiConnections.length}</p>
            <p>Documentos registados: <strong>{documents.length}</strong></p>
            <p>Posts sociais agendados: <strong>{scheduledPosts}</strong></p>
            <p>Posts sociais totais: <strong>{socialPosts.length}</strong></p>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'n/d'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

function deltaChipClass(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'bg-gray-100 text-gray-500 border border-gray-200'
  if (value >= 0) return 'bg-emerald-50 text-emerald-700 border border-emerald-200'
  return 'bg-rose-50 text-rose-700 border border-rose-200'
}

function MetricCard({
  label,
  value,
  help,
  momDeltaPct,
  yoyDeltaPct,
}: {
  label: string
  value: number | string
  help: string
  momDeltaPct: number | null
  yoyDeltaPct: number | null
}) {
  return (
    <div className="bg-white rounded-[4px] border border-navy-200 p-5">
      <p className="text-xs uppercase tracking-wide text-navy-500">{label}</p>
      <p className="text-3xl font-bold text-navy-700 mt-2">{value}</p>
      <p className="text-xs text-navy-500 mt-2">{help}</p>
      <div className="flex flex-wrap gap-2 mt-3">
        <span className={`inline-flex items-center px-2 py-1 rounded text-[11px] font-semibold ${deltaChipClass(momDeltaPct)}`}>
          MoM: {formatPct(momDeltaPct)}
        </span>
        <span className={`inline-flex items-center px-2 py-1 rounded text-[11px] font-semibold ${deltaChipClass(yoyDeltaPct)}`}>
          YoY: {formatPct(yoyDeltaPct)}
        </span>
      </div>
    </div>
  )
}

function FinancialTimelineChart({
  timeline,
  onSelectMonth,
  selectedMonth,
}: {
  timeline: AdminFinancialDashboardData['timeline']
  onSelectMonth: (month: number) => void
  selectedMonth: number | null
}) {
  if (timeline.length === 0) {
    return <p className="text-sm text-navy-400">Sem movimentos financeiros para o período selecionado.</p>
  }

  const width = 960
  const height = 280
  const paddingLeft = 48
  const paddingTop = 16
  const paddingRight = 16
  const paddingBottom = 34
  const plotWidth = width - paddingLeft - paddingRight
  const plotHeight = height - paddingTop - paddingBottom
  const maxValue = Math.max(
    1,
    ...timeline.map((point) => point.premiums),
    ...timeline.map((point) => point.commissions),
  )

  const x = (index: number) => (
    paddingLeft + (index * plotWidth) / Math.max(timeline.length - 1, 1)
  )
  const y = (value: number) => (
    paddingTop + plotHeight - (value / maxValue) * plotHeight
  )
  const premiumPath = timeline.map((point, index) => `${x(index)},${y(point.premiums)}`).join(' ')
  const commissionPath = timeline.map((point, index) => `${x(index)},${y(point.commissions)}`).join(' ')

  return (
    <div>
      <div className="flex flex-wrap items-center gap-5 text-xs text-navy-500 mb-3">
        <span className="inline-flex items-center gap-2"><span className="w-3 h-0.5 bg-navy-700 inline-block" /> Prémios</span>
        <span className="inline-flex items-center gap-2"><span className="w-3 h-0.5 bg-gold-400 inline-block" /> Comissões</span>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[760px]" role="img" aria-label="Gráfico mensal de prémios e comissões">
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const yPos = paddingTop + plotHeight * fraction
            return (
              <line
                key={`grid-${fraction}`}
                x1={paddingLeft}
                y1={yPos}
                x2={width - paddingRight}
                y2={yPos}
                stroke="#E5E7EB"
                strokeWidth="1"
              />
            )
          })}
          <polyline fill="none" stroke="#0B1E3A" strokeWidth="3" points={premiumPath} />
          <polyline fill="none" stroke="#C8961A" strokeWidth="3" points={commissionPath} />
          {timeline.map((point, index) => (
            <g
              key={point.monthKey}
              className="cursor-pointer"
              onClick={() => onSelectMonth(point.month)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectMonth(point.month)
                }
              }}
            >
              <circle cx={x(index)} cy={y(point.premiums)} r={selectedMonth === point.month ? '5' : '3.5'} fill="#0B1E3A" />
              <circle cx={x(index)} cy={y(point.commissions)} r={selectedMonth === point.month ? '5' : '3.5'} fill="#C8961A" />
              <text x={x(index)} y={height - 10} textAnchor="middle" fontSize="10" fill="#6B7280">
                {point.label}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 mt-3">
        {timeline.map((point) => (
          <button
            type="button"
            key={`${point.monthKey}_kpi`}
            onClick={() => onSelectMonth(point.month)}
            className={`text-left rounded px-3 py-2 text-xs border ${selectedMonth === point.month ? 'bg-amber-50 border-amber-200' : 'bg-navy-50 border-transparent'} text-navy-600`}
          >
            <p className="font-semibold text-navy-700">{point.label}</p>
            <p>Prémios: {formatCurrency(point.premiums)}</p>
            <p>Comissões: {formatCurrency(point.commissions)}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

function InvoiceExpressStatus({ apiConnections }: { apiConnections: ApiConnection[] }) {
  const invoiceExpressConnections = apiConnections.filter((api) => {
    const value = `${api.service} ${api.endpoint}`.toLowerCase()
    return value.includes('invoice express') || value.includes('invoiceexpress') || value.includes('fatur')
  })

  if (invoiceExpressConnections.length > 0) {
    return (
      <div className="bg-white rounded-[4px] border border-emerald-200 p-5">
        <h3 className="text-sm font-semibold text-emerald-700 mb-2">Invoice Express</h3>
        <p className="text-sm text-navy-600 mb-3">Foram encontradas ligações de faturação no estado dinâmico de `api_connections`.</p>
        <div className="space-y-2 text-sm">
          {invoiceExpressConnections.map((api) => (
            <p key={api.id} className="text-navy-600">
              <strong>{api.service}</strong> · {api.status} · {api.endpoint}
            </p>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-[4px] border border-amber-200 p-5">
      <h3 className="text-sm font-semibold text-amber-700 mb-2">Invoice Express</h3>
      <p className="text-sm text-navy-600">
        Não foi encontrado código de integração Invoice Express neste repositório nem entradas dedicadas em `api_connections`.
        O módulo foi deixado em modo stub para reintegração futura sem simular integrações inexistentes.
      </p>
    </div>
  )
}

function SendRenewalAlertsButton() {
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; companies: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSend = async () => {
    if (!confirm('Enviar alertas de renovação por email a todos os clientes com apólices a expirar nos próximos 90 dias?')) return
    setSending(true); setResult(null); setError(null)
    try {
      const res = await fetch('/api/send-renewal-alerts', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer adler-admin-2025', 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar alertas')
      setResult({ sent: data.sent, companies: data.companies })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
      <button
        onClick={handleSend}
        disabled={sending}
        style={{
          fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.82rem',
          padding: '0.55rem 1rem', background: sending ? '#cccccc' : '#C8961A',
          color: '#ffffff', border: 'none', borderRadius: '4px',
          cursor: sending ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem',
        }}
      >
        {sending
          ? <><span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />A enviar...</>
          : <>✉️ Enviar Alertas por Email</>}
      </button>
      {result && (
        <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#166534', background: '#EAF3DE', padding: '0.25rem 0.6rem', borderRadius: '4px' }}>
          ✓ {result.sent} email{result.sent !== 1 ? 's' : ''} enviado{result.sent !== 1 ? 's' : ''} para {result.companies} empresa{result.companies !== 1 ? 's' : ''}
        </span>
      )}
      {error && (
        <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#dc2626', background: '#FEE2E2', padding: '0.25rem 0.6rem', borderRadius: '4px' }}>
          ⚠️ {error}
        </span>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function SimpleCollection({ title, rows, emptyMessage }: { title: string; rows: string[]; emptyMessage: string }) {
  return (
    <div>
      <h3 className="text-md font-semibold text-navy-700 mb-3">{title}</h3>
      <div className="bg-white rounded-[4px] border border-navy-200 p-4 space-y-2 min-h-24">
        {rows.map((row, idx) => (
          <p key={`${row}_${idx}`} className="text-sm text-navy-600">• {row}</p>
        ))}
        {rows.length === 0 && <p className="text-sm text-navy-400">{emptyMessage}</p>}
      </div>
    </div>
  )
}

function CompanyForm({
  title,
  initial,
  onSubmit,
}: {
  title: string
  initial?: Partial<Company>
  onSubmit: (data: any) => Promise<void>
}) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    nif: initial?.nif || '',
    sector: initial?.sector || '',
    contactName: initial?.contactName || '',
    contactEmail: initial?.contactEmail || '',
    contactPhone: initial?.contactPhone || '',
    accessEmail: initial?.accessEmail || '',
    address: initial?.address || '',
  })
  const [submitting, setSubmitting] = useState(false)

  const update = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    await onSubmit(form)
    setSubmitting(false)
  }

  return (
    <div className="bg-white rounded-[4px] border border-navy-200 p-6 mb-6">
      <h3 className="text-lg font-semibold text-navy-700 mb-4">{title}</h3>
      <form onSubmit={handleSubmit} className="grid sm:grid-cols-2 gap-4">
        <FormField label="Nome" value={form.name} onChange={(v) => update('name', v)} required />
        <FormField label="NIF" value={form.nif} onChange={(v) => update('nif', v)} required />
        <FormField label="Setor" value={form.sector} onChange={(v) => update('sector', v)} required />
        <FormField label="Nome do Contacto" value={form.contactName} onChange={(v) => update('contactName', v)} required />
        <FormField label="Email do Contacto" value={form.contactEmail} onChange={(v) => update('contactEmail', v)} type="email" required />
        <FormField label="Telefone" value={form.contactPhone} onChange={(v) => update('contactPhone', v)} required />
        <FormField label="Email de Acesso da Empresa" value={form.accessEmail} onChange={(v) => update('accessEmail', v)} type="email" required />
        <div className="sm:col-span-2">
          <FormField label="Morada" value={form.address} onChange={(v) => update('address', v)} required />
        </div>
        <div className="sm:col-span-2">
          <button type="submit" disabled={submitting} className="px-6 py-2.5 bg-gold-400 text-navy-700 font-semibold rounded-[2px] hover:bg-gold-300 disabled:opacity-50 text-sm">
            {submitting ? 'A guardar...' : 'Guardar Empresa'}
          </button>
        </div>
      </form>
    </div>
  )
}

function CompanyUserForm({
  companyId,
  companyName,
  onSubmit,
}: {
  companyId: string
  companyName: string
  onSubmit: (data: {
    companyId: string
    name: string
    email: string
    role: 'owner' | 'manager' | 'employee'
    accessPassword: string
  }) => Promise<void>
}) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    role: 'employee' as 'owner' | 'manager' | 'employee',
    accessPassword: '',
  })
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    await onSubmit({ ...form, companyId })
    setSubmitting(false)
    setForm({ name: '', email: '', role: 'employee', accessPassword: '' })
  }

  return (
    <form onSubmit={handleSubmit} className="grid md:grid-cols-5 gap-3 bg-white border border-navy-200 rounded-[4px] p-4">
      <input
        value={companyName}
        readOnly
        className="px-3 py-2 border border-navy-200 rounded text-sm bg-navy-50 text-navy-600"
        aria-label="Empresa associada"
      />
      <input
        value={form.name}
        onChange={(e) => setForm((old) => ({ ...old, name: e.target.value }))}
        placeholder="Nome"
        className="px-3 py-2 border border-navy-200 rounded text-sm"
        required
      />
      <input
        type="email"
        value={form.email}
        onChange={(e) => setForm((old) => ({ ...old, email: e.target.value }))}
        placeholder="email@empresa.pt"
        className="px-3 py-2 border border-navy-200 rounded text-sm"
        required
      />
      <select
        value={form.role}
        onChange={(e) => setForm((old) => ({ ...old, role: e.target.value as any }))}
        className="px-3 py-2 border border-navy-200 rounded text-sm"
      >
        <option value="owner">Owner</option>
        <option value="manager">Manager</option>
        <option value="employee">Employee</option>
      </select>
      <input
        type="password"
        value={form.accessPassword}
        onChange={(e) => setForm((old) => ({ ...old, accessPassword: e.target.value }))}
        placeholder="Password inicial"
        className="px-3 py-2 border border-navy-200 rounded text-sm"
        required
        minLength={6}
      />
      <div className="md:col-span-5">
        <button type="submit" disabled={submitting} className="px-4 py-2 bg-navy-700 text-white rounded text-sm disabled:opacity-50">
          {submitting ? 'A criar...' : 'Criar Utilizador de Empresa'}
        </button>
      </div>
    </form>
  )
}

function NewAdminClaimForm({
  companies,
  companyUsers,
  policies,
  individualClients,
  onSubmit,
}: {
  companies: Company[]
  companyUsers: CompanyUser[]
  policies: Policy[]
  individualClients: IndividualClient[]
  onSubmit: (data: {
    targetType: 'company' | 'individual'
    companyId?: string
    individualClientId?: string
    clientUserId?: string
    policyId: string
    type: string
    description: string
    incidentDate: string
    estimatedValue?: number
  }) => Promise<void>
}) {
  const [targetType, setTargetType] = useState<'company' | 'individual'>('company')
  const [companyId, setCompanyId] = useState('')
  const [clientUserId, setClientUserId] = useState('')
  const [individualClientId, setIndividualClientId] = useState('')
  const [policyId, setPolicyId] = useState('')
  const [type, setType] = useState('')
  const [description, setDescription] = useState('')
  const [incidentDate, setIncidentDate] = useState('')
  const [estimatedValue, setEstimatedValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const availableUsers = companyUsers.filter((user) => user.companyId === companyId)
  const availablePolicies = policies.filter((policy) => {
    if (targetType === 'company') return policy.companyId === companyId
    return policy.individualClientId === individualClientId
  })

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    await onSubmit({
      targetType,
      companyId: targetType === 'company' ? companyId : undefined,
      individualClientId: targetType === 'individual' ? individualClientId : undefined,
      clientUserId: targetType === 'company' ? (clientUserId || undefined) : undefined,
      policyId,
      type,
      description,
      incidentDate,
      estimatedValue: estimatedValue ? Number(estimatedValue) : undefined,
    })
    setSubmitting(false)
    setPolicyId('')
    setType('')
    setDescription('')
    setIncidentDate('')
    setEstimatedValue('')
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-navy-200 rounded-[4px] p-5 mb-4 grid md:grid-cols-2 gap-4">
      <div>
        <label className="block text-sm text-navy-600 mb-1">Tipo de cliente</label>
        <select value={targetType} onChange={(e) => setTargetType(e.target.value as 'company' | 'individual')} className="w-full px-3 py-2 border border-navy-200 rounded text-sm">
          <option value="company">Empresa</option>
          <option value="individual">Cliente individual</option>
        </select>
      </div>

      {targetType === 'company' ? (
        <div>
          <label className="block text-sm text-navy-600 mb-1">Empresa</label>
          <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setPolicyId('') }} required className="w-full px-3 py-2 border border-navy-200 rounded text-sm">
            <option value="">Selecionar...</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
        </div>
      ) : (
        <div>
          <label className="block text-sm text-navy-600 mb-1">Cliente individual</label>
          <select value={individualClientId} onChange={(e) => { setIndividualClientId(e.target.value); setPolicyId('') }} required className="w-full px-3 py-2 border border-navy-200 rounded text-sm">
            <option value="">Selecionar...</option>
            {individualClients.map((client) => <option key={client.id} value={client.id}>{client.fullName}</option>)}
          </select>
        </div>
      )}

      <div>
        <label className="block text-sm text-navy-600 mb-1">Utilizador/cliente associado</label>
        {targetType === 'company' ? (
          <select value={clientUserId} onChange={(e) => setClientUserId(e.target.value)} className="w-full px-3 py-2 border border-navy-200 rounded text-sm">
            <option value="">Sem responsável inicial</option>
            {availableUsers.map((user) => <option key={user.id} value={user.id}>{user.name} ({user.email})</option>)}
          </select>
        ) : (
          <input value={individualClients.find((c) => c.id === individualClientId)?.fullName || ''} readOnly className="w-full px-3 py-2 border border-navy-200 rounded text-sm bg-navy-50 text-navy-500" />
        )}
      </div>

      <div>
        <label className="block text-sm text-navy-600 mb-1">Apólice associada</label>
        <select value={policyId} onChange={(e) => setPolicyId(e.target.value)} required className="w-full px-3 py-2 border border-navy-200 rounded text-sm">
          <option value="">Selecionar...</option>
          {availablePolicies.map((policy) => (
            <option key={policy.id} value={policy.id}>
              {policy.policyNumber} · {POLICY_TYPE_LABELS[policy.type] ?? policy.type}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm text-navy-600 mb-1">Tipo de sinistro</label>
        <input value={type} onChange={(e) => setType(e.target.value)} required className="w-full px-3 py-2 border border-navy-200 rounded text-sm" placeholder="Ex: Inundação" />
      </div>

      <div>
        <label className="block text-sm text-navy-600 mb-1">Data do sinistro</label>
        <input type="date" value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)} required className="w-full px-3 py-2 border border-navy-200 rounded text-sm" />
      </div>

      <div>
        <label className="block text-sm text-navy-600 mb-1">Valor estimado (opcional)</label>
        <input type="number" min="0" step="0.01" value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} className="w-full px-3 py-2 border border-navy-200 rounded text-sm" placeholder="0.00" />
      </div>

      <div className="md:col-span-2">
        <label className="block text-sm text-navy-600 mb-1">Descrição inicial</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} required rows={3} className="w-full px-3 py-2 border border-navy-200 rounded text-sm" />
      </div>

      <div className="md:col-span-2">
        <button disabled={submitting} className="px-4 py-2 bg-navy-700 text-white rounded text-sm disabled:opacity-50">
          {submitting ? 'A criar...' : 'Criar sinistro'}
        </button>
      </div>
    </form>
  )
}

function AdminClaimsBoard({
  claims,
  policies,
  companies,
  individualClients,
  summaryMap,
  selectedClaimId,
  onSelectClaim,
  onQuickStatusUpdate,
}: {
  claims: Claim[]
  policies: Policy[]
  companies: Company[]
  individualClients: IndividualClient[]
  summaryMap: Record<string, { responsibleName?: string; messagesCount: number; documentsCount: number; lastMessageAt?: string; updatedAt?: string }>
  selectedClaimId: string | null
  onSelectClaim: (claimId: string) => void
  onQuickStatusUpdate: (claimId: string, status: string, notes?: string) => Promise<void>
}) {
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  if (claims.length === 0) {
    return <div className="bg-white border border-navy-200 rounded-[4px] p-5 text-sm text-navy-500">Sem sinistros registados.</div>
  }

  return (
    <div className="bg-white border border-navy-200 rounded-[4px] overflow-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-navy-50 text-navy-600">
          <tr>
            <th className="text-left px-3 py-2">Cliente/Empresa</th>
            <th className="text-left px-3 py-2">Apólice</th>
            <th className="text-left px-3 py-2">Tipo</th>
            <th className="text-left px-3 py-2">Data</th>
            <th className="text-left px-3 py-2">Estado</th>
            <th className="text-left px-3 py-2">Valor</th>
            <th className="text-left px-3 py-2">Responsável</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((claim) => {
            const policy = policies.find((item) => item.id === claim.policyId)
            const companyName = claim.companyId ? (companies.find((item) => item.id === claim.companyId)?.name || claim.companyId) : undefined
            const individualName = claim.individualClientId ? (individualClients.find((item) => item.id === claim.individualClientId)?.fullName || claim.individualClientId) : undefined
            const ownerLabel = companyName || individualName || '—'
            const summary = summaryMap[claim.id]
            return (
              <tr
                key={claim.id}
                onClick={() => onSelectClaim(claim.id)}
                className={`border-t border-navy-100 cursor-pointer hover:bg-navy-50/40 ${selectedClaimId === claim.id ? 'bg-navy-50/70' : ''}`}
              >
                <td className="px-3 py-2">{ownerLabel}</td>
                <td className="px-3 py-2">{policy ? `${policy.policyNumber}` : '—'}</td>
                <td className="px-3 py-2">{claim.title}</td>
                <td className="px-3 py-2">{formatDate(claim.incidentDate)}</td>
                <td className="px-3 py-2">
                  <select
                    value={claim.status}
                    onClick={(e) => e.stopPropagation()}
                    onChange={async (e) => {
                      const status = e.target.value
                      setUpdatingId(claim.id)
                      await onQuickStatusUpdate(claim.id, status, 'Atualização rápida')
                      setUpdatingId(null)
                    }}
                    className="px-2 py-1 border border-navy-200 rounded text-xs"
                  >
                    {Object.entries(CLAIM_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  {updatingId === claim.id && <span className="ml-2 text-xs text-navy-400">...</span>}
                </td>
                <td className="px-3 py-2">{formatCurrency(claim.estimatedValue || 0)}</td>
                <td className="px-3 py-2">{summary?.responsibleName || '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AdminClaimWorkspace({
  workspace,
  companyUsers,
  onUpdated,
}: {
  workspace: {
    claim: Claim
    policy?: Policy
    company?: Company
    individualClient?: IndividualClient
    operations: ClaimOperationalData
  }
  companyUsers: CompanyUser[]
  onUpdated: () => Promise<void>
}) {
  const { claim, policy, company, individualClient, operations } = workspace
  const [selectedResponsible, setSelectedResponsible] = useState(operations.responsible?.id || '')
  const [newNote, setNewNote] = useState('')
  const [newMessage, setNewMessage] = useState('')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)

  const responsibleCandidates = claim.companyId
    ? companyUsers.filter((user) => user.companyId === claim.companyId)
    : []

  const handleUploadDocument = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const storagePath = `claims/${claim.id}/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('documents').upload(storagePath, file)
      if (error) throw new Error(error.message)
      await registerClaimDocument({
        data: {
          claimId: claim.id,
          name: file.name,
          contentType: file.type,
          storagePath,
          size: file.size,
        },
      })
      await onUpdated()
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  return (
    <div className="mt-4 bg-white border border-navy-200 rounded-[4px] p-5 space-y-5">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-navy-700">{claim.title}</h3>
          <p className="text-sm text-navy-500">{company?.name || individualClient?.fullName || '—'} · {policy?.policyNumber || 'Sem apólice'}</p>
          <p className="text-xs text-navy-400 mt-1">Data do sinistro: {formatDate(claim.incidentDate)} · Valor estimado: {formatCurrency(claim.estimatedValue || 0)}</p>
        </div>
        <div className="text-right">
          <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${getStatusColor(claim.status)}`}>
            {CLAIM_STATUS_LABELS[claim.status]}
          </span>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="border border-navy-100 rounded p-3">
          <p className="text-xs uppercase tracking-wide text-navy-500 mb-2">Responsável</p>
          <div className="flex gap-2">
            <select value={selectedResponsible} onChange={(e) => setSelectedResponsible(e.target.value)} className="flex-1 px-2 py-2 border border-navy-200 rounded text-sm">
              <option value="">Sem responsável</option>
              {responsibleCandidates.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
            <button
              disabled={saving}
              onClick={async () => {
                setSaving(true)
                const selected = responsibleCandidates.find((user) => user.id === selectedResponsible)
                await adminAssignClaimResponsible({
                  data: {
                    claimId: claim.id,
                    responsible: selected ? { id: selected.id, name: selected.name, email: selected.email } : undefined,
                  },
                })
                await onUpdated()
                setSaving(false)
              }}
              className="px-3 py-2 bg-navy-700 text-white rounded text-sm disabled:opacity-50"
            >
              Guardar
            </button>
          </div>
        </div>

        <div className="border border-navy-100 rounded p-3">
          <p className="text-xs uppercase tracking-wide text-navy-500 mb-2">Links</p>
          <p className="text-sm text-navy-600">Apólice: {policy ? `${policy.policyNumber} (${POLICY_TYPE_LABELS[policy.type] ?? policy.type})` : '—'}</p>
          <p className="text-sm text-navy-600">Cliente/Empresa: {company?.name || individualClient?.fullName || '—'}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="border border-navy-100 rounded p-3">
          <p className="text-xs uppercase tracking-wide text-navy-500 mb-3">Timeline</p>
          <div className="max-h-56 overflow-auto space-y-2">
            {operations.timeline.length === 0 ? <p className="text-sm text-navy-400">Sem eventos.</p> : operations.timeline.slice().reverse().map((event) => (
              <div key={event.id} className="text-sm border border-navy-100 rounded p-2">
                <p className="text-navy-700">{event.message}</p>
                <p className="text-xs text-navy-400 mt-1">{event.actorName} · {formatDateTime(event.createdAt)}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-navy-100 rounded p-3">
          <p className="text-xs uppercase tracking-wide text-navy-500 mb-3">Notas da equipa</p>
          <div className="max-h-40 overflow-auto space-y-2 mb-3">
            {operations.teamNotes.length === 0 ? <p className="text-sm text-navy-400">Sem notas.</p> : operations.teamNotes.slice().reverse().map((note) => (
              <div key={note.id} className="text-sm border border-navy-100 rounded p-2">
                <p>{note.note}</p>
                <p className="text-xs text-navy-400 mt-1">{note.authorName} · {formatDateTime(note.createdAt)}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newNote} onChange={(e) => setNewNote(e.target.value)} className="flex-1 px-2 py-2 border border-navy-200 rounded text-sm" placeholder="Adicionar nota interna..." />
            <button
              onClick={async () => {
                if (!newNote.trim()) return
                await adminAddClaimTeamNote({ data: { claimId: claim.id, note: newNote } })
                setNewNote('')
                await onUpdated()
              }}
              className="px-3 py-2 bg-navy-700 text-white rounded text-sm"
            >
              Adicionar
            </button>
          </div>
        </div>
      </div>

      <div className="border border-navy-100 rounded p-3">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs uppercase tracking-wide text-navy-500">Documentos</p>
          <label className="px-3 py-1.5 bg-navy-700 text-white rounded text-xs cursor-pointer">
            {uploading ? 'A carregar...' : 'Upload'}
            <input type="file" className="hidden" onChange={handleUploadDocument} />
          </label>
        </div>
        <div className="space-y-2">
          {operations.documents.length === 0 ? <p className="text-sm text-navy-400">Sem ficheiros.</p> : operations.documents.map((doc) => (
            <div key={doc.id} className="border border-navy-100 rounded p-2 flex flex-wrap items-center gap-2 justify-between">
              <div>
                <p className="text-sm text-navy-700">{doc.name}</p>
                <p className="text-xs text-navy-400">{doc.contentType} · {formatDateTime(doc.uploadedAt)} · {doc.uploadedByName}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const { url } = await getClaimDocumentUrl({ data: { claimId: claim.id, documentId: doc.id } })
                    const a = document.createElement('a')
                    a.href = url
                    a.download = doc.name
                    a.click()
                  }}
                  className="px-2 py-1 border border-navy-200 rounded text-xs"
                >
                  Download
                </button>
                <button
                  onClick={async () => {
                    await removeClaimDocument({ data: { claimId: claim.id, documentId: doc.id } })
                    await onUpdated()
                  }}
                  className="px-2 py-1 border border-red-200 text-red-600 rounded text-xs"
                >
                  Remover
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border border-navy-100 rounded p-3">
        <p className="text-xs uppercase tracking-wide text-navy-500 mb-3">Mensagens (ticket)</p>
        <div className="max-h-60 overflow-auto space-y-2 mb-3">
          {operations.messages.length === 0 ? <p className="text-sm text-navy-400">Sem mensagens.</p> : operations.messages.map((message) => (
            <div key={message.id} className={`rounded p-2 text-sm ${message.senderRole === 'admin' ? 'bg-navy-50 border border-navy-100' : 'bg-gold-50 border border-gold-100'}`}>
              <p className="text-navy-700">{message.body}</p>
              <p className="text-xs text-navy-400 mt-1">{message.senderName} · {formatDateTime(message.createdAt)}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={newMessage} onChange={(e) => setNewMessage(e.target.value)} className="flex-1 px-2 py-2 border border-navy-200 rounded text-sm" placeholder="Responder ao cliente..." />
          <button
            onClick={async () => {
              if (!newMessage.trim()) return
              await adminSendClaimMessage({ data: { claimId: claim.id, message: newMessage } })
              setNewMessage('')
              await onUpdated()
            }}
            className="px-3 py-2 bg-gold-400 text-navy-700 font-semibold rounded text-sm"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  )
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    submitted: 'bg-blue-100 text-blue-700',
    under_review: 'bg-purple-100 text-purple-700',
    documentation: 'bg-yellow-100 text-yellow-700',
    assessment: 'bg-orange-100 text-orange-700',
    approved: 'bg-green-100 text-green-700',
    denied: 'bg-red-100 text-red-700',
    paid: 'bg-emerald-100 text-emerald-700',
  }
  return colors[status] || 'bg-gray-100 text-gray-600'
}

function formatDateTime(value?: string) {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function NewPolicyForm({ companies, individualClients, onSubmit }: { companies: Company[]; individualClients: IndividualClient[]; onSubmit: (data: any) => Promise<void> }) {
  const [clientType, setClientType] = useState<'company' | 'individual'>('company')
  const [form, setForm] = useState({
    companyId: '', individualClientId: '', type: '', insurer: '', policyNumber: '', description: '', startDate: '', endDate: '', annualPremium: '', insuredValue: '',
    paymentFrequency: 'anual', commissionPercentage: '', commissionValue: '',
  })
  const [submitting, setSubmitting] = useState(false)

  const update = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    await onSubmit({
      ...form,
      companyId: clientType === 'company' ? form.companyId : undefined,
      individualClientId: clientType === 'individual' ? form.individualClientId : undefined,
      annualPremium: Number(form.annualPremium),
      insuredValue: Number(form.insuredValue),
      paymentFrequency: form.paymentFrequency || undefined,
      commissionPercentage: form.commissionPercentage ? Number(form.commissionPercentage) : undefined,
      commissionValue: form.commissionValue ? Number(form.commissionValue) : undefined,
    })
    setSubmitting(false)
  }

  return (
    <div className="bg-white rounded-[4px] border border-navy-200 p-6 mb-6">
      <h3 className="text-lg font-semibold text-navy-700 mb-4">Nova Apólice</h3>
      <form onSubmit={handleSubmit} className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-navy-600 mb-1">Tipo de Cliente</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setClientType('company')}
              className={`px-4 py-2 rounded-[2px] text-sm font-medium border transition-colors ${clientType === 'company' ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-navy-600 border-navy-200 hover:border-navy-400'}`}
            >
              Empresa
            </button>
            <button
              type="button"
              onClick={() => setClientType('individual')}
              className={`px-4 py-2 rounded-[2px] text-sm font-medium border transition-colors ${clientType === 'individual' ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-navy-600 border-navy-200 hover:border-navy-400'}`}
            >
              Cliente Individual
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-600 mb-1">{clientType === 'company' ? 'Empresa' : 'Cliente Individual'}</label>
          {clientType === 'company' ? (
            <select value={form.companyId} onChange={(e) => update('companyId', e.target.value)} className="w-full px-4 py-2.5 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400" required>
              <option value="">Selecionar empresa</option>
              {companies.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          ) : (
            <select value={form.individualClientId} onChange={(e) => update('individualClientId', e.target.value)} className="w-full px-4 py-2.5 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400" required>
              <option value="">Selecionar cliente</option>
              {individualClients.map((c) => (<option key={c.id} value={c.id}>{c.fullName}{c.nif ? ` · ${c.nif}` : ''}</option>))}
            </select>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-600 mb-1">Tipo</label>
          <select value={form.type} onChange={(e) => update('type', e.target.value)} className="w-full px-4 py-2.5 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400" required>
            <option value="">Selecionar</option>
            {Object.entries(POLICY_TYPE_LABELS).map(([key, label]) => (<option key={key} value={key}>{label}</option>))}
          </select>
        </div>
        <FormField label="Seguradora" value={form.insurer} onChange={(v) => update('insurer', v)} required />
        <FormField label="N.º Apólice" value={form.policyNumber} onChange={(v) => update('policyNumber', v)} required />
        <div className="sm:col-span-2">
          <FormField label="Descrição" value={form.description} onChange={(v) => update('description', v)} required />
        </div>
        <FormField label="Data Início" value={form.startDate} onChange={(v) => update('startDate', v)} type="date" required />
        <FormField label="Data Fim" value={form.endDate} onChange={(v) => update('endDate', v)} type="date" required />
        <FormField label="Prémio Anual (EUR)" value={form.annualPremium} onChange={(v) => update('annualPremium', v)} type="number" required />
        <FormField label="Capital Segurado (EUR)" value={form.insuredValue} onChange={(v) => update('insuredValue', v)} type="number" required />
        <div>
          <label className="block text-sm font-medium text-navy-600 mb-1">Fracionamento</label>
          <select
            value={form.paymentFrequency}
            onChange={(e) => update('paymentFrequency', e.target.value)}
            className="w-full px-4 py-2.5 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400"
          >
            <option value="mensal">Mensal</option>
            <option value="trimestral">Trimestral</option>
            <option value="semestral">Semestral</option>
            <option value="anual">Anual</option>
          </select>
        </div>
        <FormField label="Comissão (%)" value={form.commissionPercentage} onChange={(v) => update('commissionPercentage', v)} type="number" />
        <FormField label="Comissão (€)" value={form.commissionValue} onChange={(v) => update('commissionValue', v)} type="number" />
        <div className="sm:col-span-2">
          <button type="submit" disabled={submitting} className="px-6 py-2.5 bg-gold-400 text-navy-700 font-semibold rounded-[2px] hover:bg-gold-300 disabled:opacity-50 text-sm">
            {submitting ? 'A criar...' : 'Criar Apólice'}
          </button>
        </div>
      </form>
    </div>
  )
}

function PromoteToCompanySelect({ client, onSuccess }: { client: IndividualClient; onSuccess: () => Promise<void> }) {
  const [promoting, setPromoting] = useState(false)

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value !== 'company') return
    e.target.value = 'individual' // reset immediately

    const authWarning = client.authUserId ? '\n⚠️ Este cliente tem acesso ao Adler One — o acesso será desligado.' : ''
    if (!confirm(`Converter "${client.fullName}" para Empresa?\n\nIsso irá:\n• Criar um registo de Empresa\n• Mover as apólices associadas\n• Apagar o registo de cliente individual${authWarning}`)) return

    setPromoting(true)
    try {
      await adminPromoteToCompany({ data: { clientId: client.id } })
      await onSuccess()
    } catch (err: any) {
      alert(`Erro ao converter: ${err?.message ?? 'falha desconhecida'}`)
    } finally {
      setPromoting(false)
    }
  }

  return (
    <select
      value="individual"
      onChange={handleChange}
      disabled={promoting}
      className="text-xs border border-navy-200 rounded px-1.5 py-1 bg-white text-navy-700 focus:outline-none focus:ring-1 focus:ring-gold-400 disabled:opacity-50"
    >
      <option value="individual">Individual</option>
      <option value="company">→ Empresa</option>
    </select>
  )
}

function ActivateAdlerOneButton({ client, onSuccess }: { client: IndividualClient; onSuccess: () => Promise<void> }) {
  const [activating, setActivating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (client.authUserId) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
        Adler One ✓
      </span>
    )
  }

  if (!client.email) {
    return (
      <span title="Sem email — edite o cliente primeiro" className="inline-block px-2 py-1 text-xs text-navy-400 border border-navy-200 rounded cursor-default">
        Sem email
      </span>
    )
  }

  if (message) {
    return <span className="text-xs text-green-700">{message}</span>
  }

  return (
    <button
      disabled={activating}
      onClick={async () => {
        if (!confirm(`Enviar convite Adler One para ${client.email}?`)) return
        setActivating(true)
        try {
          await adminActivateAdlerOne({ data: { clientId: client.id, email: client.email!, fullName: client.fullName } })
          setMessage(`Convite enviado para ${client.email}`)
          await onSuccess()
        } catch (e: any) {
          setMessage(`Erro: ${e?.message ?? 'falha ao enviar convite'}`)
        } finally {
          setActivating(false)
        }
      }}
      className="px-2 py-1 text-xs bg-gold-400 text-navy-700 font-semibold rounded hover:bg-gold-300 disabled:opacity-50 whitespace-nowrap"
    >
      {activating ? '...' : 'Activar Adler One'}
    </button>
  )
}

function IndividualClientForm({
  title,
  initial,
  onSubmit,
}: {
  title: string
  initial?: Partial<IndividualClient>
  onSubmit: (data: any) => Promise<void>
}) {
  const [form, setForm] = useState({
    fullName: initial?.fullName || '',
    nif: initial?.nif || '',
    email: initial?.email || '',
    phone: initial?.phone || '',
    address: initial?.address || '',
    status: initial?.status || 'active',
  })
  const [submitting, setSubmitting] = useState(false)

  const update = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    await onSubmit(form)
    setSubmitting(false)
  }

  return (
    <div className="bg-white rounded-[4px] border border-navy-200 p-6 mb-6">
      <h3 className="text-lg font-semibold text-navy-700 mb-4">{title}</h3>
      <form onSubmit={handleSubmit} className="grid sm:grid-cols-2 gap-4">
        <FormField label="Nome Completo" value={form.fullName} onChange={(v) => update('fullName', v)} required />
        <FormField label="NIF" value={form.nif} onChange={(v) => update('nif', v)} />
        <FormField label="Email" value={form.email} onChange={(v) => update('email', v)} type="email" />
        <FormField label="Telefone" value={form.phone} onChange={(v) => update('phone', v)} />
        <div className="sm:col-span-2">
          <FormField label="Morada" value={form.address} onChange={(v) => update('address', v)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-600 mb-1">Estado</label>
          <select
            value={form.status}
            onChange={(e) => update('status', e.target.value)}
            className="w-full px-4 py-2.5 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400"
          >
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <button type="submit" disabled={submitting} className="px-6 py-2.5 bg-gold-400 text-navy-700 font-semibold rounded-[2px] hover:bg-gold-300 disabled:opacity-50 text-sm">
            {submitting ? 'A guardar...' : 'Guardar Cliente'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Social Hub Tab
// ─────────────────────────────────────────────────────────
const NETWORK_ICONS: Record<string, string> = {
  instagram: '📷',
  linkedin: '💼',
  facebook: '📘',
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendado',
  published: 'Publicado',
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-blue-100 text-blue-700',
  published: 'bg-green-100 text-green-700',
}

function SocialHubTab({ posts, onRefresh }: { posts: SocialPost[]; onRefresh: () => Promise<void> }) {
  const [showEditor, setShowEditor] = useState(false)
  const [editingPost, setEditingPost] = useState<SocialPost | null>(null)

  const handleNew = () => { setEditingPost(null); setShowEditor(true) }
  const handleEdit = (p: SocialPost) => { setEditingPost(p); setShowEditor(true) }
  const handleClose = async () => { setShowEditor(false); setEditingPost(null); await onRefresh() }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-navy-700">Social Hub ({posts.length})</h2>
        <button
          onClick={handleNew}
          className="px-4 py-2 bg-gold-400 text-navy-700 font-semibold rounded-[2px] hover:bg-gold-300 transition-colors text-sm"
        >
          + Novo Post
        </button>
      </div>

      {showEditor && (
        <SocialPostEditor
          initial={editingPost}
          onClose={handleClose}
        />
      )}

      {posts.length === 0 ? (
        <p className="text-navy-500">Ainda não existem posts. Cria o primeiro!</p>
      ) : (
        <div className="bg-white rounded-[4px] border border-navy-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-navy-50 border-b border-navy-200">
              <tr>
                <th className="text-left px-4 py-3 text-navy-600 font-medium">Tópico</th>
                <th className="text-left px-4 py-3 text-navy-600 font-medium">Estado</th>
                <th className="text-left px-4 py-3 text-navy-600 font-medium">Redes</th>
                <th className="text-left px-4 py-3 text-navy-600 font-medium">Data</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {posts.map((p) => (
                <tr key={p.id} className="hover:bg-navy-50 transition-colors">
                  <td className="px-4 py-3 text-navy-700 font-medium max-w-xs truncate">{p.topic}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABELS[p.status] ?? p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex gap-1">
                      {p.networks.map((n) => (
                        <span key={n} title={n}>{NETWORK_ICONS[n] ?? n}</span>
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-navy-500">
                    {p.scheduledAt ? formatDate(p.scheduledAt) : formatDate(p.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleEdit(p)}
                      className="text-xs text-navy-500 hover:text-navy-700 underline mr-3"
                    >
                      Editar
                    </button>
                    <DeletePostButton postId={p.id} onDeleted={onRefresh} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function DeletePostButton({ postId, onDeleted }: { postId: string; onDeleted: () => Promise<void> }) {
  const [deleting, setDeleting] = useState(false)
  const handleDelete = async () => {
    if (!confirm('Apagar este post?')) return
    setDeleting(true)
    await adminDeleteSocialPost({ data: { id: postId } })
    await onDeleted()
    setDeleting(false)
  }
  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
    >
      {deleting ? '...' : 'Apagar'}
    </button>
  )
}

function SocialPostEditor({ initial, onClose }: { initial: SocialPost | null; onClose: () => Promise<void> }) {
  const [topic, setTopic] = useState(initial?.topic ?? '')
  const [networks, setNetworks] = useState<string[]>(initial?.networks ?? ['instagram', 'linkedin', 'facebook'])
  const [contentInstagram, setContentInstagram] = useState(initial?.contentInstagram ?? '')
  const [contentLinkedin, setContentLinkedin] = useState(initial?.contentLinkedin ?? '')
  const [contentFacebook, setContentFacebook] = useState(initial?.contentFacebook ?? '')
  const [scheduledAt, setScheduledAt] = useState(initial?.scheduledAt ? initial.scheduledAt.slice(0, 16) : '')
  const [previewTab, setPreviewTab] = useState<'instagram' | 'linkedin' | 'facebook'>('instagram')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [genError, setGenError] = useState('')
  const [carouselSlides, setCarouselSlides] = useState<string[]>([])

  const toggleNetwork = (n: string) => {
    setNetworks((prev) => prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n])
  }

  const handleGenerate = async () => {
    if (!topic.trim()) { setGenError('Introduz um tópico primeiro.'); return }
    setGenError(''); setGenerating(true); setCarouselSlides([])
    try {
      const res = await adminGenerateSocialContent({ data: { topic } })
      if (res.instagram) setContentInstagram(res.instagram)
      if (res.linkedin) setContentLinkedin(res.linkedin)
      if (res.facebook) setContentFacebook(res.facebook)
      if (res.carouselSlides?.length) setCarouselSlides(res.carouselSlides)
    } catch (e: any) {
      setGenError(e?.message ?? 'Erro ao gerar conteúdo.')
    } finally {
      setGenerating(false)
    }
  }

  const downloadSvg = (svg: string, index: number) => {
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `adler-carousel-${index + 1}.svg`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleSave = async (status: 'draft' | 'scheduled') => {
    setSaving(true)
    const now = new Date().toISOString()
    const payload: any = {
      topic,
      status,
      networks,
      contentInstagram,
      contentLinkedin,
      contentFacebook,
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      updatedAt: now,
    }
    if (initial) {
      await adminUpdateSocialPost({ data: { id: initial.id, updates: payload } })
    } else {
      await adminCreateSocialPost({ data: { ...payload, id: crypto.randomUUID(), createdAt: now } })
    }
    setSaving(false)
    await onClose()
  }

  return (
    <div className="bg-white rounded-[4px] border border-navy-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-navy-700">{initial ? 'Editar Post' : 'Novo Post'}</h3>
        <button onClick={onClose} className="text-navy-400 hover:text-navy-600 text-sm">✕ Fechar</button>
      </div>

      {/* Topic */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-navy-600 mb-1">Tópico / Ideia</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Ex: Seguro automóvel — coberturas que não sabia que tinha"
            className="flex-1 px-4 py-2.5 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400"
          />
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 bg-navy-700 text-white text-sm font-medium rounded-[2px] hover:bg-navy-600 disabled:opacity-50 whitespace-nowrap"
          >
            {generating ? 'A gerar...' : '✦ Gerar com IA'}
          </button>
        </div>
        {genError && <p className="text-red-500 text-xs mt-1">{genError}</p>}
      </div>

      {/* Network selector */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-navy-600 mb-2">Redes</label>
        <div className="flex gap-3">
          {(['instagram', 'linkedin', 'facebook'] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => toggleNetwork(n)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                networks.includes(n)
                  ? 'bg-navy-700 text-white border-navy-700'
                  : 'bg-white text-navy-500 border-navy-200 hover:border-navy-400'
              }`}
            >
              {NETWORK_ICONS[n]} {n.charAt(0).toUpperCase() + n.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Content tabs */}
      <div className="mb-4">
        <div className="flex gap-1 border-b border-navy-200 mb-3">
          {(['instagram', 'linkedin', 'facebook'] as const).map((n) => (
            <button
              key={n}
              onClick={() => setPreviewTab(n)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                previewTab === n
                  ? 'border-gold-400 text-navy-700'
                  : 'border-transparent text-navy-400 hover:text-navy-600'
              }`}
            >
              {NETWORK_ICONS[n]} {n.charAt(0).toUpperCase() + n.slice(1)}
            </button>
          ))}
        </div>
        {previewTab === 'instagram' && (
          <textarea
            value={contentInstagram}
            onChange={(e) => setContentInstagram(e.target.value)}
            rows={8}
            placeholder="Conteúdo para Instagram..."
            className="w-full px-4 py-3 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400 resize-y font-mono"
          />
        )}
        {previewTab === 'linkedin' && (
          <textarea
            value={contentLinkedin}
            onChange={(e) => setContentLinkedin(e.target.value)}
            rows={8}
            placeholder="Conteúdo para LinkedIn..."
            className="w-full px-4 py-3 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400 resize-y font-mono"
          />
        )}
        {previewTab === 'facebook' && (
          <textarea
            value={contentFacebook}
            onChange={(e) => setContentFacebook(e.target.value)}
            rows={8}
            placeholder="Conteúdo para Facebook..."
            className="w-full px-4 py-3 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400 resize-y font-mono"
          />
        )}
      </div>

      {/* Carousel slides preview */}
      {carouselSlides.length > 0 && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-navy-600 mb-2">Carrossel Instagram ({carouselSlides.length} slides)</label>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
            {carouselSlides.map((svg, i) => (
              <div key={i} style={{ flexShrink: 0 }}>
                <img
                  src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)}
                  width={270}
                  height={270}
                  style={{ borderRadius: 4, border: '1px solid #e2e8f0', display: 'block' }}
                />
                <button
                  type="button"
                  onClick={() => downloadSvg(svg, i)}
                  className="mt-1.5 w-full px-2 py-1 bg-gold-400 text-navy-700 text-xs font-semibold rounded-[2px] hover:bg-gold-300"
                >
                  ↓ Slide {i + 1}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Schedule */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-navy-600 mb-1">Data / Hora de Agendamento (opcional)</label>
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="px-4 py-2.5 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={() => handleSave('draft')}
          disabled={saving}
          className="px-5 py-2 border border-navy-300 text-navy-700 text-sm font-medium rounded-[2px] hover:bg-navy-50 disabled:opacity-50"
        >
          {saving ? 'A guardar...' : 'Guardar Rascunho'}
        </button>
        <button
          onClick={() => handleSave('scheduled')}
          disabled={saving || !scheduledAt}
          className="px-5 py-2 bg-gold-400 text-navy-700 text-sm font-semibold rounded-[2px] hover:bg-gold-300 disabled:opacity-50"
        >
          {saving ? 'A agendar...' : 'Agendar'}
        </button>
      </div>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const POLICY_STATUS_LABEL: Record<string, string> = {
  active: 'Ativa', ativa: 'Ativa',
  expiring: 'A Renovar',
  expired: 'Expirada', expirada: 'Expirada',
  cancelled: 'Cancelada', cancelada: 'Cancelada',
}
const POLICY_STATUS_CLASS: Record<string, string> = {
  active: 'bg-green-100 text-green-700', ativa: 'bg-green-100 text-green-700',
  expiring: 'bg-yellow-100 text-yellow-700',
  expired: 'bg-red-100 text-red-700', expirada: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-600', cancelada: 'bg-gray-100 text-gray-600',
}

// ─── Admin Policy List ────────────────────────────────────────────────────────

function AdminPolicyList({ policies, documents, companies, individualClients, onReload }: {
  policies: Policy[]
  documents: DocType[]
  companies: Company[]
  individualClients: IndividualClient[]
  onReload: () => Promise<void>
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (policies.length === 0) return <p className="text-navy-500 text-sm">Sem apólices para o filtro selecionado.</p>

  return (
    <div className="flex flex-col gap-3">
      {policies.map((policy) => {
        const clientName = companies.find(c => c.id === policy.companyId)?.name
          ?? individualClients.find(c => c.id === policy.individualClientId)?.fullName
          ?? '—'
        const policyDocs = documents.filter(d => d.policyId === policy.id)
        const availableDocs = documents
          .filter(d => !d.policyId && (
            (policy.companyId && d.companyId === policy.companyId) ||
            (policy.individualClientId && !d.companyId)
          ))
          .map(d => ({
            ...d,
            clientLabel: companies.find(c => c.id === d.companyId)?.name
              ?? individualClients.find(c => c.id === (d as any).individualClientId)?.fullName
              ?? 'Sem cliente',
          }))
        const isEditing = editingId === policy.id
        const isExpanded = expandedId === policy.id

        return (
          <div key={policy.id} className="bg-white rounded-[4px] border border-navy-200 overflow-hidden">
            {/* Summary row */}
            <div className="flex items-center gap-3 px-4 py-3">
              <button onClick={() => setExpandedId(isExpanded ? null : policy.id)} className="text-navy-400 hover:text-navy-600 text-xs">
                {isExpanded ? '▾' : '▸'}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-navy-700">{POLICY_TYPE_LABELS[policy.type as keyof typeof POLICY_TYPE_LABELS] ?? policy.type}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${POLICY_STATUS_CLASS[policy.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {POLICY_STATUS_LABEL[policy.status] ?? policy.status}
                  </span>
                  <span className="text-xs text-navy-500">{clientName}</span>
                  <span className="text-xs text-navy-400">{policy.insurer} · {policy.policyNumber}</span>
                </div>
                <p className="text-xs text-navy-400 mt-0.5">{formatCurrency(policy.annualPremium)}/ano · {formatDate(policy.endDate)}</p>
              </div>
              <button
                onClick={() => {
                  if (isEditing) {
                    setEditingId(null)
                  } else {
                    setEditingId(policy.id)
                    setExpandedId(policy.id)
                  }
                }}
                className="px-2.5 py-1 text-xs border border-navy-300 rounded hover:bg-navy-50 whitespace-nowrap"
              >
                {isEditing ? 'Cancelar' : 'Editar'}
              </button>
            </div>

            {/* Expanded content: edit form OR details, plus documents (always shown when expanded or editing) */}
            {(isExpanded || isEditing) && (
              <div className="border-t border-navy-100 bg-navy-50/30 p-4 space-y-4">
                {isEditing ? (
                  <PolicyEditForm
                    policy={policy}
                    onSave={async (updates) => {
                      await adminUpdatePolicy({ data: { id: policy.id, updates } })
                      setEditingId(null)
                      await onReload()
                    }}
                  />
                ) : (
                  <div>
                    <p className="text-xs font-semibold text-navy-600 uppercase tracking-wide mb-2">Detalhes da Apólice</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-navy-600">
                      <p><strong>Seguradora:</strong> {policy.insurer}</p>
                      <p><strong>N.º Apólice:</strong> {policy.policyNumber}</p>
                      <p><strong>Estado:</strong> {POLICY_STATUS_LABEL[policy.status] ?? policy.status}</p>
                      <p><strong>Início:</strong> {formatDate(policy.startDate)}</p>
                      <p><strong>Fim:</strong> {formatDate(policy.endDate)}</p>
                      {policy.renewalDate && <p><strong>Renovação:</strong> {formatDate(policy.renewalDate)}</p>}
                      <p><strong>Prémio Anual:</strong> {formatCurrency(policy.annualPremium)}</p>
                      <p><strong>Capital Seguro:</strong> {formatCurrency(policy.insuredValue)}</p>
                      {policy.deductible != null && <p><strong>Franquia:</strong> {formatCurrency(policy.deductible)}</p>}
                      {policy.paymentFrequency && <p><strong>Pagamento:</strong> {policy.paymentFrequency}</p>}
                    </div>
                    {policy.description && <p className="text-xs text-navy-500 mt-2"><strong>Descrição:</strong> {policy.description}</p>}
                    {policy.coverages && policy.coverages.length > 0 && (
                      <p className="text-xs text-navy-600 mt-1"><strong>Coberturas:</strong> {policy.coverages.join(', ')}</p>
                    )}
                    {policy.exclusions && policy.exclusions.length > 0 && (
                      <p className="text-xs text-navy-600 mt-1"><strong>Exclusões:</strong> {policy.exclusions.join(', ')}</p>
                    )}
                  </div>
                )}

                {/* Documents — always visible when row is expanded or editing */}
                <div className="border-t border-navy-200 pt-4">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <p className="text-xs font-semibold text-navy-600 uppercase tracking-wide">Documentos associados</p>
                    <PolicyDocumentUpload
                      policyId={policy.id}
                      companyId={policy.companyId}
                      individualClientId={policy.individualClientId}
                      onUploaded={onReload}
                    />
                  </div>
                  {policyDocs.length === 0
                    ? <p className="text-xs text-navy-400 mb-3">Nenhum documento associado.</p>
                    : <ul className="mb-3 space-y-1.5">
                        {policyDocs.map(d => (
                          <li key={d.id} className="text-xs text-navy-600 flex items-center gap-2 flex-wrap">
                            <span>📄</span>
                            <span className="font-medium">{d.name}</span>
                            <span className="text-navy-400">· {d.category}</span>
                            <PolicyDocumentButtons storagePath={d.blobKey} name={d.name} />
                            <DeleteDocumentButton documentId={d.id} storagePath={d.blobKey} name={d.name} onDeleted={onReload} />
                          </li>
                        ))}
                      </ul>
                  }
                  <AssociateDocumentDropdown
                    policyId={policy.id}
                    availableDocs={availableDocs}
                    onAssociated={onReload}
                  />
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AssociateDocumentDropdown({ policyId, availableDocs, onAssociated }: {
  policyId: string
  availableDocs: (DocType & { clientLabel: string })[]
  onAssociated: () => Promise<void>
}) {
  const [selected, setSelected] = useState('')
  const [saving, setSaving] = useState(false)

  if (availableDocs.length === 0) return null

  return (
    <div className="flex items-center gap-2 mt-1">
      <select
        value={selected}
        onChange={e => setSelected(e.target.value)}
        className="text-xs border border-navy-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-gold-400"
      >
        <option value="">Associar documento...</option>
        {availableDocs.map(d => (
          <option key={d.id} value={d.id}>{d.name} — {d.clientLabel} ({d.category})</option>
        ))}
      </select>
      <button
        disabled={!selected || saving}
        onClick={async () => {
          setSaving(true)
          await adminAssociateDocument({ data: { documentId: selected, policyId } })
          setSelected('')
          setSaving(false)
          await onAssociated()
        }}
        className="px-3 py-1 text-xs bg-gold-400 text-navy-700 font-semibold rounded hover:bg-gold-300 disabled:opacity-50"
      >
        {saving ? '...' : 'Associar'}
      </button>
    </div>
  )
}

function PolicyDocumentButtons({ storagePath, name }: { storagePath: string; name: string }) {
  const [loading, setLoading] = useState(false)

  const getUrl = async () => {
    setLoading(true)
    try {
      const { url } = await adminGetDocumentUrl({ data: { storagePath } })
      return url
    } finally {
      setLoading(false)
    }
  }

  return (
    <span className="flex gap-1">
      <button
        disabled={loading}
        onClick={async () => { const url = await getUrl(); window.open(url, '_blank') }}
        className="px-1.5 py-0.5 text-xs border border-navy-200 rounded hover:bg-navy-50 disabled:opacity-50"
        title="Preview"
      >
        👁
      </button>
      <button
        disabled={loading}
        onClick={async () => {
          const url = await getUrl()
          const a = document.createElement('a')
          a.href = url; a.download = name; a.click()
        }}
        className="px-1.5 py-0.5 text-xs border border-navy-200 rounded hover:bg-navy-50 disabled:opacity-50"
        title="Download"
      >
        ↓
      </button>
    </span>
  )
}

function DeleteDocumentButton({ documentId, storagePath, name, onDeleted }: {
  documentId: string
  storagePath: string
  name: string
  onDeleted: () => Promise<void>
}) {
  const [deleting, setDeleting] = useState(false)

  return (
    <button
      disabled={deleting}
      onClick={async () => {
        if (!confirm(`Eliminar o documento "${name}"?`)) return
        setDeleting(true)
        try {
          await adminDeletePolicyDocument({ data: { documentId, storagePath } })
          await onDeleted()
        } catch (err: any) {
          alert(err?.message ?? 'Erro ao eliminar documento')
        } finally {
          setDeleting(false)
        }
      }}
      className="px-1.5 py-0.5 text-xs border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
      title="Eliminar"
    >
      {deleting ? '...' : '✕'}
    </button>
  )
}

function PolicyDocumentUpload({ policyId, companyId, individualClientId, onUploaded }: {
  policyId: string
  companyId?: string
  individualClientId?: string
  onUploaded: () => Promise<void>
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError('')
    try {
      const storagePath = `policies/${policyId}/${Date.now()}-${file.name}`
      const { error: upErr } = await supabase.storage.from('documents').upload(storagePath, file)
      if (upErr) throw new Error(upErr.message)
      await adminUploadPolicyDocument({
        data: {
          policyId,
          companyId: companyId || undefined,
          individualClientId: individualClientId || undefined,
          name: file.name,
          storagePath,
          size: file.size,
          category: file.type.startsWith('image/') ? 'certificate' : 'policy',
        },
      })
      await onUploaded()
    } catch (err: any) {
      setError(err?.message ?? 'Erro no upload')
    } finally {
      setUploading(false)
      if (ref.current) ref.current.value = ''
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-500">{error}</span>}
      <button
        onClick={() => ref.current?.click()}
        disabled={uploading}
        className="px-2.5 py-1 text-xs bg-navy-700 text-white rounded hover:bg-navy-600 disabled:opacity-50 whitespace-nowrap"
      >
        {uploading ? 'A carregar...' : '↑ Fazer Upload'}
      </button>
      <input ref={ref} type="file" accept="application/pdf,image/*" className="hidden" onChange={handleFile} />
    </div>
  )
}

function PolicyEditForm({ policy, onSave }: { policy: Policy; onSave: (updates: Partial<Policy>) => Promise<void> }) {
  const [form, setForm] = useState({
    type: policy.type ?? '',
    insurer: policy.insurer ?? '',
    policyNumber: policy.policyNumber ?? '',
    description: policy.description ?? '',
    startDate: policy.startDate ?? '',
    endDate: policy.endDate ?? '',
    renewalDate: policy.renewalDate ?? '',
    annualPremium: String(policy.annualPremium ?? ''),
    paymentFrequency: policy.paymentFrequency ?? '',
    status: policy.status ?? 'active',
    visiblePortal: policy.visiblePortal ?? true,
    emergencyContacts: policy.emergencyContacts ?? '',
    commissionPercentage: String(policy.commissionPercentage ?? ''),
    commissionValue: String(policy.commissionValue ?? ''),
    deductible: String(policy.deductible ?? ''),
    notesInternal: policy.notesInternal ?? '',
  })
  const [saving, setSaving] = useState(false)
  const u = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    await onSave({
      type: form.type as any,
      insurer: form.insurer,
      policyNumber: form.policyNumber,
      description: form.description,
      startDate: form.startDate,
      endDate: form.endDate,
      renewalDate: form.renewalDate || undefined,
      annualPremium: parseFloat(form.annualPremium) || 0,
      paymentFrequency: form.paymentFrequency || undefined,
      status: form.status as any,
      visiblePortal: form.visiblePortal,
      emergencyContacts: form.emergencyContacts || undefined,
      commissionPercentage: form.commissionPercentage ? parseFloat(form.commissionPercentage) : undefined,
      commissionValue: form.commissionValue ? parseFloat(form.commissionValue) : undefined,
      deductible: form.deductible ? parseFloat(form.deductible) : undefined,
      notesInternal: form.notesInternal || undefined,
    })
    setSaving(false)
  }

  const inp = 'w-full px-3 py-2 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-1 focus:ring-gold-400'
  const lbl = 'block text-xs font-semibold text-navy-500 uppercase tracking-wide mb-1'

  return (
    <div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <div>
          <label className={lbl}>Tipo</label>
          <select value={form.type} onChange={e => u('type', e.target.value)} className={inp}>
            {Object.entries(POLICY_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Seguradora</label>
          <input className={inp} value={form.insurer} onChange={e => u('insurer', e.target.value)} />
        </div>
        <div>
          <label className={lbl}>N.º Apólice</label>
          <input className={inp} value={form.policyNumber} onChange={e => u('policyNumber', e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Estado</label>
          <select value={form.status} onChange={e => u('status', e.target.value)} className={inp}>
            {Object.entries(POLICY_STATUS_LABEL)
              .filter(([k]) => ['active','expiring','expired','cancelled'].includes(k))
              .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Início</label>
          <input type="date" className={inp} value={form.startDate} onChange={e => u('startDate', e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Fim</label>
          <input type="date" className={inp} value={form.endDate} onChange={e => u('endDate', e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Data Renovação</label>
          <input type="date" className={inp} value={form.renewalDate} onChange={e => u('renewalDate', e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Prémio Anual (€)</label>
          <input type="number" className={inp} value={form.annualPremium} onChange={e => u('annualPremium', e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Periodicidade</label>
          <input className={inp} value={form.paymentFrequency} onChange={e => u('paymentFrequency', e.target.value)} placeholder="Mensal, Anual..." />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className={lbl}>Descrição (visível no portal)</label>
          <input className={inp} value={form.description} onChange={e => u('description', e.target.value)} />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className={lbl}>Contactos de Emergência (visível no portal)</label>
          <input className={inp} value={form.emergencyContacts} onChange={e => u('emergencyContacts', e.target.value)} placeholder="Linha de Assistência: 800 XXX XXX" />
        </div>
        <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-2">
          <input type="checkbox" id={`vp-${policy.id}`} checked={form.visiblePortal} onChange={e => u('visiblePortal', e.target.checked)} className="accent-gold-400" />
          <label htmlFor={`vp-${policy.id}`} className="text-sm text-navy-600 cursor-pointer">Visível no Adler One</label>
        </div>
      </div>

      <p className="text-xs font-semibold text-navy-400 uppercase tracking-wide mb-2 mt-1">Campos Internos (só admin)</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <div>
          <label className={lbl}>Comissão %</label>
          <input type="number" className={inp} value={form.commissionPercentage} onChange={e => u('commissionPercentage', e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Comissão €</label>
          <input type="number" className={inp} value={form.commissionValue} onChange={e => u('commissionValue', e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Franquia (€)</label>
          <input type="number" className={inp} value={form.deductible} onChange={e => u('deductible', e.target.value)} />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className={lbl}>Notas Internas</label>
          <textarea className={inp + ' resize-y'} rows={3} value={form.notesInternal} onChange={e => u('notesInternal', e.target.value)} />
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-5 py-2 bg-gold-400 text-navy-700 text-sm font-semibold rounded-[2px] hover:bg-gold-300 disabled:opacity-50"
      >
        {saving ? 'A guardar...' : 'Guardar Alterações'}
      </button>
    </div>
  )
}

function FormField({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-navy-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2.5 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400"
        required={required}
      />
    </div>
  )
}
