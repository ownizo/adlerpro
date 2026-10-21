// "Visitas do site" — aggregation of public.site_visits (adlerrochefort.com).
//
// Rows are written by the public site's /api/metrics/track function
// (ownizo/adlerrochefort, netlify/functions/metrics-track.mjs): one row per
// page view by a real browser, cookieless, no IP and no user-agent string.
// Pure functions here so they can be tested without Supabase.

export type SiteVisitRow = {
  created_at: string
  visit_id: string
  session_id: string | null
  path: string
  lang: string | null
  is_landing: boolean
  source: string | null
  medium: string | null
  country: string | null
  device: string | null
  duration_seconds: number | null
}

export type DayStat = { date: string; pageViews: number; visits: number; fromGoogle: number; fromAi: number; leads: number }
export type SiteVisitsSummary = {
  days: DayStat[]
  totals: { pageViews: number; visits: number; leads: number; avgSeconds: number }
  sources: Array<{ label: string; visits: number }>
  pages: Array<{ path: string; views: number; landings: number }>
  countries: Array<{ country: string; visits: number }>
  languages: Array<{ lang: string; views: number }>
  devices: Array<{ device: string; views: number }>
  focusDay?: string
}

const TZ = 'Europe/Lisbon'

export function lisbonDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export function dayRange(days: number, now = new Date()): string[] {
  const out: string[] = []
  const today = lisbonDate(now)
  const base = new Date(`${today}T12:00:00Z`)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 86400000)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

export function sourceLabel(source: string | null, medium: string | null): string {
  const s = source || '(direct)'
  const m = medium || '(none)'
  if (s === '(direct)') return 'Direct (no source)'
  if (m === 'organic') return `Search · ${s.charAt(0).toUpperCase()}${s.slice(1)}`
  if (m === 'ai-assistant') return `AI assistant · ${s}`
  if (m === 'cpc') return `Ads · ${s}`
  if (m === 'social') return `Social media · ${s}`
  if (m === 'referral') return `Other site · ${s}`
  return `${s} / ${m}`
}

function top<T>(map: Map<string, T>, score: (v: T) => number, n: number): Array<[string, T]> {
  return [...map.entries()].sort((a, b) => score(b[1]) - score(a[1])).slice(0, n)
}

/**
 * `focusDay` (YYYY-MM-DD, Lisbon) keeps the per-day table for the whole
 * period but restricts every other figure (totals, sources, pages,
 * countries, languages, devices) to that single day.
 */
export function summarise(rows: SiteVisitRow[], leadDates: string[], days: number, now = new Date(), focusDay?: string): SiteVisitsSummary {
  const full = summariseAll(rows, leadDates, days, now)
  if (!focusDay || !full.days.some((d) => d.date === focusDay)) return full
  const dayRows = rows.filter((r) => lisbonDate(r.created_at) === focusDay)
  const dayLeads = leadDates.filter((l) => lisbonDate(l) === focusDay)
  const focused = summariseAll(dayRows, dayLeads, days, now)
  return { ...focused, days: full.days, focusDay }
}

function summariseAll(rows: SiteVisitRow[], leadDates: string[], days: number, now: Date): SiteVisitsSummary {
  const range = dayRange(days, now)
  const byDay = new Map(range.map((d) => [d, { date: d, pageViews: 0, visits: 0, fromGoogle: 0, fromAi: 0, leads: 0 }]))
  const sessionsByDay = new Map<string, Set<string>>()
  const allSessions = new Set<string>()
  const sources = new Map<string, number>()
  const pages = new Map<string, { views: number; landings: number }>()
  const countries = new Map<string, Set<string>>()
  const languages = new Map<string, number>()
  const devices = new Map<string, number>()
  let durSum = 0
  let durN = 0

  for (const r of rows) {
    const d = lisbonDate(r.created_at)
    const day = byDay.get(d)
    if (!day) continue
    const sid = r.session_id || r.visit_id
    day.pageViews++
    if (!sessionsByDay.has(d)) sessionsByDay.set(d, new Set())
    sessionsByDay.get(d)!.add(sid)
    allSessions.add(sid)
    if (r.is_landing) {
      if (r.source === 'google' && r.medium === 'organic') day.fromGoogle++
      if (r.medium === 'ai-assistant') day.fromAi++
      const label = sourceLabel(r.source, r.medium)
      sources.set(label, (sources.get(label) || 0) + 1)
    }
    const p = pages.get(r.path) || { views: 0, landings: 0 }
    p.views++
    if (r.is_landing) p.landings++
    pages.set(r.path, p)
    const c = r.country || '—'
    if (!countries.has(c)) countries.set(c, new Set())
    countries.get(c)!.add(sid)
    const l = r.lang || 'pt'
    languages.set(l, (languages.get(l) || 0) + 1)
    const dv = r.device || 'desktop'
    devices.set(dv, (devices.get(dv) || 0) + 1)
    if (r.duration_seconds && r.duration_seconds > 0 && r.duration_seconds <= 3600) {
      durSum += r.duration_seconds
      durN++
    }
  }
  for (const [d, set] of sessionsByDay) {
    const day = byDay.get(d)
    if (day) day.visits = set.size
  }
  let leads = 0
  for (const ld of leadDates) {
    const day = byDay.get(lisbonDate(ld))
    if (day) { day.leads++; leads++ }
  }
  const dayList = range.map((d) => byDay.get(d)!)
  return {
    days: dayList,
    totals: {
      pageViews: dayList.reduce((a, d) => a + d.pageViews, 0),
      visits: allSessions.size,
      leads,
      avgSeconds: durN ? Math.round(durSum / durN) : 0,
    },
    sources: top(sources, (v) => v, 50).map(([label, visits]) => ({ label, visits })),
    pages: top(pages, (v) => v.views, 200).map(([path, v]) => ({ path, ...v })),
    countries: top(countries, (v) => v.size, 100).map(([country, v]) => ({ country, visits: v.size })),
    languages: top(languages, (v) => v, 30).map(([lang, views]) => ({ lang, views })),
    devices: top(devices, (v) => v, 3).map(([device, views]) => ({ device, views })),
  }
}
