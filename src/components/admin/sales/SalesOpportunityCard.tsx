import type { SalesOpportunity } from '@/lib/types'
import { ageInDays, formatFollowUpLabelEn } from '@/lib/sales-opportunity-rules'
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

function initials(text: string): string {
  const parts = text.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Compact, immediately scannable card — client/company front and centre,
 * product, a humanised follow-up, and a single metadata row (market ·
 * source · premium · age). The premium figure is always labelled (never a
 * generic "Value: €X" — see requirement "premium vs revenue") since it's
 * shown alongside plain currency values elsewhere on the card; revenue's
 * full premium/revenue breakdown stays in the drawer, not duplicated here.
 * Doesn't show everything at once — prioritises scanability over
 * completeness.
 */
export function SalesOpportunityCard({ opportunity, owner, draggable, onDragStart, onDragEnd, onClick }: Props) {
  const palette = STAGE_PALETTE[opportunity.stage]
  const followUp = formatFollowUpLabelEn(opportunity.nextFollowUpAt)

  return (
    <article
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`admin-opportunity-card rounded-lg border bg-white p-3 cursor-pointer ${palette.border}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800 truncate">{owner?.name ?? '—'}</p>
        {opportunity.assignedTo && (
          <span className="admin-avatar-chip" title={opportunity.assignedTo}>{initials(opportunity.assignedTo)}</span>
        )}
      </div>
      <p className="text-[13px] text-slate-500 mt-0.5 truncate">{opportunity.product ?? opportunity.title}</p>

      {followUp.urgency !== 'none' && (
        <span className={`inline-flex items-center mt-2 px-1.5 py-0.5 rounded text-[12px] font-medium border ${FOLLOW_UP_URGENCY_STYLE[followUp.urgency]}`}>
          {followUp.label}
        </span>
      )}

      <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-100 text-[12px] text-slate-400">
        <div className="flex items-center gap-1.5 min-w-0">
          {opportunity.market && <span className="admin-market-tag">{opportunity.market}</span>}
          <span className="truncate">{opportunity.source ?? '—'}</span>
        </div>
        {opportunity.estimatedAnnualPremium != null && (
          <span className="text-slate-600 font-medium shrink-0 tabular-nums">
            <span className="text-slate-400 font-normal">Premium</span> {formatCurrency(opportunity.estimatedAnnualPremium)}
          </span>
        )}
        <span className="shrink-0">{ageInDays(opportunity.createdAt)}d</span>
      </div>
    </article>
  )
}
