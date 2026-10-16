import { useEffect, useState } from 'react'
import { createCaptureLinkFn, fetchCaptureLinks, revokeCaptureLinkFn } from '@/lib/expenses.functions'
import { CAPTURE_EXPIRY_OPTIONS } from '@/lib/expense-capture'
import { formatDate } from '@/lib/expense-client'

type Link = Awaited<ReturnType<typeof fetchCaptureLinks>>[number]
type Created = Awaited<ReturnType<typeof createCaptureLinkFn>>

const inputCls = 'w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-card)] p-2 text-sm focus:outline-2 focus:outline-[var(--admin-navy)]'

export function CaptureLinkDialog({ onClose }: { onClose: () => void }) {
  const [label, setLabel] = useState('Telemóvel Hugo')
  const [phone, setPhone] = useState('+351 ')
  const [expiryDays, setExpiryDays] = useState<number>(365)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<Created | null>(null)
  const [copied, setCopied] = useState('')
  const [links, setLinks] = useState<Link[]>([])

  async function loadLinks() {
    try { setLinks(await fetchCaptureLinks()) } catch { /* list is optional */ }
  }
  useEffect(() => { void loadLinks() }, [])
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function create(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    // Open the tab synchronously so the browser does not block it as a pop-up.
    const tab = window.open('', '_blank')
    try {
      const result = await createCaptureLinkFn({ data: { label, phone, expiryDays } })
      setCreated(result)
      if (tab) tab.location.href = result.whatsappUrl
      void loadLinks()
    } catch (err) {
      tab?.close()
      setError(err instanceof Error ? err.message : 'Não foi possível criar o link.')
    } finally {
      setBusy(false)
    }
  }

  const now = Date.now()
  const active = links.filter((l) => !l.revoked_at && Date.parse(l.expires_at) > now)

  return <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Enviar link por WhatsApp">
    <button type="button" aria-label="Fechar" className="absolute inset-0 bg-black/40" onClick={onClose} />
    <div className="relative w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-[var(--admin-card)] p-5 space-y-4 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-lg">Enviar link por WhatsApp</h2>
          <p className="text-sm text-[var(--admin-muted)]">O link abre no telemóvel uma página para fotografar faturas, sem login. As faturas ficam arquivadas aqui.</p>
        </div>
        <button type="button" className="admin-btn admin-btn-ghost admin-btn--sm" onClick={onClose}>✕</button>
      </div>

      {!created ? <form onSubmit={create} className="space-y-3">
        <label className="block text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)] mb-1">Nome do link</span>
          <input className={inputCls} value={label} maxLength={120} required onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)] mb-1">Número de telefone (WhatsApp)</span>
          <input className={inputCls} value={phone} type="tel" inputMode="tel" autoComplete="tel" required onChange={(e) => setPhone(e.target.value)} placeholder="+351 912 345 678" />
        </label>
        <label className="block text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)] mb-1">Validade</span>
          <select className={inputCls} value={expiryDays} onChange={(e) => setExpiryDays(Number(e.target.value))}>
            {CAPTURE_EXPIRY_OPTIONS.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
          </select>
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button type="submit" className="admin-btn admin-btn-primary w-full" disabled={busy}>{busy ? 'A criar…' : 'Criar link e abrir WhatsApp'}</button>
        <p className="text-xs text-[var(--admin-muted)]">Quem tiver o link pode enviar faturas (não pode ver as restantes despesas). Pode desativá-lo a qualquer momento.</p>
      </form> : <div className="space-y-3">
        <p className="text-sm rounded-lg bg-green-50 text-green-900 p-3">Link criado. O WhatsApp abriu numa nova janela com a mensagem pronta — basta carregar em enviar.</p>
        <div className="flex flex-wrap gap-2">
          <a className="admin-btn admin-btn-primary" href={created.whatsappUrl} target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a>
          <button type="button" className="admin-btn admin-btn-secondary" onClick={async () => {
            try { await navigator.clipboard.writeText(created.url); setCopied('Link copiado.') } catch { setCopied('Copie manualmente: ' + created.url) }
          }}>Copiar link</button>
          <button type="button" className="admin-btn admin-btn-ghost" onClick={() => { setCreated(null); setCopied('') }}>Criar outro</button>
        </div>
        {copied && <p className="text-xs break-all">{copied}</p>}
        <p className="text-xs text-[var(--admin-muted)]">Por segurança, o link só é mostrado agora. Se o perder, crie um novo e desative o antigo.</p>
      </div>}

      {active.length > 0 && <section className="space-y-2 border-t border-[var(--admin-border)] pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Links ativos</h3>
        <ul className="space-y-2">
          {active.map((l) => <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0">
              <span className="font-semibold">{l.label}</span> <span className="text-[var(--admin-muted)]">{l.phone}</span>
              <span className="block text-xs text-[var(--admin-muted)]">Válido até {formatDate(l.expires_at)} · {l.uploads_count} envio(s){l.last_used_at ? ` · último ${formatDate(l.last_used_at)}` : ''}</span>
            </span>
            <button type="button" className="admin-btn admin-btn--sm admin-btn-danger" onClick={async () => {
              if (!window.confirm(`Desativar o link «${l.label}»? Deixará de funcionar no telemóvel.`)) return
              try { await revokeCaptureLinkFn({ data: { id: l.id } }); void loadLinks() } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao desativar.') }
            }}>Desativar</button>
          </li>)}
        </ul>
      </section>}
    </div>
  </div>
}
