import { useEffect, useState } from 'react'
import { createFileRoute, Navigate, Link } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useIdentity } from '@/lib/identity-context'
import {
  adminGetCarrierSyncRun,
  adminListCarrierImportRecords,
  adminAcceptCarrierImportDecision,
  adminRejectCarrierImportDecision,
  adminIgnoreCarrierImportDecision,
  adminLinkCarrierClientIdentity,
  adminLinkCarrierPolicyIdentity,
} from '@/lib/server-fns'
import { formatDate } from '@/lib/utils'
import type { CarrierImportRecord, CarrierSyncRun } from '@/lib/types'

/**
 * /admin/carrier-integrations/runs/$id — review a single reconciliation
 * run's staged records. Accept/Reject/Ignore only ever touch the staging
 * decision (see adminAccept/Reject/IgnoreCarrierImportDecision) — nothing
 * here creates, updates, or merges an individual_client/company/policy.
 * "Link external identity" is a separate, deliberate action a reviewer
 * chooses per record — never triggered automatically by Accept.
 */
export const Route = createFileRoute('/admin/carrier-integrations/runs/$id')({
  component: CarrierRunDetailPage,
  head: () => ({ meta: [{ title: 'Os Meus Seguros · Admin · Reconciliation Run' }] }),
})

const MATCH_STATUS_CHIP_CLASS: Record<string, string> = {
  unmatched: 'admin-chip--neutral',
  new: 'admin-chip--neutral',
  probable: 'admin-chip--info',
  ambiguous: 'admin-chip--info',
  exact: 'admin-chip--success',
  linked: 'admin-chip--success',
  ignored: 'admin-chip--neutral',
  error: 'admin-chip--danger',
}

const DECISION_CHIP_CLASS: Record<string, string> = {
  pending: 'admin-chip--neutral',
  accepted: 'admin-chip--success',
  rejected: 'admin-chip--danger',
  ignored: 'admin-chip--neutral',
}

function MatchChip({ status }: { status: string }) {
  return <span className={`admin-chip ${MATCH_STATUS_CHIP_CLASS[status] ?? 'admin-chip--neutral'}`}>{status}</span>
}

function KpiTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="admin-kpi-card">
      <p className="admin-kpi-label">{label}</p>
      <p className="admin-kpi-value">{value}</p>
    </div>
  )
}

function CarrierRunDetailPage() {
  const { user, ready } = useIdentity()
  const { id } = Route.useParams()
  const [run, setRun] = useState<CarrierSyncRun | undefined>(undefined)
  const [records, setRecords] = useState<CarrierImportRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewingId, setReviewingId] = useState<string | null>(null)

  const reload = () => {
    setLoading(true)
    Promise.all([adminGetCarrierSyncRun({ data: id }), adminListCarrierImportRecords({ data: { runId: id } })])
      .then(([runData, recordsData]) => {
        setRun(runData)
        setRecords(recordsData)
      })
      .catch((err: unknown) => console.error('carrier run detail load error:', err))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!ready || !user || !user.roles?.includes('admin')) return
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user, id])

  if (!ready) {
    return (
      <AppLayout>
        <div className="p-6 text-sm text-navy-400">Loading…</div>
      </AppLayout>
    )
  }
  if (!user) return <Navigate to="/login" />
  if (!user.roles?.includes('admin')) return <Navigate to="/dashboard" />

  const reviewingRecord = records.find((r) => r.id === reviewingId) ?? null

  return (
    <AppLayout>
      <div>
        <div className="admin-page-header" style={{ marginBottom: '1rem' }}>
          <div>
            <h1 className="admin-page-title">Reconciliation Run</h1>
            <p className="admin-page-subtitle">
              {run ? `${run.provider} · ${run.mode === 'dry_run' ? 'Dry run' : 'Import'}` : 'Loading…'}
            </p>
          </div>
          <Link to="/admin/carrier-integrations" className="admin-btn admin-btn-secondary admin-btn--sm">
            Back to Carrier Integrations
          </Link>
        </div>

        {loading || !run ? (
          <p className="text-sm text-navy-400">Loading…</p>
        ) : (
          <>
            <div className="admin-panel" style={{ marginBottom: '1rem', padding: '1rem' }}>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div><span className="text-navy-400">Provider: </span>{run.provider}</div>
                <div><span className="text-navy-400">Mode: </span>{run.mode === 'dry_run' ? 'Dry run' : 'Import'}</div>
                <div><span className="text-navy-400">Status: </span>{run.status}</div>
                <div><span className="text-navy-400">Created: </span>{formatDate(run.createdAt)}</div>
                <div><span className="text-navy-400">Started: </span>{run.startedAt ? formatDate(run.startedAt) : '—'}</div>
                <div><span className="text-navy-400">Completed: </span>{run.completedAt ? formatDate(run.completedAt) : '—'}</div>
              </div>
            </div>

            <div className="admin-kpi-grid" style={{ marginBottom: '1rem' }}>
              <KpiTile label="Received" value={run.recordsReceived} />
              <KpiTile label="Exact Matches" value={run.recordsExactMatch} />
              <KpiTile label="Needs Review" value={run.recordsReview} />
              <KpiTile label="New" value={run.recordsNew} />
              <KpiTile label="Errors" value={run.recordsError} />
            </div>

            <div className="admin-panel">
              {records.length === 0 ? (
                <p className="text-sm text-navy-400" style={{ padding: '1rem' }}>No records in this run.</p>
              ) : (
                <div className="admin-table-wrap overflow-x-auto">
                  <table className="admin-table w-full min-w-[900px]">
                    <thead>
                      <tr>
                        <th>External Policy</th>
                        <th>External Client</th>
                        <th>Customer Match</th>
                        <th>Policy Match</th>
                        <th>Decision</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((record) => (
                        <tr key={record.id}>
                          <td>{record.externalPolicyNumber ?? record.externalPolicyId ?? '—'}</td>
                          <td>{record.externalClientId ?? '—'}</td>
                          <td><MatchChip status={record.customerMatchStatus} /></td>
                          <td><MatchChip status={record.policyMatchStatus} /></td>
                          <td>
                            <span className={`admin-chip ${DECISION_CHIP_CLASS[record.decisionStatus] ?? 'admin-chip--neutral'}`}>
                              {record.decisionStatus}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="admin-btn admin-btn-secondary admin-btn--sm"
                              onClick={() => setReviewingId(record.id)}
                            >
                              Review
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {reviewingRecord && (
        <ImportRecordReviewPanel
          record={reviewingRecord}
          onClose={() => setReviewingId(null)}
          onChanged={() => { setReviewingId(null); reload() }}
        />
      )}
    </AppLayout>
  )
}

/**
 * Import record review panel (section I). Never dumps raw_payload by
 * default — collapsed behind "Technical details", admin-only (this whole
 * route already requires admin), and deliberately never renders anything
 * from a `health`/medical-looking metadata key even inside that collapsed
 * view (see requirement "do not intentionally surface medical information").
 */
function ImportRecordReviewPanel({
  record,
  onClose,
  onChanged,
}: {
  record: CarrierImportRecord
  onClose: () => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const canLinkClient =
    (record.customerMatchStatus === 'exact' || record.customerMatchStatus === 'probable') &&
    (record.matchedIndividualClientId || record.matchedCompanyId) &&
    record.externalClientId

  const canLinkPolicy =
    (record.policyMatchStatus === 'exact' || record.policyMatchStatus === 'probable') &&
    record.matchedPolicyId &&
    record.externalPolicyNumber

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  // Fields that could plausibly carry sensitive medical detail from a
  // health-insurance carrier feed — never rendered even inside the
  // collapsed "Technical details" view (requirement "do not intentionally
  // surface medical information").
  const SENSITIVE_PAYLOAD_KEY_RE = /health|medical|diagnos|clinic|condition|treatment/i
  const safePayloadEntries = Object.entries(record.rawPayload ?? {}).filter(
    ([key]) => !SENSITIVE_PAYLOAD_KEY_RE.test(key),
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        className="admin-panel"
        style={{ maxWidth: '640px', width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: '1.25rem' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: '1rem' }}>
          <h2 className="admin-panel-title">Review import record</h2>
          <button type="button" className="admin-btn admin-btn-ghost admin-btn--sm" onClick={onClose}>Close</button>
        </div>

        {/* 1. External data summary */}
        <section style={{ marginBottom: '1rem' }}>
          <h3 className="text-xs font-semibold uppercase text-navy-400" style={{ marginBottom: '0.4rem' }}>External data</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-navy-400">Provider: </span>{record.provider}</div>
            <div><span className="text-navy-400">Market: </span>{record.market ?? '—'}</div>
            <div><span className="text-navy-400">External client id: </span>{record.externalClientId ?? '—'}</div>
            <div><span className="text-navy-400">External policy id: </span>{record.externalPolicyId ?? '—'}</div>
            <div><span className="text-navy-400">External policy number: </span>{record.externalPolicyNumber ?? '—'}</div>
          </div>
        </section>

        {/* 2. CRM candidate summary */}
        <section style={{ marginBottom: '1rem' }}>
          <h3 className="text-xs font-semibold uppercase text-navy-400" style={{ marginBottom: '0.4rem' }}>CRM candidate</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-navy-400">Customer match: </span><MatchChip status={record.customerMatchStatus} /></div>
            <div><span className="text-navy-400">Policy match: </span><MatchChip status={record.policyMatchStatus} /></div>
            <div><span className="text-navy-400">Matched individual client: </span>{record.matchedIndividualClientId ?? '—'}</div>
            <div><span className="text-navy-400">Matched company: </span>{record.matchedCompanyId ?? '—'}</div>
            <div><span className="text-navy-400">Matched policy: </span>{record.matchedPolicyId ?? '—'}</div>
          </div>
        </section>

        {/* 3. Matching reasons/signals */}
        {(record.customerMatchReason || record.policyMatchReason) && (
          <section style={{ marginBottom: '1rem' }}>
            <h3 className="text-xs font-semibold uppercase text-navy-400" style={{ marginBottom: '0.4rem' }}>Matching reasons</h3>
            {record.customerMatchReason && <p className="text-sm text-navy-600">Customer: {record.customerMatchReason}</p>}
            {record.policyMatchReason && <p className="text-sm text-navy-600">Policy: {record.policyMatchReason}</p>}
          </section>
        )}

        {/* 4. Current decision */}
        <section style={{ marginBottom: '1rem' }}>
          <h3 className="text-xs font-semibold uppercase text-navy-400" style={{ marginBottom: '0.4rem' }}>Current decision</h3>
          <span className={`admin-chip ${DECISION_CHIP_CLASS[record.decisionStatus] ?? 'admin-chip--neutral'}`}>
            {record.decisionStatus}
          </span>
          {record.decisionNote && <p className="text-sm text-navy-500" style={{ marginTop: '0.4rem' }}>{record.decisionNote}</p>}
        </section>

        <details style={{ marginBottom: '1rem' }}>
          <summary className="text-xs font-semibold uppercase text-navy-400 cursor-pointer">Technical details</summary>
          <pre className="text-xs bg-navy-50 rounded p-2 overflow-x-auto" style={{ marginTop: '0.5rem' }}>
            {JSON.stringify(Object.fromEntries(safePayloadEntries), null, 2)}
          </pre>
        </details>

        {error && <p className="text-sm text-red-500" style={{ marginBottom: '0.75rem' }}>{error}</p>}

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note for this decision"
          className="w-full px-3 py-2 border border-navy-200 rounded-[2px] text-sm"
          rows={2}
          style={{ marginBottom: '0.75rem' }}
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            className="admin-btn admin-btn-primary admin-btn--sm"
            onClick={() => run(() => adminAcceptCarrierImportDecision({ data: { recordId: record.id, decisionNote: note || undefined } }))}
          >
            Accept decision
          </button>
          <button
            type="button"
            disabled={busy}
            className="admin-btn admin-btn-danger admin-btn--sm"
            onClick={() => run(() => adminRejectCarrierImportDecision({ data: { recordId: record.id, decisionNote: note || undefined } }))}
          >
            Reject
          </button>
          <button
            type="button"
            disabled={busy}
            className="admin-btn admin-btn-secondary admin-btn--sm"
            onClick={() => run(() => adminIgnoreCarrierImportDecision({ data: { recordId: record.id, decisionNote: note || undefined } }))}
          >
            Ignore
          </button>

          {canLinkClient && (
            <button
              type="button"
              disabled={busy}
              className="admin-btn admin-btn-secondary admin-btn--sm"
              title="A separate, deliberate action — Accept never links automatically."
              onClick={() =>
                run(() =>
                  adminLinkCarrierClientIdentity({
                    data: {
                      individualClientId: record.matchedIndividualClientId,
                      companyId: record.matchedCompanyId,
                      provider: record.provider,
                      externalClientId: record.externalClientId!,
                    },
                  }),
                )
              }
            >
              Link external client identity
            </button>
          )}

          {canLinkPolicy && (
            <button
              type="button"
              disabled={busy}
              className="admin-btn admin-btn-secondary admin-btn--sm"
              title="A separate, deliberate action — Accept never links automatically."
              onClick={() =>
                run(() =>
                  adminLinkCarrierPolicyIdentity({
                    data: {
                      policyId: record.matchedPolicyId!,
                      provider: record.provider,
                      externalPolicyNumber: record.externalPolicyNumber!,
                      externalPolicyId: record.externalPolicyId,
                    },
                  }),
                )
              }
            >
              Link external policy identity
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
