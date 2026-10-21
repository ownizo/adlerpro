import { useCallback, useEffect, useState } from 'react'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useIdentity } from '@/lib/identity-context'
import { fetchClaudeStatus, revokeCrmConnections } from '@/lib/crm-agent/oauth.functions'

export const Route = createFileRoute('/admin/claude')({
  component: ClaudePage,
  head: () => ({ meta: [{ title: 'Claude · Adler & Rochefort Admin' }] }),
})

type Status = Awaited<ReturnType<typeof fetchClaudeStatus>>

function ClaudePage() {
  const { user, ready } = useIdentity()
  const isAdmin = ready && !!user?.roles?.includes('admin')
  const [status, setStatus] = useState<Status | null>(null)
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const url = typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : 'https://admin.adlerrochefort.com/api/mcp'

  const load = useCallback(async () => { try { setStatus(await fetchClaudeStatus()) } catch { /* shown as empty */ } }, [])
  useEffect(() => { if (isAdmin) void load() }, [isAdmin, load])

  if (!ready) return <AppLayout><p>Loading…</p></AppLayout>
  if (!user) return <Navigate to="/login" />
  if (!isAdmin) return <Navigate to="/dashboard" />

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* ignore */ }
  }
  const revoke = async () => {
    if (!window.confirm('Disconnect every Claude session? You will need to authorise Claude again.')) return
    setRevoking(true)
    try { await revokeCrmConnections(); await load() } finally { setRevoking(false) }
  }

  return <AppLayout>
    <div className="space-y-6">
      <header className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Claude</h1>
          <p className="admin-page-subtitle">Claude works inside the CRM through this connector: it reads clients, policies, pipeline, tasks, expenses and commissions, and creates or updates records. It never deletes anything.</p>
        </div>
      </header>

      <section className="admin-panel">
        <div className="admin-panel-head"><h2 className="admin-panel-title">Connection</h2>
          <span className={`admin-chip ${status?.activeConnections ? 'admin-chip--success' : ''}`}>{status ? (status.activeConnections ? `${status.activeConnections} session${status.activeConnections === 1 ? '' : 's'} connected` : 'Not connected yet') : '…'}</span>
        </div>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-[var(--admin-ink)]">
          <li>In Claude, open <strong>Settings → Connectors → Add custom connector</strong>.</li>
          <li>Name: <strong>Adler &amp; Rochefort CRM</strong>. URL:
            <span className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded-lg bg-[var(--admin-page)] border border-[var(--admin-border)] px-3 py-2 text-[13px] break-all">{url}</code>
              <button type="button" className="admin-btn admin-btn-secondary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            </span>
          </li>
          <li>Click <strong>Connect</strong>. This backoffice page opens and asks for authorisation: click <strong>Authorise</strong>.</li>
          <li>Done: on your phone or computer, ask Claude for example “what do I have today?”.</li>
        </ol>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className="admin-btn admin-btn-secondary" onClick={revoke} disabled={revoking || !status?.activeConnections}>{revoking ? 'Disconnecting…' : 'Disconnect all sessions'}</button>
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head"><h2 className="admin-panel-title">Recent activity</h2></div>
        {!status?.activity.length ? <p className="text-sm text-[var(--admin-muted)]">No activity yet.</p> : (
          <ul className="divide-y divide-[var(--admin-border)]">
            {status.activity.map((a, i) => <li key={i} className="py-2.5 flex gap-3 text-sm">
              <span className="w-[118px] shrink-0 text-[var(--admin-muted)] tabular-nums">{new Date(a.created_at).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              <span className="w-[56px] shrink-0 font-semibold">{a.actor === 'claude' ? 'Claude' : 'Hugo'}</span>
              <span className="min-w-0 flex-1 text-[var(--admin-ink)]">{a.summary || a.action}</span>
            </li>)}
          </ul>
        )}
      </section>
    </div>
  </AppLayout>
}
