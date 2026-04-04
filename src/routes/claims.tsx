import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useState, useEffect, useMemo } from 'react'
import { fetchClaims, fetchPolicies, submitClaim } from '@/lib/server-fns'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Claim, Policy } from '@/lib/types'
import { CLAIM_STATUS_LABELS, POLICY_TYPE_LABELS } from '@/lib/types'

export const Route = createFileRoute('/claims')({
  component: ClaimsPage,
})

const CLAIM_TYPES = [
  { value: 'Acidente de Trabalho', label: 'Acidente de Trabalho' },
  { value: 'Sinistro Patrimonial', label: 'Sinistro Patrimonial' },
  { value: 'Sinistro de Frota', label: 'Sinistro de Frota' },
  { value: 'Responsabilidade Civil', label: 'Responsabilidade Civil' },
  { value: 'Incêndio / Explosão', label: 'Incêndio / Explosão' },
  { value: 'Inundação / Tempestade', label: 'Inundação / Tempestade' },
  { value: 'Furto / Roubo', label: 'Furto / Roubo' },
  { value: 'Danos a Terceiros', label: 'Danos a Terceiros' },
  { value: 'Saúde / Doença', label: 'Saúde / Doença' },
  { value: 'Ciber-Risco', label: 'Ciber-Risco' },
  { value: 'Outro', label: 'Outro' },
]

const STATUS_COLORS: Record<string, string> = {
  submitted: 'bg-blue-50 text-blue-700 border-blue-200',
  under_review: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  documentation: 'bg-orange-50 text-orange-700 border-orange-200',
  assessment: 'bg-purple-50 text-purple-700 border-purple-200',
  approved: 'bg-green-50 text-green-700 border-green-200',
  denied: 'bg-red-50 text-red-700 border-red-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

const STATUS_STEPS = ['submitted', 'under_review', 'documentation', 'assessment', 'approved', 'paid']

function ClaimsPage() {
  const [claims, setClaims] = useState<Claim[]>([])
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null)

  // Filtros
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterType, setFilterType] = useState<string>('all')
  const [filterYear, setFilterYear] = useState<string>('all')
  const [filterMonth, setFilterMonth] = useState<string>('all')
  const [searchText, setSearchText] = useState('')

  const reload = async () => {
    const [c, p] = await Promise.all([fetchClaims(), fetchPolicies()])
    setClaims(c)
    setPolicies(p)
  }

  useEffect(() => {
    reload().then(() => setLoading(false)).catch(() => setLoading(false))
  }, [])

  // Derivar anos disponíveis
  const availableYears = useMemo(() => {
    const years = [...new Set(claims.map(c => new Date(c.incidentDate).getFullYear()))]
    return years.sort((a, b) => b - a)
  }, [claims])

  // Filtrar sinistros
  const filteredClaims = useMemo(() => {
    return claims.filter(c => {
      const date = new Date(c.incidentDate)
      const year = date.getFullYear().toString()
      const month = (date.getMonth() + 1).toString()
      const matchStatus = filterStatus === 'all' || c.status === filterStatus
      const matchType = filterType === 'all' || c.title.includes(filterType)
      const matchYear = filterYear === 'all' || year === filterYear
      const matchMonth = filterMonth === 'all' || month === filterMonth
      const matchSearch = !searchText || c.title.toLowerCase().includes(searchText.toLowerCase()) || c.description.toLowerCase().includes(searchText.toLowerCase())
      return matchStatus && matchType && matchYear && matchMonth && matchSearch
    })
  }, [claims, filterStatus, filterType, filterYear, filterMonth, searchText])

  // Estatísticas
  const stats = useMemo(() => {
    const total = filteredClaims.length
    const totalValue = filteredClaims.reduce((s, c) => s + (c.estimatedValue || 0), 0)
    const open = filteredClaims.filter(c => !['approved', 'denied', 'paid'].includes(c.status)).length
    const approved = filteredClaims.filter(c => c.status === 'approved' || c.status === 'paid').length
    const denied = filteredClaims.filter(c => c.status === 'denied').length
    return { total, totalValue, open, approved, denied }
  }, [filteredClaims])

  // Exportar CSV
  const exportCSV = () => {
    const headers = ['Referência', 'Tipo', 'Data Incidente', 'Data Participação', 'Valor Estimado (€)', 'Estado', 'Apólice']
    const rows = filteredClaims.map(c => {
      const policy = policies.find(p => p.id === c.policyId)
      return [
        c.id,
        c.title,
        c.incidentDate,
        c.claimDate,
        c.estimatedValue?.toString() || '0',
        CLAIM_STATUS_LABELS[c.status] || c.status,
        policy ? `${policy.policyNumber} — ${POLICY_TYPE_LABELS[policy.type] || policy.type}` : c.policyId,
      ]
    })
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sinistros_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        {/* Cabeçalho */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-navy-700">Gestão de Sinistros</h1>
            <p className="text-navy-500 mt-1">Registo e acompanhamento de processos de sinistro</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={exportCSV}
              className="px-4 py-2 border border-navy-200 text-navy-600 text-sm font-medium rounded-[2px] hover:bg-navy-50 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Exportar CSV
            </button>
            <button
              onClick={() => { setShowForm(true); setSelectedClaim(null) }}
              className="px-4 py-2 bg-gold-400 text-navy-700 font-semibold text-sm rounded-[2px] hover:bg-gold-300 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Novo Sinistro
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total de Processos', value: stats.total, color: 'text-navy-700' },
            { label: 'Em Aberto', value: stats.open, color: 'text-orange-600' },
            { label: 'Aprovados / Pagos', value: stats.approved, color: 'text-green-600' },
            { label: 'Valor Total Estimado', value: formatCurrency(stats.totalValue), color: 'text-navy-700' },
          ].map(kpi => (
            <div key={kpi.label} className="bg-white rounded-[4px] border border-navy-200 p-4">
              <p className="text-xs text-navy-500 mb-1">{kpi.label}</p>
              <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
            </div>
          ))}
        </div>

        {/* Filtros */}
        <div className="bg-white rounded-[4px] border border-navy-200 p-4 mb-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <input
              type="text"
              placeholder="Pesquisar..."
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              className="col-span-2 sm:col-span-1 px-3 py-2 text-sm border border-navy-200 rounded focus:outline-none focus:ring-1 focus:ring-gold-400"
            />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 text-sm border border-navy-200 rounded focus:outline-none focus:ring-1 focus:ring-gold-400">
              <option value="all">Todos os estados</option>
              {Object.entries(CLAIM_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="px-3 py-2 text-sm border border-navy-200 rounded focus:outline-none focus:ring-1 focus:ring-gold-400">
              <option value="all">Todos os tipos</option>
              {CLAIM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <select value={filterYear} onChange={e => setFilterYear(e.target.value)} className="px-3 py-2 text-sm border border-navy-200 rounded focus:outline-none focus:ring-1 focus:ring-gold-400">
              <option value="all">Todos os anos</option>
              {availableYears.map(y => <option key={y} value={y.toString()}>{y}</option>)}
            </select>
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="px-3 py-2 text-sm border border-navy-200 rounded focus:outline-none focus:ring-1 focus:ring-gold-400">
              <option value="all">Todos os meses</option>
              {['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'].map((m, i) => (
                <option key={i+1} value={(i+1).toString()}>{m}</option>
              ))}
            </select>
            <button onClick={() => { setFilterStatus('all'); setFilterType('all'); setFilterYear('all'); setFilterMonth('all'); setSearchText('') }} className="px-3 py-2 text-sm text-navy-500 border border-navy-200 rounded hover:bg-navy-50">
              Limpar
            </button>
          </div>
        </div>

        {/* Formulário de novo sinistro */}
        {showForm && (
          <NewClaimForm
            policies={policies}
            onClose={() => setShowForm(false)}
            onSubmit={async (data) => {
              await submitClaim({ data })
              await reload()
              setShowForm(false)
            }}
          />
        )}

        {/* Lista de sinistros */}
        {filteredClaims.length === 0 ? (
          <div className="bg-white rounded-[4px] border border-navy-200 p-12 text-center">
            <svg className="w-12 h-12 text-navy-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-navy-500 font-medium">Nenhum sinistro encontrado</p>
            <p className="text-navy-400 text-sm mt-1">Ajuste os filtros ou registe um novo processo</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredClaims.map(claim => {
              const policy = policies.find(p => p.id === claim.policyId)
              const isSelected = selectedClaim?.id === claim.id
              return (
                <div key={claim.id} className="bg-white rounded-[4px] border border-navy-200 overflow-hidden">
                  <button
                    onClick={() => setSelectedClaim(isSelected ? null : claim)}
                    className="w-full p-5 text-left hover:bg-navy-50/50 transition-colors"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-navy-700">{claim.title}</h3>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[claim.status] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                            {CLAIM_STATUS_LABELS[claim.status] || claim.status}
                          </span>
                        </div>
                        <p className="text-sm text-navy-500 mt-1 truncate">{claim.description}</p>
                        <div className="flex flex-wrap gap-3 mt-2 text-xs text-navy-400">
                          <span>Incidente: {formatDate(claim.incidentDate)}</span>
                          <span>Participado: {formatDate(claim.claimDate)}</span>
                          {policy && <span>Apólice: {policy.policyNumber} ({POLICY_TYPE_LABELS[policy.type] || policy.type})</span>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold text-navy-700">{formatCurrency(claim.estimatedValue)}</p>
                        <p className="text-xs text-navy-400 mt-1">Ref: {claim.id.slice(-8).toUpperCase()}</p>
                      </div>
                    </div>
                  </button>

                  {/* Detalhe expandido */}
                  {isSelected && (
                    <div className="border-t border-navy-100 bg-navy-50/30 p-5">
                      {/* Timeline de estados */}
                      <h4 className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-3">Progresso do Processo</h4>
                      <div className="flex items-center gap-0 mb-6 overflow-x-auto pb-2">
                        {STATUS_STEPS.map((step, idx) => {
                          const stepOrder = STATUS_STEPS.indexOf(claim.status)
                          const isActive = idx <= stepOrder && claim.status !== 'denied'
                          const isCurrent = step === claim.status
                          const isDenied = claim.status === 'denied'
                          return (
                            <div key={step} className="flex items-center flex-shrink-0">
                              <div className={`flex flex-col items-center`}>
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                                  isDenied && isCurrent ? 'bg-red-500 border-red-500 text-white' :
                                  isCurrent ? 'bg-gold-400 border-gold-400 text-navy-700' :
                                  isActive ? 'bg-navy-700 border-navy-700 text-white' :
                                  'bg-white border-navy-200 text-navy-300'
                                }`}>
                                  {isActive && !isCurrent ? '✓' : idx + 1}
                                </div>
                                <span className={`text-xs mt-1 whitespace-nowrap ${isCurrent ? 'text-navy-700 font-semibold' : 'text-navy-400'}`}>
                                  {CLAIM_STATUS_LABELS[step as keyof typeof CLAIM_STATUS_LABELS]}
                                </span>
                              </div>
                              {idx < STATUS_STEPS.length - 1 && (
                                <div className={`h-0.5 w-8 mx-1 flex-shrink-0 ${idx < STATUS_STEPS.indexOf(claim.status) && claim.status !== 'denied' ? 'bg-navy-700' : 'bg-navy-200'}`} />
                              )}
                            </div>
                          )
                        })}
                        {claim.status === 'denied' && (
                          <div className="ml-4 flex-shrink-0">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
                              ✗ Recusado
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Histórico de passos */}
                      {claim.steps && claim.steps.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-3">Histórico</h4>
                          <div className="space-y-2">
                            {[...claim.steps].reverse().map((step, idx) => (
                              <div key={idx} className="flex items-start gap-3 text-sm">
                                <div className="w-2 h-2 rounded-full bg-gold-400 mt-1.5 flex-shrink-0" />
                                <div>
                                  <span className="font-medium text-navy-700">{CLAIM_STATUS_LABELS[step.status] || step.status}</span>
                                  <span className="text-navy-400 ml-2">{formatDate(step.date)}</span>
                                  {step.notes && <p className="text-navy-500 mt-0.5">{step.notes}</p>}
                                </div>
                              </div>
                            ))}
                          </div>
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
    </AppLayout>
  )
}

function NewClaimForm({
  policies,
  onClose,
  onSubmit,
}: {
  policies: Policy[]
  onClose: () => void
  onSubmit: (data: { policyId: string; companyId: string; title: string; description: string; incidentDate: string; estimatedValue: number }) => Promise<void>
}) {
  const [form, setForm] = useState({
    claimType: '',
    customTitle: '',
    policyId: '',
    description: '',
    incidentDate: new Date().toISOString().split('T')[0],
    estimatedValue: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const selectedPolicy = policies.find(p => p.id === form.policyId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.policyId) { setError('Seleccione uma apólice associada ao sinistro.'); return }
    if (!form.claimType) { setError('Seleccione o tipo de sinistro.'); return }
    if (!form.description.trim()) { setError('Descreva o sinistro.'); return }
    const title = form.claimType === 'Outro' ? (form.customTitle || 'Outro Sinistro') : form.claimType
    setSubmitting(true)
    try {
      await onSubmit({
        policyId: form.policyId,
        companyId: selectedPolicy?.companyId || '',
        title,
        description: form.description,
        incidentDate: form.incidentDate,
        estimatedValue: parseFloat(form.estimatedValue) || 0,
      })
    } catch (err) {
      setError('Erro ao registar o sinistro. Tente novamente.')
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-[4px] border border-gold-400 shadow-lg p-6 mb-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-navy-700">Registar Novo Sinistro</h2>
          <p className="text-sm text-navy-500 mt-0.5">Preencha os dados do processo de sinistro</p>
        </div>
        <button onClick={onClose} className="text-navy-400 hover:text-navy-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-5">
          {/* Tipo de sinistro */}
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1">Tipo de Sinistro *</label>
            <select
              value={form.claimType}
              onChange={e => setForm(f => ({ ...f, claimType: e.target.value }))}
              className="w-full px-3 py-2 border border-navy-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gold-400"
              required
            >
              <option value="">Seleccionar tipo...</option>
              {CLAIM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* Título personalizado se "Outro" */}
          {form.claimType === 'Outro' && (
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">Descrição do Tipo *</label>
              <input
                type="text"
                value={form.customTitle}
                onChange={e => setForm(f => ({ ...f, customTitle: e.target.value }))}
                placeholder="Ex: Danos por vandalismo"
                className="w-full px-3 py-2 border border-navy-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gold-400"
              />
            </div>
          )}

          {/* Apólice */}
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1">Apólice Associada *</label>
            <select
              value={form.policyId}
              onChange={e => setForm(f => ({ ...f, policyId: e.target.value }))}
              className="w-full px-3 py-2 border border-navy-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gold-400"
              required
            >
              <option value="">Seleccionar apólice...</option>
              {policies.filter(p => p.status === 'active' || p.status === 'expiring').map(p => (
                <option key={p.id} value={p.id}>
                  {p.policyNumber} — {POLICY_TYPE_LABELS[p.type] || p.type} ({p.insurer})
                </option>
              ))}
            </select>
          </div>

          {/* Data do incidente */}
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1">Data do Incidente *</label>
            <input
              type="date"
              value={form.incidentDate}
              onChange={e => setForm(f => ({ ...f, incidentDate: e.target.value }))}
              max={new Date().toISOString().split('T')[0]}
              className="w-full px-3 py-2 border border-navy-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gold-400"
              required
            />
          </div>

          {/* Valor estimado */}
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1">Valor Estimado do Dano (€)</label>
            <input
              type="number"
              value={form.estimatedValue}
              onChange={e => setForm(f => ({ ...f, estimatedValue: e.target.value }))}
              placeholder="0.00"
              min="0"
              step="0.01"
              className="w-full px-3 py-2 border border-navy-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gold-400"
            />
          </div>
        </div>

        {/* Descrição */}
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1">Descrição do Sinistro *</label>
          <textarea
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Descreva o que aconteceu, quando, onde e as circunstâncias do sinistro..."
            rows={4}
            className="w-full px-3 py-2 border border-navy-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 resize-none"
            required
          />
        </div>

        {/* Informação sobre próximos passos */}
        <div className="bg-navy-50 rounded p-4 text-sm text-navy-600">
          <p className="font-medium mb-1">Após submeter o sinistro:</p>
          <ol className="list-decimal list-inside space-y-1 text-navy-500">
            <li>O processo será registado com estado <strong>Submetido</strong></li>
            <li>A equipa Adler & Rochefort irá contactá-lo para recolha de documentação</li>
            <li>Pode acompanhar o progresso neste módulo em tempo real</li>
          </ol>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-navy-200 text-navy-600 rounded hover:bg-navy-50">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2 bg-gold-400 text-navy-700 font-semibold text-sm rounded-[2px] hover:bg-gold-300 disabled:opacity-50 flex items-center gap-2"
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-navy-700 border-t-transparent rounded-full animate-spin" />
                A registar...
              </>
            ) : 'Registar Sinistro'}
          </button>
        </div>
      </form>
    </div>
  )
}
