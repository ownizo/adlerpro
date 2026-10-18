import { supabaseAdmin } from './supabase-admin'
import { dayRange, summarise, type SiteVisitRow, type SiteVisitsSummary } from './site-visits.ts'

const COLUMNS = 'created_at, visit_id, session_id, path, lang, is_landing, source, medium, country, device, duration_seconds'
const PAGE = 1000

export async function getSiteVisitsSummary(days: number): Promise<SiteVisitsSummary> {
  const db = supabaseAdmin
  // first day of the range at 00:00 Lisbon is at most 01:00 UTC; start a day early and let summarise() bucket
  const since = new Date(`${dayRange(days)[0]}T00:00:00Z`).getTime() - 2 * 3600000
  const sinceIso = new Date(since).toISOString()

  const rows: SiteVisitRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('site_visits').select(COLUMNS)
      .gte('created_at', sinceIso).order('created_at', { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw new Error('Não foi possível ler as visitas do site.')
    rows.push(...(data as SiteVisitRow[]))
    if (!data || data.length < PAGE) break
  }

  const { data: leads, error: leadsError } = await db.from('website_leads').select('created_at').gte('created_at', sinceIso)
  if (leadsError) throw new Error('Não foi possível ler os leads.')

  return summarise(rows, (leads ?? []).map((l: { created_at: string }) => l.created_at), days)
}
