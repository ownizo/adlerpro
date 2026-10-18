import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useIdentity } from '@/lib/identity-context'
import { fetchSiteVisits } from '@/lib/site-visits.functions'
import type { SiteVisitsSummary } from '@/lib/site-visits'

export const Route = createFileRoute('/admin/site-visits')({
  component: SiteVisitsPage,
  head: () => ({ meta: [{ title: 'Visitas do site · Adler & Rochefort Admin' }] }),
})

const PERIODS = [7, 14, 30, 90] as const
const LANG_LABEL: Record<string, string> = {
  pt: 'Português', en: 'Inglês', de: 'Alemão', es: 'Espanhol', nl: 'Neerlandês', fr: 'Francês', it: 'Italiano',
  pl: 'Polaco', se: 'Sueco', dk: 'Dinamarquês', il: 'Hebraico', zh: 'Chinês',
}
const DEVICE_LABEL: Record<string, string> = { mobile: 'Telemóvel', desktop: 'Computador', tablet: 'Tablet' }

function countryName(code: string) {
  if (!/^[A-Z]{2}$/.test(code)) return 'Desconhecido'
  try {
    return new Intl.DisplayNames(['pt-PT'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

function dayLabel(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`)
  return d.toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function seconds(n: number) {
  if (!n) return '—'
  const m = Math.floor(n / 60)
  return m ? `${m} min ${n % 60} s` : `${n} s`
}

function SiteVisitsPage() {
  const { user, ready } = useIdentity()
  const isAdmin = ready && !!user?.roles?.includes('admin')
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30)
  const [data, setData] = useState<SiteVisitsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await fetchSiteVisits({ data: { days } }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as visitas.')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { if (isAdmin) void load() }, [isAdmin, load])

  const maxDay = useMemo(() => Math.max(1, ...(data?.days ?? []).map((d) => d.visits)), [data])
  const today = data?.days.at(-1)
  const yesterday = data?.days.at(-2)

  if (!ready) return <AppLayout><p>A carregar…</p></AppLayout>
  if (!user) return <Navigate to="/login" />
  if (!isAdmin) return <Navigate to="/dashboard" />

  return <AppLayout>
    <div className="space-y-6">
      <header className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Visitas do site</h1>
          <p className="admin-page-subtitle">
            Contagem própria do adlerrochefort.com, sem cookies: conta todas as pessoas, aceitem ou não os cookies (o Google Analytics só conta quem aceita). Robôs excluídos.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)] mb-1">Período</span>
            <select className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-card)] p-2 text-sm" value={days}
              onChange={(e) => setDays(Number(e.target.value) as (typeof PERIODS)[number])}>
              {PERIODS.map((p) => <option key={p} value={p}>Últimos {p} dias</option>)}
            </select>
          </label>
          <button type="button" className="admin-btn admin-btn-secondary" onClick={() => void load()} disabled={loading}>{loading ? 'A atualizar…' : 'Atualizar'}</button>
        </div>
      </header>

      {error && <p className="admin-chip admin-chip--danger">{error}</p>}

      {data && <>
        <section className="admin-kpi-grid" aria-label="Resumo">
          <div className="admin-kpi-card admin-kpi-card--strong">
            <p className="admin-kpi-label">Visitas hoje</p>
            <p className="admin-kpi-value">{today?.visits ?? 0}</p>
            <p className="admin-kpi-note">{today?.pageViews ?? 0} páginas vistas · ontem {yesterday?.visits ?? 0} visitas</p>
          </div>
          <div className="admin-kpi-card">
            <p className="admin-kpi-label">Visitas · últimos {days} dias</p>
            <p className="admin-kpi-value">{data.totals.visits}</p>
            <p className="admin-kpi-note">{data.totals.pageViews} páginas vistas</p>
          </div>
          <div className="admin-kpi-card">
            <p className="admin-kpi-label">Leads · últimos {days} dias</p>
            <p className="admin-kpi-value">{data.totals.leads}</p>
            <p className="admin-kpi-note">{data.totals.visits ? `${((data.totals.leads / data.totals.visits) * 100).toFixed(1)}% das visitas` : '—'}</p>
          </div>
          <div className="admin-kpi-card">
            <p className="admin-kpi-label">Tempo médio por página</p>
            <p className="admin-kpi-value">{seconds(data.totals.avgSeconds)}</p>
            <p className="admin-kpi-note">{data.devices.map((d) => `${DEVICE_LABEL[d.device] ?? d.device} ${d.views}`).join(' · ') || '—'}</p>
          </div>
        </section>

        <section className="admin-panel" aria-labelledby="sv-days">
          <div className="admin-panel-head"><h2 id="sv-days" className="admin-panel-title">Por dia</h2></div>
          <div className="admin-table-wrap overflow-x-auto">
            <table className="admin-table w-full">
              <thead><tr><th>Dia</th><th className="w-[40%]">Visitas</th><th>Páginas</th><th>Do Google</th><th>De IA</th><th>Leads</th></tr></thead>
              <tbody>
                {[...data.days].reverse().map((d) => <tr key={d.date}>
                  <td className="whitespace-nowrap">{dayLabel(d.date)}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="h-2 rounded-full bg-[var(--admin-navy)]" style={{ width: `${Math.max(2, (d.visits / maxDay) * 100)}%`, opacity: d.visits ? 1 : 0.2 }} />
                      <span className="tabular-nums">{d.visits}</span>
                    </div>
                  </td>
                  <td className="tabular-nums">{d.pageViews}</td>
                  <td className="tabular-nums">{d.fromGoogle}</td>
                  <td className="tabular-nums">{d.fromAi}</td>
                  <td className="tabular-nums">{d.leads ? <strong>{d.leads}</strong> : 0}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="admin-panel" aria-labelledby="sv-sources">
            <div className="admin-panel-head"><h2 id="sv-sources" className="admin-panel-title">De onde vêm (entradas no site)</h2></div>
            <table className="admin-table w-full"><tbody>
              {data.sources.length ? data.sources.map((s) => <tr key={s.label}><td>{s.label}</td><td className="text-right tabular-nums">{s.visits}</td></tr>)
                : <tr><td className="text-[var(--admin-muted)]">Ainda sem dados.</td></tr>}
            </tbody></table>
          </section>
          <section className="admin-panel" aria-labelledby="sv-countries">
            <div className="admin-panel-head"><h2 id="sv-countries" className="admin-panel-title">Países</h2></div>
            <table className="admin-table w-full"><tbody>
              {data.countries.length ? data.countries.map((c) => <tr key={c.country}><td>{countryName(c.country)}</td><td className="text-right tabular-nums">{c.visits}</td></tr>)
                : <tr><td className="text-[var(--admin-muted)]">Ainda sem dados.</td></tr>}
            </tbody></table>
          </section>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="admin-panel lg:col-span-2" aria-labelledby="sv-pages">
            <div className="admin-panel-head"><h2 id="sv-pages" className="admin-panel-title">Páginas mais vistas</h2></div>
            <div className="admin-table-wrap overflow-x-auto">
              <table className="admin-table w-full">
                <thead><tr><th>Página</th><th className="text-right">Vistas</th><th className="text-right">Entradas</th></tr></thead>
                <tbody>
                  {data.pages.map((p) => <tr key={p.path}>
                    <td className="max-w-[420px] truncate"><a href={`https://adlerrochefort.com${p.path}`} target="_blank" rel="noopener noreferrer" className="hover:underline">{p.path}</a></td>
                    <td className="text-right tabular-nums">{p.views}</td>
                    <td className="text-right tabular-nums">{p.landings}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          </section>
          <section className="admin-panel" aria-labelledby="sv-langs">
            <div className="admin-panel-head"><h2 id="sv-langs" className="admin-panel-title">Língua da página</h2></div>
            <table className="admin-table w-full"><tbody>
              {data.languages.map((l) => <tr key={l.lang}><td>{LANG_LABEL[l.lang] ?? l.lang}</td><td className="text-right tabular-nums">{l.views}</td></tr>)}
            </tbody></table>
          </section>
        </div>

        <p className="text-xs text-[var(--admin-muted)]">
          Visita = pessoa numa sessão do browser; páginas = páginas vistas. "Entradas" é a página por onde a pessoa chegou ao site.
          Para não contar as suas próprias visitas, abra uma vez no seu telemóvel e computador adlerrochefort.com/?nao-contar=1.
        </p>
      </>}
    </div>
  </AppLayout>
}
