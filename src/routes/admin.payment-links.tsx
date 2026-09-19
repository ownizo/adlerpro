import { useRef, useState } from 'react'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useIdentity } from '@/lib/identity-context'
import { createPremiumPaymentLink } from '@/lib/payment-links.functions'
import { validatePaymentLinkInput, type PaymentLinkInput } from '@/lib/payment-link-validation'

export const Route = createFileRoute('/admin/payment-links')({
  component: PaymentLinkPage,
  head: () => ({ meta: [{ title: 'Payment Link · Adler & Rochefort Admin' }] }),
})

const fields = [
  ['customerName', 'Client name', 200],
  ['customerEmail', 'Client email', 254],
  ['amount', 'Amount (EUR)', 9],
  ['insurer', 'Insurer', 500],
  ['policyReference', 'Policy reference', 500],
] as const

function PaymentLinkPage() {
  const { user, ready } = useIdentity()
  const [form, setForm] = useState({ customerName: '', customerEmail: '', amount: '', insurer: '', policyReference: '' })
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const attempt = useRef<{ fingerprint: string; requestId: string } | null>(null)
  const [error, setError] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const [result, setResult] = useState<Awaited<ReturnType<typeof createPremiumPaymentLink>> | null>(null)

  if (!ready) return <AppLayout><p>Loading…</p></AppLayout>
  if (!user) return <Navigate to="/login" />
  if (!user.roles?.includes('admin')) return <Navigate to="/dashboard" />

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (inFlight.current || result) return
    setError('')
    const fingerprint = JSON.stringify(form)
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: crypto.randomUUID() }
    const data: PaymentLinkInput = { ...form, requestId: attempt.current.requestId }
    try {
      validatePaymentLinkInput(data)
      inFlight.current = true
      setBusy(true)
      setResult(await createPremiumPaymentLink({ data }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create the Payment Link. Please retry.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return <AppLayout>
    <div className="max-w-3xl space-y-6">
      <header className="admin-page-header">
        <div><h1 className="admin-page-title">Payment Link</h1>
          <p className="admin-page-subtitle">Create a one-time payment link for an insurance premium.</p></div>
      </header>
      <form onSubmit={submit} className="admin-kpi-card space-y-4">
        <fieldset disabled={busy || !!result} className="grid grid-cols-1 sm:grid-cols-2 gap-4 disabled:opacity-70">
          {fields.map(([key, label, maxLength]) => <div key={key}>
            <label htmlFor={key} className="block text-sm font-medium text-navy-600 mb-1">{label}</label>
            <input id={key} name={key} required maxLength={maxLength}
              type={key === 'customerEmail' ? 'email' : 'text'}
              inputMode={key === 'amount' ? 'decimal' : undefined}
              aria-describedby={key === 'amount' ? 'amount-help' : undefined}
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-card)] p-3 text-sm focus:outline-2 focus:outline-[var(--admin-navy)]"
              value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} />
            {key === 'amount' && <p id="amount-help" className="text-xs text-navy-400 mt-1">Example: 1248.36. No thousands separators. This is the exact premium in EUR.</p>}
          </div>)}
        </fieldset>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={busy || !!result} className="admin-btn admin-btn-primary disabled:opacity-50">{busy ? 'Creating…' : 'Create Payment Link'}</button>
      </form>
      {result && <section className="admin-kpi-card space-y-3" aria-label="Created Payment Link">
        <p role="status" className="font-semibold">Payment Link created successfully <span className="admin-chip admin-chip--info">{result.livemode ? 'LIVE' : 'TEST'}</span></p>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div><dt>Amount</dt><dd className="font-semibold">{new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(result.amountCents / 100)}</dd></div>
          <div><dt>Insurer</dt><dd className="break-words">{result.insurer}</dd></div>
          <div><dt>Policy reference</dt><dd className="break-words">{result.policyReference}</dd></div>
        </dl>
        <p className="break-all text-sm">{result.url}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="admin-btn admin-btn-primary" onClick={async () => {
            try { await navigator.clipboard.writeText(result.url); setCopyStatus('Link copied.') }
            catch { setCopyStatus('Unable to copy. Select and copy the URL above.') }
          }}>Copy link</button>
          <a className="admin-btn admin-btn-secondary" href={result.url} target="_blank" rel="noopener noreferrer">Open link</a>
          <button type="button" className="admin-btn admin-btn-secondary" onClick={() => { setResult(null); setCopyStatus(''); attempt.current = null }}>Create another link</button>
        </div>
        <p role="status" className="text-sm">{copyStatus}</p>
      </section>}
      <aside className="admin-kpi-card space-y-3 text-sm">
        <div><h2 className="font-semibold">Pass-through premium</h2><p>This payment is collected for subsequent remittance to the insurer. Stripe Invoicing is not used and no VAT or surcharge is added by this form.</p></div>
        <div><h2 className="font-semibold">Stripe processing fee</h2><p>Stripe processing fees are a merchant cost and are not added to the insurance premium charged to the client.</p></div>
      </aside>
    </div>
  </AppLayout>
}
