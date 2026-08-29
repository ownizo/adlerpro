import { useEffect, useState } from 'react'
import type { SalesOpportunity } from '@/lib/types'
import {
  SALES_OPPORTUNITY_STAGE_LABELS_PT,
  formatFollowUpLabel,
} from '@/lib/sales-opportunity-rules'
import { fetchSalesOpportunitiesByOwner } from '@/lib/server-fns'
import { formatCurrency, formatDate } from '@/lib/utils'
import { STAGE_PALETTE, FOLLOW_UP_URGENCY_STYLE, type OwnerLookup } from './sales/salesPipelineUi'
import { SalesOpportunityDrawer } from './sales/SalesOpportunityDrawer'
import { CreateOpportunityDialog } from './sales/CreateOpportunityDialog'

interface Props {
  companyId?: string
  individualClientId?: string
  clientName: string
}

/**
 * Secção "Oportunidades" na ficha unificada do cliente — histórico
 * comercial compacto, não o pipeline completo (isso vive no separador
 * Comercial). Clicar abre a mesma drawer de detalhe do workspace principal
 * — ver requisito "opportunities in client profile". BACKOFFICE ONLY.
 */
export function SalesOpportunitiesSection({ companyId, individualClientId, clientName }: Props) {
  const [opportunities, setOpportunities] = useState<SalesOpportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const owner: OwnerLookup = { name: clientName, kind: individualClientId ? 'individual' : 'company' }

  const reload = () => {
    setLoading(true)
    setError(null)
    fetchSalesOpportunitiesByOwner({ data: { companyId, individualClientId } })
      .then(setOpportunities)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Erro ao carregar oportunidades'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, individualClientId])

  const selected = selectedId ? opportunities.find((o) => o.id === selectedId) : undefined
  const openCount = opportunities.filter((o) => o.stage !== 'won' && o.stage !== 'lost').length

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[15px] font-semibold text-slate-700">
          Oportunidades {opportunities.length > 0 && <span className="text-slate-400 font-normal">({openCount} abertas)</span>}
        </h4>
        <button
          onClick={() => setShowCreate(true)}
          className="text-[13px] px-3 py-1.5 rounded-md bg-indigo-600 text-white font-medium hover:bg-indigo-700"
        >
          + Oportunidade
        </button>
      </div>

      {error && <p className="text-[13px] text-rose-600 mb-2">{error}</p>}

      {loading ? (
        <p className="text-[14px] text-slate-400">A carregar…</p>
      ) : opportunities.length === 0 ? (
        <p className="text-[14px] text-slate-400">Sem oportunidades registadas.</p>
      ) : (
        <div className="grid gap-2">
          {opportunities.map((opp) => {
            const palette = STAGE_PALETTE[opp.stage]
            const followUp = formatFollowUpLabel(opp.nextFollowUpAt)
            return (
              <button
                key={opp.id}
                onClick={() => setSelectedId(opp.id)}
                className="text-left bg-white rounded-lg border border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2 hover:border-slate-300 hover:shadow-sm transition-shadow"
              >
                <div>
                  <p className="text-[14px] font-medium text-slate-700">{opp.product ?? opp.title}</p>
                  <p className="text-[13px] text-slate-500 mt-0.5">
                    {formatDate(opp.createdAt)} · {opp.source ?? 'manual'}
                    {opp.estimatedAnnualPremium != null && ` · Prémio ${formatCurrency(opp.estimatedAnnualPremium)}`}
                    {opp.estimatedRevenue != null && ` · Receita ${formatCurrency(opp.estimatedRevenue)}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {followUp.urgency !== 'none' && (
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-[12px] font-medium border ${FOLLOW_UP_URGENCY_STYLE[followUp.urgency]}`}>
                      {followUp.label}
                    </span>
                  )}
                  <span className={`text-[12px] px-2 py-0.5 rounded-full font-medium ${palette.badgeBg} ${palette.badgeText}`}>
                    {SALES_OPPORTUNITY_STAGE_LABELS_PT[opp.stage]}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {selected && (
        <SalesOpportunityDrawer opportunity={selected} owner={owner} onClose={() => setSelectedId(null)} onChanged={reload} />
      )}

      {showCreate && (
        <CreateOpportunityDialog
          individualClients={[]}
          companies={[]}
          initialOwner={{ kind: individualClientId ? 'individual' : 'company', id: (individualClientId ?? companyId)!, name: clientName }}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); reload() }}
        />
      )}
    </div>
  )
}
