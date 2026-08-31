import { useState } from 'react'
import { createFileRoute, Navigate, Link, useNavigate } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useIdentity } from '@/lib/identity-context'
import { adminPreviewPortfolioImport } from '@/lib/server-fns'
import { CARRIER_PROVIDERS, CARRIER_PROVIDER_LABELS, type CarrierProviderId } from '@/lib/carrier-providers'

/**
 * /admin/carrier-integrations/import — CRM3 Block 3: manual portfolio
 * import, Steps 1-3 (select insurer, select file, preview/reconcile).
 *
 * Both entry points (System → Carrier Integrations, and the "Import
 * Portfolio" action on the People tab) link to this exact route — there
 * is only ONE importer implementation.
 *
 * Never writes to individual_clients/companies/policies — the entire
 * flow here ends in adminPreviewPortfolioImport, which only ever creates
 * a carrier_sync_runs (mode='dry_run') row and carrier_import_records
 * rows. Step 4 (the compact preview table + row review) reuses the
 * existing /admin/carrier-integrations/runs/$id page in full, rather
 * than duplicating that UI here.
 */
export const Route = createFileRoute('/admin/carrier-integrations/import')({
  component: ImportPortfolioPage,
  head: () => ({ meta: [{ title: 'Os Meus Seguros · Admin · Import Portfolio' }] }),
})

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function ImportPortfolioPage() {
  const { user, ready } = useIdentity()
  const navigate = useNavigate()

  const [provider, setProvider] = useState<CarrierProviderId | ''>('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicateRunId, setDuplicateRunId] = useState<string | null>(null)

  if (!ready) {
    return (
      <AppLayout>
        <div className="p-6 text-sm text-navy-400">Loading…</div>
      </AppLayout>
    )
  }
  if (!user) return <Navigate to="/login" />
  if (!user.roles?.includes('admin')) return <Navigate to="/dashboard" />

  const canPreview = provider !== '' && file !== null && !submitting

  async function handlePreview() {
    if (!provider || !file) return
    setSubmitting(true)
    setError(null)
    setDuplicateRunId(null)
    try {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setError(`File is too large (max ${Math.floor(MAX_FILE_SIZE_BYTES / (1024 * 1024))} MB)`)
        return
      }
      const buffer = await file.arrayBuffer()
      const fileBase64 = arrayBufferToBase64(buffer)
      const result = await adminPreviewPortfolioImport({ data: { provider, filename: file.name, fileBase64 } })

      if (result.status === 'invalid_provider') {
        setError('Please select an insurer.')
      } else if (result.status === 'file_error') {
        setError(result.error)
      } else if (result.status === 'unrecognized_format') {
        setError(result.error)
      } else if (result.status === 'duplicate') {
        setDuplicateRunId(result.runId)
      } else if (result.status === 'created') {
        navigate({ to: '/admin/carrier-integrations/runs/$id', params: { id: result.runId } })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong while processing the file')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AppLayout>
      <div>
        <div className="admin-page-header" style={{ marginBottom: '1rem' }}>
          <div>
            <h1 className="admin-page-title">Import Portfolio</h1>
            <p className="admin-page-subtitle">
              Upload an insurer portfolio Excel file to preview a reconciliation against existing CRM records.
              Nothing is created or changed in the CRM at this stage.
            </p>
          </div>
          <Link to="/admin/carrier-integrations" className="admin-btn admin-btn-secondary admin-btn--sm">
            Back to Carrier Integrations
          </Link>
        </div>

        <div className="admin-panel" style={{ maxWidth: '520px', padding: '1.25rem' }}>
          <div style={{ marginBottom: '1rem' }}>
            <label className="block text-sm font-medium text-navy-600 mb-1">Insurance company</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as CarrierProviderId | '')}
              className="w-full px-4 py-2.5 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-[#223553]"
              disabled={submitting}
            >
              <option value="">Select insurer</option>
              {CARRIER_PROVIDERS.map((id) => (
                <option key={id} value={id}>{CARRIER_PROVIDER_LABELS[id]}</option>
              ))}
            </select>
            <p className="text-xs text-navy-400" style={{ marginTop: '0.35rem' }}>
              The insurer must be selected before uploading — it is never inferred from the file name, policy
              numbers, or the file's contents.
            </p>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label className="block text-sm font-medium text-navy-600 mb-1">Excel file</label>
            <input
              type="file"
              accept=".xlsx,.xls"
              disabled={!provider || submitting}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
            />
          </div>

          {error && (
            <p className="text-sm text-red-500" style={{ marginBottom: '1rem' }}>{error}</p>
          )}

          {duplicateRunId && (
            <div className="admin-chip admin-chip--info" style={{ display: 'block', marginBottom: '1rem', padding: '0.6rem' }}>
              This portfolio appears to have been imported before.{' '}
              <Link to="/admin/carrier-integrations/runs/$id" params={{ id: duplicateRunId }} className="underline">
                View that run
              </Link>
            </div>
          )}

          <button
            type="button"
            className="admin-btn admin-btn-primary"
            disabled={!canPreview}
            onClick={handlePreview}
          >
            {submitting ? 'Processing…' : 'Preview import'}
          </button>
        </div>
      </div>
    </AppLayout>
  )
}
