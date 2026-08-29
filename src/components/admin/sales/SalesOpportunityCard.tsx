import type { SalesOpportunity } from '@/lib/types'
import { ageInDays, formatFollowUpLabel } from '@/lib/sales-opportunity-rules'
import { formatCurrency } from '@/lib/utils'
import { STAGE_PALETTE, FOLLOW_UP_URGENCY_STYLE, type OwnerLookup } from './salesPipelineUi'

interface Props {
  opportunity: SalesOpportunity
  owner?: OwnerLookup
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  onClick: () => void
}

/**
 * Card compacto e imediatamente legível — cliente/empresa em destaque,
 * produto, prémio E receita rotulados sem ambiguidade (nunca um "Valor: €X"
 * genérico — ver requisito "premium vs revenue"), follow-up humanizado, e só
 * o resto como metadados discretos. Não mostra tudo ao mesmo tempo —
 * prioriza scanability sobre completude (o detalhe fica na drawer).
 */
export function SalesOpportunityCard({ opportunity, owner, draggable, onDragStart, onDragEnd, onClick }: Props) {
  const palette = STAGE_PALETTE[opportunity.stage]
  const followUp = formatFollowUpLabel(opportunity.nextFollowUpAt)

  return (
    <article
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`rounded-lg border bg-white p-3 cursor-pointer transition-shadow hover:shadow-md ${palette.border}`}
    >
      <p className="text-sm font-semibold text-slate-800 truncate">{owner?.name ?? '—'}</p>
      <p className="text-[13px] text-slate-500 mt-0.5 truncate">{opportunity.product ?? opportunity.title}</p>

      {(opportunity.estimatedAnnualPremium || opportunity.estimatedRevenue) && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px]">
          {opportunity.estimatedAnnualPremium != null && (
            <span className="text-slate-600">
              <span className="text-slate-400">Prémio</span> {formatCurrency(opportunity.estimatedAnnualPremium)}
            </span>
          )}
          {opportunity.estimatedRevenue != null && (
            <span className="text-slate-600">
              <span className="text-slate-400">Receita</span> {formatCurrency(opportunity.estimatedRevenue)}
            </span>
          )}
        </div>
      )}

      {followUp.urgency !== 'none' && (
        <span className={`inline-flex items-center mt-2 px-1.5 py-0.5 rounded text-[12px] font-medium border ${FOLLOW_UP_URGENCY_STYLE[followUp.urgency]}`}>
          {followUp.label}
        </span>
      )}

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-[12px] text-slate-400">
        <span>{opportunity.market ?? '—'} · {opportunity.source ?? '—'}</span>
        <span className="flex items-center gap-2">
          {opportunity.assignedTo && <span className="truncate max-w-[72px]" title={opportunity.assignedTo}>{opportunity.assignedTo}</span>}
          <span>{ageInDays(opportunity.createdAt)}d</span>
        </span>
      </div>
    </article>
  )
}
