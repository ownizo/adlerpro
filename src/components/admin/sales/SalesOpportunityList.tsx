import { useMemo, useState } from 'react'
import type { Company, IndividualClient, SalesOpportunity } from '@/lib/types'
import { SALES_OPPORTUNITY_STAGE_LABELS_PT, formatFollowUpLabel } from '@/lib/sales-opportunity-rules'
import { formatCurrency, formatDate } from '@/lib/utils'
import { STAGE_PALETTE, FOLLOW_UP_URGENCY_STYLE, buildOwnerLookup } from './salesPipelineUi'

interface Props {
  opportunities: SalesOpportunity[]
  individualClients: IndividualClient[]
  companies: Company[]
  onOpen: (id: string) => void
}

type SortKey = 'client' | 'product' | 'stage' | 'premium' | 'revenue' | 'followUp' | 'created'
type SortDir = 'asc' | 'desc'

const COLUMNS: Array<{ key: SortKey; label: string; align?: 'right' }> = [
  { key: 'client', label: 'Cliente' },
  { key: 'product', label: 'Produto' },
  { key: 'stage', label: 'Stage' },
  { key: 'premium', label: 'Prémio', align: 'right' },
  { key: 'revenue', label: 'Receita', align: 'right' },
  { key: 'followUp', label: 'Follow-up' },
  { key: 'created', label: 'Criada' },
]

/**
 * Tabela de dados a sério: cabeçalho fixo, alinhamento à direita para
 * valores, separadores subtis (não bordas pesadas em cada célula), hover e
 * ordenação por coluna — ver requisito "table design".
 */
export function SalesOpportunityList({ opportunities, individualClients, companies, onOpen }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('created')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const rows = useMemo(() => {
    const withOwner = opportunities.map((opp) => ({ opp, owner: buildOwnerLookup(opp, individualClients, companies) }))
    const dir = sortDir === 'asc' ? 1 : -1
    return withOwner.sort((a, b) => {
      switch (sortKey) {
        case 'client': return dir * a.owner.name.localeCompare(b.owner.name)
        case 'product': return dir * (a.opp.product ?? '').localeCompare(b.opp.product ?? '')
        case 'stage': return dir * a.opp.stage.localeCompare(b.opp.stage)
        case 'premium': return dir * ((a.opp.estimatedAnnualPremium ?? 0) - (b.opp.estimatedAnnualPremium ?? 0))
        case 'revenue': return dir * ((a.opp.estimatedRevenue ?? 0) - (b.opp.estimatedRevenue ?? 0))
        case 'followUp': return dir * (a.opp.nextFollowUpAt ?? '').localeCompare(b.opp.nextFollowUpAt ?? '')
        case 'created': return dir * a.opp.createdAt.localeCompare(b.opp.createdAt)
      }
    })
  }, [opportunities, individualClients, companies, sortKey, sortDir])

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-[14px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className={`px-4 py-2.5 text-[12px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none hover:text-slate-700 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                >
                  {col.label}{sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
              <th className="px-4 py-2.5 text-[12px] font-semibold text-slate-500 uppercase tracking-wide text-left">Responsável</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ opp, owner }) => {
              const palette = STAGE_PALETTE[opp.stage]
              const followUp = formatFollowUpLabel(opp.nextFollowUpAt)
              return (
                <tr key={opp.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => onOpen(opp.id)}>
                  <td className="px-4 py-3 text-slate-800 font-medium">{owner.name}</td>
                  <td className="px-4 py-3 text-slate-600">{opp.product ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[12px] font-medium ${palette.badgeBg} ${palette.badgeText}`}>
                      {SALES_OPPORTUNITY_STAGE_LABELS_PT[opp.stage]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 text-right tabular-nums">{opp.estimatedAnnualPremium ? formatCurrency(opp.estimatedAnnualPremium) : '—'}</td>
                  <td className="px-4 py-3 text-slate-600 text-right tabular-nums">{opp.estimatedRevenue ? formatCurrency(opp.estimatedRevenue) : '—'}</td>
                  <td className="px-4 py-3">
                    {followUp.urgency !== 'none' ? (
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[12px] font-medium border ${FOLLOW_UP_URGENCY_STYLE[followUp.urgency]}`}>
                        {followUp.label}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(opp.createdAt)}</td>
                  <td className="px-4 py-3 text-slate-500">{opp.assignedTo ?? '—'}</td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-[14px] text-slate-400">
                  Sem oportunidades para os filtros escolhidos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
