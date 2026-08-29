import { useState } from 'react'
import type { Company, IndividualClient, SalesOpportunity, SalesOpportunityStage } from '@/lib/types'
import { SALES_OPPORTUNITY_STAGES, SALES_OPPORTUNITY_STAGE_LABELS_PT } from '@/lib/sales-opportunity-rules'
import { formatCurrency } from '@/lib/utils'
import { STAGE_PALETTE, buildOwnerLookup } from './salesPipelineUi'
import { SalesOpportunityCard } from './SalesOpportunityCard'

interface Props {
  opportunities: SalesOpportunity[]
  individualClients: IndividualClient[]
  companies: Company[]
  onOpen: (id: string) => void
  onStageChange: (id: string, stage: SalesOpportunityStage) => Promise<void>
}

/**
 * Sete colunas não cabem confortavelmente a partir de ~1280px sem ficarem
 * ilegíveis — em vez de as espremer, a faixa de colunas tem a sua própria
 * scroll horizontal (scroll-snap por coluna) e cada coluna tem uma largura
 * mínima que mantém o card legível a qualquer resolução desktop. Testado
 * conceptualmente a 1440/1280/1024px — ver requisito "Kanban horizontal
 * behavior".
 */
export function SalesKanban({ opportunities, individualClients, companies, onOpen, onStageChange }: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [activeDropStage, setActiveDropStage] = useState<SalesOpportunityStage | null>(null)

  const byStage: Record<SalesOpportunityStage, SalesOpportunity[]> = {
    new: [], contacted: [], needs_analysis: [], quoted: [], negotiation: [], won: [], lost: [],
  }
  for (const opp of opportunities) byStage[opp.stage].push(opp)

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
      {SALES_OPPORTUNITY_STAGES.map((stage) => {
        const items = byStage[stage]
        const palette = STAGE_PALETTE[stage]
        // Prémio é o agregado da coluna — é o que a equipa comercial
        // acompanha por stage; receita fica só no card/detalhe para não
        // sobrecarregar o cabeçalho da coluna com dois números.
        const columnPremium = items.reduce((sum, o) => sum + (o.estimatedAnnualPremium ?? 0), 0)

        return (
          <section
            key={stage}
            className={`shrink-0 w-[272px] snap-start rounded-xl border bg-slate-50/60 flex flex-col transition-colors ${
              activeDropStage === stage ? 'border-indigo-300 bg-indigo-50/50' : 'border-slate-200'
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
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-slate-200/80">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${palette.dot}`} />
                <h4 className="text-[13px] font-semibold text-slate-700 truncate">{SALES_OPPORTUNITY_STAGE_LABELS_PT[stage]}</h4>
                <span className="text-[12px] text-slate-400 shrink-0">{items.length}</span>
              </div>
              {columnPremium > 0 && (
                <span className="text-[12px] text-slate-500 shrink-0" title="Prémio total desta coluna">
                  {formatCurrency(columnPremium)}
                </span>
              )}
            </div>

            <div className="flex-1 p-2 space-y-2 min-h-[80px]">
              {items.length === 0 ? (
                <p className="text-[13px] text-slate-400 text-center py-6">Sem oportunidades</p>
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
