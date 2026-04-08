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
  adminCreateIndividualClient,
  adminUpdateIndividualClient,
  adminDeleteIndividualClient,
  fetchSocialPosts,
  adminCreateSocialPost,
  adminUpdateSocialPost,
  adminDeleteSocialPost,
  adminGenerateSocialContent,
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
} from '@/lib/types'
import { POLICY_TYPE_LABELS, CLAIM_STATUS_LABELS } from '@/lib/types'
import { useState, useEffect } from 'react'
import { useIdentity } from '@/lib/identity-context'

export const Route = createFileRoute('/admin')({
  component: AdminPage,
  head: () => ({ meta: [{ title: 'Adler Admin' }] }),
})

function AdminPage() {
  const { user, ready } = useIdentity()
  const [tab, setTab] = useState<'companies' | 'policies' | 'claims' | 'api' | 'profiles' | 'alerts' | 'individual_clients' | 'social'>('companies')
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([])
  const [userEvents, setUserEvents] = useState<UserMetricEvent[]>([])
  const [apiConnections, setApiConnections] = useState<ApiConnection[]>([])
  const [policies, setPolicies] = useState<Policy[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
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

  const reload = async () => {
    const [{ companies: c, companyUsers: u, userEvents: e, apiConnections: a, policies: p, claims: cl, documents: d, individualClients: ic }, sp] = await Promise.all([
      fetchAdminAll(),
      fetchSocialPosts(),
    ])
    setCompanies(c)
    setCompanyUsers(u)
    setUserEvents(e)
    setApiConnections(a)
    setPolicies(p)
    setClaims(cl)
    setDocuments(d)
    setIndividualClients(ic ?? [])
    setSocialPosts(sp ?? [])
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
    { key: 'individual_clients' as const, label: 'Clientes Individuais' },
    { key: 'policies' as const, label: 'Apólices e Docs' },
    { key: 'claims' as const, label: 'Sinistros' },
    { key: 'social' as const, label: '✦ Social Hub' },
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
                        <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-navy-100">
                      {individualClients.map((client) => {
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
                                <td colSpan={6} className="bg-navy-50/50 px-6 py-4 border-b border-navy-100">
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
                                      {clientPolicies.map((p) => (
                                        <div key={p.id} className="bg-white rounded border border-navy-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                                          <div>
                                            <p className="text-sm font-medium text-navy-700">
                                              {POLICY_TYPE_LABELS[p.type as keyof typeof POLICY_TYPE_LABELS] ?? p.type}
                                              {' — '}{p.insurer}
                                            </p>
                                            <p className="text-xs text-navy-500">
                                              Apólice {p.policyNumber} · {p.startDate} → {p.endDate}
                                            </p>
                                          </div>
                                          <div className="text-right">
                                            <p className="text-sm font-semibold text-navy-700">{formatCurrency(p.annualPremium)}/ano</p>
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                                              p.status === 'active' ? 'bg-green-100 text-green-700' :
                                              p.status === 'expiring' ? 'bg-yellow-100 text-yellow-700' :
                                              'bg-red-100 text-red-700'
                                            }`}>{p.status}</span>
                                          </div>
                                        </div>
                                      ))}
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
                    individualClients={individualClients}
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
                      .filter((p) => {
                        if (!selectedCompanyId) return true
                        if (selectedCompanyId.startsWith('ic:')) return p.individualClientId === selectedCompanyId.slice(3)
                        return p.companyId === selectedCompanyId
                      })
                      .map((p) => `${POLICY_TYPE_LABELS[p.type as keyof typeof POLICY_TYPE_LABELS] ?? p.type} · ${p.policyNumber} · ${formatCurrency(p.annualPremium)}`)}
                    emptyMessage="Sem apólices para o filtro selecionado."
                  />
                  <SimpleCollection
                    title={`Documentos ${selectedCompanyId ? 'do Cliente' : 'Globais'}`}
                    rows={documents
                      .filter((d) => {
                        if (!selectedCompanyId) return true
                        if (selectedCompanyId.startsWith('ic:')) return false
                        return d.companyId === selectedCompanyId
                      })
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
                <h2 className="text-lg font-semibold text-navy-700 mb-2">API & Ligações</h2>
                <p className="text-sm text-navy-500 mb-6">Serviços externos integrados na plataforma Adler Pro. Todas as chaves são configuradas como variáveis de ambiente no Netlify.</p>
                <div className="grid gap-4">

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

function NewPolicyForm({ companies, individualClients, onSubmit }: { companies: Company[]; individualClients: IndividualClient[]; onSubmit: (data: any) => Promise<void> }) {
  const [clientType, setClientType] = useState<'company' | 'individual'>('company')
  const [form, setForm] = useState({
    companyId: '', individualClientId: '', type: '', insurer: '', policyNumber: '', description: '', startDate: '', endDate: '', annualPremium: '', insuredValue: '',
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
        <div className="sm:col-span-2">
          <button type="submit" disabled={submitting} className="px-6 py-2.5 bg-gold-400 text-navy-700 font-semibold rounded-[2px] hover:bg-gold-300 disabled:opacity-50 text-sm">
            {submitting ? 'A criar...' : 'Criar Apólice'}
          </button>
        </div>
      </form>
    </div>
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
  const [carouselSvg, setCarouselSvg] = useState<string | null>(null)

  const toggleNetwork = (n: string) => {
    setNetworks((prev) => prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n])
  }

  const handleGenerate = async () => {
    if (!topic.trim()) { setGenError('Introduz um tópico primeiro.'); return }
    setGenError(''); setGenerating(true); setCarouselSvg(null)
    try {
      const res = await adminGenerateSocialContent({ data: { topic } })
      if (res.instagram) setContentInstagram(res.instagram)
      if (res.linkedin) setContentLinkedin(res.linkedin)
      if (res.facebook) setContentFacebook(res.facebook)
      if (res.carouselSvg) setCarouselSvg(res.carouselSvg)
    } catch (e: any) {
      setGenError(e?.message ?? 'Erro ao gerar conteúdo.')
    } finally {
      setGenerating(false)
    }
  }

  const handleDownloadPng = () => {
    if (!carouselSvg) return
    const canvas = document.createElement('canvas')
    canvas.width = 1080
    canvas.height = 1080
    const ctx = canvas.getContext('2d')!
    const img = new Image()
    const svgBlob = new Blob([carouselSvg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    img.onload = () => {
      ctx.drawImage(img, 0, 0, 1080, 1080)
      URL.revokeObjectURL(url)
      const a = document.createElement('a')
      a.download = `adler-instagram-${Date.now()}.png`
      a.href = canvas.toDataURL('image/png')
      a.click()
    }
    img.src = url
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

      {/* Carousel SVG preview */}
      {carouselSvg && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-navy-600">Carrossel Instagram (preview)</label>
            <button
              type="button"
              onClick={handleDownloadPng}
              className="px-3 py-1.5 bg-gold-400 text-navy-700 text-xs font-semibold rounded-[2px] hover:bg-gold-300"
            >
              ↓ Download PNG
            </button>
          </div>
          <div
            style={{ width: 270, height: 270, overflow: 'hidden', borderRadius: 4, border: '1px solid #e2e8f0' }}
            dangerouslySetInnerHTML={{ __html: carouselSvg.replace(
              /(<svg[^>]*)(width="[^"]*")?([^>]*)(height="[^"]*")?([^>]*>)/,
              (_m, a, _w, b, _h, c) => `${a}width="270" ${b}height="270" viewBox="0 0 1080 1080"${c}`
            )}}
          />
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
