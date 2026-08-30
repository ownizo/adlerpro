import { createFileRoute, Navigate, Link } from '@tanstack/react-router'
import { BillingTab } from '@/components/billing/BillingTab'
import { AppLayout } from '@/components/AppLayout'
import {
  fetchAdminAll,
  adminCreatePolicy,
  deletePolicy,
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
  adminGrantIndividualClientAccess,
  adminResetIndividualClientPassword,
  adminRevokeIndividualClientAccess,
  adminPromoteToCompany,
  adminUpdatePolicy,
  adminUploadPolicyDocument,
  adminGetDocumentUrl,
  getStorageUploadUrl,
  fetchPolicyDocuments,
  adminDeletePolicyDocument,
  adminCreateClaim,
  fetchClaimWorkspace,
  adminAssignClaimResponsible,
  adminAddClaimTeamNote,
  adminSendClaimMessage,
  registerClaimDocument,
  removeClaimDocument,
  getClaimDocumentUrl,
  fetchAdminFinancialDashboard,
  getRenewalAlerts,
  adminUpdateRenewalAlertStatus,
  adminTriggerRenewalAlerts,
  adminSendPolicyDocument,
  fetchSalesPipelineStats,
} from '@/lib/server-fns'
import { formatCurrency, formatDate, formatFileSize } from '@/lib/utils'
import type {
  Company,
  Policy,
  Claim,
  Document as DocType,
  CompanyUser,
  UserMetricEvent,
  ApiConnection,
  IndividualClient,
  AdminFinancialDashboardData,
  RenewalAlertItem,
  RenewalAlertsResponse,
  RenewalAlertStatus,
  ClaimOperationalData,
  SalesOpportunityStage,
} from '@/lib/types'
import { POLICY_TYPE_LABELS_EN as POLICY_TYPE_LABELS, CLAIM_STATUS_LABELS_EN as CLAIM_STATUS_LABELS } from '@/lib/types'
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useIdentity } from '@/lib/identity-context'
import { supabase } from '@/lib/supabase'
import { ClientProfilePanel } from '@/components/admin/ClientProfilePanel'
import { AdminTasksPanel } from '@/components/admin/AdminTasksPanel'
import { AdminMarketingPanel } from '@/components/admin/AdminMarketingPanel'
import { SalesWorkspace } from '@/components/admin/sales/SalesWorkspace'
import { SALES_OPPORTUNITY_STAGES } from '@/lib/sales-opportunity-rules'
async function exportToExcel(data: Record<string, unknown>[], filename: string) {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Dados')
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

const ADMIN_TABS = ['dashboard', 'companies', 'individual_clients', 'policies', 'claims', 'billing', 'api', 'profiles', 'tasks', 'alerts', 'marketing', 'sales'] as const
type AdminTab = (typeof ADMIN_TABS)[number]
const RENEWAL_ALERT_STATUS_LABELS: Record<RenewalAlertStatus, string> = {
  pending: 'Pending',
  negotiating: 'Negotiating',
  renewed: 'Renewed',
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
  pending: 'pending',
  negotiating: 'negotiating',
  renewed: 'renewed',
}

function renewalColumnByStatus(status: RenewalAlertStatus): RenewalKanbanColumnId {
  if (status === 'negotiating') return 'negotiating'
  if (status === 'renewed') return 'renewed'
  return 'pending'
}

function buildRenewalAlertsView(alerts: RenewalAlertItem[]) {
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
    if (entry.newStatus === 'pending' && pendingAt === null) pendingAt = changedAt
    if (entry.previousStatus === 'pending' && pendingAt === null) pendingAt = changedAt
  }

  if (pendingAt === null) return null

  for (const entry of sortedHistory) {
    if (entry.newStatus !== 'renewed') continue
    const renewedAt = new Date(entry.changedAt).getTime()
    if (!Number.isFinite(renewedAt) || renewedAt < pendingAt) continue
    return (renewedAt - pendingAt) / (1000 * 60 * 60 * 24)
  }

  return null
}

function buildRenewalPipelineIntelligence(alerts: RenewalAlertItem[]): RenewalPipelineIntelligence {
  const totalAlerts = alerts.length
  const renewedCount = alerts.filter((alert) => alert.status === 'renewed').length
  const pendingOrNegotiatingCount = alerts.filter((alert) => alert.status !== 'renewed').length
  const renewalRatePct = totalAlerts > 0 ? (renewedCount / totalAlerts) * 100 : 0

  const durations = alerts
    .map(calculatePendingToRenewedDurationDays)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
  const avgDaysPendingToRenewed = durations.length
    ? durations.reduce((sum, value) => sum + value, 0) / durations.length
    : null

  const valueAtRiskByPeriod: RenewalRiskByPeriod[] = ([30, 60, 90] as const).map((urgency) => {
    const periodAlerts = alerts.filter((alert) => alert.urgency === urgency && alert.status !== 'renewed')
    return {
      urgency,
      alertsCount: periodAlerts.length,
      valueAtRisk: periodAlerts.reduce((sum, alert) => sum + alert.value, 0),
    }
  })

  const riskByClient = new Map<string, RenewalTopRiskClient>()
  for (const alert of alerts) {
    if (alert.status === 'renewed') continue
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
  const overduePending = alerts.filter((alert) => alert.status !== 'renewed' && alert.daysUntilRenewal <= 30)
  const unassignedCount = alerts.filter((alert) => alert.status !== 'renewed' && !alert.assignedTo?.trim()).length

  const insights: string[] = []
  if (totalAlerts === 0) {
    insights.push('No active alerts in the current period to generate insights.')
  } else {
    insights.push(`Current renewal rate at ${formatPctValue(renewalRatePct)} (${renewedCount}/${totalAlerts}).`)
    if (highestRiskPeriod && highestRiskPeriod.valueAtRisk > 0) {
      insights.push(`Highest risk concentration at D-${highestRiskPeriod.urgency}: ${formatCurrency(highestRiskPeriod.valueAtRisk)}.`)
    }
    if (topRiskClients[0]) {
      const topClient = topRiskClients[0]
      insights.push(`Highest financial risk concentrated on ${topClient.client} (${formatCurrency(topClient.valueAtRisk)}).`)
    }
    if (avgDaysPendingToRenewed !== null) {
      insights.push(`Average pending → renewed transition time is ${avgDaysPendingToRenewed.toFixed(1)} days (${durations.length} cases).`)
    }
    if (overduePending.length > 0) {
      insights.push(`${overduePending.length} policies renewing within 30 days still without a renewed status.`)
    }
    if (unassignedCount > 0) {
      insights.push(`${unassignedCount} at-risk policies still without an owner assigned.`)
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

// Deep-link leve para métricas clicáveis do dashboard comercial (ver
// requisito "clickable metrics") — sem arquitetura de routing nova: só mais
// dois parâmetros opcionais de pesquisa, lidos uma vez por SalesWorkspace
// para semear os filtros iniciais do separador Comercial.
function isSalesStageParam(value: unknown): value is SalesOpportunityStage {
  return typeof value === 'string' && (SALES_OPPORTUNITY_STAGES as string[]).includes(value)
}

// Anotado explicitamente com propriedades opcionais (`?:`, não `| undefined`)
// para que <Link search={{ tab: '...' }}> continue válido nos restantes
// pontos do ficheiro sem ter de passar sempre stage/overdue também.
export const Route = createFileRoute('/admin')({
  validateSearch: (search: Record<string, unknown>): { tab?: AdminTab; stage?: SalesOpportunityStage; overdue?: boolean } => ({
    tab: isAdminTab(search.tab) ? search.tab : undefined,
    stage: isSalesStageParam(search.stage) ? search.stage : undefined,
    overdue: search.overdue === '1' || search.overdue === true ? true : undefined,
  }),
  component: AdminPage,
  head: () => ({ meta: [{ title: 'Os Meus Seguros · Admin' }] }),
})

function AdminPage() {
  const { user, ready } = useIdentity()
  const { tab: searchTab, stage: searchStage, overdue: searchOverdue } = Route.useSearch()
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
  const [websiteLeadClientIds, setWebsiteLeadClientIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [showNewCompany, setShowNewCompany] = useState(false)
  const [showNewPolicy, setShowNewPolicy] = useState(false)
  const [showNewIndividualClient, setShowNewIndividualClient] = useState(false)
  const [editingIndividualClientId, setEditingIndividualClientId] = useState<string | null>(null)
  const [expandedIndividualClientId, setExpandedIndividualClientId] = useState<string | null>(null)
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null)
  const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(null)
  const [selectedIndividualClientIds, setSelectedIndividualClientIds] = useState<Set<string>>(new Set())
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<string>>(new Set())
  const [bulkDeletingClients, setBulkDeletingClients] = useState(false)
  const [bulkDeletingCompanies, setBulkDeletingCompanies] = useState(false)
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<Set<string>>(new Set())
  const [bulkDeletingPolicies, setBulkDeletingPolicies] = useState(false)
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

  const reload = async () => {
    const { companies: c, companyUsers: u, userEvents: e, apiConnections: a, policies: p, claims: cl, claimOperationalSummary: cos, documents: d, individualClients: ic, websiteLeadClientIds: wlc } = await fetchAdminAll()
    setCompanies(c)
    setCompanyUsers(u)
    setUserEvents(e)
    setApiConnections(a)
    setPolicies(p)
    setClaims(cl)
    setClaimOperationalSummary(cos ?? {})
    setDocuments(d)
    setIndividualClients(ic ?? [])
    setWebsiteLeadClientIds(new Set(wlc ?? []))
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
      <div>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {tab === 'dashboard' && (
              <AdminDashboardTab
                companies={companies}
                companyUsers={companyUsers}
                policies={policies}
                claims={claims}
                documents={documents}
                individualClients={individualClients}
                apiConnections={apiConnections}
              />
            )}

            {tab === 'companies' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-navy-700">Companies ({companies.length})</h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        await exportToExcel(companies.map((c) => ({
                          Name: c.name,
                          NIF: c.nif,
                          Sector: c.sector,
                          'Contact Person': c.contactName,
                          Email: c.contactEmail,
                          Phone: c.contactPhone,
                          Address: c.address,
                          'Access Email': c.accessEmail || '',
                          'Created At': c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-GB') : '',
                        })), 'companies')
                      }}
                      disabled={companies.length === 0}
                      className="px-4 py-2 border border-navy-300 text-navy-700 font-medium rounded-[2px] hover:bg-navy-50 transition-colors text-sm disabled:opacity-50"
                    >
                      Export Excel
                    </button>
                    <button
                      onClick={() => {
                        setEditingCompanyId(null)
                        setShowNewCompany(!showNewCompany)
                      }}
                      className="admin-btn admin-btn-primary"
                  >
                    {showNewCompany ? 'Cancel' : 'New company'}
                  </button>
                  </div>
                </div>

                {showNewCompany && (
                  <CompanyForm
                    title={editingCompanyId ? 'Edit company' : 'New company'}
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

                {companies.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3 px-3 py-2 bg-navy-50 border border-navy-200 rounded-[4px]">
                    <label className="flex items-center gap-2 text-sm text-navy-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={companies.length > 0 && selectedCompanyIds.size === companies.length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedCompanyIds(new Set(companies.map((c) => c.id)))
                          } else {
                            setSelectedCompanyIds(new Set())
                          }
                        }}
                        className="w-4 h-4 accent-[#17243D]"
                      />
                      Select all
                    </label>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-navy-500">
                        {selectedCompanyIds.size} selected
                      </span>
                      <button
                        disabled={selectedCompanyIds.size === 0 || bulkDeletingCompanies}
                        onClick={async () => {
                          if (selectedCompanyIds.size === 0) return
                          if (!confirm(`Delete ${selectedCompanyIds.size} compan${selectedCompanyIds.size === 1 ? 'y' : 'ies'} and their data? This action cannot be undone.`)) return
                          setBulkDeletingCompanies(true)
                          try {
                            const ids = Array.from(selectedCompanyIds)
                            const results = await Promise.allSettled(ids.map((id) => adminDeleteCompany({ data: id })))
                            const failed = results.filter((r) => r.status === 'rejected')
                            if (failed.length > 0) {
                              alert(`Failed to delete ${failed.length} of ${ids.length} compan${ids.length === 1 ? 'y' : 'ies'}. Please check and try again.`)
                            }
                            setSelectedCompanyIds(new Set())
                            setExpandedCompanyId(null)
                            await reload()
                          } catch (err) {
                            alert(`Error deleting companies: ${err instanceof Error ? err.message : 'Unknown error'}`)
                          } finally {
                            setBulkDeletingCompanies(false)
                          }
                        }}
                        className="px-3 py-1.5 text-xs bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {bulkDeletingCompanies ? 'Deleting…' : 'Delete selected'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid gap-4">
                  {companies.map((company) => {
                    const companyPolicies = policies.filter((policy) => policy.companyId === company.id)
                    const companyDocs = documents.filter((doc) => doc.companyId === company.id)
                    const users = companyUsers.filter((user) => user.companyId === company.id)
                    const isExpanded = expandedCompanyId === company.id
                    const isSelected = selectedCompanyIds.has(company.id)

                    return (
                      <div key={company.id} className="bg-white rounded-[4px] border border-navy-200 overflow-hidden">
                        <div className="flex items-stretch">
                          <div className="flex items-start pl-4 pt-6">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                setSelectedCompanyIds((prev) => {
                                  const next = new Set(prev)
                                  if (e.target.checked) next.add(company.id)
                                  else next.delete(company.id)
                                  return next
                                })
                              }}
                              className="w-4 h-4 accent-[#17243D] cursor-pointer"
                            />
                          </div>
                          <button
                            onClick={() => setExpandedCompanyId(isExpanded ? null : company.id)}
                            className="flex-1 p-6 text-left hover:bg-navy-50/50 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <h3 className="text-lg font-semibold text-navy-700">{company.name}</h3>
                                <p className="text-sm text-navy-500 mt-1">NIF {company.nif} · {company.sector}</p>
                                <p className="text-xs text-navy-400 mt-1">{company.address}</p>
                                <p className="text-xs text-navy-500 mt-2">Company access: {company.accessEmail || '-'}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-medium text-navy-700">{users.length} users</p>
                                <p className="text-sm text-navy-500">{companyPolicies.length} policies</p>
                                <p className="text-sm text-navy-500">{companyDocs.length} documents</p>
                              </div>
                            </div>
                          </button>
                          <div className="flex flex-col gap-1 p-4 border-l border-navy-100" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => {
                                setEditingCompanyId(company.id)
                                setShowNewCompany(true)
                              }}
                              className="px-3 py-1.5 text-xs border border-navy-300 rounded hover:bg-navy-50"
                            >
                              Edit
                            </button>
                            <button
                              onClick={async () => {
                                if (!confirm(`Delete company ${company.name} and its data?`)) return
                                try {
                                  await adminDeleteCompany({ data: company.id })
                                  setSelectedCompanyIds((prev) => {
                                    const next = new Set(prev)
                                    next.delete(company.id)
                                    return next
                                  })
                                  if (expandedCompanyId === company.id) setExpandedCompanyId(null)
                                  await reload()
                                } catch (err) {
                                  alert(`Error deleting company: ${err instanceof Error ? err.message : 'Unknown error'}`)
                                }
                              }}
                              className="admin-row-action admin-row-action--danger"
                            >
                              Delete
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="border-t border-navy-100 bg-navy-50/50 p-6 space-y-6">
                            <div>
                              <h4 className="text-sm font-semibold text-navy-700 mb-3">Contact Details</h4>
                              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-white rounded border border-navy-200 p-4">
                                <div>
                                  <p className="text-[11px] uppercase tracking-wide text-navy-400">Contact Person</p>
                                  <p className="text-sm text-navy-700">{company.contactName || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-wide text-navy-400">Email</p>
                                  <p className="text-sm text-navy-700 break-all">{company.contactEmail || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-wide text-navy-400">Phone</p>
                                  <p className="text-sm text-navy-700">{company.contactPhone || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-wide text-navy-400">NIF</p>
                                  <p className="text-sm text-navy-700">{company.nif || '—'}</p>
                                </div>
                                <div className="sm:col-span-2 lg:col-span-2">
                                  <p className="text-[11px] uppercase tracking-wide text-navy-400">Address</p>
                                  <p className="text-sm text-navy-700">{company.address || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-wide text-navy-400">Sector</p>
                                  <p className="text-sm text-navy-700">{company.sector || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-wide text-navy-400">Access Email</p>
                                  <p className="text-sm text-navy-700 break-all">{company.accessEmail || '—'}</p>
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => {
                                  setEditingCompanyId(company.id)
                                  setShowNewCompany(true)
                                }}
                                className="admin-btn admin-btn-secondary admin-btn--sm"
                              >
                                Edit company
                              </button>
                              <button
                                onClick={async () => {
                                  if (!confirm(`Delete company ${company.name} and its data?`)) return
                                  try {
                                    await adminDeleteCompany({ data: company.id })
                                    await reload()
                                    setExpandedCompanyId(null)
                                  } catch (err) {
                                    alert(`Error deleting company: ${err instanceof Error ? err.message : 'Unknown error'}`)
                                  }
                                }}
                                className="admin-btn admin-btn-danger admin-btn--sm"
                              >
                                Delete company
                              </button>
                              <button
                                onClick={() => setShowUserFormForCompanyId(showUserFormForCompanyId === company.id ? null : company.id)}
                                className="admin-btn admin-btn-primary admin-btn--sm"
                              >
                                {showUserFormForCompanyId === company.id ? 'Cancel new user' : 'Add user'}
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
                                <h4 className="text-sm font-semibold text-navy-700 mb-3">Company Users</h4>
                                <div className="bg-white rounded-[4px] border border-navy-200 overflow-hidden">
                                  <table className="w-full">
                                    <thead>
                                      <tr className="bg-navy-50 border-b border-navy-200">
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Name</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Email</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Role</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Actions</th>
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
                                                  const newPassword = prompt('New access password (Identity):')
                                                  if (!newPassword) return
                                                  await adminUpdateCompanyUser({
                                                    data: { id: user.id, updates: { accessPassword: newPassword } },
                                                  })
                                                  await reload()
                                                }}
                                                className="admin-row-action"
                                              >
                                                Reset password
                                              </button>
                                              <button
                                                onClick={async () => {
                                                  if (!confirm(`Delete user ${user.name}?`)) return
                                                  try {
                                                    await adminDeleteCompanyUser({ data: user.id })
                                                    await reload()
                                                  } catch (err) {
                                                    alert(`Error deleting user: ${err instanceof Error ? err.message : 'Unknown error'}`)
                                                  }
                                                }}
                                                className="admin-row-action admin-row-action--danger"
                                              >
                                                Delete
                                              </button>
                                            </div>
                                          </td>
                                        </tr>
                                      ))}
                                      {users.length === 0 && (
                                        <tr>
                                          <td colSpan={4} className="px-4 py-4 text-sm text-navy-400 text-center">
                                            No users registered for this company.
                                          </td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </div>

                              <div>
                                <h4 className="text-sm font-semibold text-navy-700 mb-3">Metrics &amp; History</h4>
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
                                        <p className="text-xs text-navy-500">Last login: {user.lastLoginAt ? formatDate(user.lastLoginAt) : '-'}</p>
                                        <p className="text-xs text-navy-500">Logins this month: {loginsThisMonth}</p>
                                        <p className="text-xs text-navy-500">Total events: {events.length}</p>
                                        <div className="mt-2 text-xs text-navy-500 space-y-1 max-h-24 overflow-y-auto">
                                          {events.slice(-5).reverse().map((event) => (
                                            <p key={event.id}>• {formatDate(event.timestamp)} · {event.description}</p>
                                          ))}
                                          {events.length === 0 && <p>No history.</p>}
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            </div>

                            <div>
                              <h4 className="text-sm font-semibold text-navy-700 mb-3">Company Policies ({companyPolicies.length})</h4>
                              {companyPolicies.length === 0 ? (
                                <p className="text-sm text-navy-400">No policies linked.</p>
                              ) : (
                                <div className="grid gap-2">
                                  {companyPolicies.map((policy) => (
                                    <PolicyExpandableCard key={policy.id} policy={policy} />
                                  ))}
                                </div>
                              )}
                            </div>
                            <ClientProfilePanel
                              subject={{ kind: 'company', company }}
                              policies={policies}
                              claims={claims}
                              documents={documents}
                            />
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
                <div className="admin-page-header" style={{ marginBottom: '1rem' }}>
                  <div>
                    <h1 className="admin-page-title">People</h1>
                    <p className="admin-page-subtitle">{individualClients.length} individual client{individualClients.length !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        await exportToExcel(individualClients.map((c) => ({
                          Name: c.fullName,
                          NIF: c.nif || '',
                          Email: c.email || '',
                          Phone: c.phone || '',
                          Address: c.address || '',
                          Status: c.status === 'active' ? 'Active' : c.status,
                          'Created At': c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-GB') : '',
                        })), 'people')
                      }}
                      disabled={individualClients.length === 0}
                      className="admin-btn admin-btn-secondary"
                    >
                      Export Excel
                    </button>
                    <button
                      onClick={() => {
                        setEditingIndividualClientId(null)
                        setShowNewIndividualClient(!showNewIndividualClient)
                      }}
                      className="admin-btn admin-btn-primary"
                    >
                      {showNewIndividualClient ? 'Cancel' : 'New person'}
                    </button>
                  </div>
                </div>

                {showNewIndividualClient && (
                  <IndividualClientForm
                    title={editingIndividualClientId ? 'Edit person' : 'New person'}
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

                {individualClients.length > 0 && (
                  <div className={`admin-selection-bar${selectedIndividualClientIds.size > 0 ? ' admin-selection-bar--active' : ''}`}>
                    <span>
                      {individualClients.length} individual clients{selectedIndividualClientIds.size > 0 ? ` · ${selectedIndividualClientIds.size} selected` : ''}
                    </span>
                    {selectedIndividualClientIds.size > 0 && (
                      <button
                        disabled={bulkDeletingClients}
                        onClick={async () => {
                          if (selectedIndividualClientIds.size === 0) return
                          if (!confirm(`Delete ${selectedIndividualClientIds.size} client(s)? This action cannot be undone.`)) return
                          setBulkDeletingClients(true)
                          try {
                            const ids = Array.from(selectedIndividualClientIds)
                            const results = await Promise.allSettled(ids.map((id) => adminDeleteIndividualClient({ data: id })))
                            const failed = results.filter((r) => r.status === 'rejected')
                            if (failed.length > 0) {
                              alert(`Failed to delete ${failed.length} of ${ids.length} client(s). Please check and try again.`)
                            }
                            setSelectedIndividualClientIds(new Set())
                            setExpandedIndividualClientId(null)
                            await reload()
                          } catch (err) {
                            alert(`Error deleting clients: ${err instanceof Error ? err.message : 'Unknown error'}`)
                          } finally {
                            setBulkDeletingClients(false)
                          }
                        }}
                        className="admin-btn admin-btn-danger admin-btn--sm"
                      >
                        {bulkDeletingClients ? 'Deleting…' : 'Delete selected'}
                      </button>
                    )}
                  </div>
                )}

                <div className="admin-table-wrap overflow-x-auto">
                  <table className="admin-table w-full min-w-[1100px]">
                    <thead>
                      <tr className="bg-navy-50 border-b border-navy-200">
                        <th className="px-4 py-3 w-10">
                          <input
                            type="checkbox"
                            checked={individualClients.length > 0 && selectedIndividualClientIds.size === individualClients.length}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedIndividualClientIds(new Set(individualClients.map((c) => c.id)))
                              } else {
                                setSelectedIndividualClientIds(new Set())
                              }
                            }}
                            className="w-4 h-4 accent-[#17243D] cursor-pointer"
                          />
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Name</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">NIF</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Email</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Phone</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Status</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Type</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Portal</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-navy-100">
                      {individualClients.map((client) => {
                        const clientPolicies = policies.filter((p) => p.individualClientId === client.id)
                        const isExpanded = expandedIndividualClientId === client.id
                        const isSelected = selectedIndividualClientIds.has(client.id)
                        return (
                          <>
                            <tr
                              key={client.id}
                              className="hover:bg-navy-50/50 cursor-pointer"
                              onClick={() => setExpandedIndividualClientId(isExpanded ? null : client.id)}
                            >
                              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    setSelectedIndividualClientIds((prev) => {
                                      const next = new Set(prev)
                                      if (e.target.checked) next.add(client.id)
                                      else next.delete(client.id)
                                      return next
                                    })
                                  }}
                                  className="w-4 h-4 accent-[#17243D] cursor-pointer"
                                />
                              </td>
                              <td className="px-4 py-3 text-sm font-medium text-navy-700">
                                <span className="mr-1 text-navy-400">{isExpanded ? '▾' : '▸'}</span>
                                {client.fullName}
                                {websiteLeadClientIds.has(client.id) && (
                                  <span
                                    title="Origem: Website"
                                    className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-600 align-middle"
                                  >
                                    Website
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-navy-500">{client.nif || '—'}</td>
                              <td className="px-4 py-3 text-sm text-navy-500">{client.email || '—'}</td>
                              <td className="px-4 py-3 text-sm text-navy-500">{client.phone || '—'}</td>
                              <td className="px-4 py-3">
                                <span className={`admin-chip ${client.status === 'active' ? 'admin-chip--success' : 'admin-chip--neutral'}`}>
                                  {client.status === 'active' ? 'Active' : client.status}
                                </span>
                              </td>
                              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                <PromoteToCompanySelect client={client} onSuccess={async () => { setIndividualClients([]); await reload(); setExpandedIndividualClientId(null) }} />
                              </td>
                              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                <ActivateAdlerOneButton client={client} onSuccess={reload} />
                              </td>
                              <td className="px-4 py-3">
                                <div className="admin-row-actions" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    onClick={() => {
                                      setEditingIndividualClientId(client.id)
                                      setShowNewIndividualClient(true)
                                      setExpandedIndividualClientId(null)
                                    }}
                                    className="admin-row-action"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={async () => {
                                      if (!confirm(`Delete client ${client.fullName}?`)) return
                                      try {
                                        await adminDeleteIndividualClient({ data: client.id })
                                        setSelectedIndividualClientIds((prev) => {
                                          const next = new Set(prev)
                                          next.delete(client.id)
                                          return next
                                        })
                                        await reload()
                                        setExpandedIndividualClientId(null)
                                      } catch (err) {
                                        alert(`Error deleting client: ${err instanceof Error ? err.message : 'Unknown error'}`)
                                      }
                                    }}
                                    className="admin-row-action admin-row-action--danger"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr key={`${client.id}-detail`}>
                                <td colSpan={9} className="bg-navy-50/50 px-6 py-4 border-b border-navy-100">
                                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                                    <div>
                                      <p className="text-[11px] uppercase tracking-wide text-navy-400">Email</p>
                                      <p className="text-sm text-navy-700 break-all">{client.email || '—'}</p>
                                    </div>
                                    <div>
                                      <p className="text-[11px] uppercase tracking-wide text-navy-400">Phone</p>
                                      <p className="text-sm text-navy-700">{client.phone || '—'}</p>
                                    </div>
                                    <div>
                                      <p className="text-[11px] uppercase tracking-wide text-navy-400">NIF</p>
                                      <p className="text-sm text-navy-700">{client.nif || '—'}</p>
                                    </div>
                                    <div className="sm:col-span-2 lg:col-span-1">
                                      <p className="text-[11px] uppercase tracking-wide text-navy-400">Address</p>
                                      <p className="text-sm text-navy-700">{client.address || '—'}</p>
                                    </div>
                                  </div>
                                  <h4 className="text-sm font-semibold text-navy-700 mb-3">
                                    Policies ({clientPolicies.length})
                                  </h4>
                                  {clientPolicies.length === 0 ? (
                                    <p className="text-sm text-navy-400">No policies linked.</p>
                                  ) : (
                                    <div className="grid gap-2">
                                      {clientPolicies.map((p) => (
                                        <PolicyExpandableCard key={p.id} policy={p} />
                                      ))}
                                    </div>
                                  )}
                                  <ClientProfilePanel
                                    subject={{ kind: 'individual', client }}
                                    policies={policies}
                                    claims={claims}
                                    documents={documents}
                                  />
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })}
                      {individualClients.length === 0 && (
                        <tr>
                          <td colSpan={9} className="px-4 py-8 text-sm text-navy-400 text-center">
                            No individual clients registered.
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
                    <h1 className="admin-page-title" style={{ fontSize: "17px" }}>Policies</h1>
                    <span className="text-sm text-navy-500">Filter by client:</span>
                    <select
                      value={selectedCompanyId}
                      onChange={(e) => setSelectedCompanyId(e.target.value)}
                      className="px-4 py-2 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-[#223553] min-w-48"
                    >
                      <option value="">All clients</option>
                      {companies.length > 0 && (
                        <optgroup label="── Companies ──">
                          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </optgroup>
                      )}
                      {individualClients.length > 0 && (
                        <optgroup label="── Individual Clients ──">
                          {individualClients.map((c) => <option key={c.id} value={`ic:${c.id}`}>{c.fullName}</option>)}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        const filtered = policies.filter((p) => {
                          if (!selectedCompanyId) return true
                          if (selectedCompanyId.startsWith('ic:')) return p.individualClientId === selectedCompanyId.slice(3)
                          return p.companyId === selectedCompanyId
                        })
                        await exportToExcel(filtered.map((p) => ({
                          'Policy No.': p.policyNumber,
                          Type: POLICY_TYPE_LABELS[p.type as keyof typeof POLICY_TYPE_LABELS] ?? p.type,
                          Insurer: p.insurer,
                          Client: companies.find(c => c.id === p.companyId)?.name ?? individualClients.find(c => c.id === p.individualClientId)?.fullName ?? '',
                          Description: p.description,
                          'Start Date': p.startDate ? new Date(p.startDate).toLocaleDateString('en-GB') : '',
                          'End Date': p.endDate ? new Date(p.endDate).toLocaleDateString('en-GB') : '',
                          'Annual Premium (€)': p.annualPremium ?? '',
                          'Insured Value (€)': p.insuredValue ?? '',
                          'Commission (%)': p.commissionPercentage ?? '',
                          'Commission (€)': p.commissionValue ?? '',
                          Status: p.status === 'active' ? 'Active' : p.status === 'expiring' ? 'Renewing' : p.status === 'expired' ? 'Expired' : p.status === 'cancelled' ? 'Cancelled' : p.status,
                          Frequency: p.paymentFrequency ?? '',
                        })), 'policies')
                      }}
                      disabled={policies.length === 0}
                      className="admin-btn admin-btn-secondary"
                    >
                      Export Excel
                    </button>
                    <button
                      onClick={() => setShowNewPolicy(!showNewPolicy)}
                      className="admin-btn admin-btn-primary"
                    >
                      {showNewPolicy ? 'Cancel' : 'New policy'}
                    </button>
                  </div>
                </div>

                {showNewPolicy && (
                  <NewPolicyForm
                    companies={companies}
                    individualClients={individualClients}
                    onSubmit={async (data) => {
                      try {
                        await adminCreatePolicy({ data })
                        await reload()
                        setShowNewPolicy(false)
                      } catch (err) {
                        alert(`Error creating policy: ${err instanceof Error ? err.message : 'Unknown error'}`)
                      }
                    }}
                  />
                )}

                {policies.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3 px-3 py-2 bg-navy-50 border border-navy-200 rounded-[4px]">
                    <label className="flex items-center gap-2 text-sm text-navy-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={policies.length > 0 && selectedPolicyIds.size === policies.filter((p) => {
                          if (!selectedCompanyId) return true
                          if (selectedCompanyId.startsWith('ic:')) return p.individualClientId === selectedCompanyId.slice(3)
                          return p.companyId === selectedCompanyId
                        }).length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            const filtered = policies.filter((p) => {
                              if (!selectedCompanyId) return true
                              if (selectedCompanyId.startsWith('ic:')) return p.individualClientId === selectedCompanyId.slice(3)
                              return p.companyId === selectedCompanyId
                            })
                            setSelectedPolicyIds(new Set(filtered.map((p) => p.id)))
                          } else {
                            setSelectedPolicyIds(new Set())
                          }
                        }}
                        className="w-4 h-4 accent-[#17243D]"
                      />
                      Select all
                    </label>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-navy-500">
                        {selectedPolicyIds.size} selected
                      </span>
                      <button
                        disabled={selectedPolicyIds.size === 0 || bulkDeletingPolicies}
                        onClick={async () => {
                          if (selectedPolicyIds.size === 0) return
                          if (!confirm(`Delete ${selectedPolicyIds.size} polic${selectedPolicyIds.size === 1 ? 'y' : 'ies'}? This action cannot be undone.`)) return
                          setBulkDeletingPolicies(true)
                          try {
                            const ids = Array.from(selectedPolicyIds)
                            const results = await Promise.allSettled(ids.map((id) => deletePolicy({ data: id })))
                            const failed = results.filter((r) => r.status === 'rejected')
                            if (failed.length > 0) {
                              alert(`Failed to delete ${failed.length} of ${ids.length} polic${ids.length === 1 ? 'y' : 'ies'}. Please check and try again.`)
                            }
                            setSelectedPolicyIds(new Set())
                            await reload()
                          } catch (err) {
                            alert(`Error deleting policies: ${err instanceof Error ? err.message : 'Unknown error'}`)
                          } finally {
                            setBulkDeletingPolicies(false)
                          }
                        }}
                        className="px-3 py-1.5 text-xs bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {bulkDeletingPolicies ? 'Deleting…' : 'Delete selected'}
                      </button>
                    </div>
                  </div>
                )}

                <AdminPolicyList
                  policies={policies.filter((p) => {
                    if (!selectedCompanyId) return true
                    if (selectedCompanyId.startsWith('ic:')) return p.individualClientId === selectedCompanyId.slice(3)
                    return p.companyId === selectedCompanyId
                  })}
                  companies={companies}
                  individualClients={individualClients}
                  onReload={reload}
                  selectedPolicyIds={selectedPolicyIds}
                  setSelectedPolicyIds={setSelectedPolicyIds}
                />
              </div>
            )}

            {tab === 'claims' && (
              <div>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h2 className="text-lg font-semibold text-navy-700">Claims ({claims.length})</h2>
                  <button
                    onClick={() => setShowNewClaim((prev) => !prev)}
                    className="admin-btn admin-btn-primary"
                  >
                    {showNewClaim ? 'Cancel' : 'New claim'}
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
                    try {
                      await adminUpdateClaimStatus({ data: { claimId, status, notes } })
                      await reload()
                    } catch (err) {
                      alert(`Error updating claim status: ${err instanceof Error ? err.message : 'Unknown error'}`)
                    }
                  }}
                />

                {loadingClaimWorkspace ? (
                  <div className="mt-4 bg-white border border-navy-200 rounded-[4px] p-6 text-sm text-navy-500">
                    Loading claim detail…
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
                    Select a claim to open its operational detail.
                  </div>
                )}
              </div>
            )}

            {tab === 'api' && (
              <div>
                <h2 className="text-lg font-semibold text-navy-700 mb-2">Integrations</h2>
                <p className="text-sm text-navy-500 mb-6">External services integrated into the platform. All keys are configured as environment variables in Netlify.</p>
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
                            <option value="connected">Connected</option>
                            <option value="degraded">Degraded</option>
                            <option value="error">Error</option>
                          </select>
                          <button
                            onClick={async () => {
                              await adminRefreshApiConnection({ data: { id: api.id } })
                              await reload()
                            }}
                            className="admin-btn admin-btn-secondary admin-btn--sm"
                          >
                            Refresh
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 text-sm text-navy-600 grid sm:grid-cols-3 gap-2">
                        <p><strong>Status:</strong> {api.status}</p>
                        <p><strong>Latency:</strong> {api.latency}</p>
                        <p><strong>Last Sync:</strong> {formatDate(api.lastSync)}</p>
                      </div>
                    </div>
                  ))}
                  {apiConnections.length === 0 && (
                    <div className="bg-white rounded-[4px] border border-navy-200 p-5 text-sm text-navy-500">
                      No dynamic connections found in `api_connections`.
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
                          <span style={{color:'#fff',fontWeight:700,fontSize:13}}>AI</span>
                        </div>
                        <div>
                          <h3 className="font-bold text-navy-700">Anthropic Claude</h3>
                          <p className="text-xs text-navy-500">Modelo: claude-3-5-haiku-20241022 · api.anthropic.com/v1</p>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span> Active
                      </span>
                    </div>
                    <div className="mt-3 text-xs text-navy-500 bg-navy-50 rounded p-3">
                      <strong>Usage:</strong> AI-powered policy data extraction, quote comparison, partner risk analysis.<br/>
                      <strong>Netlify Variable:</strong> <code className="bg-navy-100 px-1 rounded">ANTHROPIC_API_KEY</code>
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
                          <h3 className="font-bold text-navy-700">IPMA — Portuguese Sea and Atmosphere Institute</h3>
                          <p className="text-xs text-navy-500">Free public API · api.ipma.pt/open-data</p>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span> Active
                      </span>
                    </div>
                    <div className="mt-3 text-xs text-navy-500 bg-navy-50 rounded p-3">
                      <strong>Usage:</strong> Weather forecasts by location (36 cities), climate risk assessment, weather certificates for claims.<br/>
                      <strong>Netlify Variable:</strong> None (public API, no key)
                    </div>
                  </div>

                  {/* BizAPIs */}
                  <div className="bg-white rounded-[4px] border border-navy-200 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div style={{width:36,height:36,borderRadius:4,background:'#223553',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                          <span style={{color:'#fff',fontWeight:700,fontSize:13}}>BZ</span>
                        </div>
                        <div>
                          <h3 className="font-bold text-navy-700">BizAPIs — Company Data (Tax Authority &amp; Commercial Registry)</h3>
                          <p className="text-xs text-navy-500">nifName (Tax Authority) + CPRC (Commercial Registry) + Vehicle Plates · apigwws.bizapis.com</p>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span> Active
                      </span>
                    </div>
                    <div className="mt-3 text-xs text-navy-500 bg-navy-50 rounded p-3">
                      <strong>Usage:</strong> Partner Risk (NIF validation, shareholders, share capital, CAE, liens) and Vehicle Plate lookup (make, model, year, fuel type).<br/>
                      <strong>Netlify Variable:</strong> <code className="bg-navy-100 px-1 rounded">BIZAPIS_KEY</code>
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
                          <h3 className="font-bold text-navy-700">Resend — Transactional Email</h3>
                          <p className="text-xs text-navy-500">Sender: noreply@adlerrochefort.com · api.resend.com/v1</p>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span> Active
                      </span>
                    </div>
                    <div className="mt-3 text-xs text-navy-500 bg-navy-50 rounded p-3">
                      <strong>Usage:</strong> Automatic policy renewal alerts by email. Triggered from the Admin → Renewals panel.<br/>
                      <strong>Netlify Variable:</strong> <code className="bg-navy-100 px-1 rounded">RESEND_API_KEY</code>
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
                          <h3 className="font-bold text-navy-700">Supabase — Database &amp; Authentication</h3>
                          <p className="text-xs text-navy-500">PostgreSQL + Auth + Storage · VITE_SUPABASE_URL</p>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span> Active
                      </span>
                    </div>
                    <div className="mt-3 text-xs text-navy-500 bg-navy-50 rounded p-3">
                      <strong>Usage:</strong> All data persistence — companies, users, policies, claims, documents, alerts.<br/>
                      <strong>Netlify Variables:</strong> <code className="bg-navy-100 px-1 rounded">VITE_SUPABASE_URL</code> · <code className="bg-navy-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code> · <code className="bg-navy-100 px-1 rounded">SUPABASE_SERVICE_ROLE_KEY</code>
                    </div>
                  </div>

                </div>
              </div>
            )}

            {tab === 'profiles' && (
              <div>
                <h2 className="text-lg font-semibold text-navy-700 mb-4">Users &amp; Access Metrics</h2>
                <div className="bg-white rounded-[4px] border border-navy-200 overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-navy-50 border-b border-navy-200">
                        <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 uppercase">User</th>
                        <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 uppercase">Company</th>
                        <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 uppercase">Role</th>
                        <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 uppercase">Last Access</th>
                        <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 uppercase">Logins (Month)</th>
                        <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 uppercase">Events</th>
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

            {tab === 'billing' && <BillingTab />}

            {tab === 'tasks' && (
              <AdminTasksPanel companies={companies} individualClients={individualClients} />
            )}

            {tab === 'alerts' && (
              <AdminRenewalsPage companies={companies} companyUsers={companyUsers} policies={policies} />
            )}

            {tab === 'marketing' && <AdminMarketingPanel />}

            {tab === 'sales' && (
              <SalesWorkspace
                individualClients={individualClients}
                companies={companies}
                initialStage={searchStage}
                initialOverdueOnly={searchOverdue}
              />
            )}
          </>
        )}
      </div>
    </AppLayout>
  )
}

// Resumo comercial pequeno para o dashboard (CRM 2, fase 1) — sem
// forecasting complexo, só as contagens/somas pedidas. Busca os seus
// próprios dados (fetchSalesPipelineStats), independente do resto do
// dashboard, para não acoplar o pipeline comercial ao carregamento
// financeiro/renovações já existente.
function SalesPipelineSummaryWidget({ onStats }: { onStats?: (stats: Awaited<ReturnType<typeof fetchSalesPipelineStats>>) => void }) {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof fetchSalesPipelineStats>> | null>(null)

  useEffect(() => {
    let active = true
    fetchSalesPipelineStats()
      .then((result) => {
        if (!active) return
        setStats(result)
        onStats?.(result)
      })
      .catch((error) => console.error('[SalesPipelineSummaryWidget] fetchSalesPipelineStats error:', error))
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!stats) return null

  // Premium (what the client pays the insurer) and revenue (what stays with
  // Adler) are different metrics — never a substitute for one another here,
  // see computeSalesPipelineStats in sales-opportunity-rules.ts. Hierarchy:
  // 3 primary figures (what matters right now) much larger than the 5
  // secondary ones — instead of 8 identical cards competing for attention.
  const primary: Array<{ label: string; value: string }> = [
    { label: 'Open opportunities', value: String(stats.openCount) },
    { label: 'Pipeline (premium)', value: formatCurrency(stats.openPipelinePremium) },
    { label: 'Pipeline (revenue)', value: formatCurrency(stats.openPipelineRevenue) },
  ]
  const secondary: Array<{ label: string; value: string; to?: { stage?: SalesOpportunityStage } }> = [
    { label: 'New this month', value: String(stats.newThisMonthCount) },
    { label: 'Quoted', value: String(stats.quotedCount), to: { stage: 'quoted' } },
    { label: 'Won this month', value: String(stats.wonThisMonthCount), to: { stage: 'won' } },
    { label: 'Lost this month', value: String(stats.lostThisMonthCount), to: { stage: 'lost' } },
    { label: 'Revenue won (month)', value: formatCurrency(stats.wonRevenueThisMonth) },
  ]
  const hasAttention = stats.overdueFollowUpsCount > 0 || stats.dueTodayFollowUpsCount > 0

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <h3 className="admin-panel-title">Sales pipeline</h3>
        <Link to="/admin" search={{ tab: 'sales' }} className="admin-panel-link">
          View pipeline →
        </Link>
      </div>

      {/* "What needs attention today" — see requirement "actionable dashboard" */}
      {hasAttention && (
        <Link
          to="/admin"
          search={{ tab: 'sales', overdue: stats.overdueFollowUpsCount > 0 ? true : undefined }}
          className="admin-attention-chip"
        >
          <span className="admin-attention-dot" />
          {stats.overdueFollowUpsCount > 0 && <span>{stats.overdueFollowUpsCount} overdue follow-up{stats.overdueFollowUpsCount !== 1 ? 's' : ''}</span>}
          {stats.overdueFollowUpsCount > 0 && stats.dueTodayFollowUpsCount > 0 && <span>·</span>}
          {stats.dueTodayFollowUpsCount > 0 && <span>{stats.dueTodayFollowUpsCount} due today</span>}
        </Link>
      )}

      <div className="admin-stage-strip">
        {primary.map((card) => (
          <div key={card.label} className="admin-stage-strip-item">
            <p className="admin-stage-strip-value">{card.value}</p>
            <p className="admin-stage-strip-label">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="admin-stage-mini-grid">
        {secondary.map((card) =>
          card.to ? (
            <Link key={card.label} to="/admin" search={{ tab: 'sales', ...card.to }} className="admin-stage-mini group">
              <p className="admin-stage-mini-value">{card.value}</p>
              <p className="admin-stage-mini-label">{card.label}</p>
            </Link>
          ) : (
            <div key={card.label} className="admin-stage-mini">
              <p className="admin-stage-mini-value">{card.value}</p>
              <p className="admin-stage-mini-label">{card.label}</p>
            </div>
          ),
        )}
      </div>
    </div>
  )
}

function KpiTile({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className={`admin-kpi-card${strong ? ' admin-kpi-card--strong' : ''}`}>
      <p className="admin-kpi-label">{label}</p>
      <p className="admin-kpi-value">{value}</p>
      {note && <p className="admin-kpi-note">{note}</p>}
    </div>
  )
}

function AdminDashboardTab({
  companies,
  policies,
  claims,
}: {
  companies: Company[]
  companyUsers: CompanyUser[]
  policies: Policy[]
  claims: Claim[]
  documents: DocType[]
  individualClients: IndividualClient[]
  apiConnections: ApiConnection[]
}) {
  const openClaims = claims.filter((c) => c.status !== 'paid' && c.status !== 'denied')
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
  const [salesStats, setSalesStats] = useState<Awaited<ReturnType<typeof fetchSalesPipelineStats>> | null>(null)

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

  // Unfiltered — the minimum-value risk filter lives only in the dedicated
  // Renewals page (AdminRenewalsPage) now; this condensed dashboard summary
  // always reflects the full alert set.
  const renewalAlertsView = renewalAlerts

  const renewalIntelligence = useMemo(
    () => buildRenewalPipelineIntelligence(renewalAlertsView?.alerts ?? []),
    [renewalAlertsView]
  )

  const monthSelectOptions = [
    { value: '', label: 'Full year' },
    { value: '1', label: 'January' },
    { value: '2', label: 'February' },
    { value: '3', label: 'March' },
    { value: '4', label: 'April' },
    { value: '5', label: 'May' },
    { value: '6', label: 'June' },
    { value: '7', label: 'July' },
    { value: '8', label: 'August' },
    { value: '9', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
  ]

  const visibleTimeline = financialData
    ? financialData.timeline.filter((point) =>
        timelineMode === 'historical' ? point.isHistorical : point.isProjected
      )
    : []
  const drillMonthValue = drillDownMonth ?? (selectedMonth ? Number(selectedMonth) : null)
  const selectedMonthDetails = financialData?.monthlyDetails.find((monthItem) => monthItem.month === drillMonthValue)

  return (
    <div className="admin-dashboard">
      {/* ROW A — page header + compact filter bar */}
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Dashboard</h1>
          <p className="admin-page-subtitle">Your commercial and insurance operations workspace</p>
        </div>
        <div className="admin-filter-bar">
          <label className="admin-filter-field">
            <span>Year</span>
            <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
              {(financialData?.availableFilters.years ?? [selectedYear]).map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </label>
          <label className="admin-filter-field">
            <span>Month</span>
            <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
              {monthSelectOptions.map((monthOption) => (
                <option key={monthOption.value || 'all'} value={monthOption.value}>{monthOption.label}</option>
              ))}
            </select>
          </label>
          <label className="admin-filter-field">
            <span>Company</span>
            <select value={selectedCompanyId} onChange={(e) => setSelectedCompanyId(e.target.value)}>
              <option value="">All</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>{company.name}</option>
              ))}
            </select>
          </label>
          <label className="admin-filter-field">
            <span>Insurer</span>
            <select value={selectedInsurer} onChange={(e) => setSelectedInsurer(e.target.value)}>
              <option value="">All</option>
              {(financialData?.availableFilters.insurers ?? []).map((insurer) => (
                <option key={insurer} value={insurer}>{insurer}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* ROW B — KPI strip (existing metrics only, recomposed) */}
      <div className="admin-kpi-grid">
        <KpiTile
          strong
          label="Open pipeline"
          value={salesStats ? formatCurrency(salesStats.openPipelinePremium) : '…'}
          note={salesStats ? `${salesStats.openCount} open opportunities` : undefined}
        />
        <KpiTile
          label="Expected revenue"
          value={salesStats ? formatCurrency(salesStats.openPipelineRevenue) : '…'}
          note={salesStats ? `${formatCurrency(salesStats.wonRevenueThisMonth)} won this month` : undefined}
        />
        <KpiTile
          label="Written premium"
          value={financialLoading || !financialData ? '…' : formatCurrency(financialData.summary.totalPremiums)}
          note={financialData ? `MoM ${formatPct(financialData.summary.comparisons.totalPremiums.momDeltaPct)}` : undefined}
        />
        <KpiTile
          label="Active policies"
          value={financialLoading || !financialData ? '…' : String(financialData.summary.activePolicies)}
          note={financialData ? `YoY ${formatPct(financialData.summary.comparisons.activePolicies.yoyDeltaPct)}` : undefined}
        />
        <KpiTile
          label="Renewals at risk"
          value={renewalAlertsLoading || !renewalAlertsView ? '…' : formatCurrency(renewalAlertsView.summary.totalValueAtRisk)}
          note={renewalAlertsView ? `${renewalIntelligence.pendingOrNegotiatingCount} pending` : undefined}
        />
      </div>

      {/* ROW C — sales pipeline / tasks & follow-ups */}
      <div className="admin-ops-grid admin-ops-grid--sales">
        <SalesPipelineSummaryWidget onStats={setSalesStats} />

        <div className="admin-panel">
          <div className="admin-panel-head">
            <h3 className="admin-panel-title">Tasks &amp; follow-ups</h3>
            <Link to="/admin" search={{ tab: 'tasks' }} className="admin-panel-link">Open tasks →</Link>
          </div>
          {salesStats ? (
            <div className="admin-task-summary">
              <div className={`admin-task-row${salesStats.overdueFollowUpsCount > 0 ? ' admin-task-row--overdue' : ''}`}>
                <span>Overdue follow-ups</span>
                <strong>{salesStats.overdueFollowUpsCount}</strong>
              </div>
              <div className="admin-task-row">
                <span>Due today</span>
                <strong>{salesStats.dueTodayFollowUpsCount}</strong>
              </div>
              <div className="admin-task-row">
                <span>New opportunities this month</span>
                <strong>{salesStats.newThisMonthCount}</strong>
              </div>
              {salesStats.overdueFollowUpsCount > 0 && (
                <Link to="/admin" search={{ tab: 'sales', overdue: true }} className="admin-panel-link admin-panel-link--block">
                  Review overdue follow-ups →
                </Link>
              )}
            </div>
          ) : (
            <p className="admin-muted-note">Loading…</p>
          )}
        </div>
      </div>

      {/* ROW D — insurance operations: renewals / portfolio */}
      <div className="admin-ops-grid admin-ops-grid--insurance">
        <div className="admin-panel">
          <div className="admin-panel-head">
            <h3 className="admin-panel-title">Renewals</h3>
            <Link to="/admin" search={{ tab: 'alerts' }} className="admin-panel-link">Manage renewals →</Link>
          </div>
          {renewalAlertsLoading ? (
            <p className="admin-muted-note">Loading renewal alerts…</p>
          ) : renewalAlertsView && renewalAlertsView.total > 0 ? (
            <div className="admin-renewals-summary">
              <div className="admin-stat-row-grid">
                <div className="admin-stat-block">
                  <p className="admin-stat-block-label">Renewals due</p>
                  <p className="admin-stat-block-value">{renewalAlertsView.summary.totalRenewals}</p>
                </div>
                <div className="admin-stat-block admin-stat-block--risk">
                  <p className="admin-stat-block-label">Value at risk</p>
                  <p className="admin-stat-block-value">{formatCurrency(renewalAlertsView.summary.totalValueAtRisk)}</p>
                </div>
                <div className="admin-stat-block">
                  <p className="admin-stat-block-label">Renewal rate</p>
                  <p className="admin-stat-block-value">{formatPctValue(renewalIntelligence.renewalRatePct)}</p>
                </div>
              </div>
              <div className="admin-status-pill-row">
                <span className="admin-status-pill">Pending {renewalAlertsView.summary.countsByStatus.pending}</span>
                <span className="admin-status-pill">Negotiating {renewalAlertsView.summary.countsByStatus.negotiating}</span>
                <span className="admin-status-pill admin-status-pill--ok">Renewed {renewalAlertsView.summary.countsByStatus.renewed}</span>
              </div>
              <div className="admin-urgency-bars">
                {renewalIntelligence.valueAtRiskByPeriod.map((period) => {
                  const maxValue = Math.max(1, ...renewalIntelligence.valueAtRiskByPeriod.map((p) => p.valueAtRisk))
                  const widthPct = Math.round((period.valueAtRisk / maxValue) * 100)
                  return (
                    <div key={period.urgency} className="admin-urgency-bar-row">
                      <span className="admin-urgency-bar-label">D-{period.urgency}</span>
                      <div className="admin-urgency-bar-track">
                        <div className="admin-urgency-bar-fill" style={{ width: `${widthPct}%` }} />
                      </div>
                      <span className="admin-urgency-bar-value">{formatCurrency(period.valueAtRisk)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <p className="admin-muted-note">No active renewal alerts for D-90, D-60 or D-30.</p>
          )}
        </div>

        <div className="admin-panel">
          <div className="admin-panel-head">
            <h3 className="admin-panel-title">Portfolio</h3>
          </div>
          <div className="admin-portfolio-rows">
            <div className="admin-portfolio-row">
              <span>Total premiums</span>
              <strong>{financialLoading || !financialData ? '…' : formatCurrency(financialData.summary.totalPremiums)}</strong>
            </div>
            <div className="admin-portfolio-row">
              <span>Total commissions</span>
              <strong>{financialLoading || !financialData ? '…' : formatCurrency(financialData.summary.totalCommissions)}</strong>
            </div>
            <div className="admin-portfolio-row">
              <span>Projected commissions</span>
              <strong>{financialLoading || !financialData ? '…' : formatCurrency(financialData.summary.projectedCommissions)}</strong>
            </div>
            <div className="admin-portfolio-row">
              <span>Active policies</span>
              <strong>{financialLoading || !financialData ? '…' : financialData.summary.activePolicies}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* ROW E — attention strip (existing data only, omitted when empty) */}
      {(salesStats?.overdueFollowUpsCount || openClaims.length || renewalIntelligence.pendingOrNegotiatingCount || salesStats?.newThisMonthCount) ? (
        <div className="admin-panel admin-attention-panel">
          <h3 className="admin-panel-title">Needs attention</h3>
          <div className="admin-attention-row">
            {!!salesStats?.overdueFollowUpsCount && (
              <Link to="/admin" search={{ tab: 'sales', overdue: true }} className="admin-attention-item admin-attention-item--danger">
                <strong>{salesStats.overdueFollowUpsCount}</strong> overdue follow-up{salesStats.overdueFollowUpsCount !== 1 ? 's' : ''}
              </Link>
            )}
            {renewalIntelligence.pendingOrNegotiatingCount > 0 && (
              <Link to="/admin" search={{ tab: 'alerts' }} className="admin-attention-item">
                <strong>{renewalIntelligence.pendingOrNegotiatingCount}</strong> renewals still at risk
              </Link>
            )}
            {openClaims.length > 0 && (
              <Link to="/admin" search={{ tab: 'claims' }} className="admin-attention-item">
                <strong>{openClaims.length}</strong> claims requiring attention
              </Link>
            )}
            {!!salesStats?.newThisMonthCount && (
              <Link to="/admin" search={{ tab: 'sales' }} className="admin-attention-item">
                <strong>{salesStats.newThisMonthCount}</strong> new opportunities this month
              </Link>
            )}
          </div>
        </div>
      ) : null}

      {/* Advanced detail — unchanged data/behaviour, kept below the fold */}
      <details className="admin-panel admin-collapsible">
        <summary className="admin-collapsible-summary">Financial detail</summary>
        <div className="admin-collapsible-body">
      <div className="bg-white rounded-[4px] border border-navy-200 p-5 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-navy-700">Premiums vs Commissions (monthly timeline)</h3>
          <div className="inline-flex rounded border border-navy-200 overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setTimelineMode('historical')}
              className={`px-3 py-1.5 ${timelineMode === 'historical' ? 'bg-navy-700 text-white' : 'bg-white text-navy-600 hover:bg-navy-50'}`}
            >
              Historical
            </button>
            <button
              type="button"
              onClick={() => setTimelineMode('projection')}
              className={`px-3 py-1.5 border-l border-navy-200 ${timelineMode === 'projection' ? 'bg-gold-400 text-navy-700 font-semibold' : 'bg-white text-navy-600 hover:bg-navy-50'}`}
            >
              Projection
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
                ? 'No history for the selected period.'
                : 'No future projection for the selected period.'}
            </p>
          )
        ) : (
          <p className="text-sm text-navy-400">{financialLoading ? 'A calcular cashflow...' : 'Sem dados financeiros para os filtros selecionados.'}</p>
        )}
      </div>
      <div className="bg-white rounded-[4px] border border-navy-200 p-5 mb-6">
        <h3 className="text-sm font-semibold text-navy-700 mb-3">Months with Highest Projected Revenue</h3>
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
                <p className="text-xs text-navy-600 mt-1">Commissions: {formatCurrency(monthItem.commissions)}</p>
                <p className="text-xs text-navy-500">Premiums: {formatCurrency(monthItem.premiums)}</p>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-navy-400">No future months with projected revenue for the applied filters.</p>
        )}
      </div>
      <div className="bg-white rounded-[4px] border border-navy-200 p-5 mb-6">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-navy-700">Drill-down by Month (Policies)</h3>
          <select
            value={drillMonthValue ?? ''}
            onChange={(e) => setDrillDownMonth(e.target.value ? Number(e.target.value) : null)}
            className="px-3 py-1.5 border border-navy-200 rounded-[2px] text-xs focus:outline-none focus:ring-2 focus:ring-[#223553]"
          >
            <option value="">Select month</option>
            {monthSelectOptions.filter((item) => item.value).map((item) => (
              <option key={`drill_${item.value}`} value={item.value}>{item.label}</option>
            ))}
          </select>
        </div>
        {!selectedMonthDetails ? (
          <p className="text-sm text-navy-400">Select a month to see the detail of allocated policies.</p>
        ) : selectedMonthDetails.policies.length === 0 ? (
          <p className="text-sm text-navy-400">No policies with financial activity in {selectedMonthDetails.label}.</p>
        ) : (
          <div className="space-y-3">
            <div className="bg-navy-50 border border-navy-100 rounded px-3 py-2 text-xs text-navy-600">
              <p><strong>{selectedMonthDetails.label} {selectedYear}</strong> · {selectedMonthDetails.policiesCount} policies</p>
              <p>Premiums allocated: {formatCurrency(selectedMonthDetails.premiums)} · Commissions allocated: {formatCurrency(selectedMonthDetails.commissions)}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="bg-navy-50 border-b border-navy-200">
                    <th className="text-left px-3 py-2 text-xs font-semibold text-navy-500 uppercase">Policy</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-navy-500 uppercase">Insurer</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-navy-500 uppercase">Client</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-navy-500 uppercase">Frequency</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-navy-500 uppercase">Premium</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-navy-500 uppercase">Commission</th>
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
                      <td className="px-3 py-2 text-xs text-navy-600">{policyItem.paymentFrequency || 'annual'}</td>
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
        </div>
      </details>

    </div>
  )
}

function AdminRenewalsPage({
  companyUsers,
  policies,
}: {
  companies: Company[]
  companyUsers: CompanyUser[]
  policies: Policy[]
}) {
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
    setRenewalAlertsLoading(true)
    getRenewalAlerts()
      .then((result) => {
        if (!active) return
        setRenewalAlerts(result)
      })
      .catch((error) => {
        console.error('[AdminRenewalsPage] getRenewalAlerts error:', error)
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
      console.error('[AdminRenewalsPage] reloadRenewalAlerts error:', error)
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
      console.error('[AdminRenewalsPage] adminUpdateRenewalAlertStatus error:', error)
      alert('Could not update the alert status.')
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

  return (
    <div>
      <div className="admin-page-header" style={{ marginBottom: '1rem' }}>
        <div>
          <h1 className="admin-page-title">Renewals</h1>
          <p className="admin-page-subtitle">Policies renewing within 90 days, tracked through Pending → Negotiating → Renewed.</p>
        </div>
        <SendRenewalAlertsButton />
      </div>

        <div className="bg-white rounded-[4px] border border-navy-200 p-5">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
            <h3 className="text-sm font-semibold text-navy-700">Renewals pipeline</h3>
            <label className="text-xs text-navy-600">
              <span className="block mb-1">Minimum value filter (€)</span>
              <input
                type="number"
                min={0}
                step={100}
                value={renewalRiskMinValue}
                onChange={(event) => setRenewalRiskMinValue(event.target.value)}
                placeholder="Top financial risk"
                className="w-44 px-2 py-1.5 border border-navy-200 rounded-[2px] text-xs focus:outline-none focus:ring-2 focus:ring-[#223553]"
              />
            </label>
          </div>
          {renewalAlertsLoading ? (
            <p className="text-sm text-navy-400">Loading renewal alerts...</p>
          ) : renewalAlertsView && renewalAlertsView.total > 0 ? (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-2">
                <div className="rounded border border-navy-200 bg-navy-50 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-navy-500">Number of renewals</p>
                  <p className="text-base font-semibold text-navy-700">{renewalAlertsView.summary.totalRenewals}</p>
                </div>
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-red-500">Total value at risk</p>
                  <p className="text-base font-semibold text-red-700">{formatCurrency(renewalAlertsView.summary.totalValueAtRisk)}</p>
                </div>
              </div>
              <div className="grid xl:grid-cols-3 gap-2">
                <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-emerald-600">Renewal rate</p>
                  <p className="text-base font-semibold text-emerald-700">{formatPctValue(renewalIntelligence.renewalRatePct)}</p>
                  <p className="text-[11px] text-emerald-700/80">
                    {renewalIntelligence.renewedCount} renewed of {renewalIntelligence.totalAlerts}
                  </p>
                </div>
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-amber-600">Avg. time pending → renewed</p>
                  <p className="text-base font-semibold text-amber-700">
                    {renewalIntelligence.avgDaysPendingToRenewed === null
                      ? 'n/d'
                      : `${renewalIntelligence.avgDaysPendingToRenewed.toFixed(1)} days`}
                  </p>
                  <p className="text-[11px] text-amber-700/80">
                    Base: {renewalIntelligence.avgDaysSampleSize} completed transitions
                  </p>
                </div>
                <div className="rounded border border-navy-200 bg-navy-50 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-navy-500">Cases at risk</p>
                  <p className="text-base font-semibold text-navy-700">{renewalIntelligence.pendingOrNegotiatingCount}</p>
                  <p className="text-[11px] text-navy-600">Not yet renewed</p>
                </div>
              </div>
              <div className="grid xl:grid-cols-3 gap-2">
                {renewalIntelligence.valueAtRiskByPeriod.map((period) => (
                  <div key={period.urgency} className="rounded border border-red-200 bg-red-50 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-red-500">Risk D-{period.urgency}</p>
                    <p className="text-base font-semibold text-red-700">{formatCurrency(period.valueAtRisk)}</p>
                    <p className="text-[11px] text-red-600/90">{period.alertsCount} policies at risk</p>
                  </div>
                ))}
              </div>
              <div className="rounded border border-navy-200 bg-white px-3 py-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-navy-700 mb-2">
                  Clients with highest financial risk
                </h4>
                {renewalIntelligence.topRiskClients.length === 0 ? (
                  <p className="text-[11px] text-navy-500">No clients at risk in the current period.</p>
                ) : (
                  <div className="space-y-1.5">
                    {renewalIntelligence.topRiskClients.map((client, index) => (
                      <div key={`${client.client}_${client.company}`} className="flex items-center justify-between gap-2 text-[11px] text-navy-600">
                        <p>
                          <strong className="text-navy-700">#{index + 1}</strong> {client.client} <span className="text-navy-400">({client.company})</span>
                        </p>
                        <p className="font-semibold text-red-700">
                          {formatCurrency(client.valueAtRisk)} · {client.policiesCount} policies
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded border border-gold-200 bg-gold-50 px-3 py-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-navy-700 mb-2">
                  Automatic insights
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
                          No policies in this column.
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
                                label: 'Move to Pending',
                                status: 'pending',
                                className: 'border-navy-200 text-navy-700 bg-white hover:bg-navy-50',
                              })
                            }
                            if (renewalColumnByStatus(alert.status) !== 'negotiating') {
                              nextStatusActions.push({
                                label: 'Move to Negotiating',
                                status: 'negotiating',
                                className: 'border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100',
                              })
                            }
                            if (renewalColumnByStatus(alert.status) !== 'renewed') {
                              nextStatusActions.push({
                                label: 'Move to Renewed',
                                status: 'renewed',
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
                                  Policy {alert.policyNumber} · Renews in {alert.daysUntilRenewal} days ({formatDate(alert.renewalDate)})
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
                                    <label className="text-[11px] text-navy-600">Owner</label>
                                    <div className="flex gap-1.5 mt-1">
                                      <input
                                        list={`responsible_${alert.key}`}
                                        value={assigneeDraftByKey[alert.key] ?? alert.assignedTo ?? ''}
                                        onChange={(event) => {
                                          const value = event.target.value
                                          setAssigneeDraftByKey((current) => ({ ...current, [alert.key]: value }))
                                        }}
                                        placeholder="Owner's email"
                                        className="flex-1 px-2 py-1 text-[11px] border border-navy-200 rounded-[2px] bg-white focus:outline-none focus:ring-2 focus:ring-[#223553]"
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
                                        Save
                                      </button>
                                    </div>
                                    <p className="text-[11px] text-navy-500 mt-1">
                                      Current: <strong>{alert.assignedTo ? (responsibleLabelMap.get(alert.assignedTo) ? `${responsibleLabelMap.get(alert.assignedTo)} (${alert.assignedTo})` : alert.assignedTo) : 'Unassigned'}</strong>
                                    </p>
                                  </div>
                                  <div>
                                    <label className="text-[11px] text-navy-600">Next action</label>
                                    <textarea
                                      value={nextActionDraftByKey[alert.key] ?? alert.nextAction ?? ''}
                                      onChange={(event) => {
                                        const value = event.target.value
                                        setNextActionDraftByKey((current) => ({ ...current, [alert.key]: value }))
                                      }}
                                      placeholder="Set next action for this policy"
                                      rows={2}
                                      className="w-full mt-1 px-2 py-1 text-[11px] border border-navy-200 rounded-[2px] bg-white focus:outline-none focus:ring-2 focus:ring-[#223553] resize-y"
                                    />
                                    <div className="flex items-center justify-between mt-1">
                                      <p className="text-[11px] text-navy-500">
                                        Current: <strong>{alert.nextAction || 'No action set'}</strong>
                                      </p>
                                      <button
                                        type="button"
                                        disabled={updatingRenewalAlertKey === alert.key}
                                        onClick={() => handleRenewalAlertStatusUpdate(alert.key, { nextAction: nextActionDraftByKey[alert.key] ?? alert.nextAction ?? null })}
                                        className="px-2 py-1 text-[11px] rounded border border-navy-200 bg-white text-navy-700 hover:bg-navy-100 disabled:opacity-50"
                                      >
                                        Save action
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
                                    View policy
                                  </Link>
                                  {alert.contactEmail ? (
                                    <a
                                      href={`mailto:${alert.contactEmail}`}
                                      className="px-2 py-1 text-[11px] rounded border border-gold-300 text-navy-700 bg-gold-100 hover:bg-gold-200"
                                    >
                                      Contact client
                                    </a>
                                  ) : alert.contactPhone ? (
                                    <a
                                      href={`tel:${alert.contactPhone}`}
                                      className="px-2 py-1 text-[11px] rounded border border-gold-300 text-navy-700 bg-gold-100 hover:bg-gold-200"
                                    >
                                      Contact client
                                    </a>
                                  ) : (
                                    <span className="px-2 py-1 text-[11px] rounded border border-gray-200 text-gray-400 bg-gray-50">
                                      No contact
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-navy-500 mt-2">
                                  Current status: <strong>{RENEWAL_ALERT_STATUS_LABELS[alert.status]}</strong>
                                </p>
                                <details className="mt-2 rounded border border-navy-100 bg-navy-50 px-2 py-1.5">
                                  <summary className="text-[11px] font-semibold text-navy-700 cursor-pointer">
                                    Change history ({alert.history.length})
                                  </summary>
                                  <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
                                    {alert.history.length === 0 ? (
                                      <p className="text-[11px] text-navy-500">No history.</p>
                                    ) : (
                                      alert.history.map((entry) => (
                                        <div key={entry.id} className="text-[11px] text-navy-600 border-l-2 border-navy-200 pl-2 py-0.5">
                                          <p className="text-navy-700 font-medium">{formatDate(entry.changedAt)}</p>
                                          <p>
                                            Status: <strong>{entry.previousStatus ? RENEWAL_ALERT_STATUS_LABELS[entry.previousStatus] : '—'}</strong> → <strong>{RENEWAL_ALERT_STATUS_LABELS[entry.newStatus]}</strong>
                                          </p>
                                          <p>
                                            Owner: <strong>{entry.previousAssignedTo || '—'}</strong> → <strong>{entry.newAssignedTo || '—'}</strong>
                                          </p>
                                          <p>
                                            Next action: <strong>{entry.previousNextAction || '—'}</strong> → <strong>{entry.newNextAction || '—'}</strong>
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
                ? 'No alerts match the applied value filter.'
                : 'No active alerts for D-90, D-60 or D-30.'}
            </p>
          )}
        </div>
    </div>
  )
}

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'n/d'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
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
    return <p className="text-sm text-navy-400">No financial activity for the selected period.</p>
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
        <span className="inline-flex items-center gap-2"><span className="w-3 h-0.5 bg-navy-700 inline-block" /> Premiums</span>
        <span className="inline-flex items-center gap-2"><span className="w-3 h-0.5 bg-[#223553] inline-block" /> Commissions</span>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[760px]" role="img" aria-label="Monthly premiums and commissions chart">
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
          <polyline fill="none" stroke="#17243D" strokeWidth="3" points={premiumPath} />
          <polyline fill="none" stroke="#223553" strokeWidth="3" points={commissionPath} />
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
              <circle cx={x(index)} cy={y(point.premiums)} r={selectedMonth === point.month ? '5' : '3.5'} fill="#17243D" />
              <circle cx={x(index)} cy={y(point.commissions)} r={selectedMonth === point.month ? '5' : '3.5'} fill="#223553" />
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
            <p>Premiums: {formatCurrency(point.premiums)}</p>
            <p>Commissions: {formatCurrency(point.commissions)}</p>
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
        <p className="text-sm text-navy-600 mb-3">Billing connections were found in the dynamic `api_connections` state.</p>
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
        No Invoice Express integration code was found in this repository, nor dedicated entries in `api_connections`.
        The module was left as a stub for future re-integration, without simulating integrations that don't exist.
      </p>
    </div>
  )
}

function SendRenewalAlertsButton() {
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; companies: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSend = async () => {
    if (!confirm('Send renewal alerts by email to all clients with policies expiring within the next 90 days?')) return
    setSending(true); setResult(null); setError(null)
    try {
      const data = await adminTriggerRenewalAlerts()
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
          padding: '0.55rem 1rem', background: sending ? '#cccccc' : '#17243D',
          color: '#ffffff', border: 'none', borderRadius: '4px',
          cursor: sending ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem',
        }}
      >
        {sending
          ? <><span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Sending…</>
          : <>✉️ Send Alerts by Email</>}
      </button>
      {result && (
        <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#166534', background: '#EAF3DE', padding: '0.25rem 0.6rem', borderRadius: '4px' }}>
          ✓ {result.sent} email{result.sent !== 1 ? 's' : ''} sent to {result.companies} compan{result.companies !== 1 ? 'ies' : 'y'}
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


type PolicyDocFile = {
  id: string
  name: string
  storagePath: string
  size: number
  mimeType?: string
  uploadedAt?: string
}

function PolicyDocumentsPanel({ policy }: { policy: Policy }) {
  const [docs, setDocs] = useState<PolicyDocFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewName, setPreviewName] = useState<string>('')
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchPolicyDocuments({
        data: { policyId: policy.id, companyId: policy.companyId || undefined },
      })
      setDocs(data as PolicyDocFile[])
    } catch (e: any) {
      setError(e?.message ?? 'Error loading documents')
    } finally {
      setLoading(false)
    }
  }, [policy.id, policy.companyId])

  useEffect(() => { load() }, [load])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setUploading(true)
    setError(null)
    const errors: string[] = []
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = {}
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
    for (const file of files) {
      setUploadStatus(`A carregar ${file.name}…`)
      try {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('type', 'policy_document')
        fd.append('policyId', policy.id)
        const res = await fetch('/api/upload', { method: 'POST', headers, body: fd })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          errors.push(`${file.name}: ${err.error ?? 'Erro'}`)
        }
      } catch {
        errors.push(`${file.name}: Erro de rede`)
      }
    }
    if (inputRef.current) inputRef.current.value = ''
    setUploading(false)
    setUploadStatus(null)
    if (errors.length) setError(errors.join(' | '))
    await load()
  }

  const openSignedUrl = async (storagePath: string): Promise<string> => {
    const { url } = await adminGetDocumentUrl({ data: { storagePath } })
    return url
  }

  const handlePreview = async (doc: PolicyDocFile) => {
    try {
      const url = await openSignedUrl(doc.storagePath)
      setPreviewName(doc.name)
      setPreviewUrl(url)
    } catch (e: any) {
      alert('Erro ao obter URL: ' + (e?.message ?? ''))
    }
  }

  const handleDownload = async (doc: PolicyDocFile) => {
    try {
      const url = await openSignedUrl(doc.storagePath)
      const a = document.createElement('a')
      a.href = url
      a.download = doc.name
      a.target = '_blank'
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (e: any) {
      alert('Erro ao descarregar: ' + (e?.message ?? ''))
    }
  }

  const handleDelete = async (doc: PolicyDocFile) => {
    if (!confirm(`Eliminar "${doc.name}"?`)) return
    try {
      await adminDeletePolicyDocument({ data: { storagePath: doc.storagePath } })
      setDocs((prev) => prev.filter((d) => d.id !== doc.id))
    } catch (e: any) {
      alert('Erro ao eliminar: ' + (e?.message ?? ''))
    }
  }

  return (
    <div className="bg-white rounded border border-navy-100 p-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide">
          Documentos {docs.length > 0 ? `(${docs.length})` : ''}
        </p>
        <label className={`text-xs font-semibold px-2.5 py-1 rounded-[6px] inline-flex items-center gap-1 ${uploading ? 'bg-navy-100 text-navy-400 cursor-not-allowed' : 'bg-[#17243D] text-white hover:bg-[#223553] cursor-pointer'}`}>
          {uploading ? 'A carregar…' : '+ Carregar'}
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            multiple
            onChange={handleUpload}
            className="hidden"
            disabled={uploading}
          />
        </label>
      </div>
      {uploadStatus && <p className="text-xs text-navy-500 mb-2">{uploadStatus}</p>}
      {error && (
        <div className="mb-2 px-2 py-1 bg-red-50 border border-red-200 rounded text-xs text-red-600 flex items-start gap-2">
          <span>⚠ {error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-500">×</button>
        </div>
      )}
      {loading ? (
        <p className="text-xs text-navy-400">Loading documents…</p>
      ) : docs.length === 0 ? (
        <p className="text-xs text-navy-400">No documents. Upload a file to get started.</p>
      ) : (
        <div className="space-y-1.5">
          {docs.map((doc) => {
            const isPdf = (doc.mimeType ?? '').includes('pdf') || doc.name.toLowerCase().endsWith('.pdf')
            const isImage = (doc.mimeType ?? '').startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(doc.name)
            return (
              <div key={doc.id} className="flex items-center gap-2 px-2 py-1.5 bg-navy-50/40 rounded border border-navy-100">
                <span className="text-base flex-shrink-0">{isPdf ? '📄' : isImage ? '🖼️' : '📎'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-navy-700 truncate">{doc.name}</p>
                  <p className="text-[11px] text-navy-400">{formatFileSize(doc.size)}</p>
                </div>
                <button
                  onClick={() => handlePreview(doc)}
                  title="Preview"
                  className="px-2 py-1 text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100"
                >
                  Ver
                </button>
                <button
                  onClick={() => handleDownload(doc)}
                  title="Download"
                  className="px-2 py-1 text-[11px] font-semibold bg-navy-50 text-navy-700 border border-navy-200 rounded hover:bg-navy-100"
                >
                  ↓
                </button>
                <button
                  onClick={() => handleDelete(doc)}
                  title="Delete"
                  className="px-2 py-1 text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100"
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}
      {previewUrl && (
        <div
          className="fixed inset-0 z-[300] bg-black/75 flex items-center justify-center p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <div
            className="bg-white rounded w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-2 border-b border-navy-100 flex items-center justify-between gap-2">
              <p className="font-semibold text-sm text-navy-700 truncate">{previewName}</p>
              <div className="flex gap-2 items-center">
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2 py-1 text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded"
                >
                  Open in new window
                </a>
                <button onClick={() => setPreviewUrl(null)} className="text-navy-500 text-xl leading-none">×</button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              {/\.(jpg|jpeg|png|webp)$/i.test(previewName) ? (
                <img src={previewUrl} alt={previewName} className="w-full h-full object-contain" />
              ) : (
                <iframe src={previewUrl} title={previewName} className="w-full h-[70vh] border-none" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PolicyExpandableCard({ policy, defaultOpen = false }: { policy: Policy; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const typeLabel = POLICY_TYPE_LABELS[policy.type as keyof typeof POLICY_TYPE_LABELS] ?? policy.type
  return (
    <div className="bg-white rounded border border-navy-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-left hover:bg-navy-50/40"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-navy-700">
            <span className="mr-1 text-navy-400">{open ? '▾' : '▸'}</span>
            {typeLabel}
            {' — '}{policy.insurer}
          </p>
          <p className="text-xs text-navy-500">
            Policy {policy.policyNumber} · {policy.startDate} → {policy.endDate}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-navy-700">{formatCurrency(policy.annualPremium)}/yr</p>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            policy.status === 'active' ? 'bg-green-100 text-green-700' :
            policy.status === 'expiring' ? 'bg-yellow-100 text-yellow-700' :
            'bg-red-100 text-red-700'
          }`}>{policy.status}</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-navy-100 bg-navy-50/40 p-3">
          <PolicyDocumentsPanel policy={policy} />
        </div>
      )}
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
    marketingOptOut: initial?.marketingOptOut ?? false,
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
        <FormField label="Name" value={form.name} onChange={(v) => update('name', v)} required />
        <FormField label="NIF" value={form.nif} onChange={(v) => update('nif', v)} required />
        <FormField label="Sector" value={form.sector} onChange={(v) => update('sector', v)} required />
        <FormField label="Contact Name" value={form.contactName} onChange={(v) => update('contactName', v)} required />
        <FormField label="Contact Email" value={form.contactEmail} onChange={(v) => update('contactEmail', v)} type="email" required />
        <FormField label="Phone" value={form.contactPhone} onChange={(v) => update('contactPhone', v)} required />
        <FormField label="Company Access Email" value={form.accessEmail} onChange={(v) => update('accessEmail', v)} type="email" required />
        <div className="sm:col-span-2">
          <FormField label="Address" value={form.address} onChange={(v) => update('address', v)} required />
        </div>
        <div className="sm:col-span-2">
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.marketingOptOut}
              onChange={(e) => setForm((f) => ({ ...f, marketingOptOut: e.target.checked }))}
              className="mt-0.5 w-4 h-4 accent-[#17243D]"
            />
            <div>
              <span className="text-sm font-medium text-navy-700">Do not send marketing communications</span>
              <p className="text-xs text-navy-400 mt-0.5">
                When enabled, this company does not receive marketing campaigns. Check this when a client asks to be removed (reply "Remove").
              </p>
            </div>
          </label>
        </div>
        <div className="sm:col-span-2">
          <button type="submit" disabled={submitting} className="admin-btn admin-btn-primary">
            {submitting ? 'Saving…' : 'Save company'}
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
        aria-label="Associated company"
      />
      <input
        value={form.name}
        onChange={(e) => setForm((old) => ({ ...old, name: e.target.value }))}
        placeholder="Name"
        className="px-3 py-2 border border-navy-200 rounded text-sm"
        required
      />
      <input
        type="email"
        value={form.email}
        onChange={(e) => setForm((old) => ({ ...old, email: e.target.value }))}
        placeholder="email@company.com"
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
        placeholder="Initial password"
        className="px-3 py-2 border border-navy-200 rounded text-sm"
        required
        minLength={6}
      />
      <div className="md:col-span-5">
        <button type="submit" disabled={submitting} className="admin-btn admin-btn-primary">
          {submitting ? 'Creating…' : 'Create company user'}
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
  const [error, setError] = useState('')

  const availableUsers = companyUsers.filter((user) => user.companyId === companyId)
  const availablePolicies = policies.filter((policy) => {
    if (targetType === 'company') return policy.companyId === companyId
    return policy.individualClientId === individualClientId
  })

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
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
      setPolicyId('')
      setType('')
      setDescription('')
      setIncidentDate('')
      setEstimatedValue('')
    } catch (err) {
      setError(`Error creating claim: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-navy-200 rounded-[4px] p-5 mb-4 grid md:grid-cols-2 gap-4">
      <div>
        <label className="block text-sm text-navy-600 mb-1">Client type</label>
        <select value={targetType} onChange={(e) => setTargetType(e.target.value as 'company' | 'individual')} className="w-full px-3 py-2 border border-navy-200 rounded text-sm">
          <option value="company">Company</option>
          <option value="individual">Individual client</option>
        </select>
      </div>

      {targetType === 'company' ? (
        <div>
          <label className="block text-sm text-navy-600 mb-1">Company</label>
          <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setPolicyId('') }} required className="w-full px-3 py-2 border border-navy-200 rounded text-sm">
            <option value="">Select…</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
        </div>
      ) : (
        <div>
          <label className="block text-sm text-navy-600 mb-1">Individual client</label>
          <select value={individualClientId} onChange={(e) => { setIndividualClientId(e.target.value); setPolicyId('') }} required className="w-full px-3 py-2 border border-navy-200 rounded text-sm">
            <option value="">Select…</option>
            {individualClients.map((client) => <option key={client.id} value={client.id}>{client.fullName}</option>)}
          </select>
        </div>
      )}

      <div>
        <label className="block text-sm text-navy-600 mb-1">Associated user/client</label>
        {targetType === 'company' ? (
          <select value={clientUserId} onChange={(e) => setClientUserId(e.target.value)} className="w-full px-3 py-2 border border-navy-200 rounded text-sm">
            <option value="">No initial owner</option>
            {availableUsers.map((user) => <option key={user.id} value={user.id}>{user.name} ({user.email})</option>)}
          </select>
        ) : (
          <input value={individualClients.find((c) => c.id === individualClientId)?.fullName || ''} readOnly className="w-full px-3 py-2 border border-navy-200 rounded text-sm bg-navy-50 text-navy-500" />
        )}
      </div>

      <div>
        <label className="block text-sm text-navy-600 mb-1">Associated policy</label>
        <select value={policyId} onChange={(e) => setPolicyId(e.target.value)} required className="w-full px-3 py-2 border border-navy-200 rounded text-sm">
          <option value="">Select…</option>
          {availablePolicies.map((policy) => (
            <option key={policy.id} value={policy.id}>
              {policy.policyNumber} · {POLICY_TYPE_LABELS[policy.type] ?? policy.type}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm text-navy-600 mb-1">Claim type</label>
        <input value={type} onChange={(e) => setType(e.target.value)} required className="w-full px-3 py-2 border border-navy-200 rounded text-sm" placeholder="e.g. Flood damage" />
      </div>

      <div>
        <label className="block text-sm text-navy-600 mb-1">Incident date</label>
        <input type="date" value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)} required className="w-full px-3 py-2 border border-navy-200 rounded text-sm" />
      </div>

      <div>
        <label className="block text-sm text-navy-600 mb-1">Estimated amount (optional)</label>
        <input type="number" min="0" step="0.01" value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} className="w-full px-3 py-2 border border-navy-200 rounded text-sm" placeholder="0.00" />
      </div>

      <div className="md:col-span-2">
        <label className="block text-sm text-navy-600 mb-1">Initial description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} required rows={3} className="w-full px-3 py-2 border border-navy-200 rounded text-sm" />
      </div>

      {error && (
        <div className="md:col-span-2 px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="md:col-span-2">
        <button disabled={submitting} className="admin-btn admin-btn-primary">
          {submitting ? 'Creating…' : 'Create claim'}
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
    return <div className="bg-white border border-navy-200 rounded-[4px] p-5 text-sm text-navy-500">No claims registered.</div>
  }

  return (
    <div className="bg-white border border-navy-200 rounded-[4px] overflow-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-navy-50 text-navy-600">
          <tr>
            <th className="text-left px-3 py-2">Client/Company</th>
            <th className="text-left px-3 py-2">Policy</th>
            <th className="text-left px-3 py-2">Type</th>
            <th className="text-left px-3 py-2">Date</th>
            <th className="text-left px-3 py-2">Status</th>
            <th className="text-left px-3 py-2">Amount</th>
            <th className="text-left px-3 py-2">Owner</th>
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
                      await onQuickStatusUpdate(claim.id, status, 'Quick update')
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
      const { token, path } = await getStorageUploadUrl({ data: { storagePath } })
      const { error } = await supabase.storage.from('documents').uploadToSignedUrl(path, token, file)
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
          <p className="text-sm text-navy-500">{company?.name || individualClient?.fullName || '—'} · {policy?.policyNumber || 'No policy'}</p>
          <p className="text-xs text-navy-400 mt-1">Incident date: {formatDate(claim.incidentDate)} · Estimated amount: {formatCurrency(claim.estimatedValue || 0)}</p>
        </div>
        <div className="text-right">
          <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${getStatusColor(claim.status)}`}>
            {CLAIM_STATUS_LABELS[claim.status]}
          </span>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="border border-navy-100 rounded p-3">
          <p className="text-xs uppercase tracking-wide text-navy-500 mb-2">Owner</p>
          <div className="flex gap-2">
            <select value={selectedResponsible} onChange={(e) => setSelectedResponsible(e.target.value)} className="flex-1 px-2 py-2 border border-navy-200 rounded text-sm">
              <option value="">No owner</option>
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
              className="admin-btn admin-btn-primary admin-btn--sm"
            >
              Save
            </button>
          </div>
        </div>

        <div className="border border-navy-100 rounded p-3">
          <p className="text-xs uppercase tracking-wide text-navy-500 mb-2">Links</p>
          <p className="text-sm text-navy-600">Policy: {policy ? `${policy.policyNumber} (${POLICY_TYPE_LABELS[policy.type] ?? policy.type})` : '—'}</p>
          <p className="text-sm text-navy-600">Client/Company: {company?.name || individualClient?.fullName || '—'}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="border border-navy-100 rounded p-3">
          <p className="text-xs uppercase tracking-wide text-navy-500 mb-3">Timeline</p>
          <div className="max-h-56 overflow-auto space-y-2">
            {operations.timeline.length === 0 ? <p className="text-sm text-navy-400">No events.</p> : operations.timeline.slice().reverse().map((event) => (
              <div key={event.id} className="text-sm border border-navy-100 rounded p-2">
                <p className="text-navy-700">{event.message}</p>
                <p className="text-xs text-navy-400 mt-1">{event.actorName} · {formatDateTime(event.createdAt)}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-navy-100 rounded p-3">
          <p className="text-xs uppercase tracking-wide text-navy-500 mb-3">Team notes</p>
          <div className="max-h-40 overflow-auto space-y-2 mb-3">
            {operations.teamNotes.length === 0 ? <p className="text-sm text-navy-400">No notes.</p> : operations.teamNotes.slice().reverse().map((note) => (
              <div key={note.id} className="text-sm border border-navy-100 rounded p-2">
                <p>{note.note}</p>
                <p className="text-xs text-navy-400 mt-1">{note.authorName} · {formatDateTime(note.createdAt)}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newNote} onChange={(e) => setNewNote(e.target.value)} className="flex-1 px-2 py-2 border border-navy-200 rounded text-sm" placeholder="Add an internal note…" />
            <button
              onClick={async () => {
                if (!newNote.trim()) return
                await adminAddClaimTeamNote({ data: { claimId: claim.id, note: newNote } })
                setNewNote('')
                await onUpdated()
              }}
              className="admin-btn admin-btn-primary admin-btn--sm"
            >
              Add
            </button>
          </div>
        </div>
      </div>

      <div className="border border-navy-100 rounded p-3">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs uppercase tracking-wide text-navy-500">Documents</p>
          <label className="admin-btn admin-btn-primary admin-btn--sm cursor-pointer">
            {uploading ? 'Uploading…' : 'Upload'}
            <input type="file" className="hidden" onChange={handleUploadDocument} />
          </label>
        </div>
        <div className="space-y-2">
          {operations.documents.length === 0 ? <p className="text-sm text-navy-400">No files.</p> : operations.documents.map((doc) => (
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
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border border-navy-100 rounded p-3">
        <p className="text-xs uppercase tracking-wide text-navy-500 mb-3">Messages (ticket)</p>
        <div className="max-h-60 overflow-auto space-y-2 mb-3">
          {operations.messages.length === 0 ? <p className="text-sm text-navy-400">No messages.</p> : operations.messages.map((message) => (
            <div key={message.id} className={`rounded p-2 text-sm ${message.senderRole === 'admin' ? 'bg-navy-50 border border-navy-100' : 'bg-[#EEF2F7] border border-[#DCE6F0]'}`}>
              <p className="text-navy-700">{message.body}</p>
              <p className="text-xs text-navy-400 mt-1">{message.senderName} · {formatDateTime(message.createdAt)}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={newMessage} onChange={(e) => setNewMessage(e.target.value)} className="flex-1 px-2 py-2 border border-navy-200 rounded text-sm" placeholder="Reply to the client…" />
          <button
            onClick={async () => {
              if (!newMessage.trim()) return
              await adminSendClaimMessage({ data: { claimId: claim.id, message: newMessage } })
              setNewMessage('')
              await onUpdated()
            }}
            className="admin-btn admin-btn-primary"
          >
            Send
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
  const [error, setError] = useState<string | null>(null)

  const update = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const updateCommissionPercentage = (value: string) => {
    const pct = parseFloat(value)
    const premium = parseFloat(form.annualPremium)
    setForm((f) => ({
      ...f,
      commissionPercentage: value,
      commissionValue: (!isNaN(pct) && !isNaN(premium) && premium > 0) ? (premium * pct / 100).toFixed(2) : f.commissionValue,
    }))
  }

  const updateCommissionValue = (value: string) => {
    const val = parseFloat(value)
    const premium = parseFloat(form.annualPremium)
    setForm((f) => ({
      ...f,
      commissionValue: value,
      commissionPercentage: (!isNaN(val) && !isNaN(premium) && premium > 0) ? (val / premium * 100).toFixed(2) : f.commissionPercentage,
    }))
  }

  const updatePremium = (value: string) => {
    const premium = parseFloat(value)
    const pct = parseFloat(form.commissionPercentage)
    setForm((f) => ({
      ...f,
      annualPremium: value,
      commissionValue: (!isNaN(pct) && !isNaN(premium) && premium > 0) ? (premium * pct / 100).toFixed(2) : f.commissionValue,
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creating policy')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-[4px] border border-navy-200 p-6 mb-6">
      <h3 className="text-lg font-semibold text-navy-700 mb-4">New Policy</h3>
      <form onSubmit={handleSubmit} className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-navy-600 mb-1">Client Type</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setClientType('company')}
              className={`px-4 py-2 rounded-[2px] text-sm font-medium border transition-colors ${clientType === 'company' ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-navy-600 border-navy-200 hover:border-navy-400'}`}
            >
              Company
            </button>
            <button
              type="button"
              onClick={() => setClientType('individual')}
              className={`px-4 py-2 rounded-[2px] text-sm font-medium border transition-colors ${clientType === 'individual' ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-navy-600 border-navy-200 hover:border-navy-400'}`}
            >
              Individual Client
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-600 mb-1">{clientType === 'company' ? 'Company' : 'Individual Client'}</label>
          {clientType === 'company' ? (
            <select value={form.companyId} onChange={(e) => update('companyId', e.target.value)} className="w-full px-4 py-2.5 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-[#223553]" required>
              <option value="">Select company</option>
              {companies.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          ) : (
            <select value={form.individualClientId} onChange={(e) => update('individualClientId', e.target.value)} className="w-full px-4 py-2.5 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-[#223553]" required>
              <option value="">Select client</option>
              {individualClients.map((c) => (<option key={c.id} value={c.id}>{c.fullName}{c.nif ? ` · ${c.nif}` : ''}</option>))}
            </select>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-600 mb-1">Type</label>
          <select value={form.type} onChange={(e) => update('type', e.target.value)} className="w-full px-4 py-2.5 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-[#223553]" required>
            <option value="">Select…</option>
            {Object.entries(POLICY_TYPE_LABELS).map(([key, label]) => (<option key={key} value={key}>{label}</option>))}
          </select>
        </div>
        <FormField label="Insurer" value={form.insurer} onChange={(v) => update('insurer', v)} required />
        <FormField label="Policy No." value={form.policyNumber} onChange={(v) => update('policyNumber', v)} required />
        <div className="sm:col-span-2">
          <FormField label="Description" value={form.description} onChange={(v) => update('description', v)} required />
        </div>
        <FormField label="Start Date" value={form.startDate} onChange={(v) => update('startDate', v)} type="date" required />
        <FormField label="End Date" value={form.endDate} onChange={(v) => update('endDate', v)} type="date" required />
        <FormField label="Annual Premium (EUR)" value={form.annualPremium} onChange={(v) => updatePremium(v)} type="number" required />
        <FormField label="Insured Value (EUR)" value={form.insuredValue} onChange={(v) => update('insuredValue', v)} type="number" required />
        <div>
          <label className="block text-sm font-medium text-navy-600 mb-1">Payment Frequency</label>
          <select
            value={form.paymentFrequency}
            onChange={(e) => update('paymentFrequency', e.target.value)}
            className="w-full px-4 py-2.5 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-[#223553]"
          >
            <option value="mensal">Monthly</option>
            <option value="trimestral">Quarterly</option>
            <option value="semestral">Half-yearly</option>
            <option value="anual">Yearly</option>
          </select>
        </div>
        <FormField label="Commission (%)" value={form.commissionPercentage} onChange={(v) => updateCommissionPercentage(v)} type="number" />
        <FormField label="Commission (€)" value={form.commissionValue} onChange={(v) => updateCommissionValue(v)} type="number" />
        <div className="sm:col-span-2">
          {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
          <button type="submit" disabled={submitting} className="admin-btn admin-btn-primary">
            {submitting ? 'Creating…' : 'Create policy'}
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

    const hasPolicies = true // we don't have the count here, warn generically
    const authWarning = client.authUserId ? '\n⚠️ This client has portal access — access will be disabled.' : ''
    if (!confirm(`Convert "${client.fullName}" to a company?\n\nThis will:\n• Create a company record\n• Move the linked policies\n• Delete the individual client record${authWarning}`)) return

    setPromoting(true)
    try {
      await adminPromoteToCompany({ data: { clientId: client.id } })
      await onSuccess()
    } catch (err: any) {
      alert(`Error converting: ${err?.message ?? 'unknown failure'}`)
    } finally {
      setPromoting(false)
    }
  }

  return (
    <select
      value="individual"
      onChange={handleChange}
      disabled={promoting}
      className="text-xs border border-navy-200 rounded px-1.5 py-1 bg-white text-navy-700 focus:outline-none focus:ring-1 focus:ring-[#223553] disabled:opacity-50"
    >
      <option value="individual">Individual</option>
      <option value="company">→ Company</option>
    </select>
  )
}

function ActivateAdlerOneButton({ client, onSuccess }: { client: IndividualClient; onSuccess: () => Promise<void> }) {
  // Invite flow state (existing, unchanged)
  const [activating,        setActivating]        = useState(false)
  const [message,           setMessage]           = useState<string | null>(null)

  // Generated-password flow state — isolated so it doesn't interfere with invite
  const [grantingAccess,    setGrantingAccess]    = useState(false)
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null)
  const [grantError,        setGrantError]        = useState<string | null>(null)

  // Password reset flow state
  const [resetting,         setResetting]         = useState(false)
  const [resetError,        setResetError]        = useState<string | null>(null)
  const [passwordContext,   setPasswordContext]   = useState<'grant' | 'reset'>('grant')

  // Access revocation flow state
  const [revoking,          setRevoking]          = useState(false)
  const [revokeError,       setRevokeError]       = useState<string | null>(null)

  const handleClosePassword = async () => {
    setGeneratedPassword(null)
    setGrantError(null)
    setResetError(null)
    await onSuccess()
  }

  return (
    <>
      {/* Shared overlay — grant and reset flows */}
      {generatedPassword && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={handleClosePassword}
        >
          <div
            style={{ background: '#fff', borderRadius: 8, padding: '1.75rem', maxWidth: 440, width: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', fontFamily: "'Montserrat', sans-serif" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ fontWeight: 700, fontSize: '1rem', color: '#0A1628', margin: '0 0 0.3rem' }}>
              {passwordContext === 'reset' ? 'Password reset' : 'Access created'} — {client.fullName}
            </p>
            <p style={{ fontSize: '0.78rem', color: '#64748B', margin: '0 0 0.85rem' }}>
              {client.email}
            </p>
            <p style={{ fontSize: '0.82rem', color: '#B91C1C', fontWeight: 600, margin: '0 0 0.85rem' }}>
              ⚠ Save this password now — it will not be shown again.
            </p>
            <div style={{ background: '#F1F5F9', borderRadius: 6, padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <code style={{ flex: 1, fontFamily: 'monospace', fontSize: '1.05rem', letterSpacing: '0.08em', color: '#0A1628', wordBreak: 'break-all' }}>
                {generatedPassword}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(generatedPassword)}
                style={{ flexShrink: 0, padding: '0.35rem 0.75rem', background: '#0A1628', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: "'Montserrat', sans-serif" }}
              >
                Copy
              </button>
            </div>
            <p style={{ fontSize: '0.74rem', color: '#64748B', margin: '0 0 1.25rem', lineHeight: 1.5 }}>
              Hand it to the client over a secure channel (phone or direct message).<br />
              {passwordContext === 'reset'
                ? 'The client can use this password immediately.'
                : <><strong>Portal → Profile</strong> lets them change the password after first login.</>}
            </p>
            <button
              onClick={handleClosePassword}
              style={{ width: '100%', padding: '0.6rem', background: '#F1F5F9', color: '#0A1628', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', fontFamily: "'Montserrat', sans-serif" }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* State 1: client already has access → green badge + reset password + revoke */}
      {client.authUserId && (
        <>
          {resetError && <p className="text-xs text-red-600 mb-1">{resetError}</p>}
          {revokeError && <p className="text-xs text-red-600 mb-1">{revokeError}</p>}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
            <span className="admin-chip admin-chip--success">
              Portal access ✓
            </span>
            <button
              disabled={resetting || revoking}
              onClick={async () => {
                if (!confirm(`Generate a new password for ${client.fullName}?`)) return
                setResetting(true)
                setResetError(null)
                try {
                  const result = await adminResetIndividualClientPassword({ data: { clientId: client.id } })
                  setPasswordContext('reset')
                  setGeneratedPassword(result.password)
                } catch (e: any) {
                  setResetError(`Error: ${e?.message ?? 'failed to reset password'}`)
                } finally {
                  setResetting(false)
                }
              }}
              className="admin-row-action"
            >
              {resetting ? '…' : 'Password access'}
            </button>
            <button
              disabled={resetting || revoking}
              onClick={async () => {
                if (!confirm(`Revoke ${client.fullName}'s portal access?\n\nThe client will no longer be able to sign in. Their record (policies, documents, etc.) is kept and access can be granted again later.`)) return
                setRevoking(true)
                setRevokeError(null)
                try {
                  await adminRevokeIndividualClientAccess({ data: { clientId: client.id } })
                  await onSuccess()
                } catch (e: any) {
                  setRevokeError(`Error: ${e?.message ?? 'failed to revoke access'}`)
                } finally {
                  setRevoking(false)
                }
              }}
              className="admin-row-action admin-row-action--danger"
            >
              {revoking ? '…' : 'Revoke'}
            </button>
          </div>
        </>
      )}

      {/* State 2: no email → disabled */}
      {!client.authUserId && !client.email && (
        <span title="No email — edit the client first" className="admin-chip admin-chip--neutral">
          No email
        </span>
      )}

      {/* State 3: has email, no access → two buttons */}
      {!client.authUserId && client.email && (
        <>
          {message && (
            <p className="text-xs text-green-700 mb-1">{message}</p>
          )}
          {grantError && (
            <p className="text-xs text-red-600 mb-1">{grantError}</p>
          )}
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            <button
              disabled={activating || grantingAccess}
              onClick={async () => {
                if (!confirm(`Send a portal invite to ${client.email}?`)) return
                setActivating(true)
                setMessage(null)
                setGrantError(null)
                try {
                  await adminActivateAdlerOne({ data: { clientId: client.id, email: client.email!, fullName: client.fullName } })
                  setMessage(`Invite sent to ${client.email}`)
                  await onSuccess()
                } catch (e: any) {
                  setMessage(`Error: ${e?.message ?? 'failed to send invite'}`)
                } finally {
                  setActivating(false)
                }
              }}
              className="admin-row-action"
            >
              {activating ? '…' : 'Invite'}
            </button>

            <button
              disabled={activating || grantingAccess}
              onClick={async () => {
                if (!confirm(`Create portal access for ${client.fullName} (${client.email})?\n\nThe system will generate a password to hand to the client.`)) return
                setGrantingAccess(true)
                setGrantError(null)
                setMessage(null)
                try {
                  const result = await adminGrantIndividualClientAccess({ data: { clientId: client.id } })
                  setPasswordContext('grant')
                  setGeneratedPassword(result.password)
                } catch (e: any) {
                  setGrantError(`Error: ${e?.message ?? 'failed to create access'}`)
                } finally {
                  setGrantingAccess(false)
                }
              }}
              className="admin-row-action"
            >
              {grantingAccess ? '…' : 'Password access'}
            </button>
          </div>
        </>
      )}
    </>
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
    marketingOptOut: initial?.marketingOptOut ?? false,
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
        <FormField label="Full Name" value={form.fullName} onChange={(v) => update('fullName', v)} required />
        <FormField label="NIF" value={form.nif} onChange={(v) => update('nif', v)} />
        <FormField label="Email" value={form.email} onChange={(v) => update('email', v)} type="email" />
        <FormField label="Phone" value={form.phone} onChange={(v) => update('phone', v)} />
        <div className="sm:col-span-2">
          <FormField label="Address" value={form.address} onChange={(v) => update('address', v)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-600 mb-1">Status</label>
          <select
            value={form.status}
            onChange={(e) => update('status', e.target.value)}
            className="w-full px-4 py-2.5 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-[#223553]"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.marketingOptOut}
              onChange={(e) => setForm((f) => ({ ...f, marketingOptOut: e.target.checked }))}
              className="mt-0.5 w-4 h-4 accent-[#17243D]"
            />
            <div>
              <span className="text-sm font-medium text-navy-700">Do not send marketing communications</span>
              <p className="text-xs text-navy-400 mt-0.5">
                When enabled, this client does not receive marketing campaigns. Check this when the client asks to be removed (reply "Remove").
              </p>
            </div>
          </label>
        </div>
        <div className="sm:col-span-2">
          <button type="submit" disabled={submitting} className="admin-btn admin-btn-primary">
            {submitting ? 'Saving…' : 'Save client'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const POLICY_STATUS_LABEL: Record<string, string> = {
  active: 'Active', ativa: 'Active',
  expiring: 'Renewing',
  expired: 'Expired', expirada: 'Expired',
  cancelled: 'Cancelled', cancelada: 'Cancelled',
}
const POLICY_STATUS_CLASS: Record<string, string> = {
  active: 'bg-green-100 text-green-700', ativa: 'bg-green-100 text-green-700',
  expiring: 'bg-yellow-100 text-yellow-700',
  expired: 'bg-red-100 text-red-700', expirada: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-600', cancelada: 'bg-gray-100 text-gray-600',
}

// ─── Admin Policy List ────────────────────────────────────────────────────────

function AdminPolicyList({ policies, companies, individualClients, onReload, selectedPolicyIds, setSelectedPolicyIds }: {
  policies: Policy[]
  companies: Company[]
  individualClients: IndividualClient[]
  onReload: () => Promise<void>
  selectedPolicyIds: Set<string>
  setSelectedPolicyIds: React.Dispatch<React.SetStateAction<Set<string>>>
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (policies.length === 0) return <p className="text-navy-500 text-sm">No policies for the selected filter.</p>

  return (
    <div className="flex flex-col gap-3">
      {policies.map((policy) => {
        const clientName = companies.find(c => c.id === policy.companyId)?.name
          ?? individualClients.find(c => c.id === policy.individualClientId)?.fullName
          ?? '—'
        const isEditing = editingId === policy.id
        const isExpanded = expandedId === policy.id

        return (
          <div key={policy.id} className="bg-white rounded-[4px] border border-navy-200 overflow-hidden">
            {/* Summary row */}
            <div className="flex items-center gap-3 px-4 py-3">
              <input
                type="checkbox"
                checked={selectedPolicyIds.has(policy.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  setSelectedPolicyIds((prev) => {
                    const next = new Set(prev)
                    if (e.target.checked) next.add(policy.id)
                    else next.delete(policy.id)
                    return next
                  })
                }}
                className="w-4 h-4 accent-[#17243D] cursor-pointer"
              />
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
                <p className="text-xs text-navy-400 mt-0.5">{formatCurrency(policy.annualPremium)}/yr · {formatDate(policy.endDate)}</p>
              </div>
              <button
                onClick={() => setEditingId(isEditing ? null : policy.id)}
                className="admin-row-action"
              >
                {isEditing ? 'Cancel' : 'Edit'}
              </button>
            </div>

            {/* Edit form */}
            {isEditing && (
              <div className="border-t border-navy-100 bg-navy-50/30 p-4">
                <PolicyEditForm
                  policy={policy}
                  onSave={async (updates) => {
                    await adminUpdatePolicy({ data: { id: policy.id, updates } })
                    setEditingId(null)
                    await onReload()
                  }}
                />
              </div>
            )}

            {/* Expanded: documents */}
            {isExpanded && !isEditing && (
              <AdminPolicyStorageDocs
                policy={policy}
                clientEmail={
                  individualClients.find((c) => c.id === policy.individualClientId)?.email
                  ?? companies.find((c) => c.id === policy.companyId)?.contactEmail
                  ?? undefined
                }
                onReload={onReload}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}


const DEFAULT_MESSAGE =
  'Please find attached the document related to your policy. Should you require any clarification, do not hesitate to contact us. Best regards, Adler & Rochefort.'

function SendDocumentModal({
  policyId,
  storagePath,
  filename,
  policyNumber,
  insurer,
  defaultEmail,
  onClose,
}: {
  policyId: string
  storagePath: string
  filename: string
  policyNumber: string
  insurer: string
  defaultEmail?: string
  onClose: () => void
}) {
  const [inputEmail, setInputEmail] = useState('')
  const [recipients, setRecipients] = useState<string[]>(defaultEmail ? [defaultEmail] : [])
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const addRecipient = () => {
    const email = inputEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) return
    if (!recipients.includes(email)) setRecipients((prev) => [...prev, email])
    setInputEmail('')
  }

  const removeRecipient = (email: string) =>
    setRecipients((prev) => prev.filter((e) => e !== email))

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addRecipient() }
  }

  const handleSend = async () => {
    if (!recipients.length) return
    setSending(true)
    setResult(null)
    try {
      const res = await adminSendPolicyDocument({
        data: { policyId, storagePath, filename, recipients, message },
      })
      setResult({ ok: true, msg: `Document sent to ${res.sent} recipient(s).` })
      setTimeout(onClose, 2000)
    } catch (e: any) {
      setResult({ ok: false, msg: e?.message ?? 'Error sending document.' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} onClick={onClose} />
      <div style={{ position: 'relative', background: '#fff', borderRadius: 8, width: '95%', maxWidth: 520, padding: '1.75rem', fontFamily: 'Arial, sans-serif', boxShadow: '0 4px 24px rgba(0,0,0,0.18)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 1.25rem', color: '#1B2B4B' }}>
          Send Document to Client
        </h3>

        {/* Referência readonly */}
        <div style={{ background: '#F4F6F9', borderLeft: '3px solid #223553', borderRadius: 3, padding: '10px 14px', marginBottom: '1.25rem' }}>
          <p style={{ margin: '0 0 2px', fontSize: '0.7rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Policy</p>
          <p style={{ margin: '0 0 2px', fontSize: '0.95rem', fontWeight: 700, color: '#1B2B4B', fontFamily: 'Courier New, monospace', letterSpacing: '0.08em' }}>{policyNumber}</p>
          <p style={{ margin: '0 0 4px', fontSize: '0.78rem', color: '#555' }}>{insurer}</p>
          <p style={{ margin: 0, fontSize: '0.75rem', color: '#888' }}>📄 {filename}</p>
        </div>

        {/* Destinatários */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: '#555', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Recipients *
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <input
              type="email"
              value={inputEmail}
              onChange={(e) => setInputEmail(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="email@example.com"
              style={{ flex: 1, padding: '0.45rem 0.75rem', border: '1px solid #ddd', borderRadius: 4, fontSize: '0.85rem' }}
            />
            <button
              type="button"
              onClick={addRecipient}
              style={{ padding: '0.45rem 0.9rem', background: '#1B2B4B', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Add
            </button>
          </div>
          {recipients.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {recipients.map((email) => (
                <span key={email} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: '#EEF2F7', border: '1px solid #D1D9E8', borderRadius: 4, padding: '0.2rem 0.6rem', fontSize: '0.78rem', color: '#1B2B4B' }}>
                  {email}
                  <button type="button" onClick={() => removeRecipient(email)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: '1rem', lineHeight: 1, padding: 0 }}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Mensagem de acompanhamento */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: '#555', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Accompanying message
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #ddd', borderRadius: 4, fontSize: '0.83rem', lineHeight: '1.55', resize: 'vertical', boxSizing: 'border-box' }}
          />
        </div>

        {/* Aviso BCC */}
        <p style={{ fontSize: '0.72rem', color: '#999', margin: '0 0 1.25rem' }}>
          A copy will be archived to insurance@adlerrochefort.com (automatic BCC).
        </p>

        {/* Feedback */}
        {result && (
          <div style={{ marginBottom: '1rem', padding: '0.6rem 0.9rem', borderRadius: 4, background: result.ok ? '#D1FAE5' : '#FEE2E2', color: result.ok ? '#065F46' : '#991B1B', fontSize: '0.82rem', fontWeight: 600 }}>
            {result.msg}
          </div>
        )}

        {/* Acções */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <button
            onClick={onClose}
            style={{ padding: '0.5rem 1.1rem', background: 'none', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.83rem', cursor: 'pointer', color: '#555' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !recipients.length}
            style={{ padding: '0.5rem 1.3rem', background: recipients.length ? '#17243D' : '#ddd', border: 'none', borderRadius: 4, fontSize: '0.83rem', fontWeight: 700, cursor: recipients.length ? 'pointer' : 'not-allowed', color: recipients.length ? '#fff' : '#999' }}
          >
            {sending ? 'Sending…' : 'Send document'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PolicyDocumentButtons({
  storagePath,
  name,
  policy,
  clientEmail,
}: {
  storagePath: string
  name: string
  policy: Policy
  clientEmail?: string
}) {
  const [loading, setLoading] = useState(false)
  const [showSendModal, setShowSendModal] = useState(false)

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
    <>
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
        <button
          disabled={loading}
          onClick={() => setShowSendModal(true)}
          className="px-1.5 py-0.5 text-xs border border-navy-200 rounded hover:bg-navy-50 disabled:opacity-50"
          title="Send to client"
        >
          📧
        </button>
      </span>
      {showSendModal && (
        <SendDocumentModal
          policyId={policy.id}
          storagePath={storagePath}
          filename={name}
          policyNumber={policy.policyNumber}
          insurer={policy.insurer}
          defaultEmail={clientEmail}
          onClose={() => setShowSendModal(false)}
        />
      )}
    </>
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
      const effectiveCompanyId = companyId || 'general'
      const storagePath = `${effectiveCompanyId}/policies/${policyId}/${Date.now()}_${file.name}`
      const { token, path } = await getStorageUploadUrl({ data: { storagePath } })
      const { error: upErr } = await supabase.storage.from('documents').uploadToSignedUrl(path, token, file)
      if (upErr) throw new Error(upErr.message)
      await adminUploadPolicyDocument({
        data: {
          policyId,
          companyId: effectiveCompanyId !== 'general' ? effectiveCompanyId : undefined,
          individualClientId: individualClientId || undefined,
          name: file.name,
          storagePath,
          size: file.size,
          category: file.type.startsWith('image/') ? 'certificate' : 'policy',
        },
      })
      await onUploaded()
    } catch (err: any) {
      setError(err?.message ?? 'Upload error')
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
        className="admin-btn admin-btn-primary admin-btn--sm"
      >
        {uploading ? 'Uploading…' : '↑ Upload'}
      </button>
      <input ref={ref} type="file" accept="application/pdf,image/*" className="hidden" onChange={handleFile} />
    </div>
  )
}

function AdminPolicyStorageDocs({ policy, clientEmail, onReload }: { policy: Policy; clientEmail?: string; onReload: () => Promise<void> }) {
  const [docs, setDocs] = useState<PolicyDocFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchPolicyDocuments({
        data: { policyId: policy.id, companyId: policy.companyId || undefined },
      })
      setDocs(data as PolicyDocFile[])
    } catch (e: any) {
      setError(e?.message ?? 'Error loading documents')
    } finally {
      setLoading(false)
    }
  }, [policy.id, policy.companyId])

  useEffect(() => { load() }, [load])

  const handleUploaded = useCallback(async () => {
    await load()
    await onReload()
  }, [load, onReload])

  return (
    <div className="border-t border-navy-100 bg-navy-50/30 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-navy-600 uppercase tracking-wide">Linked Documents</p>
        <PolicyDocumentUpload
          policyId={policy.id}
          companyId={policy.companyId}
          individualClientId={policy.individualClientId}
          onUploaded={handleUploaded}
        />
      </div>
      {loading && <p className="text-xs text-navy-400">Loading…</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {!loading && !error && docs.length === 0 && (
        <p className="text-xs text-navy-400 mb-3">No documents linked.</p>
      )}
      {!loading && docs.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {docs.map(d => (
            <li key={d.id} className="text-xs text-navy-600 flex items-center gap-2 flex-wrap">
              <span>📄</span>
              <span className="font-medium">{d.name}</span>
              <PolicyDocumentButtons storagePath={d.storagePath} name={d.name} policy={policy} clientEmail={clientEmail} />
            </li>
          ))}
        </ul>
      )}
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

  const updateCommissionPct = (v: string) => {
    const pct = parseFloat(v)
    const premium = parseFloat(form.annualPremium)
    setForm(f => ({
      ...f,
      commissionPercentage: v,
      commissionValue: (!isNaN(pct) && !isNaN(premium) && premium > 0) ? (premium * pct / 100).toFixed(2) : f.commissionValue,
    }))
  }

  const updateCommissionVal = (v: string) => {
    const val = parseFloat(v)
    const premium = parseFloat(form.annualPremium)
    setForm(f => ({
      ...f,
      commissionValue: v,
      commissionPercentage: (!isNaN(val) && !isNaN(premium) && premium > 0) ? (val / premium * 100).toFixed(2) : f.commissionPercentage,
    }))
  }

  const updateEditPremium = (v: string) => {
    const premium = parseFloat(v)
    const pct = parseFloat(form.commissionPercentage)
    setForm(f => ({
      ...f,
      annualPremium: v,
      commissionValue: (!isNaN(pct) && !isNaN(premium) && premium > 0) ? (premium * pct / 100).toFixed(2) : f.commissionValue,
    }))
  }

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

  const inp = 'w-full px-3 py-2 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-1 focus:ring-[#223553]'
  const lbl = 'block text-xs font-semibold text-navy-500 uppercase tracking-wide mb-1'

  return (
    <div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <div>
          <label className={lbl}>Type</label>
          <select value={form.type} onChange={e => u('type', e.target.value)} className={inp}>
            {Object.entries(POLICY_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Insurer</label>
          <input className={inp} value={form.insurer} onChange={e => u('insurer', e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Policy No.</label>
          <input className={inp} value={form.policyNumber} onChange={e => u('policyNumber', e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Status</label>
          <select value={form.status} onChange={e => u('status', e.target.value)} className={inp}>
            {Object.entries(POLICY_STATUS_LABEL)
              .filter(([k]) => ['active','expiring','expired','cancelled'].includes(k))
              .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Start Date</label>
          <input type="date" className={inp} value={form.startDate} onChange={e => u('startDate', e.target.value)} />
        </div>
        <div>
          <label className={lbl}>End Date</label>
          <input type="date" className={inp} value={form.endDate} onChange={e => u('endDate', e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Renewal Date</label>
          <input type="date" className={inp} value={form.renewalDate} onChange={e => u('renewalDate', e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Annual Premium (€)</label>
          <input type="number" className={inp} value={form.annualPremium} onChange={e => updateEditPremium(e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Payment Frequency</label>
          <input className={inp} value={form.paymentFrequency} onChange={e => u('paymentFrequency', e.target.value)} placeholder="Monthly, Yearly…" />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className={lbl}>Description (visible in portal)</label>
          <input className={inp} value={form.description} onChange={e => u('description', e.target.value)} />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className={lbl}>Emergency Contacts (visible in portal)</label>
          <input className={inp} value={form.emergencyContacts} onChange={e => u('emergencyContacts', e.target.value)} placeholder="Assistance Line: 800 XXX XXX" />
        </div>
        <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-2">
          <input type="checkbox" id={`vp-${policy.id}`} checked={form.visiblePortal} onChange={e => u('visiblePortal', e.target.checked)} className="accent-[#17243D]" />
          <label htmlFor={`vp-${policy.id}`} className="text-sm text-navy-600 cursor-pointer">Visible in customer portal</label>
        </div>
      </div>

      <p className="text-xs font-semibold text-navy-400 uppercase tracking-wide mb-2 mt-1">Internal Fields (admin only)</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <div>
          <label className={lbl}>Commission %</label>
          <input type="number" className={inp} value={form.commissionPercentage} onChange={e => updateCommissionPct(e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Commission €</label>
          <input type="number" className={inp} value={form.commissionValue} onChange={e => updateCommissionVal(e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Deductible (€)</label>
          <input type="number" className={inp} value={form.deductible} onChange={e => u('deductible', e.target.value)} />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className={lbl}>Internal Notes</label>
          <textarea className={inp + ' resize-y'} rows={3} value={form.notesInternal} onChange={e => u('notesInternal', e.target.value)} />
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="admin-btn admin-btn-primary"
      >
        {saving ? 'Saving…' : 'Save changes'}
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
        className="w-full px-4 py-2.5 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-[#223553]"
        required={required}
      />
    </div>
  )
}
