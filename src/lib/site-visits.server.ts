import { supabaseAdmin } from './supabase-admin'
import { dayRange, summarise, type SiteKey, type SiteVisitRow, type SiteVisitsSummary } from './site-visits.ts'

const COLUMNS = 'created_at, visit_id, session_id, path, lang, is_landing, source, medium, country, device, duration_seconds'
const PAGE = 1000

export async function getSiteVisitsSummary(days: number, focusDay?: string, site: SiteKey = 'adlerrochefort.com'): Promise<SiteVisitsSummary> {
  const db = supabaseAdmin
  // first day of the range at 00:00 Lisbon is at most 01:00 UTC; start a day early and let summarise() bucket
  const since = new Date(`${dayRange(days)[0]}T00:00:00Z`).getTime() - 2 * 3600000
  const sinceIso = new Date(since).toISOString()

  const rows: SiteVisitRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('site_visits').select(COLUMNS)
      .eq('site', site).gte('created_at', sinceIso).order('created_at', { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw new Error('Could not read the site visits.')
    rows.push(...(data as SiteVisitRow[]))
    if (!data || data.length < PAGE) break
  }

  // Website leads only exist for adlerrochefort.com (Viagem Garantida sells through HelloSafe, no lead forms).
  let leadDates: string[] = []
  if (site === 'adlerrochefort.com') {
    const { data: leads, error: leadsError } = await db.from('website_leads').select('created_at').gte('created_at', sinceIso)
    if (leadsError) throw new Error('Could not read the leads.')
    leadDates = (leads ?? []).map((l: { created_at: string }) => l.created_at)
  }

  return summarise(rows, leadDates, days, new Date(), focusDay, site)
}
