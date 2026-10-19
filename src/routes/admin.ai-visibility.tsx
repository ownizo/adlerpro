import { Fragment, useCallback, useEffect, useState } from 'react'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useIdentity } from '@/lib/identity-context'
import { addAiPrompt, fetchAiVisibility, setAiPromptActive, startAiVisibilityRun } from '@/lib/ai-visibility.functions'
import { ENGINE_LABEL, type Engine, type VisibilitySummary } from '@/lib/ai-visibility'

export const Route = createFileRoute('/admin/ai-visibility')({
  component: AiVisibilityPage,
  head: () => ({ meta: [{ title: 'Visibilidade em IA · Adler & Rochefort Admin' }] }),
})

type Data = VisibilitySummary & { since: string; configured: Engine[] }
const PERIODS = [7, 30, 90] as const
const SHOWN: Engine[] = ['CLAUDE', 'CHATGPT', 'GEMINI', 'PERPLEXITY']
const LANG: Record<string, string> = { en: 'EN', pt: 'PT', de: 'DE', es: 'ES', fr: 'FR', nl: 'NL' }

function fmtDay(iso: string | null) {
  if (!iso) return '—'
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', timeZone: 'UTC' })
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
    try { setData(await fetchAiVisibility({ data: { days } })); setError('') } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível carregar.') }
  }, [days])
  useEffect(() => { if (isAdmin) void load() }, [isAdmin, load])

  if (!ready) return <AppLayout><p>A carregar…</p></AppLayout>
  if (!user) return <Navigate to="/login" />
  if (!isAdmin) return <Navigate to="/dashboard" />

  const runNow = async () => {
    setBusy('run'); setNotice('')
    try { const r = await startAiVisibilityRun(); setNotice(`Teste iniciado (${r.started.map((e) => ENGINE_LABEL[e]).join(', ')}). Demora 5 a 15 minutos — atualize a página depois.`) }
    catch (e) { setError(e instanceof Error ? e.message : 'Falhou.') }
    finally { setBusy(null) }
  }
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('add'); setError('')
    try { await addAiPrompt({ data: { prompt: newPrompt } }); setNewPrompt(''); setNotice('Pergunta adicionada. O teste nos assistentes demora 1 a 2 minutos — atualize a página depois.'); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Falhou.') }
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
          <h1 className="admin-page-title">Visibilidade em IA</h1>
          <p className="admin-page-subtitle">Com que frequência os assistentes de IA recomendam a Adler &amp; Rochefort quando alguém faz estas perguntas. O backoffice pergunta diretamente ao Claude, ChatGPT, Gemini e Perplexity, com pesquisa web, todas as segundas de manhã.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)] mb-1">Período</span>
            <select className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-card)] p-2 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value) as (typeof PERIODS)[number])}>
              {PERIODS.map((p) => <option key={p} value={p}>Últimos {p} dias</option>)}
            </select>
          </label>
          <button type="button" className="admin-btn admin-btn-primary" onClick={runNow} disabled={busy === 'run'}>{busy === 'run' ? 'A iniciar…' : 'Testar agora'}</button>
        </div>
      </header>

      {error && <p className="admin-chip admin-chip--danger">{error}</p>}
      {notice && <p className="sv-focus">{notice}</p>}

      {data && <>
        <div className="aiv-engines" aria-label="Assistentes ligados">
          {SHOWN.map((e) => <span key={e} className={`aiv-engine ${data.configured.includes(e) ? 'is-on' : ''}`}>{ENGINE_LABEL[e]} · {data.configured.includes(e) ? 'ligado' : 'falta chave da API'}</span>)}
        </div>
        <section className="admin-kpi-grid" aria-label="Resumo">
          <div className="admin-kpi-card admin-kpi-card--strong">
            <p className="admin-kpi-label">Visibilidade</p>
            <p className="admin-kpi-value">{data.totals.visibility}%</p>
            <p className="admin-kpi-note">{data.totals.mentioned} de {data.totals.runs} respostas mencionam-nos</p>
          </div>
          <div className="admin-kpi-card">
            <p className="admin-kpi-label">Respostas que citam o site</p>
            <p className="admin-kpi-value">{data.totals.cited}</p>
            <p className="admin-kpi-note">com link para adlerrochefort.com</p>
          </div>
          <div className="admin-kpi-card">
            <p className="admin-kpi-label">Posição média</p>
            <p className="admin-kpi-value">{data.totals.avgPosition ?? '—'}</p>
            <p className="admin-kpi-note">entre as marcas citadas, quando aparecemos</p>
          </div>
          <div className="admin-kpi-card">
            <p className="admin-kpi-label">Último teste</p>
            <p className="admin-kpi-value">{fmtDay(data.totals.lastDay)}</p>
            <p className="admin-kpi-note">todas as segundas de manhã</p>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="admin-panel">
            <div className="admin-panel-head"><h2 className="admin-panel-title">Por assistente</h2></div>
            {data.engines.length === 0 ? <p className="text-sm text-[var(--admin-muted)]">Ainda sem testes neste período. Carregue em "Testar agora".</p> : (
              <ul className="space-y-3">
                {data.engines.map((e) => <li key={e.engine}>
                  <div className="flex items-baseline justify-between text-sm"><strong>{ENGINE_LABEL[e.engine]}</strong><span className="tabular-nums">{e.visibility}% · {e.mentioned}/{e.runs}{e.avgPosition ? ` · posição ${e.avgPosition}` : ''}</span></div>
                  <div className="aiv-bar"><span style={{ width: `${Math.max(2, e.visibility)}%` }} /></div>
                  <p className="text-xs text-[var(--admin-muted)] mt-1">Último: {fmtDay(e.lastDay)} · {e.cited} com citação do site</p>
                </li>)}
              </ul>
            )}
          </section>
          <section className="admin-panel">
            <div className="admin-panel-head"><h2 className="admin-panel-title">Quem aparece nas respostas</h2></div>
            {data.competitors.length === 0 ? <p className="text-sm text-[var(--admin-muted)]">Sem dados.</p> : (
              <table className="admin-table w-full"><tbody>
                {data.competitors.map((c) => <tr key={c.name} className={c.name === 'Adler & Rochefort' ? 'aiv-own' : ''}>
                  <td>{c.name}</td><td className="text-right tabular-nums">{c.mentions}</td><td className="text-right tabular-nums w-[64px]">{c.share}%</td>
                </tr>)}
              </tbody></table>
            )}
          </section>
        </div>

        <section className="admin-panel">
          <div className="admin-panel-head"><h2 className="admin-panel-title">Perguntas acompanhadas</h2></div>
          <form className="today-add" onSubmit={add}>
            <input value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} placeholder="Nova pergunta, como um cliente a faria (ex.: Best expat health insurance broker in the Algarve?)" maxLength={500} aria-label="Nova pergunta" />
            <button type="submit" disabled={busy === 'add' || newPrompt.trim().length < 10}>{busy === 'add' ? 'A adicionar…' : 'Adicionar e testar'}</button>
          </form>
          <div className="admin-table-wrap overflow-x-auto">
            <table className="admin-table ar-stack w-full">
              <thead><tr><th>Pergunta</th><th>Visibilidade</th>{SHOWN.map((e) => <th key={e} className="text-center">{ENGINE_LABEL[e]}</th>)}<th>Ativa</th></tr></thead>
              <tbody>
                {data.prompts.map((p) => <Fragment key={p.id}>
                  <tr className={`aiv-row ${p.active ? '' : 'is-off'}`} onClick={() => setOpen(open === p.id ? null : p.id)}>
                    <td className="max-w-[520px]"><span className="aiv-lang">{LANG[p.language ?? ''] ?? p.language}</span> {p.prompt}</td>
                    <td className="tabular-nums">{p.runs ? `${p.visibility}%` : '—'}</td>
                    {SHOWN.map((e) => {
                      const r = p.latest[e]
                      return <td key={e} className="text-center">{!r ? <span className="aiv-dot" title="Sem teste">·</span> : r.error ? <span className="aiv-dot is-err" title={r.error}>!</span> : r.mentioned ? <span className="aiv-dot is-yes" title={`Mencionada${r.position ? ` em ${r.position}.º` : ''}${r.cited ? ' · com link' : ''}`}>{r.position ?? '✓'}</span> : <span className="aiv-dot is-no" title="Não mencionada">✕</span>}</td>
                    })}
                    <td onClick={(ev) => ev.stopPropagation()}><input type="checkbox" checked={p.active} disabled={busy === p.id} onChange={(ev) => toggle(p.id, ev.target.checked)} aria-label="Ativa" /></td>
                  </tr>
                  {open === p.id && <tr className="aiv-detail"><td colSpan={3 + SHOWN.length}>
                    {SHOWN.filter((e) => p.latest[e]).map((e) => {
                      const r = p.latest[e]!
                      return <div key={e} className="aiv-answer">
                        <p className="aiv-answer-head"><strong>{ENGINE_LABEL[e]}</strong> · {fmtDay(r.day)} · {r.error ? `erro: ${r.error}` : r.mentioned ? `mencionada${r.position ? ` (${r.position}.ª marca)` : ''}${r.cited ? ', com link para o site' : ''}` : 'não mencionada'}{r.competitors.length ? ` · também: ${r.competitors.slice(0, 6).join(', ')}` : ''}</p>
                        {r.excerpt && <p className="aiv-answer-text">{r.excerpt}</p>}
                      </div>
                    })}
                    {!Object.keys(p.latest).length && <p className="text-sm text-[var(--admin-muted)]">Ainda sem respostas neste período.</p>}
                  </td></tr>}
                </Fragment>)}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-[var(--admin-muted)]">Número = posição da Adler &amp; Rochefort entre as marcas da resposta (1 = primeira); ✕ = não aparece; ! = erro no teste. Toque numa pergunta para ver as respostas.</p>
        </section>
      </>}
    </div>
  </AppLayout>
}
