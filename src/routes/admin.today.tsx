import { useCallback, useEffect, useState } from 'react'
import { createFileRoute, Link, Navigate } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useIdentity } from '@/lib/identity-context'
import { fetchToday, quickAddTask, setTodayTask, type TodayData } from '@/lib/crm-agent/today.functions'

export const Route = createFileRoute('/admin/today')({
  component: TodayPage,
  head: () => ({ meta: [{ title: 'Today · Adler & Rochefort Admin' }] }),
})

type Row = TodayData['new_leads'][number]

const PRODUCT: Record<string, string> = {
  health: 'Health', 'international-health': 'International health', home: 'Home', auto: 'Motor', tvde: 'TVDE', life: 'Life',
  'professional-liability': 'Professional liability', 'event-liability': 'Event liability', 'private-clients': 'Private clients', general: 'General enquiry',
  'insurance-review': 'Insurance review', 'fiscal-representation': 'Fiscal representation',
}
const STAGE: Record<string, string> = { new: 'to contact', contacted: 'contacted', needs_analysis: 'needs analysis', quoted: 'quoted', negotiation: 'negotiation', won: 'won', lost: 'lost' }
const TYPE: Record<string, string> = { property: 'Property', liability: 'Liability', workers_comp: 'Workers compensation', auto: 'Motor', health: 'Health', life: 'Life', other: 'Other' }

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function dayLabel(iso: string, today: string) {
  if (iso === today) return 'Today'
  if (iso === addDays(today, 1)) return 'Tomorrow'
  if (iso === addDays(today, -1)) return 'Yesterday'
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function ago(iso: string) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (mins < 60) return `${Math.max(1, mins)} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/Lisbon' }).format(new Date()))
  return h < 13 ? 'Good morning' : h < 20 ? 'Good afternoon' : 'Good evening'
}

const euro = (v: unknown) => (typeof v === 'number' || typeof v === 'string') && Number(v) ? `${Number(v).toLocaleString('en-GB', { maximumFractionDigits: 0 })} €` : ''

function TodayPage() {
  const { user, ready } = useIdentity()
  const isAdmin = ready && !!user?.roles?.includes('admin')
  const [data, setData] = useState<TodayData | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [newTask, setNewTask] = useState('')

  const load = useCallback(async () => {
    try { setData(await fetchToday()); setError('') } catch (e) { setError(e instanceof Error ? e.message : 'Could not load.') }
  }, [])
  useEffect(() => { if (isAdmin) void load() }, [isAdmin, load])

  if (!ready) return <AppLayout><p>Loading…</p></AppLayout>
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
    { label: 'Overdue', value: t!.overdue.length, tone: t!.overdue.length ? 'danger' : '' },
    { label: 'Due today', value: t!.today.length, tone: '' },
    { label: 'New leads', value: data.new_leads.length, tone: data.new_leads.length ? 'accent' : '' },
    { label: 'Emails to answer', value: data.emails_awaiting_reply.length, tone: '' },
    { label: 'Renewals 60 d', value: data.renewals.length, tone: '' },
  ] : []

  return <AppLayout>
    <div className="today">
      <header className="today-head">
        <div>
          <p className="today-date">{data ? new Date(`${data.today}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : ' '}</p>
          <h1 className="today-title">{greeting()}, {(user.name || 'Hugo').split(' ')[0]}</h1>
        </div>
        <a className="today-claude" href="https://claude.ai/new" target="_blank" rel="noopener noreferrer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" /></svg>
          Ask Claude
        </a>
      </header>

      {error && <p className="admin-chip admin-chip--danger">{error}</p>}
      {!data && !error && <p className="text-sm text-[var(--admin-muted)]">Preparing your day…</p>}

      {data && <>
        <div className="today-counts">
          {counts.map((c) => <div key={c.label} className={`today-count ${c.tone ? `is-${c.tone}` : ''}`}><span className="today-count-value">{c.value}</span><span className="today-count-label">{c.label}</span></div>)}
        </div>

        <div className="today-grid">
          <section className="admin-panel today-card today-card--tasks">
            <div className="admin-panel-head"><h2 className="admin-panel-title">Tasks</h2></div>
            <form className="today-add" onSubmit={add}>
              <input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="New task for today…" aria-label="New task" maxLength={200} />
              <button type="submit" disabled={busy === 'new' || !newTask.trim()}>Add</button>
            </form>
            {[...t!.overdue, ...t!.today, ...t!.next_3_days].length === 0 && <p className="today-empty">No pending tasks. 🎉</p>}
            <ul className="today-list">
              {[...t!.overdue, ...t!.today, ...t!.next_3_days].map((task) => {
                const id = String(task.id)
                const due = String(task.due_date)
                const late = due < data.today
                return <li key={id} className={`today-task ${busy === id ? 'is-busy' : ''}`}>
                  <button type="button" className="today-check" aria-label="Complete" onClick={() => act(id, { status: 'done' })} />
                  <div className="today-task-body">
                    <p className="today-task-title">{Number(task.priority) === 1 && <span className="today-prio" aria-label="Urgent" />}{String(task.title)}</p>
                    <p className="today-task-meta">
                      <span className={late ? 'is-late' : ''}>{dayLabel(due, data.today)}</span>
                      {task.client ? <> · {task.client}</> : null}
                      {task.source === 'renewal' ? ' · renewal' : task.source === 'lead' ? ' · lead' : task.source === 'claude' ? ' · created by Claude' : ''}
                    </p>
                  </div>
                  {due <= data.today && <button type="button" className="today-snooze" onClick={() => act(id, { due_date: addDays(data.today, 1) })}>Tomorrow</button>}
                </li>
              })}
            </ul>
          </section>

          <section className="admin-panel today-card">
            <div className="admin-panel-head"><h2 className="admin-panel-title">New leads</h2><Link to="/admin" search={{ tab: 'sales' }} className="today-more">Pipeline →</Link></div>
            {data.new_leads.length === 0 ? <p className="today-empty">No leads in the last 72 h.</p> : <ul className="today-list">
              {data.new_leads.map((l: Row) => <li key={String(l.id)} className="today-row">
                <div className="today-task-body">
                  <p className="today-task-title">{l.client ?? '—'}</p>
                  <p className="today-task-meta">{PRODUCT[String(l.product)] ?? String(l.product ?? '')} · {ago(String(l.received_at))}{` · ${STAGE[String(l.opportunity_stage ?? 'new')] ?? String(l.opportunity_stage)}`}</p>
                </div>
              </li>)}
            </ul>}
          </section>

          <section className="admin-panel today-card">
            <div className="admin-panel-head"><h2 className="admin-panel-title">Emails to answer</h2></div>
            {data.emails_awaiting_reply.length === 0 ? <p className="today-empty">Nothing waiting for a reply.</p> : <ul className="today-list">
              {data.emails_awaiting_reply.map((m: Row) => <li key={String(m.id)} className="today-row">
                <a className="today-task-body" href={m.gmail_thread_id ? `https://mail.google.com/mail/u/0/#all/${String(m.gmail_thread_id)}` : undefined} target="_blank" rel="noopener noreferrer">
                  <p className="today-task-title">{String(m.subject ?? '(no subject)')}</p>
                  <p className="today-task-meta">{m.client ?? String(m.from_address ?? '')} · {ago(String(m.sent_at))}</p>
                </a>
              </li>)}
            </ul>}
          </section>

          <section className="admin-panel today-card">
            <div className="admin-panel-head"><h2 className="admin-panel-title">Follow-ups and to contact</h2></div>
            {data.follow_ups_due.length + data.opportunities_not_contacted.length === 0 ? <p className="today-empty">Pipeline up to date.</p> : <ul className="today-list">
              {[...data.follow_ups_due, ...data.opportunities_not_contacted.filter((o: Row) => !data.follow_ups_due.some((f: Row) => f.id === o.id))].slice(0, 12).map((o: Row) => <li key={String(o.id)} className="today-row">
                <div className="today-task-body">
                  <p className="today-task-title">{String(o.title)}</p>
                  <p className="today-task-meta">{o.stage === 'new' ? `to contact · ${ago(String(o.created_at))}` : `follow-up · ${STAGE[String(o.stage)] ?? String(o.stage)}`}{euro(o.estimated_annual_premium) ? ` · ${euro(o.estimated_annual_premium)}` : ''}</p>
                </div>
              </li>)}
            </ul>}
          </section>

          <section className="admin-panel today-card">
            <div className="admin-panel-head"><h2 className="admin-panel-title">Renewals (60 days)</h2><Link to="/admin" search={{ tab: 'alerts' }} className="today-more">Renewals →</Link></div>
            {data.renewals.length === 0 ? <p className="today-empty">No renewals in the next 60 days.</p> : <ul className="today-list">
              {data.renewals.slice(0, 12).map((p: Row) => <li key={String(p.id)} className="today-row">
                <div className="today-task-body">
                  <p className="today-task-title">{p.client ?? '—'}</p>
                  <p className="today-task-meta">{TYPE[String(p.type)] ?? String(p.type)} · {String(p.insurer)} · {dayLabel(String(p.end_date), data.today)}{euro(p.annual_premium) ? ` · ${euro(p.annual_premium)}` : ''}</p>
                </div>
              </li>)}
            </ul>}
          </section>

          {data.expenses_to_review > 0 && <section className="admin-panel today-card">
            <div className="admin-panel-head"><h2 className="admin-panel-title">Expenses</h2><Link to="/admin/expenses" className="today-more">Open →</Link></div>
            <p className="today-empty">{data.expenses_to_review} invoice{data.expenses_to_review === 1 ? '' : 's'} waiting for confirmation.</p>
          </section>}
        </div>
      </>}
    </div>
  </AppLayout>
}
