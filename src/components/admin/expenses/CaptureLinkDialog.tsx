import { useEffect, useState } from 'react'
import { createCaptureLinkFn, fetchCaptureLinks, revokeCaptureLinkFn } from '@/lib/expenses.functions'
import { CAPTURE_EXPIRY_OPTIONS } from '@/lib/expense-capture'
import { formatDate } from '@/lib/expense-client'

type Link = Awaited<ReturnType<typeof fetchCaptureLinks>>[number]
type Created = Awaited<ReturnType<typeof createCaptureLinkFn>>

const inputCls = 'w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-card)] p-2 text-sm focus:outline-2 focus:outline-[var(--admin-navy)]'

function QrCode({ value }: { value: string }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let cancelled = false
    void import('qrcode').then((QR) => QR.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#17243D', light: '#FFFFFF' } }))
      .then((out) => { if (!cancelled) setSvg(out) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [value])
  if (!svg) return <div className="h-56 w-56 rounded-lg bg-[var(--admin-page)]" />
  return <div className="h-56 w-56 rounded-lg bg-white p-2 border border-[var(--admin-border)]" role="img" aria-label="Código QR do link" dangerouslySetInnerHTML={{ __html: svg }} />
}

export function CaptureLinkDialog({ onClose }: { onClose: () => void }) {
  const [label, setLabel] = useState('Telemóvel Hugo')
  const [email, setEmail] = useState('hugo@adlerrochefort.com')
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
    if (busy) return
    setBusy(true); setError('')
    try {
      setCreated(await createCaptureLinkFn({ data: { label, email: email.trim() || null, expiryDays } }))
      void loadLinks()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar o link.')
    } finally {
      setBusy(false)
    }
  }

  const now = Date.now()
  const active = links.filter((l) => !l.revoked_at && Date.parse(l.expires_at) > now)

  return <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Link para o telemóvel">
    <button type="button" aria-label="Fechar" className="absolute inset-0 bg-black/40" onClick={onClose} />
    <div className="relative w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-[var(--admin-card)] p-5 space-y-4 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-lg">Link para o telemóvel</h2>
          <p className="text-sm text-[var(--admin-muted)]">Abre no telemóvel uma página para fotografar faturas, sem login. As faturas ficam arquivadas aqui.</p>
        </div>
        <button type="button" className="admin-btn admin-btn-ghost admin-btn--sm" onClick={onClose} aria-label="Fechar">✕</button>
      </div>

      {!created ? <form onSubmit={create} className="space-y-3">
        <label className="block text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)] mb-1">Nome do link</span>
          <input className={inputCls} value={label} maxLength={120} required onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)] mb-1">Enviar também por email (opcional)</span>
          <input className={inputCls} value={email} type="email" inputMode="email" autoComplete="email" onChange={(e) => setEmail(e.target.value)} placeholder="email que lê no telemóvel" />
        </label>
        <label className="block text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)] mb-1">Validade</span>
          <select className={inputCls} value={expiryDays} onChange={(e) => setExpiryDays(Number(e.target.value))}>
            {CAPTURE_EXPIRY_OPTIONS.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
          </select>
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button type="submit" className="admin-btn admin-btn-primary w-full" disabled={busy}>{busy ? 'A criar…' : 'Criar link'}</button>
        <p className="text-xs text-[var(--admin-muted)]">Quem tiver o link pode enviar faturas (não vê as restantes despesas). Pode desativá-lo a qualquer momento.</p>
      </form> : <div className="space-y-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <QrCode value={created.url} />
          <p className="text-sm font-semibold">Aponte a câmara do telemóvel para o código</p>
          <p className="text-xs text-[var(--admin-muted)]">O link abre diretamente no telemóvel. Guarde-o nos favoritos do browser para o usar sempre.</p>
        </div>
        {created.emailed && <p className="text-sm rounded-lg bg-green-50 text-green-900 p-3">Link enviado para <strong>{created.link.sent_to}</strong>. Abra o email no telemóvel e toque em «Fotografar fatura».</p>}
        {created.emailError && <p role="alert" className="text-sm rounded-lg bg-amber-50 text-amber-900 p-3">{created.emailError}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="admin-btn admin-btn-secondary" onClick={async () => {
            try { await navigator.clipboard.writeText(created.url); setCopied('Link copiado.') } catch { setCopied(created.url) }
          }}>Copiar link</button>
          <button type="button" className="admin-btn admin-btn-ghost" onClick={() => { setCreated(null); setCopied('') }}>Criar outro</button>
          <button type="button" className="admin-btn admin-btn-primary ml-auto" onClick={onClose}>Concluído</button>
        </div>
        {copied && <p className="text-xs break-all">{copied}</p>}
        <p className="text-xs text-[var(--admin-muted)]">Por segurança, o link só é mostrado agora. Se o perder, crie um novo e desative o antigo.</p>
      </div>}

      {active.length > 0 && <section className="space-y-2 border-t border-[var(--admin-border)] pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Links ativos</h3>
        <ul className="space-y-2">
          {active.map((l) => <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0">
              <span className="font-semibold">{l.label}</span>{l.sent_to && <span className="text-[var(--admin-muted)]"> {l.sent_to}</span>}
              <span className="block text-xs text-[var(--admin-muted)]">Criado {formatDate(l.created_at)} · válido até {formatDate(l.expires_at)} · {l.uploads_count} envio(s){l.last_used_at ? ` · último ${formatDate(l.last_used_at)}` : ''}</span>
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
