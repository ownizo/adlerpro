import type { Context } from '@netlify/functions'
import { supabaseAdmin } from '../../src/lib/supabase-admin'
import { buildTrackedVisit, TRACKED_SITES } from './lib/site-track-shared'

// -----------------------------------------------------------------------------
// /api/site-track — contador de visitas sem cookies para os outros sites do
// grupo (hoje: viagemgarantida.com e guardemar.com). Grava em public.site_visits com a coluna
// `site`, que o módulo Site visits do admin filtra.
//
// O adlerrochefort.com continua a usar o seu próprio /api/metrics/track.
//
// Responde sempre 204 depressa: um contador nunca pode atrasar uma página nem
// mostrar erros ao visitante. As falhas ficam só no log.
// -----------------------------------------------------------------------------

export const config = { path: '/api/site-track' }

const ORIGINS = new Set(TRACKED_SITES.flatMap((s) => [`https://${s}`, `https://www.${s}`]))
const MAX_BODY_BYTES = 4 * 1024

function done(req: Request) {
  const origin = req.headers.get('origin') || ''
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' }
  if (ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'Content-Type'
    headers['Vary'] = 'Origin'
  }
  return new Response(null, { status: 204, headers })
}

export default async function handler(req: Request, context: Context) {
  if (req.method !== 'POST') return done(req)
  const origin = req.headers.get('origin')
  if (origin && !ORIGINS.has(origin)) return done(req)

  const text = await req.text()
  if (text.length > MAX_BODY_BYTES) return done(req)
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return done(req)
  }

  const visit = buildTrackedVisit(body, {
    userAgent: req.headers.get('user-agent') || '',
    country: context?.geo?.country?.code || '',
  })
  if (!visit) return done(req)

  try {
    if (visit.kind === 'start') {
      const { error } = await supabaseAdmin.from('site_visits').upsert(visit.row, { onConflict: 'visit_id', ignoreDuplicates: true })
      if (error) console.log(JSON.stringify({ event: 'site_track_failed', kind: 'start', code: error.code }))
    } else {
      const { error } = await supabaseAdmin
        .from('site_visits')
        .update({ duration_seconds: visit.duration })
        .eq('visit_id', visit.visitId)
        .eq('site', visit.site)
      if (error) console.log(JSON.stringify({ event: 'site_track_failed', kind: 'end', code: error.code }))
    }
  } catch (err) {
    console.log(JSON.stringify({ event: 'site_track_failed', error: (err as Error).name }))
  }
  return done(req)
}
