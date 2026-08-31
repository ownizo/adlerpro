import { useEffect, useState } from 'react'
import { createFileRoute, Navigate, Link, Outlet, useRouterState } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useIdentity } from '@/lib/identity-context'
import { adminListCarrierSyncRuns } from '@/lib/server-fns'
import { formatDate } from '@/lib/utils'
import type { CarrierSyncRun } from '@/lib/types'

/**
 * /admin/carrier-integrations — CRM3 Block 2 shell.
 *
 * Placeholder-only for the carrier connections themselves (no working
 * "Connect" button, no credentials anywhere in this file or in the repo —
 * see requirement "Do NOT suggest credentials are already present"). The
 * Reconciliation Runs section below is real and reads carrier_sync_runs,
 * but nothing on this page creates, imports, or syncs anything — see
 * /admin/carrier-integrations/runs/$id for reviewing an individual run.
 */
export const Route = createFileRoute('/admin/carrier-integrations')({
  component: CarrierIntegrationsPage,
  head: () => ({ meta: [{ title: 'Os Meus Seguros · Admin · Carrier Integrations' }] }),
})

interface ProviderPlaceholder {
  key: string
  name: string
}

const PROVIDER_PLACEHOLDERS: ProviderPlaceholder[] = [
  { key: 'zurich', name: 'Zurich' },
  { key: 'allianz', name: 'Allianz' },
  { key: 'mgen', name: 'MGEN' },
  { key: 'asisa', name: 'ASISA' },
  { key: 'other', name: 'Other' },
]

const SYNC_STATUS_CHIP_CLASS: Record<string, string> = {
  pending: 'admin-chip--neutral',
  processing: 'admin-chip--info',
  completed: 'admin-chip--success',
  failed: 'admin-chip--danger',
}

// CarrierIntegrationsPage stays a thin wrapper so /admin/carrier-integrations'
// existing content (now in CarrierIntegrationsContent, byte-for-byte the
// same) is untouched. It only exists so genuinely separate child routes —
// /admin/carrier-integrations/import and /admin/carrier-integrations/runs/$id,
// both nested under this route in the generated route tree — actually
// render: TanStack Router always renders an ancestor route's component for
// any of its descendants, so this route needs an <Outlet/> for those
// descendants to show at all. Same fix already applied to /admin itself —
// see AdminPage/AdminDashboardContent in src/routes/admin.tsx. At the exact
// "/admin/carrier-integrations" path there is no matched child route, so
// this never affects the existing page.
function CarrierIntegrationsPage() {
  const location = useRouterState({ select: (state) => state.location })
  if (location.pathname !== '/admin/carrier-integrations') return <Outlet />
  return <CarrierIntegrationsContent />
}

function CarrierIntegrationsContent() {
  const { user, ready } = useIdentity()
  const [runs, setRuns] = useState<CarrierSyncRun[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ready || !user || !user.roles?.includes('admin')) return
    let cancelled = false
    setLoading(true)
    adminListCarrierSyncRuns({ data: {} })
      .then((data) => { if (!cancelled) setRuns(data) })
      .catch((err: unknown) => console.error('adminListCarrierSyncRuns error:', err))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [ready, user])

  if (!ready) {
    return (
      <AppLayout>
        <div className="p-6 text-sm text-navy-400">Loading…</div>
      </AppLayout>
    )
  }
  if (!user) return <Navigate to="/login" />
  if (!user.roles?.includes('admin')) return <Navigate to="/dashboard" />

  return (
    <AppLayout>
      <div>
        <div className="admin-page-header" style={{ marginBottom: '1rem' }}>
          <div>
            <h1 className="admin-page-title">Carrier Integrations</h1>
            <p className="admin-page-subtitle">
              Connect insurer portfolio data and reconcile it safely with existing CRM records.
            </p>
          </div>
          <Link to="/admin/carrier-integrations/import" className="admin-btn admin-btn-primary">
            Import Portfolio
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3" style={{ marginBottom: '1.5rem' }}>
          {PROVIDER_PLACEHOLDERS.map((provider) => (
            <div key={provider.key} className="admin-panel" style={{ padding: '1rem' }}>
              <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
                <span className="font-semibold text-sm" style={{ color: 'var(--ui-text-primary)' }}>{provider.name}</span>
                <span className="admin-chip admin-chip--neutral">Not connected</span>
              </div>
              <p className="text-xs" style={{ color: 'var(--ui-text-muted)', marginBottom: '0.75rem' }}>
                Portfolio integration is not configured yet.
              </p>
              <button type="button" className="admin-btn admin-btn-secondary admin-btn--sm" disabled>
                Configuration pending
              </button>
            </div>
          ))}
        </div>

        <div className="admin-panel">
          <div className="admin-panel-head">
            <h2 className="admin-panel-title">Reconciliation Runs</h2>
          </div>

          {loading ? (
            <p className="text-sm text-navy-400" style={{ padding: '1rem' }}>Loading…</p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-navy-400" style={{ padding: '1rem' }}>No reconciliation runs yet.</p>
          ) : (
            <div className="admin-table-wrap overflow-x-auto">
              <table className="admin-table w-full min-w-[900px]">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Mode</th>
                    <th>Status</th>
                    <th>Received</th>
                    <th>Exact</th>
                    <th>Review</th>
                    <th>New</th>
                    <th>Errors</th>
                    <th>Created</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td>{run.provider}</td>
                      <td>{run.mode === 'dry_run' ? 'Dry run' : 'Import'}</td>
                      <td>
                        <span className={`admin-chip ${SYNC_STATUS_CHIP_CLASS[run.status] ?? 'admin-chip--neutral'}`}>
                          {run.status}
                        </span>
                      </td>
                      <td>{run.recordsReceived}</td>
                      <td>{run.recordsExactMatch}</td>
                      <td>{run.recordsReview}</td>
                      <td>{run.recordsNew}</td>
                      <td>{run.recordsError}</td>
                      <td>{formatDate(run.createdAt)}</td>
                      <td>
                        <Link
                          to="/admin/carrier-integrations/runs/$id"
                          params={{ id: run.id }}
                          className="admin-btn admin-btn-secondary admin-btn--sm"
                        >
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
