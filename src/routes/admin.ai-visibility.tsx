import { Fragment, useCallback, useEffect, useState } from 'react'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useIdentity } from '@/lib/identity-context'
import { addAiPrompt, fetchAiVisibility, setAiPromptActive, startAiVisibilityRun } from '@/lib/ai-visibility.functions'
import { ENGINE_LABEL, type Engine, type VisibilitySummary } from '@/lib/ai-visibility'

export const Route = createFileRoute('/admin/ai-visibility')({
  component: AiVisibilityPage,
  head: () => ({ meta: [{ title: 'AI visibility · Adler & Rochefort Admin' }] }),
})

type Data = VisibilitySummary & { since: string; configured: Engine[] }
const PERIODS = [7, 30, 90] as const
const SHOWN: Engine[] = ['CLAUDE', 'CHATGPT', 'GEMINI', 'PERPLEXITY']
const LANG: Record<string, string> = { en: 'EN', pt: 'PT', de: 'DE', es: 'ES', fr: 'FR', nl: 'NL' }

function fmtDay(iso: string | null) {
  if (!iso) return '—'
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function AiVisibilityPage() {
  const { user, ready } = useIdentity()
  const isAdmin = ready && !!user?.roles?.includes('admin')
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30)
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [newPrompt, setNewPrompt] = useState('')

  const load = useCallback(async () => {
    try { setData(await fetchAiVisibility({ data: { days } })); setError('') } catch (e) { setError(e instanceof Error ? e.message : 'Could not load.') }
  }, [days])
  useEffect(() => { if (isAdmin) void load() }, [isAdmin, load])

  if (!ready) return <AppLayout><p>Loading…</p></AppLayout>
  if (!user) return <Navigate to="/login" />
  if (!isAdmin) return <Navigate to="/dashboard" />

  const runNow = async () => {
    setBusy('run'); setNotice('')
    try { const r = await startAiVisibilityRun(); setNotice(`Test started (${r.started.map((e) => ENGINE_LABEL[e]).join(', ')}). It takes 5 to 15 minutes; refresh the page afterwards.`) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed.') }
    finally { setBusy(null) }
  }
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('add'); setError('')
    try { await addAiPrompt({ data: { prompt: newPrompt } }); setNewPrompt(''); setNotice('Question added. Testing it on the assistants takes 1 to 2 minutes; refresh the page afterwards.'); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed.') }
    finally { setBusy(null) }
  }
  const toggle = async (id: string, active: boolean) => {
    setBusy(id)
    try { await setAiPromptActive({ data: { id, active } }); await load() } finally { setBusy(null) }
  }

  return <AppLayout>
    <div className="space-y-6">
      <header className="admin-page-header">
        <div>
          <h1 className="admin-page-title">AI visibility</h1>
          <p className="admin-page-subtitle">How often AI assistants recommend Adler &amp; Rochefort when someone asks these questions. The backoffice asks Claude, ChatGPT, Gemini and Perplexity directly, with web search, every Monday morning.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)] mb-1">Period</span>
            <select className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-card)] p-2 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value) as (typeof PERIODS)[number])}>
              {PERIODS.map((p) => <option key={p} value={p}>Last {p} days</option>)}
            </select>
          </label>
          <button type="button" className="admin-btn admin-btn-primary" onClick={runNow} disabled={busy === 'run'}>{busy === 'run' ? 'Starting…' : 'Test now'}</button>
        </div>
      </header>

      {error && <p className="admin-chip admin-chip--danger">{error}</p>}
      {notice && <p className="sv-focus">{notice}</p>}

      {data && <>
        <div className="aiv-engines" aria-label="Connected assistants">
          {SHOWN.map((e) => <span key={e} className={`aiv-engine ${data.configured.includes(e) ? 'is-on' : ''}`}>{ENGINE_LABEL[e]} · {data.configured.includes(e) ? 'connected' : 'API key missing'}</span>)}
        </div>
        <section className="admin-kpi-grid" aria-label="Summary">
          <div className="admin-kpi-card admin-kpi-card--strong">
            <p className="admin-kpi-label">Visibility</p>
            <p className="admin-kpi-value">{data.totals.visibility}%</p>
            <p className="admin-kpi-note">{data.totals.mentioned} of {data.totals.runs} answers mention us</p>
          </div>
          <div className="admin-kpi-card">
            <p className="admin-kpi-label">Answers citing the site</p>
            <p className="admin-kpi-value">{data.totals.cited}</p>
            <p className="admin-kpi-note">with a link to adlerrochefort.com</p>
          </div>
          <div className="admin-kpi-card">
            <p className="admin-kpi-label">Average position</p>
            <p className="admin-kpi-value">{data.totals.avgPosition ?? '—'}</p>
            <p className="admin-kpi-note">among the brands cited, when we appear</p>
          </div>
          <div className="admin-kpi-card">
            <p className="admin-kpi-label">Last test</p>
            <p className="admin-kpi-value">{fmtDay(data.totals.lastDay)}</p>
            <p className="admin-kpi-note">every Monday morning</p>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="admin-panel">
            <div className="admin-panel-head"><h2 className="admin-panel-title">By assistant</h2></div>
            {data.engines.length === 0 ? <p className="text-sm text-[var(--admin-muted)]">No tests in this period yet. Click "Test now".</p> : (
              <ul className="space-y-3">
                {data.engines.map((e) => <li key={e.engine}>
                  <div className="flex items-baseline justify-between text-sm"><strong>{ENGINE_LABEL[e.engine]}</strong><span className="tabular-nums">{e.visibility}% · {e.mentioned}/{e.runs}{e.avgPosition ? ` · position ${e.avgPosition}` : ''}</span></div>
                  <div className="aiv-bar"><span style={{ width: `${Math.max(2, e.visibility)}%` }} /></div>
                  <p className="text-xs text-[var(--admin-muted)] mt-1">Last: {fmtDay(e.lastDay)} · {e.cited} citing the site</p>
                  {e.errors > 0 && <p className="aiv-engine-error">{e.errors} question{e.errors === 1 ? '' : 's'} without an answer in the last test: {e.lastError}</p>}
                </li>)}
              </ul>
            )}
          </section>
          <section className="admin-panel">
            <div className="admin-panel-head"><h2 className="admin-panel-title">Who appears in the answers</h2></div>
            {data.competitors.length === 0 ? <p className="text-sm text-[var(--admin-muted)]">No data.</p> : (
              <table className="admin-table w-full"><tbody>
                {data.competitors.map((c) => <tr key={c.name} className={c.name === 'Adler & Rochefort' ? 'aiv-own' : ''}>
                  <td>{c.name}</td><td className="text-right tabular-nums">{c.mentions}</td><td className="text-right tabular-nums w-[64px]">{c.share}%</td>
                </tr>)}
              </tbody></table>
            )}
          </section>
        </div>

        <section className="admin-panel">
          <div className="admin-panel-head"><h2 className="admin-panel-title">Tracked questions</h2></div>
          <form className="today-add" onSubmit={add}>
            <input value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} placeholder="New question, as a client would ask it (e.g. Best expat health insurance broker in the Algarve?)" maxLength={500} aria-label="New question" />
            <button type="submit" disabled={busy === 'add' || newPrompt.trim().length < 10}>{busy === 'add' ? 'Adding…' : 'Add and test'}</button>
          </form>
          <div className="admin-table-wrap overflow-x-auto">
            <table className="admin-table ar-stack w-full">
              <thead><tr><th>Question</th><th>Visibility</th>{SHOWN.map((e) => <th key={e} className="text-center">{ENGINE_LABEL[e]}</th>)}<th>Active</th></tr></thead>
              <tbody>
                {data.prompts.map((p) => <Fragment key={p.id}>
                  <tr className={`aiv-row ${p.active ? '' : 'is-off'}`} onClick={() => setOpen(open === p.id ? null : p.id)}>
                    <td className="max-w-[520px]"><span className="aiv-lang">{LANG[p.language ?? ''] ?? p.language}</span> {p.prompt}</td>
                    <td className="tabular-nums">{p.runs ? `${p.visibility}%` : '—'}</td>
                    {SHOWN.map((e) => {
                      const r = p.latest[e]
                      return <td key={e} className="text-center">{!r ? <span className="aiv-dot" title="Not tested">·</span> : r.error ? <span className="aiv-dot is-err" title={r.error}>!</span> : r.mentioned ? <span className="aiv-dot is-yes" title={`Mentioned${r.position ? ` at #${r.position}` : ''}${r.cited ? ' · with link' : ''}`}>{r.position ?? '✓'}</span> : <span className="aiv-dot is-no" title="Not mentioned">✕</span>}</td>
                    })}
                    <td onClick={(ev) => ev.stopPropagation()}><input type="checkbox" checked={p.active} disabled={busy === p.id} onChange={(ev) => toggle(p.id, ev.target.checked)} aria-label="Active" /></td>
                  </tr>
                  {open === p.id && <tr className="aiv-detail"><td colSpan={3 + SHOWN.length}>
                    {SHOWN.filter((e) => p.latest[e]).map((e) => {
                      const r = p.latest[e]!
                      return <div key={e} className="aiv-answer">
                        <p className="aiv-answer-head"><strong>{ENGINE_LABEL[e]}</strong> · {fmtDay(r.day)} · {r.error ? `error: ${r.error}` : r.mentioned ? `mentioned${r.position ? ` (brand #${r.position})` : ''}${r.cited ? ', with a link to the site' : ''}` : 'not mentioned'}{r.competitors.length ? ` · also: ${r.competitors.slice(0, 6).join(', ')}` : ''}</p>
                        {r.excerpt && <p className="aiv-answer-text">{r.excerpt}</p>}
                      </div>
                    })}
                    {!Object.keys(p.latest).length && <p className="text-sm text-[var(--admin-muted)]">No answers in this period yet.</p>}
                  </td></tr>}
                </Fragment>)}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-[var(--admin-muted)]">Number = Adler &amp; Rochefort's position among the brands in the answer (1 = first); ✕ = not present; ! = test error. Tap a question to see the answers.</p>
        </section>
      </>}
    </div>
  </AppLayout>
}
