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

  if (!ready) return <AppLayout><p>A carregar…</p></AppLayout>
  if (!user) return <Navigate to="/login" />
  if (!isAdmin) return <Navigate to="/dashboard" />

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* ignore */ }
  }
  const revoke = async () => {
    if (!window.confirm('Desligar todas as sessões do Claude? Terá de voltar a autorizar no Claude.')) return
    setRevoking(true)
    try { await revokeCrmConnections(); await load() } finally { setRevoking(false) }
  }

  return <AppLayout>
    <div className="space-y-6">
      <header className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Claude</h1>
          <p className="admin-page-subtitle">O Claude trabalha dentro do CRM através deste conector: lê clientes, apólices, pipeline, tarefas, despesas e comissões, e cria ou atualiza registos. Nunca apaga nada.</p>
        </div>
      </header>

      <section className="admin-panel">
        <div className="admin-panel-head"><h2 className="admin-panel-title">Ligação</h2>
          <span className={`admin-chip ${status?.activeConnections ? 'admin-chip--success' : ''}`}>{status ? (status.activeConnections ? `${status.activeConnections} sessão(ões) ligada(s)` : 'Ainda não ligado') : '…'}</span>
        </div>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-[var(--admin-ink)]">
          <li>No Claude, abra <strong>Definições → Conectores → Adicionar conector personalizado</strong>.</li>
          <li>Nome: <strong>Adler &amp; Rochefort CRM</strong>. URL:
            <span className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded-lg bg-[var(--admin-page)] border border-[var(--admin-border)] px-3 py-2 text-[13px] break-all">{url}</code>
              <button type="button" className="admin-btn admin-btn-secondary" onClick={copy}>{copied ? 'Copiado' : 'Copiar'}</button>
            </span>
          </li>
          <li>Carregue em <strong>Ligar</strong>. Abre esta página do backoffice a pedir autorização — carregue em <strong>Autorizar</strong>.</li>
          <li>Pronto: no telemóvel ou no computador, peça ao Claude por exemplo “o que tenho hoje?”.</li>
        </ol>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className="admin-btn admin-btn-secondary" onClick={revoke} disabled={revoking || !status?.activeConnections}>{revoking ? 'A desligar…' : 'Desligar todas as sessões'}</button>
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head"><h2 className="admin-panel-title">Atividade recente</h2></div>
        {!status?.activity.length ? <p className="text-sm text-[var(--admin-muted)]">Ainda sem atividade.</p> : (
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
