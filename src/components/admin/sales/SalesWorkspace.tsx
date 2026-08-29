import { useEffect, useMemo, useState } from 'react'
import type { Company, IndividualClient, SalesOpportunity, SalesOpportunityStage } from '@/lib/types'
import { fetchSalesOpportunities, adminUpdateSalesOpportunityStage } from '@/lib/server-fns'
import { formatFollowUpLabel } from '@/lib/sales-opportunity-rules'
import { SalesToolbar } from './SalesToolbar'
import { SalesFilters, DEFAULT_SALES_FILTERS, type SalesFiltersState } from './SalesFilters'
import { SalesKanban } from './SalesKanban'
import { SalesOpportunityList } from './SalesOpportunityList'
import { SalesOpportunityDrawer } from './SalesOpportunityDrawer'
import { CreateOpportunityDialog } from './CreateOpportunityDialog'
import { buildOwnerLookup } from './salesPipelineUi'

interface Props {
  individualClients: IndividualClient[]
  companies: Company[]
  /** Deep-link vindo do dashboard (ex.: "Em cotação" → stage=quoted) — ver requisito "clickable metrics". */
  initialStage?: SalesOpportunityStage
  initialOverdueOnly?: boolean
}

/**
 * Workspace comercial (CRM 2) — orquestra fetch, filtros, e as duas vistas
 * (Kanban/Lista) sobre os mesmos dados já carregados uma vez. Sem fetch por
 * card nem refetch total a cada edição: mudanças de stage atualizam o
 * estado local otimisticamente, e só voltam ao servidor (reload()) para
 * confirmar — ver requisito "performance".
 */
export function SalesWorkspace({ individualClients, companies, initialStage, initialOverdueOnly }: Props) {
  const [opportunities, setOpportunities] = useState<SalesOpportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'kanban' | 'list'>('kanban')
  // Semeado uma única vez a partir do deep-link do dashboard (?stage=/&overdue=1);
  // depois disso o utilizador controla os filtros livremente na página.
  const [filters, setFilters] = useState<SalesFiltersState>(() => ({
    ...DEFAULT_SALES_FILTERS,
    stage: initialStage ?? DEFAULT_SALES_FILTERS.stage,
    onlyOverdue: initialOverdueOnly ?? DEFAULT_SALES_FILTERS.onlyOverdue,
  }))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const reload = async () => {
    setError(null)
    try {
      const result = await fetchSalesOpportunities({ data: {} })
      setOpportunities(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as oportunidades.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  const ownerByOpportunityId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildOwnerLookup>>()
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
      if (filters.onlyOverdue && formatFollowUpLabel(opp.nextFollowUpAt).urgency !== 'overdue') return false
      if (filters.search.trim()) {
        // Filtragem em memória sobre dados já carregados — sem pedido de
        // rede por tecla, por isso não precisa de debounce (ver requisito
        // "search"; debounce só faria sentido se isto disparasse uma query).
        const q = filters.search.trim().toLowerCase()
        const owner = ownerByOpportunityId.get(opp.id)
        const haystack = [owner?.name, owner?.email, opp.product, opp.title].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [opportunities, filters, ownerByOpportunityId])

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
    // Update otimista: a coluna reage imediatamente ao drop, sem esperar
    // pelo round-trip — ver requisito "drag & drop".
    setOpportunities((prev) => prev.map((o) => (o.id === id ? { ...o, stage } : o)))
    try {
      await adminUpdateSalesOpportunityStage({ data: { id, stage } })
      await reload()
    } catch (err) {
      setOpportunities(previous)
      setError(err instanceof Error ? err.message : 'Não foi possível mover a oportunidade.')
    }
  }

  const selected = selectedId ? opportunities.find((o) => o.id === selectedId) : undefined

  return (
    <div>
      <SalesToolbar view={view} onViewChange={setView} onCreate={() => setShowCreate(true)} />

      <SalesFilters
        filters={filters}
        onChange={setFilters}
        knownMarkets={knownMarkets}
        knownAssignees={knownAssignees}
        resultCount={filtered.length}
        totalCount={opportunities.length}
      />

      {error && (
        <div className="mt-3 px-3 py-2 text-[13px] text-rose-700 bg-rose-50 border border-rose-100 rounded-md">{error}</div>
      )}

      <div className="mt-4">
        {loading ? (
          <SalesWorkspaceSkeleton view={view} />
        ) : opportunities.length === 0 ? (
          <EmptyState
            title="Ainda não há oportunidades comerciais"
            description="Criadas automaticamente a partir de pedidos do website, ou manualmente aqui."
            actionLabel="Criar oportunidade"
            onAction={() => setShowCreate(true)}
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="Sem oportunidades para estes filtros" description="Tenta limpar ou ajustar os filtros ativos." />
        ) : view === 'kanban' ? (
          <SalesKanban
            opportunities={filtered}
            individualClients={individualClients}
            companies={companies}
            onOpen={setSelectedId}
            onStageChange={handleStageChange}
          />
        ) : (
          <SalesOpportunityList
            opportunities={filtered}
            individualClients={individualClients}
            companies={companies}
            onOpen={setSelectedId}
          />
        )}
      </div>

      {selected && (
        <SalesOpportunityDrawer
          opportunity={selected}
          owner={ownerByOpportunityId.get(selected.id)}
          onClose={() => setSelectedId(null)}
          onChanged={reload}
        />
      )}

      {showCreate && (
        <CreateOpportunityDialog
          individualClients={individualClients}
          companies={companies}
          onClose={() => setShowCreate(false)}
          onCreated={async () => { setShowCreate(false); await reload() }}
        />
      )}
    </div>
  )
}

function SalesWorkspaceSkeleton({ view }: { view: 'kanban' | 'list' }) {
  if (view === 'list') {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        {[...Array(6)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}
      </div>
    )
  }
  return (
    <div className="flex gap-3 overflow-hidden">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="shrink-0 w-[272px] h-64 bg-slate-100 rounded-xl animate-pulse" />
      ))}
    </div>
  )
}

function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="bg-white border border-dashed border-slate-200 rounded-xl py-14 px-6 text-center">
      <p className="text-[15px] font-medium text-slate-600">{title}</p>
      <p className="text-[13px] text-slate-400 mt-1">{description}</p>
      {actionLabel && onAction && (
        <button onClick={onAction} className="mt-4 px-4 py-2 text-[14px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md">
          {actionLabel}
        </button>
      )}
    </div>
  )
}
