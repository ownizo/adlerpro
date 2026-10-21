import { useState } from 'react'
import { adminDeleteOrphanFiles, adminListOrphanFiles } from '@/lib/storage-cleanup.functions'

type Scan = { totalFiles: number; orphans: string[] }

export function StorageCleanupCard() {
  const [scan, setScan] = useState<Scan | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function runScan() {
    setBusy(true)
    setMessage(null)
    try {
      setScan(await adminListOrphanFiles())
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not scan storage.')
    } finally {
      setBusy(false)
    }
  }

  async function removeOrphans() {
    if (!scan || scan.orphans.length === 0) return
    if (!window.confirm(`Permanently delete ${scan.orphans.length} file(s) not linked to any client, policy or claim?`)) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await adminDeleteOrphanFiles({ data: { paths: scan.orphans } })
      setMessage(`${result.deleted} file(s) deleted${result.skipped ? `, ${result.skipped} kept because they are now linked` : ''}.`)
      setScan(await adminListOrphanFiles())
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not delete files.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white rounded-[4px] border border-navy-200 p-5 mt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-bold text-navy-700">Document storage cleanup</h3>
          <p className="text-xs text-navy-500">Finds files left behind by deleted clients, policies or claims.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={runScan} disabled={busy} className="admin-btn admin-btn-secondary admin-btn--sm">
            {busy && !scan ? 'Scanning…' : 'Scan'}
          </button>
          {scan && scan.orphans.length > 0 && (
            <button onClick={removeOrphans} disabled={busy} className="admin-btn admin-btn-primary admin-btn--sm">
              Delete {scan.orphans.length} file(s)
            </button>
          )}
        </div>
      </div>
      {scan && (
        <div className="mt-3 text-sm text-navy-600">
          <p>
            {scan.totalFiles} file(s) in storage, {scan.orphans.length} not linked to any record.
          </p>
          {scan.orphans.length > 0 && (
            <ul className="mt-2 max-h-48 overflow-auto text-xs text-navy-500 font-mono break-all">
              {scan.orphans.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {message && <p className="mt-3 text-sm text-navy-700">{message}</p>}
    </div>
  )
}
