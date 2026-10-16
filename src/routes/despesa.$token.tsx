import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { invoiceMime, prepareInvoiceFile } from '@/lib/expense-image'

// Public phone page opened from the WhatsApp link: photograph an invoice,
// it is uploaded, read by AI and archived. No login — the secret token in the
// URL is the credential (checked server-side on every call).

export const Route = createFileRoute('/despesa/$token')({
  component: CapturePage,
  head: () => ({
    meta: [
      { title: 'Registar despesa · Adler & Rochefort' },
      { name: 'robots', content: 'noindex, nofollow' },
      { name: 'referrer', content: 'no-referrer' },
    ],
  }),
})

type Recent = { id: string; status: string; supplier_name: string | null; total_amount: number | null; currency: string; invoice_date: string | null; created_at: string }
type Result = { status: string; supplier_name?: string | null; invoice_date?: string | null; total_amount?: number | null; currency?: string; error?: string }
type Phase =
  | { kind: 'loading' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ready' }
  | { kind: 'uploading' }
  | { kind: 'reading' }
  | { kind: 'done'; result: Result }
  | { kind: 'error'; message: string }

const NAVY = '#17243D'
const GOLD = '#C8961A'

async function call(token: string, payload: Record<string, unknown>) {
  const res = await fetch('/api/expense-capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, ...payload }),
  })
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json')
  const body = isJson ? await res.json() : null
  if (!res.ok) {
    const err = new Error(body?.error || 'Não foi possível comunicar com o servidor.') as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return body
}

function money(v: number | null | undefined, currency = 'EUR') {
  if (v === null || v === undefined) return ''
  try { return new Intl.NumberFormat('pt-PT', { style: 'currency', currency }).format(v) } catch { return `${v} ${currency}` }
}
function day(v: string | null | undefined) {
  if (!v) return ''
  const [y, m, d] = v.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function CapturePage() {
  const { token } = Route.useParams()
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [label, setLabel] = useState('')
  const [recent, setRecent] = useState<Recent[]>([])
  const camera = useRef<HTMLInputElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function refresh() {
    try {
      const data = await call(token, { action: 'check' })
      setLabel(data.label)
      setRecent(data.recent ?? [])
      return true
    } catch (err) {
      setPhase({ kind: 'invalid', message: err instanceof Error ? err.message : 'Link inválido.' })
      return false
    }
  }

  useEffect(() => {
    void refresh().then((ok) => { if (ok) setPhase({ kind: 'ready' }) })
    return () => { if (closeTimer.current) clearTimeout(closeTimer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function send(original: File) {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setPhase({ kind: 'uploading' })
    let id: string | null = null
    try {
      const file = await prepareInvoiceFile(original)
      const mime = invoiceMime(file)
      const started = await call(token, { action: 'start', fileName: file.name, mime, size: file.size })
      id = started.id
      const { error } = await supabase.storage.from('expenses').uploadToSignedUrl(started.path, started.token, file, { contentType: mime })
      if (error) {
        await call(token, { action: 'cancel', id }).catch(() => {})
        throw new Error('O envio falhou. Verifique a ligação à internet e tente novamente.')
      }
      setPhase({ kind: 'reading' })
      const result: Result = await call(token, { action: 'process', id })
      setPhase({ kind: 'done', result })
      void refresh()
      if (result.status === 'confirmed') {
        // Done: try to close the tab (works when opened from a link); otherwise
        // return to the start screen so the next invoice is one tap away.
        closeTimer.current = setTimeout(() => {
          window.close()
          setPhase({ kind: 'ready' })
        }, 4000)
      }
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : 'Ocorreu um erro. Tente novamente.' })
    }
  }

  function onPick(files: FileList | null) {
    const file = files?.[0]
    if (file) void send(file)
  }

  const busy = phase.kind === 'uploading' || phase.kind === 'reading'

  return <main style={{ minHeight: '100dvh', background: '#F6F4EF', color: NAVY, fontFamily: 'Montserrat, system-ui, sans-serif' }}
    className="flex flex-col">
    <header style={{ background: NAVY }} className="px-5 py-4 flex items-center gap-3">
      <img src="/lion-app-icon.png" alt="" width={32} height={32} className="rounded" />
      <div>
        <p className="text-white font-semibold leading-tight">Adler &amp; Rochefort</p>
        <p className="text-xs leading-tight" style={{ color: GOLD }}>Registo de despesas{label ? ` · ${label}` : ''}</p>
      </div>
    </header>

    <section className="flex-1 flex flex-col items-center justify-center px-6 py-8 text-center gap-6">
      {phase.kind === 'loading' && <p>A abrir…</p>}

      {phase.kind === 'invalid' && <div className="space-y-2">
        <p className="text-lg font-semibold">Link indisponível</p>
        <p className="text-sm opacity-80">{phase.message}</p>
      </div>}

      {(phase.kind === 'ready' || phase.kind === 'error') && <>
        <div className="space-y-2 max-w-sm">
          <p className="text-2xl font-semibold">Fotografar fatura</p>
          <p className="text-sm opacity-80">Enquadre a fatura inteira, com boa luz. A fatura é lida automaticamente e arquivada.</p>
        </div>
        {phase.kind === 'error' && <p role="alert" className="text-sm rounded-lg px-4 py-3 bg-red-50 text-red-800 max-w-sm">{phase.message}</p>}
        <button type="button" onClick={() => camera.current?.click()}
          style={{ background: NAVY }} className="w-full max-w-sm rounded-2xl py-5 text-white text-lg font-semibold shadow-lg active:scale-[0.98] transition">
          📷  Tirar foto
        </button>
        <button type="button" onClick={() => picker.current?.click()}
          style={{ borderColor: NAVY }} className="w-full max-w-sm rounded-2xl py-3 border text-sm font-semibold">
          Escolher foto ou PDF
        </button>
      </>}

      {busy && <div className="space-y-4" aria-live="polite">
        <div className="mx-auto h-14 w-14 rounded-full border-4 animate-spin" style={{ borderColor: `${GOLD} transparent ${GOLD} ${GOLD}` }} />
        <p className="text-lg font-semibold">{phase.kind === 'uploading' ? 'A enviar a fatura…' : 'A ler a fatura…'}</p>
        <p className="text-sm opacity-70">Não feche esta página.</p>
      </div>}

      {phase.kind === 'done' && <div className="space-y-4 max-w-sm w-full" aria-live="polite">
        <div className="mx-auto h-20 w-20 rounded-full flex items-center justify-center text-white text-4xl"
          style={{ background: phase.result.status === 'confirmed' ? '#1F7A4D' : GOLD }}>✓</div>
        <p className="text-2xl font-semibold">{phase.result.status === 'confirmed' ? 'Confirmada' : 'Fatura arquivada'}</p>
        {(phase.result.supplier_name || phase.result.total_amount != null) && <div className="rounded-xl bg-white px-4 py-3 text-left shadow-sm">
          {phase.result.supplier_name && <p className="font-semibold">{phase.result.supplier_name}</p>}
          <p className="text-sm opacity-80">{[day(phase.result.invoice_date), money(phase.result.total_amount, phase.result.currency)].filter(Boolean).join(' · ')}</p>
        </div>}
        {phase.result.status !== 'confirmed' && <p className="text-sm opacity-80">
          {phase.result.status === 'failed' ? 'Não foi possível ler todos os dados. ' : 'Alguns dados precisam de ser verificados. '}
          A foto ficou guardada e pode ser revista no backoffice.
        </p>}
        <div className="flex gap-3">
          <button type="button" onClick={() => { if (closeTimer.current) clearTimeout(closeTimer.current); camera.current?.click() }}
            style={{ background: NAVY }} className="flex-1 rounded-2xl py-4 text-white font-semibold">Outra fatura</button>
          <button type="button" onClick={() => { if (closeTimer.current) clearTimeout(closeTimer.current); window.close(); setPhase({ kind: 'ready' }) }}
            style={{ borderColor: NAVY }} className="flex-1 rounded-2xl py-4 border font-semibold">Fechar</button>
        </div>
      </div>}

      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" disabled={busy}
        onChange={(e) => { onPick(e.target.files); e.target.value = '' }} />
      <input ref={picker} type="file" accept="image/*,application/pdf,.pdf,.heic" className="hidden" disabled={busy}
        onChange={(e) => { onPick(e.target.files); e.target.value = '' }} />
    </section>

    {recent.length > 0 && (phase.kind === 'ready' || phase.kind === 'error') && <section className="px-6 pb-8">
      <p className="text-xs font-semibold uppercase tracking-wide opacity-60 mb-2">Últimos envios</p>
      <ul className="space-y-2">
        {recent.map((r) => <li key={r.id} className="rounded-lg bg-white px-3 py-2 flex justify-between gap-2 text-sm shadow-sm">
          <span className="truncate">{r.supplier_name || 'Fatura'}{r.invoice_date ? ` · ${day(r.invoice_date)}` : ''}</span>
          <span className="whitespace-nowrap">{money(r.total_amount, r.currency)} {r.status === 'confirmed' ? '✓' : '•'}</span>
        </li>)}
      </ul>
    </section>}
  </main>
}
