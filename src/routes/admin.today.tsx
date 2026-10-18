import { useCallback, useEffect, useState } from 'react'
import { createFileRoute, Link, Navigate } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useIdentity } from '@/lib/identity-context'
import { fetchToday, quickAddTask, setTodayTask, type TodayData } from '@/lib/crm-agent/today.functions'

export const Route = createFileRoute('/admin/today')({
  component: TodayPage,
  head: () => ({ meta: [{ title: 'Hoje · Adler & Rochefort Admin' }] }),
})

type Row = TodayData['new_leads'][number]

const PRODUCT: Record<string, string> = {
  health: 'Saúde', 'international-health': 'Saúde internacional', home: 'Habitação', auto: 'Automóvel', tvde: 'TVDE', life: 'Vida',
  'professional-liability': 'RC profissional', 'event-liability': 'RC eventos', 'private-clients': 'Private clients', general: 'Pedido geral',
  'insurance-review': 'Revisão de seguros', 'fiscal-representation': 'Representação fiscal',
}
const STAGE: Record<string, string> = { new: 'por contactar', contacted: 'contactado', needs_analysis: 'em análise', quoted: 'cotado', negotiation: 'em negociação', won: 'ganho', lost: 'perdido' }
const TYPE: Record<string, string> = { property: 'Habitação/Multirriscos', liability: 'RC', workers_comp: 'Acidentes de trabalho', auto: 'Automóvel', health: 'Saúde', life: 'Vida', other: 'Outro' }

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function dayLabel(iso: string, today: string) {
  if (iso === today) return 'Hoje'
  if (iso === addDays(today, 1)) return 'Amanhã'
  if (iso === addDays(today, -1)) return 'Ontem'
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function ago(iso: string) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (mins < 60) return `há ${Math.max(1, mins)} min`
  const h = Math.round(mins / 60)
  if (h < 24) return `há ${h} h`
  return `há ${Math.round(h / 24)} d`
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/Lisbon' }).format(new Date()))
  return h < 13 ? 'Bom dia' : h < 20 ? 'Boa tarde' : 'Boa noite'
}

const euro = (v: unknown) => (typeof v === 'number' || typeof v === 'string') && Number(v) ? `${Number(v).toLocaleString('pt-PT', { maximumFractionDigits: 0 })} €` : ''

function TodayPage() {
  const { user, ready } = useIdentity()
  const isAdmin = ready && !!user?.roles?.includes('admin')
  const [data, setData] = useState<TodayData | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [newTask, setNewTask] = useState('')

  const load = useCallback(async () => {
    try { setData(await fetchToday()); setError('') } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível carregar.') }
  }, [])
  useEffect(() => { if (isAdmin) void load() }, [isAdmin, load])

  if (!ready) return <AppLayout><p>A carregar…</p></AppLayout>
  if (!user) return <Navigate to="/login" />
  if (!isAdmin) return <Navigate to="/dashboard" />

  const act = async (id: string, change: { status?: 'done' | 'pending'; due_date?: string }) => {
    setBusy(id)
    try { await setTodayTask({ data: { id, ...change } }); await load() } finally { setBusy(null) }
  }
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTask.trim()) return
    setBusy('new')
    try { await quickAddTask({ data: { title: newTask } }); setNewTask(''); await load() } finally { setBusy(null) }
  }

  const t = data?.tasks
  const counts = data ? [
    { label: 'Atrasadas', value: t!.overdue.length, tone: t!.overdue.length ? 'danger' : '' },
    { label: 'Para hoje', value: t!.today.length, tone: '' },
    { label: 'Leads novas', value: data.new_leads.length, tone: data.new_leads.length ? 'accent' : '' },
    { label: 'E-mails por responder', value: data.emails_awaiting_reply.length, tone: '' },
    { label: 'Renovações 60 d', value: data.renewals.length, tone: '' },
  ] : []

  return <AppLayout>
    <div className="today">
      <header className="today-head">
        <div>
          <p className="today-date">{data ? new Date(`${data.today}T12:00:00Z`).toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : ' '}</p>
          <h1 className="today-title">{greeting()}, {(user.name || 'Hugo').split(' ')[0]}</h1>
        </div>
        <a className="today-claude" href="https://claude.ai/new" target="_blank" rel="noopener noreferrer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" /></svg>
          Pedir ao Claude
        </a>
      </header>

      {error && <p className="admin-chip admin-chip--danger">{error}</p>}
      {!data && !error && <p className="text-sm text-[var(--admin-muted)]">A preparar o seu dia…</p>}

      {data && <>
        <div className="today-counts">
          {counts.map((c) => <div key={c.label} className={`today-count ${c.tone ? `is-${c.tone}` : ''}`}><span className="today-count-value">{c.value}</span><span className="today-count-label">{c.label}</span></div>)}
        </div>

        <div className="today-grid">
          <section className="admin-panel today-card today-card--tasks">
            <div className="admin-panel-head"><h2 className="admin-panel-title">Tarefas</h2></div>
            <form className="today-add" onSubmit={add}>
              <input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Nova tarefa para hoje…" aria-label="Nova tarefa" maxLength={200} />
              <button type="submit" disabled={busy === 'new' || !newTask.trim()}>Adicionar</button>
            </form>
            {[...t!.overdue, ...t!.today, ...t!.next_3_days].length === 0 && <p className="today-empty">Sem tarefas pendentes. 🎉</p>}
            <ul className="today-list">
              {[...t!.overdue, ...t!.today, ...t!.next_3_days].map((task) => {
                const id = String(task.id)
                const due = String(task.due_date)
                const late = due < data.today
                return <li key={id} className={`today-task ${busy === id ? 'is-busy' : ''}`}>
                  <button type="button" className="today-check" aria-label="Concluir" onClick={() => act(id, { status: 'done' })} />
                  <div className="today-task-body">
                    <p className="today-task-title">{Number(task.priority) === 1 && <span className="today-prio" aria-label="Urgente" />}{String(task.title)}</p>
                    <p className="today-task-meta">
                      <span className={late ? 'is-late' : ''}>{dayLabel(due, data.today)}</span>
                      {task.client ? <> · {task.client}</> : null}
                      {task.source === 'renewal' ? ' · renovação' : task.source === 'lead' ? ' · lead' : task.source === 'claude' ? ' · criada pelo Claude' : ''}
                    </p>
                  </div>
                  {due <= data.today && <button type="button" className="today-snooze" onClick={() => act(id, { due_date: addDays(data.today, 1) })}>Amanhã</button>}
                </li>
              })}
            </ul>
          </section>

          <section className="admin-panel today-card">
            <div className="admin-panel-head"><h2 className="admin-panel-title">Leads novas</h2><Link to="/admin" search={{ tab: 'sales' }} className="today-more">Pipeline →</Link></div>
            {data.new_leads.length === 0 ? <p className="today-empty">Nenhuma lead nas últimas 72 h.</p> : <ul className="today-list">
              {data.new_leads.map((l: Row) => <li key={String(l.id)} className="today-row">
                <div className="today-task-body">
                  <p className="today-task-title">{l.client ?? '—'}</p>
                  <p className="today-task-meta">{PRODUCT[String(l.product)] ?? String(l.product ?? '')} · {ago(String(l.received_at))}{` · ${STAGE[String(l.opportunity_stage ?? 'new')] ?? String(l.opportunity_stage)}`}</p>
                </div>
              </li>)}
            </ul>}
          </section>

          <section className="admin-panel today-card">
            <div className="admin-panel-head"><h2 className="admin-panel-title">E-mails por responder</h2></div>
            {data.emails_awaiting_reply.length === 0 ? <p className="today-empty">Nada à espera de resposta.</p> : <ul className="today-list">
              {data.emails_awaiting_reply.map((m: Row) => <li key={String(m.id)} className="today-row">
                <a className="today-task-body" href={m.gmail_thread_id ? `https://mail.google.com/mail/u/0/#all/${String(m.gmail_thread_id)}` : undefined} target="_blank" rel="noopener noreferrer">
                  <p className="today-task-title">{String(m.subject ?? '(sem assunto)')}</p>
                  <p className="today-task-meta">{m.client ?? String(m.from_address ?? '')} · {ago(String(m.sent_at))}</p>
                </a>
              </li>)}
            </ul>}
          </section>

          <section className="admin-panel today-card">
            <div className="admin-panel-head"><h2 className="admin-panel-title">Follow-ups e por contactar</h2></div>
            {data.follow_ups_due.length + data.opportunities_not_contacted.length === 0 ? <p className="today-empty">Pipeline em dia.</p> : <ul className="today-list">
              {[...data.follow_ups_due, ...data.opportunities_not_contacted.filter((o: Row) => !data.follow_ups_due.some((f: Row) => f.id === o.id))].slice(0, 12).map((o: Row) => <li key={String(o.id)} className="today-row">
                <div className="today-task-body">
                  <p className="today-task-title">{String(o.title)}</p>
                  <p className="today-task-meta">{o.stage === 'new' ? `por contactar · ${ago(String(o.created_at))}` : `follow-up · ${STAGE[String(o.stage)] ?? String(o.stage)}`}{euro(o.estimated_annual_premium) ? ` · ${euro(o.estimated_annual_premium)}` : ''}</p>
                </div>
              </li>)}
            </ul>}
          </section>

          <section className="admin-panel today-card">
            <div className="admin-panel-head"><h2 className="admin-panel-title">Renovações (60 dias)</h2><Link to="/admin" search={{ tab: 'alerts' }} className="today-more">Renovações →</Link></div>
            {data.renewals.length === 0 ? <p className="today-empty">Nenhuma renovação nos próximos 60 dias.</p> : <ul className="today-list">
              {data.renewals.slice(0, 12).map((p: Row) => <li key={String(p.id)} className="today-row">
                <div className="today-task-body">
                  <p className="today-task-title">{p.client ?? '—'}</p>
                  <p className="today-task-meta">{TYPE[String(p.type)] ?? String(p.type)} · {String(p.insurer)} · {dayLabel(String(p.end_date), data.today)}{euro(p.annual_premium) ? ` · ${euro(p.annual_premium)}` : ''}</p>
                </div>
              </li>)}
            </ul>}
          </section>

          {data.expenses_to_review > 0 && <section className="admin-panel today-card">
            <div className="admin-panel-head"><h2 className="admin-panel-title">Despesas</h2><Link to="/admin/expenses" className="today-more">Abrir →</Link></div>
            <p className="today-empty">{data.expenses_to_review} fatura(s) à espera de confirmação.</p>
          </section>}
        </div>
      </>}
    </div>
  </AppLayout>
}
