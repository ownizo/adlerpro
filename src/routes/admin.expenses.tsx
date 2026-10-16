import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { ExpenseReviewPanel } from '@/components/admin/expenses/ExpenseReviewPanel'
import { useIdentity } from '@/lib/identity-context'
import { EXPENSE_CATEGORIES, expenseCategory } from '@/lib/expense-categories'
import { fetchExpenses } from '@/lib/expenses.functions'
import { extractInvoice, formatDate, formatMoney, formatMonth, uploadInvoice } from '@/lib/expense-client'
import { expensesToCsv, expenseStatusLabel, totalsByCategory } from '@/lib/expense-export'
import type { Expense } from '@/lib/expense-validation'

export const Route = createFileRoute('/admin/expenses')({
  component: ExpensesPage,
  head: () => ({ meta: [{ title: 'Despesas · Adler & Rochefort Admin' }] }),
})

type Period = { mode: 'month'; month: string } | { mode: 'year'; year: string } | { mode: 'all' }
type UploadJob = { key: string; name: string; state: 'uploading' | 'reading' | 'done' | 'error'; message?: string; id?: string }

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function periodRange(p: Period): { from?: string; to?: string } {
  if (p.mode === 'month') return { from: `${p.month}-01`, to: `${p.month}-01` }
  if (p.mode === 'year') return { from: `${p.year}-01-01`, to: `${p.year}-12-01` }
  return {}
}

function periodLabel(p: Period) {
  if (p.mode === 'month') return formatMonth(`${p.month}-01`)
  if (p.mode === 'year') return `ano ${p.year}`
  return 'todo o histórico'
}

const STATUS_CHIP: Record<Expense['status'], string> = {
  processing: 'admin-chip admin-chip--info',
  review: 'admin-chip admin-chip--neutral',
  confirmed: 'admin-chip admin-chip--success',
  failed: 'admin-chip admin-chip--danger',
}

function ExpensesPage() {
  const { user, ready } = useIdentity()
  const isAdmin = ready && !!user?.roles?.includes('admin')
  const [period, setPeriod] = useState<Period>({ mode: 'month', month: currentMonth() })
  const [category, setCategory] = useState('')
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [jobs, setJobs] = useState<UploadJob[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      setExpenses(await fetchExpenses({ data: { ...periodRange(period), ...(category ? { category } : {}) } }))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar as despesas.')
    } finally {
      setLoading(false)
    }
  }, [period, category])

  useEffect(() => { if (isAdmin) void load() }, [isAdmin, load])

  const upsert = useCallback((expense: Expense) => {
    setExpenses((list) => list.some((e) => e.id === expense.id) ? list.map((e) => e.id === expense.id ? expense : e) : [expense, ...list])
  }, [])

  const totals = useMemo(() => {
    const confirmedOrReview = expenses.filter((e) => e.status !== 'processing')
    const sum = (k: 'net_amount' | 'vat_amount' | 'total_amount') => Math.round(confirmedOrReview.reduce((a, e) => a + (e[k] ?? 0), 0) * 100) / 100
    return {
      total: sum('total_amount'), vat: sum('vat_amount'), net: sum('net_amount'),
      count: expenses.length,
      pending: expenses.filter((e) => e.status === 'review' || e.status === 'failed' || e.status === 'processing').length,
    }
  }, [expenses])
  const byCategory = useMemo(() => totalsByCategory(expenses.filter((e) => e.status !== 'processing')), [expenses])

  if (!ready) return <AppLayout><p>A carregar…</p></AppLayout>
  if (!user) return <Navigate to="/login" />
  if (!isAdmin) return <Navigate to="/dashboard" />

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    const list = Array.from(files)
    let lastId: string | null = null
    await Promise.all(list.map(async (file) => {
      const key = crypto.randomUUID()
      const update = (patch: Partial<UploadJob>) => setJobs((js) => js.map((j) => j.key === key ? { ...j, ...patch } : j))
      setJobs((js) => [{ key, name: file.name, state: 'uploading' }, ...js])
      try {
        const id = await uploadInvoice(file)
        update({ state: 'reading', id })
        try {
          const expense = await extractInvoice(id)
          upsert(expense)
          update({ state: 'done' })
        } catch (err) {
          update({ state: 'error', message: err instanceof Error ? err.message : 'A leitura automática falhou.' })
          void load()
        }
        lastId = id
      } catch (err) {
        update({ state: 'error', message: err instanceof Error ? err.message : 'O envio falhou.' })
      }
    }))
    await load()
    // With a single document, go straight to the review.
    if (list.length === 1 && lastId) setSelectedId(lastId)
  }

  function exportCsv() {
    const csv = expensesToCsv(expenses)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const suffix = period.mode === 'month' ? period.month : period.mode === 'year' ? period.year : 'todas'
    a.href = url
    a.download = `despesas-${suffix}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const activeJobs = jobs.filter((j) => j.state !== 'done')
  const years = Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - i))

  return <AppLayout>
    <div className="space-y-6">
      <header className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Despesas</h1>
          <p className="admin-page-subtitle">Fotografe ou carregue as faturas da empresa. A IA lê os dados e arquiva a fatura; reveja e confirme.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="admin-btn admin-btn-primary" onClick={() => cameraInput.current?.click()}>Fotografar fatura</button>
          <button type="button" className="admin-btn admin-btn-secondary" onClick={() => fileInput.current?.click()}>Carregar PDF / imagem</button>
          <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { void handleFiles(e.target.files); e.target.value = '' }} />
          <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.heic" multiple className="hidden"
            onChange={(e) => { void handleFiles(e.target.files); e.target.value = '' }} />
        </div>
      </header>

      {activeJobs.length > 0 && <section className="admin-kpi-card space-y-2" aria-live="polite" aria-label="Envios em curso">
        {activeJobs.map((job) => <div key={job.key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="truncate max-w-[60%]">{job.name}</span>
          <span className="flex items-center gap-2">
            {job.state === 'uploading' && <span className="admin-chip admin-chip--info">A enviar…</span>}
            {job.state === 'reading' && <span className="admin-chip admin-chip--info">A ler a fatura…</span>}
            {job.state === 'error' && <>
              <span className="admin-chip admin-chip--danger">{job.message}</span>
              {job.id && <button type="button" className="admin-btn admin-btn--sm admin-btn-secondary" onClick={() => setSelectedId(job.id!)}>Preencher</button>}
            </>}
            {job.state === 'error' && <button type="button" className="admin-btn admin-btn--sm admin-btn-ghost" aria-label="Fechar" onClick={() => setJobs((js) => js.filter((j) => j.key !== job.key))}>✕</button>}
          </span>
        </div>)}
      </section>}

      <section className="flex flex-wrap items-end gap-3" aria-label="Filtros">
        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)] mb-1">Período</span>
          <select className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-card)] p-2 text-sm" value={period.mode}
            onChange={(e) => {
              const mode = e.target.value
              setPeriod(mode === 'month' ? { mode, month: currentMonth() } : mode === 'year' ? { mode, year: years[0] } : { mode: 'all' })
            }}>
            <option value="month">Mês</option>
            <option value="year">Ano</option>
            <option value="all">Tudo</option>
          </select>
        </label>
        {period.mode === 'month' && <label className="text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)] mb-1">Mês</span>
          <input type="month" className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-card)] p-2 text-sm" value={period.month}
            onChange={(e) => e.target.value && setPeriod({ mode: 'month', month: e.target.value })} />
        </label>}
        {period.mode === 'year' && <label className="text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)] mb-1">Ano</span>
          <select className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-card)] p-2 text-sm" value={period.year}
            onChange={(e) => setPeriod({ mode: 'year', year: e.target.value })}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>}
        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)] mb-1">Tipo de despesa</span>
          <select className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-card)] p-2 text-sm max-w-[260px]" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Todas</option>
            {EXPENSE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <button type="button" className="admin-btn admin-btn-secondary ml-auto" disabled={!expenses.length} onClick={exportCsv}>Exportar CSV</button>
      </section>

      <section className="admin-kpi-grid" aria-label="Resumo">
        <div className="admin-kpi-card admin-kpi-card--strong">
          <p className="admin-kpi-label">Total com IVA · {periodLabel(period)}</p>
          <p className="admin-kpi-value">{formatMoney(totals.total)}</p>
        </div>
        <div className="admin-kpi-card">
          <p className="admin-kpi-label">Base tributável</p>
          <p className="admin-kpi-value">{formatMoney(totals.net)}</p>
        </div>
        <div className="admin-kpi-card">
          <p className="admin-kpi-label">IVA suportado</p>
          <p className="admin-kpi-value">{formatMoney(totals.vat)}</p>
        </div>
        <div className="admin-kpi-card">
          <p className="admin-kpi-label">Documentos · por rever</p>
          <p className="admin-kpi-value">{totals.count} · {totals.pending}</p>
        </div>
      </section>

      {loadError && <p role="alert" className="text-sm text-red-700">{loadError}</p>}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
        <section aria-label="Lista de despesas">
          {loading && !expenses.length ? <p className="text-sm text-[var(--admin-muted)]">A carregar…</p>
            : !expenses.length ? <div className="admin-kpi-card text-sm">
              <p className="font-semibold">Sem despesas em {periodLabel(period)}.</p>
              <p className="text-[var(--admin-muted)]">Use «Fotografar fatura» no telemóvel ou «Carregar PDF / imagem» para arquivar a primeira.</p>
            </div>
            : <>
              {/* Phone: cards */}
              <ul className="space-y-2 md:hidden">
                {expenses.map((e) => <li key={e.id}>
                  <button type="button" onClick={() => setSelectedId(e.id)} className="w-full text-left admin-kpi-card !min-h-0 !gap-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-semibold truncate">{e.supplier_name || e.file_name}</span>
                      <span className="font-semibold whitespace-nowrap">{formatMoney(e.total_amount, e.currency)}</span>
                    </span>
                    <span className="flex items-center justify-between gap-2 text-xs text-[var(--admin-muted)]">
                      <span>{formatDate(e.invoice_date)} · {expenseCategory(e.category).label}</span>
                      <span className={STATUS_CHIP[e.status]}>{expenseStatusLabel(e.status)}</span>
                    </span>
                  </button>
                </li>)}
              </ul>
              {/* Desktop: table */}
              <div className="admin-table-wrap hidden md:block overflow-x-auto">
                <table className="admin-table w-full">
                  <thead><tr>
                    <th>Data</th><th>Fornecedor</th><th>Tipo de despesa</th><th>N.º documento</th>
                    <th className="text-right">Base</th><th className="text-right">IVA</th><th className="text-right">Total</th><th>Estado</th>
                  </tr></thead>
                  <tbody>
                    {expenses.map((e) => <tr key={e.id} className="cursor-pointer" onClick={() => setSelectedId(e.id)}>
                      <td className="whitespace-nowrap">{formatDate(e.invoice_date)}</td>
                      <td><button type="button" className="text-left font-semibold hover:underline" onClick={(ev) => { ev.stopPropagation(); setSelectedId(e.id) }}>{e.supplier_name || e.file_name}</button>
                        {e.description && <div className="text-xs text-[var(--admin-muted)] truncate max-w-[280px]">{e.description}</div>}</td>
                      <td>{expenseCategory(e.category).label}</td>
                      <td className="whitespace-nowrap">{e.invoice_number || '—'}</td>
                      <td className="text-right whitespace-nowrap">{formatMoney(e.net_amount, e.currency)}</td>
                      <td className="text-right whitespace-nowrap">{formatMoney(e.vat_amount, e.currency)}</td>
                      <td className="text-right whitespace-nowrap font-semibold">{formatMoney(e.total_amount, e.currency)}</td>
                      <td><span className={STATUS_CHIP[e.status]}>{expenseStatusLabel(e.status)}</span></td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
            </>}
        </section>

        <aside className="admin-kpi-card !justify-start space-y-3" aria-label="Por tipo de despesa">
          <h2 className="font-semibold text-sm">Por tipo de despesa</h2>
          {!byCategory.length ? <p className="text-sm text-[var(--admin-muted)]">Sem dados no período.</p>
            : <ul className="space-y-2 text-sm">
              {byCategory.map((c) => <li key={c.key}>
                <div className="flex justify-between gap-2"><span>{c.label}</span><span className="font-semibold whitespace-nowrap">{formatMoney(c.total)}</span></div>
                <div className="flex justify-between gap-2 text-xs text-[var(--admin-muted)]"><span>SNC {c.snc} · {c.count} doc.</span><span>IVA {formatMoney(c.vat)}</span></div>
                <div className="h-1.5 mt-1 rounded bg-[var(--admin-page)] overflow-hidden">
                  <div className="h-full bg-[var(--admin-navy)]" style={{ width: `${totals.total > 0 ? Math.max(2, (c.total / totals.total) * 100) : 0}%` }} />
                </div>
              </li>)}
            </ul>}
          <p className="text-xs text-[var(--admin-muted)]">Contas SNC indicativas — o contabilista confirma o lançamento final.</p>
        </aside>
      </div>
    </div>

    {selectedId && <ExpenseReviewPanel
      id={selectedId}
      onClose={() => setSelectedId(null)}
      onChange={(expense) => { upsert(expense) }}
      onDeleted={(id) => { setExpenses((list) => list.filter((e) => e.id !== id)); setSelectedId(null) }}
    />}
  </AppLayout>
}
