import { useEffect, useState } from 'react'
import { createFileRoute, Navigate, Link, useNavigate } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useIdentity } from '@/lib/identity-context'
import {
  adminGetCarrierSyncRun,
  adminListCarrierImportRecords,
  adminGetCarrierImportRecordReview,
  adminAcceptCarrierImportDecision,
  adminRejectCarrierImportDecision,
  adminIgnoreCarrierImportDecision,
  adminLinkCarrierClientIdentity,
  adminLinkCarrierPolicyIdentity,
  adminCancelCarrierSyncRun,
  adminSetCarrierImportRecordApplyActions,
  adminApplyCarrierSyncRun,
  type AdminApplyCarrierSyncRunResult,
} from '@/lib/server-fns'
import { formatCurrency, formatDate } from '@/lib/utils'
import { redactSensitivePayload } from '@/lib/carrier-payload-redaction'
import { CARRIER_PROVIDER_LABELS, type CarrierProviderId } from '@/lib/carrier-providers'
import {
  computeRunApplyReadiness,
  describeRowApplyResult,
  type ApplyActionRowState,
  type CustomerApplyAction,
  type PolicyApplyAction,
  type RowApplyResultStatus,
} from '@/lib/carrier-apply-actions'
import {
  computePolicyFieldProposals,
  buildApprovedPolicyChanges,
  type PolicyProposalField,
} from '@/lib/carrier-apply-field-mapping'
import { mapPortfolioRows } from '@/lib/carrier-import-mappers'
import type { CarrierImportRecord, CarrierImportRecordReview, CarrierSyncRun, Json } from '@/lib/types'

const CUSTOMER_ACTION_LABELS: Record<CustomerApplyAction, string> = {
  link_existing_individual: 'Use existing person',
  link_existing_company: 'Use existing company',
  create_individual: 'Create new person',
  create_company: 'Create new company',
  add_policyholder_to_existing_client: 'Add as policyholder to existing client',
  no_customer_change: 'No customer change',
}

const POLICY_ACTION_LABELS: Record<PolicyApplyAction, string> = {
  link_existing_policy: 'Use existing policy',
  create_policy: 'Create new policy',
  update_existing_policy: 'Use existing policy & apply approved changes',
  no_policy_change: 'No policy change',
}

const POLICY_FIELD_LABELS: Record<PolicyProposalField, string> = {
  policyNumber: 'Policy number',
  startDate: 'Start date',
  endDate: 'End date',
  annualPremium: 'Annual premium',
}

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

function recordToApplyActionRowState(record: CarrierImportRecord): ApplyActionRowState {
  return {
    decisionStatus: record.decisionStatus,
    customerApplyAction: record.customerApplyAction ?? null,
    policyApplyAction: record.policyApplyAction ?? null,
    selectedIndividualClientId: record.selectedIndividualClientId ?? null,
    selectedCompanyId: record.selectedCompanyId ?? null,
    selectedPolicyId: record.selectedPolicyId ?? null,
    participantMode: record.selectedPolicyholderMode ?? null,
    selectedPolicyholderIndividualClientId: record.selectedPolicyholderIndividualClientId ?? null,
    selectedPolicyholderCompanyId: record.selectedPolicyholderCompanyId ?? null,
    approvedPolicyChanges: (record.approvedPolicyChanges as Record<string, unknown> | undefined) ?? null,
  }
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
  const navigate = useNavigate()
  const { id } = Route.useParams()
  const [run, setRun] = useState<CarrierSyncRun | undefined>(undefined)
  const [records, setRecords] = useState<CarrierImportRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [showConfirmApply, setShowConfirmApply] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<AdminApplyCarrierSyncRunResult | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)

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

  const readiness = computeRunApplyReadiness(records.map(recordToApplyActionRowState))
  const runApplyStatus = run?.applyStatus ?? 'not_applied'
  const alreadyFullyApplied = runApplyStatus === 'applied'
  const hasRetryableFailures = runApplyStatus === 'partially_failed' || records.some((record) => record.applyStatus === 'failed')

  async function confirmApply() {
    setApplying(true)
    setApplyError(null)
    try {
      const result = await adminApplyCarrierSyncRun({ data: id })
      setApplyResult(result)
      setShowConfirmApply(false)
      reload()
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Something went wrong while applying this import')
    } finally {
      setApplying(false)
    }
  }

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
            {/* Wrong-insurer protection (CRM3 Block 3): provider is
                immutable once a run exists — there is no update-provider
                code path anywhere. The only way to "fix" a wrong
                selection is to cancel this run and upload again. */}
            <div
              className="admin-panel"
              style={{ marginBottom: '1rem', padding: '0.85rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}
            >
              <p className="text-sm font-medium" style={{ color: 'var(--ui-text-primary)' }}>
                Importing {run.recordsReceived} record{run.recordsReceived === 1 ? '' : 's'} from{' '}
                {CARRIER_PROVIDER_LABELS[run.provider as CarrierProviderId] ?? run.provider}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="admin-btn admin-btn-danger admin-btn--sm"
                  disabled={cancelling}
                  onClick={async () => {
                    setCancelling(true)
                    try {
                      await adminCancelCarrierSyncRun({ data: run.id })
                      navigate({ to: '/admin/carrier-integrations' })
                    } finally {
                      setCancelling(false)
                    }
                  }}
                >
                  Cancel import
                </button>
                <Link to="/admin/carrier-integrations/import" className="admin-btn admin-btn-secondary admin-btn--sm">
                  Upload again
                </Link>
              </div>
            </div>

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

            {/* CRM3 Block 4 — Confirm & Apply. Never mutates on its own:
                the button only opens a confirmation modal, and applying
                is entirely blocked while any accepted record still lacks
                an explicit apply action. */}
            <div className="admin-panel" style={{ marginBottom: '1rem', padding: '1rem' }}>
              {alreadyFullyApplied || applyResult || hasRetryableFailures ? (
                <div>
                  <h3 className="admin-panel-title" style={{ marginBottom: '0.5rem' }}>
                    {applyResult?.failed || hasRetryableFailures ? 'Portfolio apply incomplete' : 'Portfolio applied'}
                  </h3>
                  <p className="text-sm text-navy-600">
                    {applyResult
                      ? `${applyResult.accepted + applyResult.skipped} records processed / ${applyResult.applied} applied / ${applyResult.skipped} skipped / ${applyResult.failed} failed${applyResult.alreadyApplied ? ` / ${applyResult.alreadyApplied} already applied` : ''}`
                      : `Run status: ${runApplyStatus}`}
                  </p>
                  <button
                    type="button"
                    className="admin-btn admin-btn-primary admin-btn--sm"
                    disabled={!hasRetryableFailures}
                    style={{ marginTop: '0.75rem' }}
                    onClick={() => setShowConfirmApply(true)}
                  >
                    Retry failed records
                  </button>
                </div>
              ) : (
                <div>
                  <h3 className="admin-panel-title" style={{ marginBottom: '0.5rem' }}>Apply</h3>
                  {readiness.acceptedCount === 0 ? (
                    <p className="text-sm text-navy-400">No accepted records yet — accept a record above before applying.</p>
                  ) : readiness.unresolvedCount > 0 ? (
                    <p className="text-sm text-red-500">
                      {readiness.unresolvedCount} accepted record{readiness.unresolvedCount === 1 ? '' : 's'} still need{readiness.unresolvedCount === 1 ? 's' : ''} an apply action.
                    </p>
                  ) : (
                    <div className="text-sm text-navy-600">
                      <p className="font-medium" style={{ marginBottom: '0.3rem' }}>
                        Ready to apply / {readiness.readyCount} accepted record{readiness.readyCount === 1 ? '' : 's'}
                      </p>
                      <ul style={{ marginLeft: '1rem', listStyle: 'disc' }}>
                        {readiness.willLinkCustomers > 0 && <li>{readiness.willLinkCustomers} existing client{readiness.willLinkCustomers === 1 ? '' : 's'} will be linked</li>}
                        {readiness.willCreateIndividuals + readiness.willCreateCompanies > 0 && (
                          <li>{readiness.willCreateIndividuals + readiness.willCreateCompanies} new client{readiness.willCreateIndividuals + readiness.willCreateCompanies === 1 ? '' : 's'} will be created</li>
                        )}
                        {readiness.willLinkPolicies > 0 && <li>{readiness.willLinkPolicies} existing polic{readiness.willLinkPolicies === 1 ? 'y' : 'ies'} will be linked</li>}
                        {readiness.willCreatePolicies > 0 && <li>{readiness.willCreatePolicies} new polic{readiness.willCreatePolicies === 1 ? 'y' : 'ies'} will be created</li>}
                        {readiness.willUpdatePolicies > 0 && <li>{readiness.willUpdatePolicies} existing polic{readiness.willUpdatePolicies === 1 ? 'y has' : 'ies have'} approved changes</li>}
                      </ul>
                    </div>
                  )}
                  {applyError && <p className="text-sm text-red-500" style={{ marginTop: '0.5rem' }}>{applyError}</p>}
                  <button
                    type="button"
                    className="admin-btn admin-btn-primary admin-btn--sm"
                    disabled={!readiness.canApply}
                    style={{ marginTop: '0.75rem' }}
                    onClick={() => setShowConfirmApply(true)}
                  >
                    Confirm &amp; Apply
                  </button>
                </div>
              )}
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
                        <th>Apply</th>
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
                            {record.applyStatus !== 'pending' ? (
                              describeRowApplyResult(record.applyStatus as RowApplyResultStatus)
                            ) : record.decisionStatus !== 'accepted' ? (
                              <span className="text-navy-400 text-xs">—</span>
                            ) : record.customerApplyAction && record.policyApplyAction ? (
                              <span className="text-navy-500 text-xs">Ready</span>
                            ) : (
                              <span className="text-red-500 text-xs">Needs action</span>
                            )}
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
          onApplyActionsChanged={reload}
        />
      )}

      {showConfirmApply && run && (
        <ConfirmApplyModal
          provider={CARRIER_PROVIDER_LABELS[run.provider as CarrierProviderId] ?? run.provider}
          count={readiness.readyCount}
          busy={applying}
          onCancel={() => setShowConfirmApply(false)}
          onConfirm={confirmApply}
        />
      )}
    </AppLayout>
  )
}

/** Exact copy per requirement — no mutation happens until this modal's
 * own "Confirm & Apply" click, never on the first button click. */
function ConfirmApplyModal({
  provider,
  count,
  busy,
  onCancel,
  onConfirm,
}: {
  provider: string
  count: number
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: '1rem',
      }}
      onClick={onCancel}
    >
      <div className="admin-panel" style={{ maxWidth: '480px', width: '100%', padding: '1.25rem' }} onClick={(e) => e.stopPropagation()}>
        <h2 className="admin-panel-title" style={{ marginBottom: '0.75rem' }}>Confirm portfolio import</h2>
        <p className="text-sm text-navy-600" style={{ marginBottom: '1rem' }}>
          You are about to apply {count} accepted record{count === 1 ? '' : 's'} from {provider}. This can create or update CRM records according to the reviewed actions.
        </p>
        <div className="flex items-center gap-2">
          <button type="button" className="admin-btn admin-btn-secondary admin-btn--sm" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" className="admin-btn admin-btn-primary admin-btn--sm" disabled={busy} onClick={onConfirm}>
            {busy ? 'Applying…' : 'Confirm & Apply'}
          </button>
        </div>
      </div>
    </div>
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
  onApplyActionsChanged,
}: {
  record: CarrierImportRecord
  onClose: () => void
  onChanged: () => void
  onApplyActionsChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<CarrierImportRecordReview | undefined>(undefined)
  const [reviewLoading, setReviewLoading] = useState(true)

  // CRM3 Block 4 — explicit apply action resolution. Initialized from
  // whatever is already persisted on the record (so re-opening the panel
  // shows the previously-saved choice), never inferred from match status.
  const [customerAction, setCustomerAction] = useState<CustomerApplyAction | ''>(record.customerApplyAction ?? '')
  const [participantResolution, setParticipantResolution] = useState<'existing_individual' | 'existing_company' | 'create_individual' | 'create_company'>('existing_individual')
  const [policyAction, setPolicyAction] = useState<PolicyApplyAction | ''>(record.policyApplyAction ?? '')
  const [approvedFields, setApprovedFields] = useState<Set<PolicyProposalField>>(new Set())
  const [applyActionSaving, setApplyActionSaving] = useState(false)
  const [applyActionError, setApplyActionError] = useState<string | null>(null)
  const [applyActionSaved, setApplyActionSaved] = useState(false)

  // Server-side candidate resolution only — this route never queries
  // Supabase directly from the browser (see adminGetCarrierImportRecordReview).
  useEffect(() => {
    let cancelled = false
    setReviewLoading(true)
    adminGetCarrierImportRecordReview({ data: record.id })
      .then((data) => { if (!cancelled) setReview(data) })
      .catch((err: unknown) => console.error('adminGetCarrierImportRecordReview error:', err))
      .finally(() => { if (!cancelled) setReviewLoading(false) })
    return () => { cancelled = true }
  }, [record.id])

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

  // CRM3 Block 4 — re-derive the semantic imported row (same technique
  // used server-side at apply time — see applyCarrierImportRecord) only
  // to compute individually-approvable field proposals for "Use existing
  // policy & apply approved changes". Never used to apply anything by
  // itself — this is display-only until Save is clicked.
  const mappedForRecord = mapPortfolioRows(record.provider as CarrierProviderId, [record.rawPayload as Record<string, unknown>])
  const parsedRow = mappedForRecord.recognized ? mappedForRecord.rows[0] : undefined
  const policyProposals = parsedRow ? computePolicyFieldProposals(review?.policyCandidate, parsedRow) : []

  const canApplyThisRow = record.decisionStatus === 'accepted' && record.applyStatus !== 'applied'

  async function saveApplyAction() {
    if (!customerAction || !policyAction) return
    setApplyActionSaving(true)
    setApplyActionError(null)
    setApplyActionSaved(false)
    try {
      const selectedIndividualClientId =
        customerAction === 'link_existing_individual' ? review?.individualCandidate?.id : undefined
      const selectedCompanyId =
        customerAction === 'link_existing_company' ? review?.companyCandidate?.id : undefined
      const selectedPolicyholderMode =
        customerAction === 'add_policyholder_to_existing_client' ? participantResolution : undefined
      const selectedPolicyholderIndividualClientId =
        customerAction === 'add_policyholder_to_existing_client' && participantResolution === 'existing_individual'
          ? review?.individualCandidate?.id
          : undefined
      const selectedPolicyholderCompanyId =
        customerAction === 'add_policyholder_to_existing_client' && participantResolution === 'existing_company'
          ? review?.companyCandidate?.id
          : undefined
      const selectedPolicyId =
        policyAction === 'link_existing_policy' || policyAction === 'update_existing_policy'
          ? review?.policyCandidate?.id
          : undefined
      const approvedPolicyChanges =
        policyAction === 'update_existing_policy'
          ? (buildApprovedPolicyChanges(policyProposals, approvedFields) as Record<string, Json>)
          : undefined

      await adminSetCarrierImportRecordApplyActions({
        data: {
          recordId: record.id,
          customerApplyAction: customerAction,
          policyApplyAction: policyAction,
          selectedIndividualClientId,
          selectedCompanyId,
          selectedPolicyId,
          selectedPolicyholderMode,
          selectedPolicyholderIndividualClientId,
          selectedPolicyholderCompanyId,
          approvedPolicyChanges,
        },
      })
      setApplyActionSaved(true)
      onApplyActionsChanged()
    } catch (err) {
      setApplyActionError(err instanceof Error ? err.message : 'Could not save this apply action')
    } finally {
      setApplyActionSaving(false)
    }
  }

  // Fields that could plausibly carry sensitive medical detail from a
  // health-insurance carrier feed — never rendered even inside the
  // collapsed "Technical details" view (requirement "do not intentionally
  // surface medical information"). Recursive: a nested medical key must be
  // redacted just as reliably as a top-level one — see
  // src/lib/carrier-payload-redaction.ts.
  const redactedPayload = redactSensitivePayload(record.rawPayload ?? {})

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
            <div><span className="text-navy-400">Imported tomador: </span>{String(record.rawPayload.tomador ?? '—')}</div>
            <div><span className="text-navy-400">Imported NIF: </span>{String(record.rawPayload.nif ?? '—')}</div>
          </div>
        </section>

        {/* 2. CRM candidate summary — human-readable, resolved server-side
            (adminGetCarrierImportRecordReview). Never infers missing
            fields: a candidate simply omits whatever it doesn't have. */}
        <section style={{ marginBottom: '1rem' }}>
          <h3 className="text-xs font-semibold uppercase text-navy-400" style={{ marginBottom: '0.4rem' }}>CRM candidate</h3>
          <div className="grid grid-cols-2 gap-2 text-sm" style={{ marginBottom: '0.5rem' }}>
            <div><span className="text-navy-400">Customer match: </span><MatchChip status={record.customerMatchStatus} /></div>
            <div><span className="text-navy-400">Policy match: </span><MatchChip status={record.policyMatchStatus} /></div>
          </div>

          {reviewLoading ? (
            <p className="text-sm text-navy-400">Loading candidate details…</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="border border-navy-100 rounded-[4px] p-3">
                <p className="text-xs font-semibold text-navy-500" style={{ marginBottom: '0.3rem' }}>CRM customer</p>
                {review?.individualCandidate ? (
                  <div className="text-sm text-navy-700">
                    <p className="font-medium">{review.individualCandidate.fullName}</p>
                    {review.individualCandidate.nif && <p className="text-navy-500">NIF: {review.individualCandidate.nif}</p>}
                    {review.individualCandidate.email && <p className="text-navy-500">{review.individualCandidate.email}</p>}
                    {review.individualCandidate.phone && <p className="text-navy-500">{review.individualCandidate.phone}</p>}
                    {review.individualCandidate.address && <p className="text-navy-400 text-xs" style={{ marginTop: '0.2rem' }}>{review.individualCandidate.address}</p>}
                    <p className="text-navy-300 text-xs" style={{ marginTop: '0.3rem' }}>ID: {review.individualCandidate.id}</p>
                  </div>
                ) : review?.companyCandidate ? (
                  <div className="text-sm text-navy-700">
                    <p className="font-medium">{review.companyCandidate.name}</p>
                    <p className="text-navy-500">NIF: {review.companyCandidate.nif}</p>
                    <p className="text-navy-500">{review.companyCandidate.contactName}</p>
                    <p className="text-navy-500">{review.companyCandidate.contactEmail}</p>
                    <p className="text-navy-500">{review.companyCandidate.contactPhone}</p>
                    {review.companyCandidate.address && <p className="text-navy-400 text-xs" style={{ marginTop: '0.2rem' }}>{review.companyCandidate.address}</p>}
                    <p className="text-navy-300 text-xs" style={{ marginTop: '0.3rem' }}>ID: {review.companyCandidate.id}</p>
                  </div>
                ) : (
                  <p className="text-sm text-navy-400">No CRM candidate linked.</p>
                )}
              </div>

              <div className="border border-navy-100 rounded-[4px] p-3">
                <p className="text-xs font-semibold text-navy-500" style={{ marginBottom: '0.3rem' }}>CRM policy</p>
                {review?.policyCandidate ? (
                  <div className="text-sm text-navy-700">
                    <p className="font-medium">{review.policyCandidate.insurer} · {review.policyCandidate.policyNumber}</p>
                    {review.policyCandidate.policyType && <p className="text-navy-500">{review.policyCandidate.policyType}</p>}
                    {(review.policyCandidate.startDate || review.policyCandidate.endDate) && (
                      <p className="text-navy-500">
                        {review.policyCandidate.startDate ? formatDate(review.policyCandidate.startDate) : '—'}
                        {' → '}
                        {review.policyCandidate.endDate ? formatDate(review.policyCandidate.endDate) : '—'}
                      </p>
                    )}
                    {review.policyCandidate.annualPremium != null && (
                      <p className="text-navy-500">{formatCurrency(review.policyCandidate.annualPremium)}/year</p>
                    )}
                    {review.policyCandidate.ownerLabel && <p className="text-navy-500">Owner: {review.policyCandidate.ownerLabel}</p>}
                    <p className="text-navy-300 text-xs" style={{ marginTop: '0.3rem' }}>ID: {review.policyCandidate.id}</p>
                  </div>
                ) : (
                  <p className="text-sm text-navy-400">No CRM candidate linked.</p>
                )}
              </div>
            </div>
          )}
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

        {/* 5. Apply action (CRM3 Block 4) — only ever shown on an
            accepted record, since "accepted" never implies an apply
            action by itself. Nothing here mutates the CRM: Save only
            persists the chosen action; the actual mutation happens later
            at Confirm & Apply, and only for a record whose apply action
            is fully resolved (see isRowReadyToApply). */}
        {record.decisionStatus === 'accepted' && (
          <section style={{ marginBottom: '1rem' }}>
            <h3 className="text-xs font-semibold uppercase text-navy-400" style={{ marginBottom: '0.4rem' }}>Apply action</h3>

            {record.applyStatus === 'applied' ? (
              <p className="text-sm text-navy-500">This record has already been applied — its apply action can no longer be changed.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-sm">
                  <span className="text-navy-500 text-xs block" style={{ marginBottom: '0.2rem' }}>Customer</span>
                  <select
                    className="w-full px-2 py-1.5 border border-navy-200 rounded-[2px] text-sm"
                    value={customerAction}
                    onChange={(e) => setCustomerAction(e.target.value as CustomerApplyAction)}
                  >
                    <option value="">Select…</option>
                    {review?.individualCandidate && (
                      <option value="link_existing_individual">{CUSTOMER_ACTION_LABELS.link_existing_individual}</option>
                    )}
                    {review?.companyCandidate && (
                      <option value="link_existing_company">{CUSTOMER_ACTION_LABELS.link_existing_company}</option>
                    )}
                    {review?.policyCandidate && (
                      <option value="add_policyholder_to_existing_client">{CUSTOMER_ACTION_LABELS.add_policyholder_to_existing_client}</option>
                    )}
                    <option value="create_individual">{CUSTOMER_ACTION_LABELS.create_individual}</option>
                    <option value="create_company">{CUSTOMER_ACTION_LABELS.create_company}</option>
                    <option value="no_customer_change">{CUSTOMER_ACTION_LABELS.no_customer_change}</option>
                  </select>
                </label>

                {customerAction === 'add_policyholder_to_existing_client' && (
                  <label className="text-sm sm:col-span-2">
                    <span className="text-navy-500 text-xs block" style={{ marginBottom: '0.2rem' }}>Policyholder</span>
                    <select
                      className="w-full px-2 py-1.5 border border-navy-200 rounded-[2px] text-sm"
                      value={participantResolution}
                      onChange={(e) => setParticipantResolution(e.target.value as 'existing_individual' | 'existing_company' | 'create_individual' | 'create_company')}
                    >
                      <option value="existing_individual">Use existing person</option>
                      <option value="existing_company">Use existing company</option>
                      <option value="create_individual">Create new person</option>
                      <option value="create_company">Create new company</option>
                    </select>
                  </label>
                )}

                <label className="text-sm">
                  <span className="text-navy-500 text-xs block" style={{ marginBottom: '0.2rem' }}>Policy</span>
                  <select
                    className="w-full px-2 py-1.5 border border-navy-200 rounded-[2px] text-sm"
                    value={policyAction}
                    onChange={(e) => setPolicyAction(e.target.value as PolicyApplyAction)}
                  >
                    <option value="">Select…</option>
                    {review?.policyCandidate && (
                      <option value="link_existing_policy">{POLICY_ACTION_LABELS.link_existing_policy}</option>
                    )}
                    {customerAction !== 'add_policyholder_to_existing_client' && (
                      <option value="create_policy">{POLICY_ACTION_LABELS.create_policy}</option>
                    )}
                    {review?.policyCandidate && policyProposals.length > 0 && (
                      <option value="update_existing_policy">{POLICY_ACTION_LABELS.update_existing_policy}</option>
                    )}
                    <option value="no_policy_change">{POLICY_ACTION_LABELS.no_policy_change}</option>
                  </select>
                </label>
              </div>
            )}

            {policyAction === 'update_existing_policy' && policyProposals.length > 0 && (
              <div className="border border-navy-100 rounded-[4px] p-3" style={{ marginTop: '0.6rem' }}>
                <p className="text-xs font-semibold text-navy-500" style={{ marginBottom: '0.4rem' }}>
                  Approve the field changes to apply — only checked fields will be written.
                </p>
                {policyProposals.map((proposal) => (
                  <label key={proposal.field} className="flex items-center gap-2 text-sm" style={{ marginBottom: '0.3rem' }}>
                    <input
                      type="checkbox"
                      checked={approvedFields.has(proposal.field)}
                      onChange={(e) => {
                        setApprovedFields((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(proposal.field)
                          else next.delete(proposal.field)
                          return next
                        })
                      }}
                    />
                    <span>
                      {POLICY_FIELD_LABELS[proposal.field]}: <span className="text-navy-400">{String(proposal.current ?? '—')}</span> → <span className="font-medium">{String(proposal.proposed)}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            {applyActionError && <p className="text-sm text-red-500" style={{ marginTop: '0.5rem' }}>{applyActionError}</p>}
            {applyActionSaved && !applyActionError && <p className="text-sm text-green-600" style={{ marginTop: '0.5rem' }}>Apply action saved.</p>}

            {canApplyThisRow && (
              <button
                type="button"
                className="admin-btn admin-btn-secondary admin-btn--sm"
                style={{ marginTop: '0.6rem' }}
                disabled={applyActionSaving || !customerAction || !policyAction}
                onClick={saveApplyAction}
              >
                {applyActionSaving ? 'Saving…' : 'Save apply action'}
              </button>
            )}
          </section>
        )}

        <details style={{ marginBottom: '1rem' }}>
          <summary className="text-xs font-semibold uppercase text-navy-400 cursor-pointer">Technical details</summary>
          <pre className="text-xs bg-navy-50 rounded p-2 overflow-x-auto" style={{ marginTop: '0.5rem' }}>
            {JSON.stringify(redactedPayload, null, 2)}
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
