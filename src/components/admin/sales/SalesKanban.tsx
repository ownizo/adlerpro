import { useState } from 'react'
import type { Company, IndividualClient, SalesOpportunity, SalesOpportunityStage } from '@/lib/types'
import { SALES_OPPORTUNITY_STAGES, SALES_OPPORTUNITY_STAGE_LABELS_EN } from '@/lib/sales-opportunity-rules'
import { formatCurrency } from '@/lib/utils'
import { STAGE_PALETTE, buildOwnerLookup } from './salesPipelineUi'
import { SalesOpportunityCard } from './SalesOpportunityCard'

interface Props {
  opportunities: SalesOpportunity[]
  individualClients: IndividualClient[]
  companies: Company[]
  onOpen: (id: string) => void
  onStageChange: (id: string, stage: SalesOpportunityStage) => Promise<void>
  onCreate?: () => void
}

/**
 * Seven columns don't fit comfortably from ~1280px without becoming
 * illegible — instead of squeezing them, the column strip has its own
 * horizontal scroll (scroll-snap per column) and each column has a minimum
 * width that keeps the card legible at any desktop resolution. Column
 * headers stay visible while scrolling their own column body — see
 * requirement "Kanban horizontal behavior".
 */
export function SalesKanban({ opportunities, individualClients, companies, onOpen, onStageChange, onCreate }: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [activeDropStage, setActiveDropStage] = useState<SalesOpportunityStage | null>(null)

  const byStage: Record<SalesOpportunityStage, SalesOpportunity[]> = {
    new: [], contacted: [], needs_analysis: [], quoted: [], negotiation: [], won: [], lost: [],
  }
  for (const opp of opportunities) byStage[opp.stage].push(opp)

  return (
    <div className="admin-kanban-scroll snap-x">
      {SALES_OPPORTUNITY_STAGES.map((stage) => {
        const items = byStage[stage]
        const palette = STAGE_PALETTE[stage]
        // Premium is the column aggregate — that's what the sales team
        // tracks per stage; revenue stays in the card/detail only, to avoid
        // overloading the column header with two numbers.
        const columnPremium = items.reduce((sum, o) => sum + (o.estimatedAnnualPremium ?? 0), 0)

        return (
          <section
            key={stage}
            className={`admin-kanban-column snap-start transition-colors ${
              activeDropStage === stage ? 'border-indigo-300 bg-indigo-50/40' : ''
            }`}
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
              await onStageChange(droppedId, stage)
            }}
          >
            <div className="admin-kanban-column-header px-3 py-2.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${palette.dot}`} />
                <h4 className="text-[13px] font-semibold text-slate-700 truncate">{SALES_OPPORTUNITY_STAGE_LABELS_EN[stage]}</h4>
              </div>
              <p className="text-[11.5px] text-slate-500 mt-0.5" title="Opportunities · total premium in this column">
                {items.length} opportunit{items.length === 1 ? 'y' : 'ies'} · {formatCurrency(columnPremium)}
              </p>
            </div>

            <div className="admin-kanban-column-body flex-1 p-2 space-y-2">
              {items.length === 0 ? (
                onCreate ? (
                  <button type="button" onClick={onCreate} className="admin-kanban-add">
                    + Add opportunity
                  </button>
                ) : (
                  <p className="admin-kanban-empty">No opportunities</p>
                )
              ) : (
                items.map((opp) => (
                  <SalesOpportunityCard
                    key={opp.id}
                    opportunity={opp}
                    owner={buildOwnerLookup(opp, individualClients, companies)}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', opp.id)
                      e.dataTransfer.effectAllowed = 'move'
                      setDraggingId(opp.id)
                    }}
                    onDragEnd={() => { setDraggingId(null); setActiveDropStage(null) }}
                    onClick={() => onOpen(opp.id)}
                  />
                ))
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
