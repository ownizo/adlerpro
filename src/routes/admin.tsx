import { createFileRoute, Navigate } from '@tanstack/react-router'
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
} from '@/lib/types'
import { POLICY_TYPE_LABELS, CLAIM_STATUS_LABELS } from '@/lib/types'
import { useState, useEffect } from 'react'
import { useIdentity } from '@/lib/identity-context'

export const Route = createFileRoute('/admin')({
  component: AdminPage,
})

function AdminPage() {
  const { user, ready } = useIdentity()
  const [tab, setTab] = useState<'companies' | 'policies' | 'claims' | 'api' | 'profiles' | 'alerts'>('companies')
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([])
  const [userEvents, setUserEvents] = useState<UserMetricEvent[]>([])
  const [apiConnections, setApiConnections] = useState<ApiConnection[]>([])
  const [policies, setPolicies] = useState<Policy[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [documents, setDocuments] = useState<DocType[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewCompany, setShowNewCompany] = useState(false)
  const [showNewPolicy, setShowNewPolicy] = useState(false)
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null)
  const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(null)
  const [showUserFormForCompanyId, setShowUserFormForCompanyId] = useState<string | null>(null)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('')

  const reload = async () => {
    const { companies: c, companyUsers: u, userEvents: e, apiConnections: a, policies: p, claims: cl, documents: d } = await fetchAdminAll()
    setCompanies(c)
    setCompanyUsers(u)
    setUserEvents(e)
    setApiConnections(a)
    setPolicies(p)
    setClaims(cl)
    setDocuments(d)
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

  if (!ready) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" />
  if (!user.roles?.includes('admin')) return <Navigate to="/dashboard" />

  const tabs = [
    { key: 'companies' as const, label: 'Empresas' },
    { key: 'policies' as const, label: 'Apólices e Docs' },
    { key: 'claims' as const, label: 'Sinistros' },
    { key: 'api' as const, label: 'API & Ligações' },
    { key: 'profiles' as const, label: 'Perfis e Métricas' },
    { key: 'alerts' as const, label: 'Alertas (60 dias)' },
  ]

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

        <div className="flex flex-wrap gap-1 bg-navy-100 p-1 rounded-[2px] mb-8 w-fit">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === t.key ? 'bg-white text-navy-700 shadow-sm' : 'text-navy-500 hover:text-navy-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
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
                  {companies.map((company) => {
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
                              <SimpleCollection
                                title="Apólices da Empresa"
                                rows={companyPolicies.map((policy) => `${POLICY_TYPE_LABELS[policy.type]} · ${policy.policyNumber} · ${policy.insurer}`)}
                                emptyMessage="Sem apólices associadas."
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
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
                      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <button
                    onClick={() => setShowNewPolicy(!showNewPolicy)}
                    className="px-4 py-2 bg-gold-400 text-navy-700 font-semibold rounded-[2px] hover:bg-gold-300 transition-colors text-sm whitespace-nowrap"
                  >
                    {showNewPolicy ? 'Cancelar' : 'Nova Apólice'}
                  </button>
                </div>

                {showNewPolicy && (
                  <NewPolicyForm
                    companies={companies}
                    onSubmit={async (data) => {
                      await adminCreatePolicy({ data })
                      await reload()
                      setShowNewPolicy(false)
                    }}
                  />
                )}

                <div className="grid lg:grid-cols-2 gap-8">
                  <SimpleCollection
                    title={`Apólices ${selectedCompanyId ? 'do Cliente' : 'Globais'}`}
                    rows={policies
                      .filter((p) => selectedCompanyId ? p.companyId === selectedCompanyId : true)
                      .map((p) => `${POLICY_TYPE_LABELS[p.type]} · ${p.policyNumber} · ${formatCurrency(p.annualPremium)}`)}
                    emptyMessage="Sem apólices para o filtro selecionado."
                  />
                  <SimpleCollection
                    title={`Documentos ${selectedCompanyId ? 'do Cliente' : 'Globais'}`}
                    rows={documents
                      .filter((d) => selectedCompanyId ? d.companyId === selectedCompanyId : true)
                      .map((d) => `${d.name} · ${d.category} · ${formatDate(d.uploadedAt)}`)}
                    emptyMessage="Sem documentos para o filtro selecionado."
                  />
                </div>
              </div>
            )}

            {tab === 'claims' && (
              <div>
                <h2 className="text-lg font-semibold text-navy-700 mb-4">Sinistros ({claims.length})</h2>
                <div className="grid gap-4">
                  {claims.map((claim) => {
                    const policy = policies.find((p) => p.id === claim.policyId)
                    const company = companies.find((c) => c.id === claim.companyId)
                    return (
                      <AdminClaimCard
                        key={claim.id}
                        claim={claim}
                        policy={policy}
                        company={company}
                        onStatusUpdate={async (status, notes) => {
                          await adminUpdateClaimStatus({ data: { claimId: claim.id, status, notes } })
                          await reload()
                        }}
                      />
                    )
                  })}
                </div>
              </div>
            )}

            {tab === 'api' && (
              <div>
                <h2 className="text-lg font-semibold text-navy-700 mb-4">Estado das Ligações API</h2>
                <div className="grid gap-4">
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

function AdminClaimCard({
  claim,
  policy,
  company,
  onStatusUpdate,
}: {
  claim: Claim
  policy?: Policy
  company?: Company
  onStatusUpdate: (status: string, notes?: string) => Promise<void>
}) {
  const [updating, setUpdating] = useState(false)
  const [newStatus, setNewStatus] = useState('')
  const [notes, setNotes] = useState('')

  const handleUpdate = async () => {
    if (!newStatus) return
    setUpdating(true)
    await onStatusUpdate(newStatus, notes || undefined)
    setNewStatus('')
    setNotes('')
    setUpdating(false)
  }

  return (
    <div className="bg-white rounded-[4px] border border-navy-200 p-6">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-lg font-semibold text-navy-700">{claim.title}</h3>
          <p className="text-sm text-navy-400">
            {company?.name} | {policy ? `${POLICY_TYPE_LABELS[policy.type]} — ${policy.policyNumber}` : 'N/A'}
          </p>
        </div>
        <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${getStatusColor(claim.status)}`}>
          {CLAIM_STATUS_LABELS[claim.status]}
        </span>
      </div>
      <p className="text-sm text-navy-500 mb-4">{claim.description}</p>
      <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-navy-100">
        <select
          value={newStatus}
          onChange={(e) => setNewStatus(e.target.value)}
          className="px-3 py-2 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400"
        >
          <option value="">Alterar estado...</option>
          {Object.entries(CLAIM_STATUS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notas (opcional)"
          className="px-3 py-2 border border-navy-200 rounded-[2px] text-sm flex-1 min-w-48 focus:outline-none focus:ring-2 focus:ring-gold-400"
        />
        <button
          onClick={handleUpdate}
          disabled={!newStatus || updating}
          className="px-4 py-2 bg-navy-700 text-white text-sm font-medium rounded-[2px] hover:bg-navy-600 disabled:opacity-50 transition-colors"
        >
          {updating ? 'A atualizar...' : 'Atualizar'}
        </button>
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

function NewPolicyForm({ companies, onSubmit }: { companies: Company[]; onSubmit: (data: any) => Promise<void> }) {
  const [form, setForm] = useState({
    companyId: '', type: '', insurer: '', policyNumber: '', description: '', startDate: '', endDate: '', annualPremium: '', insuredValue: '',
  })
  const [submitting, setSubmitting] = useState(false)

  const update = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    await onSubmit({
      ...form,
      annualPremium: Number(form.annualPremium),
      insuredValue: Number(form.insuredValue),
    })
    setSubmitting(false)
  }

  return (
    <div className="bg-white rounded-[4px] border border-navy-200 p-6 mb-6">
      <h3 className="text-lg font-semibold text-navy-700 mb-4">Nova Apólice</h3>
      <form onSubmit={handleSubmit} className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-navy-600 mb-1">Empresa</label>
          <select value={form.companyId} onChange={(e) => update('companyId', e.target.value)} className="w-full px-4 py-2.5 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400" required>
            <option value="">Selecionar</option>
            {companies.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
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
        <div className="sm:col-span-2">
          <button type="submit" disabled={submitting} className="px-6 py-2.5 bg-gold-400 text-navy-700 font-semibold rounded-[2px] hover:bg-gold-300 disabled:opacity-50 text-sm">
            {submitting ? 'A criar...' : 'Criar Apólice'}
          </button>
        </div>
      </form>
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
