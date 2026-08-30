import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { SalesOpportunity } from '@/lib/types'
import {
  SALES_OPPORTUNITY_STAGE_LABELS_EN,
  SALES_OPPORTUNITY_SOURCES,
  SALES_OPPORTUNITY_SOURCE_LABELS_EN,
  formatFollowUpLabelEn,
  isClosedStage,
  suggestedNextStages,
} from '@/lib/sales-opportunity-rules'
import {
  adminUpdateSalesOpportunity,
  adminUpdateSalesOpportunityStage,
  adminDeleteSalesOpportunity,
  adminCreateOpportunityFollowUpTask,
  fetchWebsiteLeadContextForOpportunity,
} from '@/lib/server-fns'
import { formatCurrency, formatDate } from '@/lib/utils'
import { STAGE_PALETTE, FOLLOW_UP_URGENCY_STYLE, type OwnerLookup } from './salesPipelineUi'

interface Props {
  opportunity: SalesOpportunity
  owner?: OwnerLookup
  onClose: () => void
  onChanged: () => void
}

type WebsiteLeadContext = Awaited<ReturnType<typeof fetchWebsiteLeadContextForOpportunity>>

/** Campo com clique-para-editar: mostra o valor, um clique troca por um input, Enter/blur guarda. */
function InlineField({
  label,
  value,
  display,
  onSave,
  type = 'text',
}: {
  label: string
  value: string
  display: string
  onSave: (next: string) => Promise<void>
  type?: 'text' | 'number' | 'date'
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)

  useEffect(() => setDraft(value), [value])

  const commit = async () => {
    setEditing(false)
    if (draft === value) return
    setSaving(true)
    try {
      await onSave(draft)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center justify-between py-1.5">
      <dt className="text-[13px] text-slate-500">{label}</dt>
      {editing ? (
        <input
          autoFocus
          type={type}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
          className="text-[14px] text-right px-2 py-0.5 border border-indigo-300 rounded-md w-40 focus:outline-none"
        />
      ) : (
        <dd
          onClick={() => setEditing(true)}
          className={`text-[14px] text-slate-700 cursor-text px-1.5 py-0.5 rounded hover:bg-slate-50 ${saving ? 'opacity-50' : ''}`}
          title="Click to edit"
        >
          {display || <span className="text-slate-300">set…</span>}
        </dd>
      )}
    </div>
  )
}

function InlineSelect<T extends string>({
  label,
  value,
  options,
  labels,
  onSave,
}: {
  label: string
  value: T | undefined
  options: readonly T[]
  labels: Record<T, string>
  onSave: (next: T) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  return (
    <div className="flex items-center justify-between py-1.5">
      <dt className="text-[13px] text-slate-500">{label}</dt>
      <select
        value={value ?? ''}
        disabled={saving}
        onChange={async (e) => {
          setSaving(true)
          try { await onSave(e.target.value as T) } finally { setSaving(false) }
        }}
        className="text-[14px] text-slate-700 text-right bg-transparent hover:bg-slate-50 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-indigo-200"
      >
        {options.map((o) => <option key={o} value={o}>{labels[o]}</option>)}
      </select>
    </div>
  )
}

/**
 * Drawer lateral (não modal) — a pipeline continua visível atrás, permite
 * processar várias oportunidades seguidas sem perder o contexto do Kanban.
 * Ver requisito "opportunity detail — drawer preferred".
 */
export function SalesOpportunityDrawer({ opportunity, owner, onClose, onChanged }: Props) {
  const [lostReason, setLostReason] = useState(opportunity.lostReason ?? '')
  const [error, setError] = useState<string | null>(null)
  const [stageSaving, setStageSaving] = useState(false)
  const [followUpDate, setFollowUpDate] = useState(opportunity.nextFollowUpAt?.slice(0, 10) ?? '')
  const [followUpMsg, setFollowUpMsg] = useState<string | null>(null)
  const [websiteLeadContext, setWebsiteLeadContext] = useState<WebsiteLeadContext | null>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

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

  const save = async (updates: Record<string, unknown>) => {
    setError(null)
    try {
      await adminUpdateSalesOpportunity({ data: { id: opportunity.id, updates } })
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the change.')
    }
  }

  const changeStage = async (stage: SalesOpportunity['stage']) => {
    setStageSaving(true)
    setError(null)
    try {
      await adminUpdateSalesOpportunityStage({
        data: { id: opportunity.id, stage, lostReason: stage === 'lost' ? lostReason || null : undefined },
      })
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the stage.')
    } finally {
      setStageSaving(false)
    }
  }

  const palette = STAGE_PALETTE[opportunity.stage]
  const followUp = formatFollowUpLabelEn(opportunity.nextFollowUpAt)
  const nextStages = suggestedNextStages(opportunity.stage)

  // Honest activity: only events that genuinely exist in the data (no
  // fabricated stage-change history, which isn't stored yet) — see
  // requirement "activity/timeline".
  const activity: Array<{ label: string; at: string }> = [
    { label: 'Opportunity created', at: opportunity.createdAt },
  ]
  if (websiteLeadContext) activity.push({ label: 'Request received from website', at: websiteLeadContext.receivedAt })
  if (opportunity.closedAt) {
    activity.push({ label: `Marked as ${SALES_OPPORTUNITY_STAGE_LABELS_EN[opportunity.stage]}`, at: opportunity.closedAt })
  }
  activity.sort((a, b) => a.at.localeCompare(b.at))

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="relative w-full sm:w-[480px] lg:w-[540px] bg-white h-full shadow-2xl flex flex-col overflow-hidden">
        {/* HEADER */}
        <div className="px-5 pt-5 pb-4 border-b border-slate-100">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[17px] font-semibold text-slate-800 truncate">{owner?.name ?? '—'}</p>
              <p className="text-[13px] text-slate-500 mt-0.5 truncate">
                {owner?.email}
                {owner && (
                  <>
                    {owner.email ? ' · ' : ''}
                    <Link
                      to="/admin"
                      search={{ tab: owner.kind === 'individual' ? 'individual_clients' : 'companies' }}
                      className="text-indigo-600 hover:text-indigo-700 font-medium"
                    >
                      View client →
                    </Link>
                  </>
                )}
              </p>
            </div>
            <button onClick={onClose} className="shrink-0 text-slate-400 hover:text-slate-700 p-1" aria-label="Close">✕</button>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <span className={`inline-flex px-2 py-1 rounded-full text-[12px] font-semibold ${palette.badgeBg} ${palette.badgeText}`}>
              {SALES_OPPORTUNITY_STAGE_LABELS_EN[opportunity.stage]}
            </span>
            <span className="text-[13px] text-slate-500">{opportunity.product ?? opportunity.title}</span>
          </div>

          {/* Quick stage actions — no need for drag&drop or the full selector */}
          {!isClosedStage(opportunity.stage) && nextStages.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {nextStages.map((stage) => (
                <button
                  key={stage}
                  disabled={stageSaving}
                  onClick={() => changeStage(stage)}
                  className={`px-2.5 py-1 text-[13px] font-medium rounded-md border disabled:opacity-40 ${
                    stage === 'won' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : stage === 'lost' ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {stage === 'won' ? 'Mark won' : stage === 'lost' ? 'Mark lost' : `Move to ${SALES_OPPORTUNITY_STAGE_LABELS_EN[stage]}`}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <div className="mx-5 mt-3 px-3 py-2 text-[13px] text-rose-700 bg-rose-50 border border-rose-100 rounded-md">{error}</div>}

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* SUMMARY */}
          <section>
            <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Summary</p>
            <dl className="divide-y divide-slate-50">
              <div className="flex items-center justify-between py-1.5">
                <dt className="text-[13px] text-slate-500">Market</dt>
                <dd className="text-[14px] text-slate-700">{opportunity.market ?? '—'}</dd>
              </div>
              <InlineSelect
                label="Source"
                value={opportunity.source as (typeof SALES_OPPORTUNITY_SOURCES)[number] | undefined}
                options={SALES_OPPORTUNITY_SOURCES}
                labels={SALES_OPPORTUNITY_SOURCE_LABELS_EN}
                onSave={(source) => save({ source })}
              />
              <InlineField
                label="Owner"
                value={opportunity.assignedTo ?? ''}
                display={opportunity.assignedTo ?? ''}
                onSave={(assignedTo) => save({ assignedTo })}
              />
              <div className="flex items-center justify-between py-1.5">
                <dt className="text-[13px] text-slate-500">Created on</dt>
                <dd className="text-[14px] text-slate-700">{formatDate(opportunity.createdAt)}</dd>
              </div>
            </dl>
          </section>

          {/* VALUES */}
          <section>
            <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Values</p>
            <dl className="divide-y divide-slate-50">
              <InlineField
                label="Estimated annual premium"
                type="number"
                value={String(opportunity.estimatedAnnualPremium ?? '')}
                display={opportunity.estimatedAnnualPremium ? formatCurrency(opportunity.estimatedAnnualPremium) : ''}
                onSave={(v) => save({ estimatedAnnualPremium: v ? Number(v) : null })}
              />
              <InlineField
                label="Estimated revenue (Adler)"
                type="number"
                value={String(opportunity.estimatedRevenue ?? '')}
                display={opportunity.estimatedRevenue ? formatCurrency(opportunity.estimatedRevenue) : ''}
                onSave={(v) => save({ estimatedRevenue: v ? Number(v) : null })}
              />
              <InlineField
                label="Expected close date"
                type="date"
                value={opportunity.expectedCloseDate ?? ''}
                display={opportunity.expectedCloseDate ? formatDate(opportunity.expectedCloseDate) : ''}
                onSave={(v) => save({ expectedCloseDate: v || null })}
              />
            </dl>
            <p className="text-[12px] text-slate-400 mt-1.5">Premium is what the client pays the insurer; revenue is what stays with Adler — never the same thing.</p>
          </section>

          {/* NEXT ACTION */}
          <section>
            <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Next action</p>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-[13px] text-slate-500">Follow-up</dt>
              {followUp.urgency !== 'none' && (
                <span className={`inline-flex px-1.5 py-0.5 rounded text-[12px] font-medium border ${FOLLOW_UP_URGENCY_STYLE[followUp.urgency]}`}>
                  {followUp.label}
                </span>
              )}
            </div>
            <div className="flex gap-1.5 mt-1.5">
              <input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className="flex-1 px-2.5 py-1.5 text-[14px] border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-200" />
              <button
                disabled={!followUpDate}
                onClick={async () => {
                  setFollowUpMsg(null)
                  try {
                    const result = await adminCreateOpportunityFollowUpTask({
                      data: { opportunityId: opportunity.id, title: `Follow-up — ${opportunity.title}`, dueDate: followUpDate },
                    })
                    setFollowUpMsg(result.created ? 'Task created.' : 'Existing task updated.')
                    onChanged()
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not set the follow-up.')
                  }
                }}
                className="px-3 py-1.5 text-[13px] font-medium border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-40"
              >
                Set
              </button>
            </div>
            {followUpMsg && <p className="text-[12px] text-slate-500 mt-1">{followUpMsg} Linked task in Tasks.</p>}
          </section>

          {/* SOURCE (website leads) */}
          {opportunity.websiteLeadId && (
            <section>
              <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Request source</p>
              {websiteLeadContext ? (
                <dl className="divide-y divide-slate-50">
                  <div className="flex items-center justify-between py-1.5">
                    <dt className="text-[13px] text-slate-500">Form</dt>
                    <dd className="text-[14px] text-slate-700">{websiteLeadContext.formName}</dd>
                  </div>
                  {websiteLeadContext.sourceUrl && (
                    <div className="flex items-center justify-between py-1.5 gap-3">
                      <dt className="text-[13px] text-slate-500 shrink-0">Page</dt>
                      <dd className="text-[14px] text-right truncate">
                        <a href={websiteLeadContext.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-700">
                          {websiteLeadContext.sourceUrl}
                        </a>
                      </dd>
                    </div>
                  )}
                  {(websiteLeadContext.utmSource || websiteLeadContext.utmMedium || websiteLeadContext.utmCampaign) && (
                    <div className="flex items-center justify-between py-1.5">
                      <dt className="text-[13px] text-slate-500">UTM</dt>
                      <dd className="text-[14px] text-slate-700">{[websiteLeadContext.utmSource, websiteLeadContext.utmMedium, websiteLeadContext.utmCampaign].filter(Boolean).join(' / ')}</dd>
                    </div>
                  )}
                  <div className="flex items-center justify-between py-1.5">
                    <dt className="text-[13px] text-slate-500">Received on</dt>
                    <dd className="text-[14px] text-slate-700">{formatDate(websiteLeadContext.receivedAt)}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-[13px] text-slate-400">Loading…</p>
              )}
            </section>
          )}

          {/* ACTIVITY */}
          <section>
            <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Activity</p>
            <ul className="space-y-2">
              {activity.map((event, i) => (
                <li key={i} className="flex items-center gap-2 text-[13px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                  <span className="text-slate-600">{event.label}</span>
                  <span className="text-slate-400 ml-auto">{formatDate(event.at)}</span>
                </li>
              ))}
            </ul>
          </section>

          {opportunity.stage === 'lost' && (
            <section>
              <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Loss reason</p>
              <div className="flex gap-1.5">
                <input
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 text-[14px] border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
                <button onClick={() => save({ lostReason })} className="px-3 py-1.5 text-[13px] font-medium border border-slate-200 rounded-md hover:bg-slate-50">
                  Save
                </button>
              </div>
            </section>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
          <button
            onClick={async () => {
              if (!window.confirm('Delete this opportunity? This action cannot be undone.')) return
              try {
                await adminDeleteSalesOpportunity({ data: opportunity.id })
                onClose()
                onChanged()
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not delete.')
              }
            }}
            className="px-3 py-1.5 text-[13px] font-medium text-rose-600 hover:bg-rose-50 rounded-md"
          >
            Delete opportunity
          </button>
        </div>
      </div>
    </div>
  )
}
