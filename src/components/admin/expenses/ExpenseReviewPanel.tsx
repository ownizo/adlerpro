import { useEffect, useState } from 'react'
import { EXPENSE_CATEGORIES, expenseCategory } from '@/lib/expense-categories'
import { fetchExpense, fetchExpenseFileUrl, removeExpense, reopenExpenseFn, saveExpense } from '@/lib/expenses.functions'
import { extractInvoice, formatMoney } from '@/lib/expense-client'
import { expenseStatusLabel } from '@/lib/expense-export'
import { expenseWarnings, type Expense, type VatLine } from '@/lib/expense-validation'

type Props = {
  id: string
  onClose: () => void
  onChange: (expense: Expense) => void
  onDeleted: (id: string) => void
}

type Form = {
  supplier_name: string; supplier_nif: string; buyer_nif: string; document_type: string
  invoice_number: string; atcud: string; invoice_date: string; due_date: string; reference_month: string
  category: string; description: string; currency: string
  net_amount: string; vat_amount: string; total_amount: string
  payment_method: string; notes: string
  vat_lines: Array<{ rate: string; base: string; vat: string }>
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const amountText = (v: number | null) => (v === null || v === undefined ? '' : v.toFixed(2).replace('.', ','))

function toForm(e: Expense): Form {
  return {
    supplier_name: s(e.supplier_name), supplier_nif: s(e.supplier_nif), buyer_nif: s(e.buyer_nif),
    document_type: s(e.document_type), invoice_number: s(e.invoice_number), atcud: s(e.atcud),
    invoice_date: s(e.invoice_date), due_date: s(e.due_date),
    reference_month: e.reference_month ? e.reference_month.slice(0, 7) : '',
    category: e.category || 'outros', description: s(e.description), currency: e.currency || 'EUR',
    net_amount: amountText(e.net_amount), vat_amount: amountText(e.vat_amount), total_amount: amountText(e.total_amount),
    payment_method: s(e.payment_method), notes: s(e.notes),
    vat_lines: (e.vat_lines ?? []).map((l: VatLine) => ({ rate: s(l.rate), base: amountText(l.base), vat: amountText(l.vat) })),
  }
}

function fromForm(f: Form): Record<string, unknown> {
  return {
    ...f,
    reference_month: f.reference_month || null,
    vat_lines: f.vat_lines.filter((l) => l.rate || l.base || l.vat).map((l) => ({ rate: l.rate || null, base: l.base || null, vat: l.vat || null })),
  }
}

const PAYMENT_METHODS = ['Cartão', 'Multibanco', 'MB WAY', 'Transferência', 'Débito direto', 'Numerário', 'PayPal']

export function ExpenseReviewPanel({ id, onClose, onChange, onDeleted }: Props) {
  const [expense, setExpense] = useState<Expense | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [file, setFile] = useState<{ url: string; mime: string; name: string } | null>(null)
  const [busy, setBusy] = useState<'' | 'save' | 'confirm' | 'read' | 'delete' | 'reopen'>('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    setExpense(null); setForm(null); setFile(null); setError(''); setNotice('')
    void (async () => {
      try {
        const [e, f] = await Promise.all([fetchExpense({ data: { id } }), fetchExpenseFileUrl({ data: { id } })])
        if (cancelled) return
        setExpense(e); setForm(toForm(e)); setFile(f)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Não foi possível abrir a despesa.')
      }
    })()
    return () => { cancelled = true }
  }, [id])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function apply(e: Expense, message = '') {
    setExpense(e); setForm(toForm(e)); onChange(e); setNotice(message); setError('')
  }

  async function run(kind: typeof busy, action: () => Promise<void>) {
    setBusy(kind); setError(''); setNotice('')
    try { await action() } catch (err) { setError(err instanceof Error ? err.message : 'Ocorreu um erro. Tente novamente.') } finally { setBusy('') }
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f))
  const locked = expense?.status === 'confirmed'
  const warnings = expense ? expenseWarnings(expense) : []
  const cat = expenseCategory(form?.category)

  return <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Rever despesa">
    <button type="button" aria-label="Fechar" className="absolute inset-0 bg-black/40" onClick={onClose} />
    <div className="relative h-full w-full max-w-5xl bg-[var(--admin-page)] shadow-xl flex flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--admin-border)] bg-[var(--admin-card)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-semibold truncate">{expense?.supplier_name || expense?.file_name || 'Despesa'}</h2>
          {expense && <p className="text-xs text-[var(--admin-muted)]">{expenseStatusLabel(expense.status)}{expense.ai_model ? ` · lida por IA` : ''}</p>}
        </div>
        <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>Fechar</button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {!form || !expense ? <p className="p-4 text-sm">{error || 'A carregar…'}</p> : <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
          <section aria-label="Documento original" className="space-y-2">
            <div className="admin-kpi-card !p-2 !min-h-0">
              {!file ? <p className="text-sm p-4">A carregar documento…</p>
                : file.mime === 'application/pdf'
                  ? <object data={file.url} type="application/pdf" className="w-full h-[60vh] lg:h-[75vh] rounded" aria-label={file.name}>
                    <p className="text-sm p-4">Pré-visualização indisponível neste dispositivo. <a className="underline" href={file.url} target="_blank" rel="noopener noreferrer">Abrir PDF</a></p>
                  </object>
                  : <a href={file.url} target="_blank" rel="noopener noreferrer"><img src={file.url} alt={`Fatura ${file.name}`} className="w-full max-h-[75vh] object-contain rounded bg-white" /></a>}
            </div>
            <div className="flex flex-wrap gap-2">
              {file && <a className="admin-btn admin-btn--sm admin-btn-secondary" href={file.url} target="_blank" rel="noopener noreferrer">Abrir original</a>}
              <button type="button" className="admin-btn admin-btn--sm admin-btn-secondary" onClick={async () => {
                try { const f = await fetchExpenseFileUrl({ data: { id, download: true } }); window.location.href = f.url }
                catch { setError('Não foi possível descarregar o ficheiro.') }
              }}>Descarregar</button>
              {!locked && <button type="button" className="admin-btn admin-btn--sm admin-btn-secondary" disabled={!!busy} onClick={() => run('read', async () => {
                apply(await extractInvoice(id), 'Fatura lida novamente. Reveja os dados.')
              })}>{busy === 'read' ? 'A ler…' : 'Ler novamente com IA'}</button>}
            </div>
            {expense.ai_error && expense.status === 'failed' && <p className="text-xs text-red-700">Leitura automática falhou. Preencha os dados manualmente ou tente ler novamente.</p>}
          </section>

          <form className="space-y-4" onSubmit={(ev) => { ev.preventDefault() }}>
            {warnings.length > 0 && !locked && <ul className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 list-disc pl-6">
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>}
            <fieldset disabled={locked || !!busy} className="space-y-4">
              <div className="admin-kpi-card !min-h-0 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Tipo de despesa" full>
                  <select value={form.category} onChange={(e) => set('category', e.target.value)} className={inputCls}>
                    {EXPENSE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label} (SNC {c.snc})</option>)}
                  </select>
                  <span className="block text-xs text-[var(--admin-muted)] mt-1">{cat.hint}</span>
                </Field>
                <Field label="Mês de referência">
                  <input type="month" value={form.reference_month} onChange={(e) => set('reference_month', e.target.value)} className={inputCls} />
                </Field>
                <Field label="Data da fatura">
                  <input type="date" value={form.invoice_date} onChange={(e) => {
                    const v = e.target.value
                    setForm((f) => f ? { ...f, invoice_date: v, reference_month: f.reference_month || v.slice(0, 7) } : f)
                  }} className={inputCls} />
                </Field>
                <Field label="Descrição" full>
                  <input value={form.description} maxLength={2000} onChange={(e) => set('description', e.target.value)} className={inputCls} placeholder="Ex.: Toner HP 305A" />
                </Field>
              </div>

              <div className="admin-kpi-card !min-h-0 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Fornecedor" full><input value={form.supplier_name} maxLength={300} onChange={(e) => set('supplier_name', e.target.value)} className={inputCls} /></Field>
                <Field label="NIF do fornecedor"><input value={form.supplier_nif} maxLength={30} inputMode="numeric" onChange={(e) => set('supplier_nif', e.target.value)} className={inputCls} /></Field>
                <Field label="NIF do adquirente"><input value={form.buyer_nif} maxLength={30} inputMode="numeric" onChange={(e) => set('buyer_nif', e.target.value)} className={inputCls} /></Field>
                <Field label="Tipo de documento"><input value={form.document_type} maxLength={60} onChange={(e) => set('document_type', e.target.value)} className={inputCls} placeholder="Fatura-Recibo" /></Field>
                <Field label="N.º do documento"><input value={form.invoice_number} maxLength={120} onChange={(e) => set('invoice_number', e.target.value)} className={inputCls} /></Field>
                <Field label="ATCUD"><input value={form.atcud} maxLength={120} onChange={(e) => set('atcud', e.target.value)} className={inputCls} /></Field>
                <Field label="Data de vencimento"><input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} className={inputCls} /></Field>
              </div>

              <div className="admin-kpi-card !min-h-0 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Base"><input value={form.net_amount} inputMode="decimal" onChange={(e) => set('net_amount', e.target.value)} className={inputCls} /></Field>
                  <Field label="IVA"><input value={form.vat_amount} inputMode="decimal" onChange={(e) => set('vat_amount', e.target.value)} className={inputCls} /></Field>
                  <Field label={`Total (${form.currency})`}><input value={form.total_amount} inputMode="decimal" onChange={(e) => set('total_amount', e.target.value)} className={`${inputCls} font-semibold`} /></Field>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)] mb-1">Quadro de IVA</p>
                  {form.vat_lines.length === 0 && <p className="text-xs text-[var(--admin-muted)]">Sem discriminação de taxas.</p>}
                  {form.vat_lines.map((l, i) => <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 mb-2">
                    <input aria-label="Taxa (%)" placeholder="Taxa %" value={l.rate} inputMode="decimal" className={inputCls}
                      onChange={(e) => set('vat_lines', form.vat_lines.map((x, j) => j === i ? { ...x, rate: e.target.value } : x))} />
                    <input aria-label="Base" placeholder="Base" value={l.base} inputMode="decimal" className={inputCls}
                      onChange={(e) => set('vat_lines', form.vat_lines.map((x, j) => j === i ? { ...x, base: e.target.value } : x))} />
                    <input aria-label="IVA" placeholder="IVA" value={l.vat} inputMode="decimal" className={inputCls}
                      onChange={(e) => set('vat_lines', form.vat_lines.map((x, j) => j === i ? { ...x, vat: e.target.value } : x))} />
                    <button type="button" className="admin-btn admin-btn--sm admin-btn-ghost" aria-label="Remover taxa"
                      onClick={() => set('vat_lines', form.vat_lines.filter((_, j) => j !== i))}>✕</button>
                  </div>)}
                  <button type="button" className="admin-btn admin-btn--sm admin-btn-secondary" onClick={() => set('vat_lines', [...form.vat_lines, { rate: '23', base: '', vat: '' }])}>Adicionar taxa</button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Forma de pagamento">
                    <input list="expense-payment-methods" value={form.payment_method} maxLength={60} onChange={(e) => set('payment_method', e.target.value)} className={inputCls} />
                    <datalist id="expense-payment-methods">{PAYMENT_METHODS.map((m) => <option key={m} value={m} />)}</datalist>
                  </Field>
                  <Field label="Moeda"><input value={form.currency} maxLength={3} onChange={(e) => set('currency', e.target.value.toUpperCase())} className={inputCls} /></Field>
                </div>
              </div>

              {expense.line_items.length > 0 && <details className="admin-kpi-card !min-h-0 text-sm">
                <summary className="cursor-pointer font-semibold">Linhas da fatura ({expense.line_items.length})</summary>
                <ul className="mt-2 space-y-1">
                  {expense.line_items.map((li, i) => <li key={i} className="flex justify-between gap-2">
                    <span>{li.quantity && li.quantity !== 1 ? `${li.quantity} × ` : ''}{li.description}</span>
                    <span className="whitespace-nowrap">{formatMoney(li.total, expense.currency)}</span>
                  </li>)}
                </ul>
              </details>}

              <Field label="Notas" full>
                <textarea value={form.notes} maxLength={4000} rows={3} onChange={(e) => set('notes', e.target.value)} className={inputCls} />
              </Field>
            </fieldset>

            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            {notice && <p role="status" className="text-sm text-green-800">{notice}</p>}
          </form>
        </div>}
      </div>

      {form && expense && <footer className="flex flex-wrap items-center gap-2 border-t border-[var(--admin-border)] bg-[var(--admin-card)] px-4 py-3">
        {!locked ? <>
          <button type="button" className="admin-btn admin-btn-primary" disabled={!!busy} onClick={() => run('confirm', async () => {
            apply(await saveExpense({ data: { id, fields: fromForm(form), confirm: true } }), 'Despesa confirmada e arquivada.')
          })}>{busy === 'confirm' ? 'A confirmar…' : 'Confirmar e arquivar'}</button>
          <button type="button" className="admin-btn admin-btn-secondary" disabled={!!busy} onClick={() => run('save', async () => {
            apply(await saveExpense({ data: { id, fields: fromForm(form) } }), 'Alterações guardadas.')
          })}>{busy === 'save' ? 'A guardar…' : 'Guardar rascunho'}</button>
        </> : <button type="button" className="admin-btn admin-btn-secondary" disabled={!!busy} onClick={() => run('reopen', async () => {
          apply(await reopenExpenseFn({ data: { id } }), 'Despesa reaberta para edição.')
        })}>Editar</button>}
        <button type="button" className="admin-btn admin-btn-danger ml-auto" disabled={!!busy} onClick={() => {
          if (!window.confirm('Apagar esta despesa e a fatura arquivada? Esta ação não pode ser desfeita.')) return
          void run('delete', async () => { await removeExpense({ data: { id } }); onDeleted(id) })
        }}>{busy === 'delete' ? 'A apagar…' : 'Apagar'}</button>
      </footer>}
    </div>
  </div>
}

const inputCls = 'w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-card)] p-2 text-sm focus:outline-2 focus:outline-[var(--admin-navy)] disabled:bg-[var(--admin-page)]'

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return <label className={`block text-sm ${full ? 'sm:col-span-2' : ''}`}>
    <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)] mb-1">{label}</span>
    {children}
  </label>
}
