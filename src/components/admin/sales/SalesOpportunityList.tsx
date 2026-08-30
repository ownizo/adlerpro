import { useMemo, useState } from 'react'
import type { Company, IndividualClient, SalesOpportunity } from '@/lib/types'
import { SALES_OPPORTUNITY_STAGE_LABELS_EN, formatFollowUpLabelEn } from '@/lib/sales-opportunity-rules'
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
  { key: 'client', label: 'Client' },
  { key: 'product', label: 'Product' },
  { key: 'stage', label: 'Stage' },
  { key: 'premium', label: 'Premium', align: 'right' },
  { key: 'revenue', label: 'Revenue', align: 'right' },
  { key: 'followUp', label: 'Follow-up' },
  { key: 'created', label: 'Created' },
]

/**
 * A real data table: fixed header, right-alignment for values, subtle
 * separators (not heavy borders on every cell), hover and per-column
 * sorting — see requirement "table design".
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
    <div className="admin-panel" style={{ padding: 0 }}>
      <div className="overflow-x-auto">
        <table className="admin-table min-w-[920px]">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className="cursor-pointer select-none hover:text-slate-700"
                  style={{ textAlign: col.align === 'right' ? 'right' : 'left' }}
                >
                  {col.label}{sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ opp, owner }) => {
              const palette = STAGE_PALETTE[opp.stage]
              const followUp = formatFollowUpLabelEn(opp.nextFollowUpAt)
              return (
                <tr key={opp.id} className="cursor-pointer" onClick={() => onOpen(opp.id)}>
                  <td className="font-medium">{owner.name}</td>
                  <td>{opp.product ?? '—'}</td>
                  <td>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[12px] font-medium ${palette.badgeBg} ${palette.badgeText}`}>
                      {SALES_OPPORTUNITY_STAGE_LABELS_EN[opp.stage]}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">{opp.estimatedAnnualPremium ? formatCurrency(opp.estimatedAnnualPremium) : '—'}</td>
                  <td className="text-right tabular-nums">{opp.estimatedRevenue ? formatCurrency(opp.estimatedRevenue) : '—'}</td>
                  <td>
                    {followUp.urgency !== 'none' ? (
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[12px] font-medium border ${FOLLOW_UP_URGENCY_STYLE[followUp.urgency]}`}>
                        {followUp.label}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td>{formatDate(opp.createdAt)}</td>
                  <td>{opp.assignedTo ?? '—'}</td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-[14px] text-slate-400">
                  No opportunities for the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
