import {
  SALES_OPPORTUNITY_STAGES,
  SALES_OPPORTUNITY_STAGE_LABELS_EN,
  SALES_OPPORTUNITY_SOURCES,
  SALES_OPPORTUNITY_SOURCE_LABELS_EN,
  SALES_OPPORTUNITY_PRODUCT_OPTIONS_EN,
} from '@/lib/sales-opportunity-rules'
import type { SalesOpportunityStage } from '@/lib/types'

export interface SalesFiltersState {
  stage: SalesOpportunityStage | 'all'
  market: string
  product: string
  source: string
  assignedTo: string
  status: 'all' | 'open' | 'won' | 'lost'
  search: string
  /** Shortcut from the dashboard ("Overdue follow-ups") — see requirement "clickable metrics". */
  onlyOverdue: boolean
}

export const DEFAULT_SALES_FILTERS: SalesFiltersState = {
  stage: 'all', market: '', product: '', source: '', assignedTo: '', status: 'all', search: '', onlyOverdue: false,
}

interface Props {
  filters: SalesFiltersState
  onChange: (filters: SalesFiltersState) => void
  knownMarkets: string[]
  knownAssignees: string[]
  resultCount: number
  totalCount: number
}

function isDefault(filters: SalesFiltersState): boolean {
  return JSON.stringify(filters) === JSON.stringify(DEFAULT_SALES_FILTERS)
}

const selectClass = 'text-[13px] px-2.5 py-1.5 border border-slate-200 rounded-md bg-white text-slate-700 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400'

/**
 * Single compact filter/search toolbar: primary filters, free search, result
 * count and an always-visible "Clear filters" whenever there is something to
 * clear — see requirement "filter experience". Open/Won/Lost now lives in
 * SalesToolbar's segmented control, not here.
 */
export function SalesFilters({ filters, onChange, knownMarkets, knownAssignees, resultCount, totalCount }: Props) {
  const set = <K extends keyof SalesFiltersState>(key: K, value: SalesFiltersState[K]) => onChange({ ...filters, [key]: value })

  return (
    <div className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2.5">
      <div className="relative flex-1 min-w-[200px] max-w-[320px]">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
        </svg>
        <input
          value={filters.search}
          onChange={(e) => set('search', e.target.value)}
          placeholder="Search client, email, company, product…"
          className="w-full pl-8 pr-2.5 py-1.5 text-[13px] border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
        />
      </div>

      <select value={filters.stage} onChange={(e) => set('stage', e.target.value as SalesFiltersState['stage'])} className={selectClass}>
        <option value="all">All stages</option>
        {SALES_OPPORTUNITY_STAGES.map((s) => <option key={s} value={s}>{SALES_OPPORTUNITY_STAGE_LABELS_EN[s]}</option>)}
      </select>
      <select value={filters.market} onChange={(e) => set('market', e.target.value)} className={selectClass}>
        <option value="">All markets</option>
        {knownMarkets.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <select value={filters.product} onChange={(e) => set('product', e.target.value)} className={selectClass}>
        <option value="">All products</option>
        {SALES_OPPORTUNITY_PRODUCT_OPTIONS_EN.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <select value={filters.source} onChange={(e) => set('source', e.target.value)} className={selectClass}>
        <option value="">All sources</option>
        {SALES_OPPORTUNITY_SOURCES.map((s) => <option key={s} value={s}>{SALES_OPPORTUNITY_SOURCE_LABELS_EN[s]}</option>)}
      </select>
      {knownAssignees.length > 0 && (
        <select value={filters.assignedTo} onChange={(e) => set('assignedTo', e.target.value)} className={selectClass}>
          <option value="">All owners</option>
          {knownAssignees.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      )}

      <button
        type="button"
        onClick={() => set('onlyOverdue', !filters.onlyOverdue)}
        className={`text-[13px] px-2.5 py-1.5 rounded-md border font-medium ${
          filters.onlyOverdue ? 'bg-rose-50 border-rose-200 text-rose-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'
        }`}
      >
        Overdue
      </button>

      <div className="ml-auto flex items-center gap-3">
        <span className="text-[13px] text-slate-400">
          {resultCount === totalCount ? `${totalCount}` : `${resultCount} of ${totalCount}`}
        </span>
        {!isDefault(filters) && (
          <button onClick={() => onChange(DEFAULT_SALES_FILTERS)} className="text-[13px] font-medium text-indigo-600 hover:text-indigo-800">
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}
