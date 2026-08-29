import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { Company, IndividualClient, SalesOpportunity, SalesOpportunityStage } from '@/lib/types'
import {
  SALES_OPPORTUNITY_STAGES,
  SALES_OPPORTUNITY_STAGE_LABELS_PT,
  SALES_OPPORTUNITY_SOURCES,
  SALES_OPPORTUNITY_SOURCE_LABELS_PT,
  SALES_OPPORTUNITY_PRODUCT_OPTIONS,
} from '@/lib/sales-opportunity-rules'
import {
  fetchSalesOpportunities,
  adminCreateSalesOpportunity,
  adminUpdateSalesOpportunity,
  adminUpdateSalesOpportunityStage,
  adminDeleteSalesOpportunity,
  adminCreateOpportunityFollowUpTask,
  fetchWebsiteLeadContextForOpportunity,
} from '@/lib/server-fns'
import { formatCurrency, formatDate } from '@/lib/utils'

// -----------------------------------------------------------------------------
// SalesPipeline — pipeline comercial (CRM 2, fase 1). BACKOFFICE ONLY: nunca
// importado por nenhuma rota /one/* nem por qualquer portal de cliente.
//
// Dados completamente separados do Kanban de renovações (RENEWAL_KANBAN_*
// em admin.tsx) — aqui são oportunidades novas, lá são apólices existentes a
// renovar. Só o layout/interação de drag&drop foi inspirado nesse Kanban;
// nenhum estado ou dado é partilhado entre os dois.
// -----------------------------------------------------------------------------

const STAGE_PALETTE: Record<SalesOpportunityStage, { border: string; badge: string }> = {
  new: { border: 'border-navy-200', badge: 'bg-navy-100 text-navy-700' },
  contacted: { border: 'border-blue-300', badge: 'bg-blue-100 text-blue-700' },
  needs_analysis: { border: 'border-amber-300', badge: 'bg-amber-100 text-amber-700' },
  quoted: { border: 'border-gold-300', badge: 'bg-gold-100 text-gold-700' },
  negotiation: { border: 'border-orange-300', badge: 'bg-orange-100 text-orange-700' },
  won: { border: 'border-emerald-300', badge: 'bg-emerald-100 text-emerald-700' },
  lost: { border: 'border-red-300', badge: 'bg-red-100 text-red-700' },
}

function ageInDays(createdAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)))
}

interface OwnerLookup {
  name: string
  email?: string
  kind: 'individual' | 'company'
}

function buildOwnerLookup(
  opportunity: SalesOpportunity,
  individualClients: IndividualClient[],
  companies: Company[],
): OwnerLookup {
  if (opportunity.individualClientId) {
    const client = individualClients.find((c) => c.id === opportunity.individualClientId)
    return { name: client?.fullName ?? 'Cliente removido', email: client?.email, kind: 'individual' }
  }
  const company = companies.find((c) => c.id === opportunity.companyId)
  return { name: company?.name ?? 'Empresa removida', email: company?.contactEmail, kind: 'company' }
}

interface Props {
  individualClients: IndividualClient[]
  companies: Company[]
}

type ViewMode = 'kanban' | 'list'
type StatusFilter = 'all' | 'open' | 'won' | 'lost'

export function SalesPipeline({ individualClients, companies }: Props) {
  const [opportunities, setOpportunities] = useState<SalesOpportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('kanban')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [activeDropStage, setActiveDropStage] = useState<SalesOpportunityStage | null>(null)

  const [filters, setFilters] = useState<{
    stage: SalesOpportunityStage | 'all'
    market: string
    product: string
    source: string
    assignedTo: string
    status: StatusFilter
    search: string
  }>({ stage: 'all', market: '', product: '', source: '', assignedTo: '', status: 'all', search: '' })

  const reload = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchSalesOpportunities({ data: {} })
      setOpportunities(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar oportunidades')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const ownerByOpportunityId = useMemo(() => {
    const map = new Map<string, OwnerLookup>()
    for (const opp of opportunities) map.set(opp.id, buildOwnerLookup(opp, individualClients, companies))
    return map
  }, [opportunities, individualClients, companies])

  const filtered = useMemo(() => {
    return opportunities.filter((opp) => {
      if (filters.stage !== 'all' && opp.stage !== filters.stage) return false
      if (filters.market && opp.market !== filters.market) return false
      if (filters.product && opp.product !== filters.product) return false
      if (filters.source && opp.source !== filters.source) return false
      if (filters.assignedTo && opp.assignedTo !== filters.assignedTo) return false
      if (filters.status === 'open' && (opp.stage === 'won' || opp.stage === 'lost')) return false
      if (filters.status === 'won' && opp.stage !== 'won') return false
      if (filters.status === 'lost' && opp.stage !== 'lost') return false
      if (filters.search.trim()) {
        const q = filters.search.trim().toLowerCase()
        const owner = ownerByOpportunityId.get(opp.id)
        const haystack = [owner?.name, owner?.email, opp.product, opp.title].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [opportunities, filters, ownerByOpportunityId])

  const byStage = useMemo(() => {
    const grouped: Record<SalesOpportunityStage, SalesOpportunity[]> = {
      new: [], contacted: [], needs_analysis: [], quoted: [], negotiation: [], won: [], lost: [],
    }
    for (const opp of filtered) grouped[opp.stage].push(opp)
    return grouped
  }, [filtered])

  const knownMarkets = useMemo(
    () => [...new Set(opportunities.map((o) => o.market).filter((m): m is string => !!m))].sort(),
    [opportunities],
  )
  const knownAssignees = useMemo(
    () => [...new Set(opportunities.map((o) => o.assignedTo).filter((a): a is string => !!a))].sort(),
    [opportunities],
  )

  const handleStageChange = async (id: string, stage: SalesOpportunityStage) => {
    const previous = opportunities
    setOpportunities((prev) => prev.map((o) => (o.id === id ? { ...o, stage } : o)))
    try {
      await adminUpdateSalesOpportunityStage({ data: { id, stage } })
      await reload()
    } catch (err) {
      setOpportunities(previous)
      setError(err instanceof Error ? err.message : 'Erro ao mudar de stage')
    }
  }

  const selected = selectedId ? opportunities.find((o) => o.id === selectedId) : undefined

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          <button
            onClick={() => setView('kanban')}
            className={`px-3 py-1.5 text-sm rounded-[4px] border ${view === 'kanban' ? 'bg-navy-700 text-white border-navy-700' : 'border-navy-200 text-navy-700 bg-white hover:bg-navy-50'}`}
          >
            Kanban
          </button>
          <button
            onClick={() => setView('list')}
            className={`px-3 py-1.5 text-sm rounded-[4px] border ${view === 'list' ? 'bg-navy-700 text-white border-navy-700' : 'border-navy-200 text-navy-700 bg-white hover:bg-navy-50'}`}
          >
            Lista
          </button>
        </div>
        <button
          onClick={() => setShowNewForm((v) => !v)}
          className="px-4 py-2 bg-gold-400 text-navy-700 font-semibold rounded-[2px] hover:bg-gold-300 transition-colors text-sm"
        >
          {showNewForm ? 'Cancelar' : 'Nova Oportunidade'}
        </button>
      </div>

      {showNewForm && (
        <NewOpportunityForm
          individualClients={individualClients}
          companies={companies}
          onCreated={async () => {
            setShowNewForm(false)
            await reload()
          }}
          onCancel={() => setShowNewForm(false)}
        />
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex flex-wrap gap-2 bg-navy-50 border border-navy-200 rounded-[4px] p-2">
        <select
          value={filters.stage}
          onChange={(e) => setFilters((f) => ({ ...f, stage: e.target.value as SalesOpportunityStage | 'all' }))}
          className="text-xs px-2 py-1 border border-navy-200 rounded-[2px] bg-white"
        >
          <option value="all">Todos os stages</option>
          {SALES_OPPORTUNITY_STAGES.map((s) => (
            <option key={s} value={s}>{SALES_OPPORTUNITY_STAGE_LABELS_PT[s]}</option>
          ))}
        </select>
        <select
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as StatusFilter }))}
          className="text-xs px-2 py-1 border border-navy-200 rounded-[2px] bg-white"
        >
          <option value="all">Abertas + fechadas</option>
          <option value="open">Só abertas</option>
          <option value="won">Só ganhas</option>
          <option value="lost">Só perdidas</option>
        </select>
        <select
          value={filters.market}
          onChange={(e) => setFilters((f) => ({ ...f, market: e.target.value }))}
          className="text-xs px-2 py-1 border border-navy-200 rounded-[2px] bg-white"
        >
          <option value="">Todos os mercados</option>
          {knownMarkets.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select
          value={filters.product}
          onChange={(e) => setFilters((f) => ({ ...f, product: e.target.value }))}
          className="text-xs px-2 py-1 border border-navy-200 rounded-[2px] bg-white"
        >
          <option value="">Todos os produtos</option>
          {SALES_OPPORTUNITY_PRODUCT_OPTIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <select
          value={filters.source}
          onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
          className="text-xs px-2 py-1 border border-navy-200 rounded-[2px] bg-white"
        >
          <option value="">Todas as origens</option>
          {SALES_OPPORTUNITY_SOURCES.map((s) => <option key={s} value={s}>{SALES_OPPORTUNITY_SOURCE_LABELS_PT[s]}</option>)}
        </select>
        {knownAssignees.length > 0 && (
          <select
            value={filters.assignedTo}
            onChange={(e) => setFilters((f) => ({ ...f, assignedTo: e.target.value }))}
            className="text-xs px-2 py-1 border border-navy-200 rounded-[2px] bg-white"
          >
            <option value="">Todos os responsáveis</option>
            {knownAssignees.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        <input
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          placeholder="Pesquisar cliente, email, empresa, produto…"
          className="text-xs px-2 py-1 border border-navy-200 rounded-[2px] bg-white flex-1 min-w-[200px]"
        />
      </div>

      {loading ? (
        <p className="text-sm text-navy-400">A carregar…</p>
      ) : view === 'kanban' ? (
        <div className="grid xl:grid-cols-4 2xl:grid-cols-7 gap-3">
          {SALES_OPPORTUNITY_STAGES.map((stage) => {
            const items = byStage[stage]
            const palette = STAGE_PALETTE[stage]
            return (
              <section
                key={stage}
                className={`rounded-[4px] border p-3 bg-navy-50/60 transition-colors ${activeDropStage === stage ? 'border-gold-400 bg-gold-50/60' : 'border-navy-200'}`}
                onDragOver={(e) => {
                  if (!draggingId) return
                  e.preventDefault()
                  setActiveDropStage(stage)
                }}
                onDragLeave={() => setActiveDropStage((c) => (c === stage ? null : c))}
                onDrop={async (e) => {
                  e.preventDefault()
                  const droppedId = e.dataTransfer.getData('text/plain')
                  setActiveDropStage(null)
                  setDraggingId(null)
                  if (!droppedId) return
                  await handleStageChange(droppedId, stage)
                }}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-navy-700">
                    {SALES_OPPORTUNITY_STAGE_LABELS_PT[stage]}
                  </h4>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-navy-200 text-navy-700 font-semibold">
                    {items.length}
                  </span>
                </div>
                {items.length === 0 ? (
                  <p className="text-[11px] text-navy-400 rounded border border-dashed border-navy-200 bg-white px-2 py-2">
                    Sem oportunidades.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {items.map((opp) => {
                      const owner = ownerByOpportunityId.get(opp.id)
                      return (
                        <article
                          key={opp.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', opp.id)
                            e.dataTransfer.effectAllowed = 'move'
                            setDraggingId(opp.id)
                          }}
                          onDragEnd={() => { setDraggingId(null); setActiveDropStage(null) }}
                          onClick={() => setSelectedId(opp.id)}
                          className={`text-xs text-navy-700 rounded border bg-white p-2 cursor-pointer hover:shadow-sm ${palette.border}`}
                        >
                          <p className="font-semibold truncate">{owner?.name ?? '—'}</p>
                          <p className="text-navy-600 mt-0.5 truncate">{opp.product ?? '—'} {opp.market ? `· ${opp.market}` : ''}</p>
                          {(opp.estimatedAnnualPremium || opp.estimatedRevenue) && (
                            <p className="text-navy-600 mt-0.5">
                              {formatCurrency(opp.estimatedAnnualPremium ?? opp.estimatedRevenue ?? 0)}
                            </p>
                          )}
                          <div className="flex items-center justify-between mt-1 text-[11px] text-navy-500">
                            <span>{ageInDays(opp.createdAt)}d</span>
                            {opp.assignedTo && <span className="truncate max-w-[80px]">{opp.assignedTo}</span>}
                          </div>
                          {opp.nextFollowUpAt && (
                            <p className="text-[11px] text-gold-700 mt-0.5">Follow-up: {formatDate(opp.nextFollowUpAt)}</p>
                          )}
                        </article>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      ) : (
        <div className="bg-white rounded-[4px] border border-navy-200 overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="bg-navy-50 border-b border-navy-200">
                <th className="text-left px-3 py-2 text-xs font-semibold text-navy-500 uppercase">Cliente/Empresa</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-navy-500 uppercase">Produto</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-navy-500 uppercase">Mercado</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-navy-500 uppercase">Stage</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-navy-500 uppercase">Origem</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-navy-500 uppercase">Valor est.</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-navy-500 uppercase">Follow-up</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-navy-500 uppercase">Responsável</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {filtered.map((opp) => {
                const owner = ownerByOpportunityId.get(opp.id)
                return (
                  <tr key={opp.id} className="hover:bg-navy-50/50 cursor-pointer" onClick={() => setSelectedId(opp.id)}>
                    <td className="px-3 py-2 text-sm text-navy-700">{owner?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-sm text-navy-600">{opp.product ?? '—'}</td>
                    <td className="px-3 py-2 text-sm text-navy-600">{opp.market ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${STAGE_PALETTE[opp.stage].badge}`}>
                        {SALES_OPPORTUNITY_STAGE_LABELS_PT[opp.stage]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-sm text-navy-600">{opp.source ?? '—'}</td>
                    <td className="px-3 py-2 text-sm text-navy-600">
                      {opp.estimatedAnnualPremium || opp.estimatedRevenue
                        ? formatCurrency(opp.estimatedAnnualPremium ?? opp.estimatedRevenue ?? 0)
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-sm text-navy-600">{opp.nextFollowUpAt ? formatDate(opp.nextFollowUpAt) : '—'}</td>
                    <td className="px-3 py-2 text-sm text-navy-600">{opp.assignedTo ?? '—'}</td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-navy-400">Sem oportunidades para os filtros escolhidos.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <OpportunityDetail
          opportunity={selected}
          owner={ownerByOpportunityId.get(selected.id)}
          onClose={() => setSelectedId(null)}
          onChanged={reload}
        />
      )}
    </div>
  )
}

function NewOpportunityForm({
  individualClients,
  companies,
  onCreated,
  onCancel,
}: {
  individualClients: IndividualClient[]
  companies: Company[]
  onCreated: () => void
  onCancel: () => void
}) {
  const [ownerType, setOwnerType] = useState<'individual' | 'company'>('individual')
  const [ownerId, setOwnerId] = useState('')
  const [product, setProduct] = useState('')
  const [market, setMarket] = useState('PT')
  const [source, setSource] = useState('manual')
  const [estimatedAnnualPremium, setEstimatedAnnualPremium] = useState('')
  const [estimatedRevenue, setEstimatedRevenue] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [expectedCloseDate, setExpectedCloseDate] = useState('')
  const [nextFollowUpAt, setNextFollowUpAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = ownerId && product && !saving

  return (
    <div className="bg-white rounded-[4px] border border-navy-200 p-4 space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-navy-600">Tipo de cliente</label>
          <select
            value={ownerType}
            onChange={(e) => { setOwnerType(e.target.value as 'individual' | 'company'); setOwnerId('') }}
            className="w-full mt-1 px-2 py-1.5 text-sm border border-navy-200 rounded-[2px]"
          >
            <option value="individual">Cliente Individual</option>
            <option value="company">Empresa</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-navy-600">{ownerType === 'individual' ? 'Cliente' : 'Empresa'}</label>
          <select
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            className="w-full mt-1 px-2 py-1.5 text-sm border border-navy-200 rounded-[2px]"
          >
            <option value="">Selecionar…</option>
            {ownerType === 'individual'
              ? individualClients.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)
              : companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-navy-600">Produto</label>
          <select value={product} onChange={(e) => setProduct(e.target.value)} className="w-full mt-1 px-2 py-1.5 text-sm border border-navy-200 rounded-[2px]">
            <option value="">Selecionar…</option>
            {SALES_OPPORTUNITY_PRODUCT_OPTIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-navy-600">Mercado</label>
          <select value={market} onChange={(e) => setMarket(e.target.value)} className="w-full mt-1 px-2 py-1.5 text-sm border border-navy-200 rounded-[2px]">
            <option value="PT">PT</option>
            <option value="ES">ES</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-navy-600">Origem</label>
          <select value={source} onChange={(e) => setSource(e.target.value)} className="w-full mt-1 px-2 py-1.5 text-sm border border-navy-200 rounded-[2px]">
            {SALES_OPPORTUNITY_SOURCES.map((s) => <option key={s} value={s}>{SALES_OPPORTUNITY_SOURCE_LABELS_PT[s]}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-navy-600">Responsável (email)</label>
          <input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="comercial@adlerrochefort.com" className="w-full mt-1 px-2 py-1.5 text-sm border border-navy-200 rounded-[2px]" />
        </div>
        <div>
          <label className="text-xs text-navy-600">Prémio anual estimado (€)</label>
          <input type="number" value={estimatedAnnualPremium} onChange={(e) => setEstimatedAnnualPremium(e.target.value)} className="w-full mt-1 px-2 py-1.5 text-sm border border-navy-200 rounded-[2px]" />
        </div>
        <div>
          <label className="text-xs text-navy-600">Receita estimada (€)</label>
          <input type="number" value={estimatedRevenue} onChange={(e) => setEstimatedRevenue(e.target.value)} className="w-full mt-1 px-2 py-1.5 text-sm border border-navy-200 rounded-[2px]" />
        </div>
        <div>
          <label className="text-xs text-navy-600">Fecho esperado</label>
          <input type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} className="w-full mt-1 px-2 py-1.5 text-sm border border-navy-200 rounded-[2px]" />
        </div>
        <div>
          <label className="text-xs text-navy-600">Próximo follow-up</label>
          <input type="date" value={nextFollowUpAt} onChange={(e) => setNextFollowUpAt(e.target.value)} className="w-full mt-1 px-2 py-1.5 text-sm border border-navy-200 rounded-[2px]" />
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm border border-navy-200 rounded-[2px] text-navy-700 hover:bg-navy-50">Cancelar</button>
        <button
          disabled={!canSave}
          onClick={async () => {
            setSaving(true)
            setError(null)
            const clientName =
              ownerType === 'individual'
                ? individualClients.find((c) => c.id === ownerId)?.fullName ?? 'Cliente'
                : companies.find((c) => c.id === ownerId)?.name ?? 'Cliente'
            try {
              await adminCreateSalesOpportunity({
                data: {
                  companyId: ownerType === 'company' ? ownerId : undefined,
                  individualClientId: ownerType === 'individual' ? ownerId : undefined,
                  clientName,
                  product,
                  market,
                  source,
                  assignedTo: assignedTo || undefined,
                  estimatedAnnualPremium: estimatedAnnualPremium ? Number(estimatedAnnualPremium) : undefined,
                  estimatedRevenue: estimatedRevenue ? Number(estimatedRevenue) : undefined,
                  expectedCloseDate: expectedCloseDate || undefined,
                  nextFollowUpAt: nextFollowUpAt || undefined,
                },
              })
              onCreated()
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Erro ao criar oportunidade')
            } finally {
              setSaving(false)
            }
          }}
          className="px-4 py-1.5 text-sm bg-gold-400 text-navy-700 font-semibold rounded-[2px] hover:bg-gold-300 disabled:opacity-50"
        >
          {saving ? 'A criar…' : 'Criar Oportunidade'}
        </button>
      </div>
    </div>
  )
}

function OpportunityDetail({
  opportunity,
  owner,
  onClose,
  onChanged,
}: {
  opportunity: SalesOpportunity
  owner?: OwnerLookup
  onClose: () => void
  onChanged: () => void
}) {
  const [lostReason, setLostReason] = useState(opportunity.lostReason ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [followUpDate, setFollowUpDate] = useState('')
  const [followUpMsg, setFollowUpMsg] = useState<string | null>(null)
  const [websiteLeadContext, setWebsiteLeadContext] = useState<Awaited<ReturnType<typeof fetchWebsiteLeadContextForOpportunity>> | null>(null)

  // Contexto do website_lead associado — reutiliza website_leads (nunca
  // duplicado em sales_opportunities); nunca mostra `metadata` nem qualquer
  // campo fora do allowlist (ver pickWebsiteLeadContextFields).
  useEffect(() => {
    if (!opportunity.websiteLeadId || !opportunity.individualClientId) {
      setWebsiteLeadContext(null)
      return
    }
    let active = true
    fetchWebsiteLeadContextForOpportunity({
      data: { individualClientId: opportunity.individualClientId, websiteLeadId: opportunity.websiteLeadId },
    })
      .then((result) => { if (active) setWebsiteLeadContext(result ?? null) })
      .catch(() => { if (active) setWebsiteLeadContext(null) })
    return () => { active = false }
  }, [opportunity.websiteLeadId, opportunity.individualClientId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-[4px] border border-navy-200 max-w-lg w-full max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-navy-700">{opportunity.title}</h3>
            <p className="text-xs text-navy-500 mt-0.5">
              {owner?.name} {owner?.email ? `· ${owner.email}` : ''}
              {owner && (
                <>
                  {' · '}
                  <Link
                    to="/admin"
                    search={{ tab: owner.kind === 'individual' ? 'individual_clients' : 'companies' }}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    Ver cliente →
                  </Link>
                </>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-navy-700">✕</button>
        </div>

        {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

        <dl className="text-xs text-navy-600 space-y-1.5 mb-3">
          <div className="flex justify-between"><dt>Produto</dt><dd>{opportunity.product ?? '—'}</dd></div>
          <div className="flex justify-between"><dt>Mercado</dt><dd>{opportunity.market ?? '—'}</dd></div>
          <div className="flex justify-between"><dt>Origem</dt><dd>{opportunity.source ?? '—'}{opportunity.sourceDetail ? ` (${opportunity.sourceDetail})` : ''}</dd></div>
          <div className="flex justify-between"><dt>Prémio anual estimado</dt><dd>{opportunity.estimatedAnnualPremium ? formatCurrency(opportunity.estimatedAnnualPremium) : '—'}</dd></div>
          <div className="flex justify-between"><dt>Receita estimada</dt><dd>{opportunity.estimatedRevenue ? formatCurrency(opportunity.estimatedRevenue) : '—'}</dd></div>
          <div className="flex justify-between"><dt>Moeda</dt><dd>{opportunity.currency}</dd></div>
          <div className="flex justify-between"><dt>Responsável</dt><dd>{opportunity.assignedTo ?? '—'}</dd></div>
          <div className="flex justify-between"><dt>Fecho esperado</dt><dd>{opportunity.expectedCloseDate ? formatDate(opportunity.expectedCloseDate) : '—'}</dd></div>
          <div className="flex justify-between"><dt>Próximo follow-up</dt><dd>{opportunity.nextFollowUpAt ? formatDate(opportunity.nextFollowUpAt) : '—'}</dd></div>
          <div className="flex justify-between"><dt>Criada em</dt><dd>{formatDate(opportunity.createdAt)}</dd></div>
          {opportunity.closedAt && <div className="flex justify-between"><dt>Fechada em</dt><dd>{formatDate(opportunity.closedAt)}</dd></div>}
        </dl>

        {opportunity.websiteLeadId && (
          <div className="border-t border-navy-100 pt-3 mb-3">
            <p className="text-xs font-semibold text-navy-700 mb-1.5">Pedido do website</p>
            {websiteLeadContext ? (
              <dl className="text-xs text-navy-600 space-y-1">
                <div className="flex justify-between"><dt>Formulário</dt><dd>{websiteLeadContext.formName}</dd></div>
                {websiteLeadContext.sourceUrl && (
                  <div className="flex justify-between gap-2">
                    <dt>Página de origem</dt>
                    <dd className="truncate max-w-[220px]" title={websiteLeadContext.sourceUrl}>
                      <a href={websiteLeadContext.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800">
                        {websiteLeadContext.sourceUrl}
                      </a>
                    </dd>
                  </div>
                )}
                {(websiteLeadContext.utmSource || websiteLeadContext.utmMedium || websiteLeadContext.utmCampaign) && (
                  <div className="flex justify-between">
                    <dt>UTM</dt>
                    <dd>{[websiteLeadContext.utmSource, websiteLeadContext.utmMedium, websiteLeadContext.utmCampaign].filter(Boolean).join(' / ')}</dd>
                  </div>
                )}
                <div className="flex justify-between"><dt>Recebido em</dt><dd>{formatDate(websiteLeadContext.receivedAt)}</dd></div>
              </dl>
            ) : (
              <p className="text-xs text-navy-400">A carregar…</p>
            )}
          </div>
        )}

        <div className="border-t border-navy-100 pt-3 space-y-2">
          <label className="text-xs text-navy-600">Mudar stage</label>
          <div className="flex flex-wrap gap-1.5">
            {SALES_OPPORTUNITY_STAGES.map((stage) => (
              <button
                key={stage}
                disabled={saving || stage === opportunity.stage}
                onClick={async () => {
                  setSaving(true)
                  setError(null)
                  try {
                    await adminUpdateSalesOpportunityStage({
                      data: { id: opportunity.id, stage, lostReason: stage === 'lost' ? lostReason || null : undefined },
                    })
                    onChanged()
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Erro ao mudar stage')
                  } finally {
                    setSaving(false)
                  }
                }}
                className={`px-2 py-1 text-[11px] rounded border disabled:opacity-40 ${STAGE_PALETTE[stage].badge} border-transparent`}
              >
                {SALES_OPPORTUNITY_STAGE_LABELS_PT[stage]}
              </button>
            ))}
          </div>
          {opportunity.stage === 'lost' && (
            <div>
              <label className="text-xs text-navy-600">Motivo de perda</label>
              <div className="flex gap-1.5 mt-1">
                <input
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                  className="flex-1 px-2 py-1 text-xs border border-navy-200 rounded-[2px]"
                />
                <button
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true)
                    try {
                      await adminUpdateSalesOpportunity({ data: { id: opportunity.id, updates: { lostReason } } })
                      onChanged()
                    } finally {
                      setSaving(false)
                    }
                  }}
                  className="px-2 py-1 text-[11px] rounded border border-navy-200 bg-white hover:bg-navy-50"
                >
                  Guardar
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-navy-100 pt-3 mt-3 space-y-2">
          <label className="text-xs text-navy-600">Criar tarefa de follow-up</label>
          <div className="flex gap-1.5">
            <input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className="px-2 py-1 text-xs border border-navy-200 rounded-[2px]" />
            <button
              disabled={!followUpDate || saving}
              onClick={async () => {
                setSaving(true)
                setFollowUpMsg(null)
                try {
                  // adminCreateOpportunityFollowUpTask já mantém
                  // opportunity.nextFollowUpAt e a client_task pendente em
                  // sincronia num único ponto no servidor — ver
                  // ensureFollowUpTaskForOpportunity em data.ts.
                  const result = await adminCreateOpportunityFollowUpTask({
                    data: {
                      opportunityId: opportunity.id,
                      title: `Follow-up — ${opportunity.title}`,
                      dueDate: followUpDate,
                    },
                  })
                  setFollowUpMsg(
                    result.created ? 'Tarefa criada.' : 'Tarefa de follow-up existente atualizada para a nova data.',
                  )
                  onChanged()
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Erro ao criar tarefa')
                } finally {
                  setSaving(false)
                }
              }}
              className="px-2 py-1 text-[11px] rounded border border-navy-200 bg-white hover:bg-navy-50 disabled:opacity-40"
            >
              Criar/ligar tarefa
            </button>
          </div>
          {followUpMsg && <p className="text-[11px] text-navy-500">{followUpMsg}</p>}
        </div>

        <div className="border-t border-navy-100 pt-3 mt-3 flex justify-end">
          <button
            disabled={saving}
            onClick={async () => {
              if (!window.confirm('Eliminar esta oportunidade?')) return
              setSaving(true)
              try {
                await adminDeleteSalesOpportunity({ data: opportunity.id })
                onClose()
                onChanged()
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Erro ao eliminar')
                setSaving(false)
              }
            }}
            className="px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-[2px] hover:bg-red-50"
          >
            Eliminar oportunidade
          </button>
        </div>
      </div>
    </div>
  )
}
