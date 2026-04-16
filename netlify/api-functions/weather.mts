import type { Config } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const OWM_KEY = process.env.OPENWEATHERMAP_API_KEY || ''

// 30-minute in-memory cache keyed by rounded lat/lon
const cache = new Map<string, { data: unknown; ts: number }>()
const CACHE_TTL = 30 * 60 * 1000

function getSupabaseAdmin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function extractToken(req: Request): string | null {
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  const cookie = req.headers.get('cookie') || ''
  const match = cookie.match(/sb-[^=]+-auth-token=([^;]+)/)
  if (!match) return null
  try {
    const raw = decodeURIComponent(match[1])
    const value = raw.startsWith('base64-')
      ? Buffer.from(raw.slice(7), 'base64').toString('utf-8')
      : raw
    const parsed = JSON.parse(value)
    return parsed.access_token || null
  } catch {
    return null
  }
}

const DISTRITO_TO_AREA: Record<string, string> = {
  aveiro: 'AVR',
  beja: 'BJA',
  braga: 'BGC',
  braganca: 'BGN',
  'castelo branco': 'CTB',
  coimbra: 'CBR',
  evora: 'EVR',
  faro: 'FAR',
  guarda: 'GRD',
  leiria: 'LEI',
  lisboa: 'LIS',
  portalegre: 'PTL',
  porto: 'PRT',
  santarem: 'STR',
  setubal: 'STB',
  'viana do castelo': 'VCT',
  'vila real': 'VRL',
  viseu: 'VSU',
  madeira: 'MAD',
  acores: 'AMP',
}

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  try {
    const token = extractToken(req)
    if (!token) {
      return Response.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const supabase = getSupabaseAdmin()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return Response.json({ error: 'Token inválido' }, { status: 401 })
    }

    const body = await req.json()
    const { lat, lon, distrito } = body as { lat?: number; lon?: number; distrito?: string }

    if (lat == null || lon == null) {
      return Response.json({ error: 'Localização obrigatória' }, { status: 400 })
    }

    const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`
    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return Response.json(cached.data)
    }

    const normDistrict = (distrito || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
    const idAreaAviso = DISTRITO_TO_AREA[normDistrict] ?? null

    // Fetch OWM current weather and IPMA warnings in parallel; tolerate partial failures
    const [owmResult, warningsResult] = await Promise.allSettled([
      OWM_KEY
        ? fetch(
            `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OWM_KEY}&units=metric&lang=pt`
          ).then((r) => (r.ok ? r.json() : null))
        : Promise.resolve(null),
      fetch('https://api.ipma.pt/open-data/forecast/warnings/warnings_www.json').then((r) =>
        r.ok ? r.json() : []
      ),
    ])

    const owmData = owmResult.status === 'fulfilled' ? owmResult.value : null
    const allWarnings: unknown[] =
      warningsResult.status === 'fulfilled' ? (warningsResult.value ?? []) : []

    const now = new Date()
    const warnings = allWarnings.filter((w: any) => {
      if (idAreaAviso && w.idAreaAviso !== idAreaAviso) return false
      const end = new Date(w.endTime)
      return end > now
    })

    const result = { owm: owmData, warnings, idAreaAviso }
    cache.set(cacheKey, { data: result, ts: Date.now() })

    return Response.json(result)
  } catch (error: unknown) {
    console.error('weather error:', error)
    return Response.json({ owm: null, warnings: [], idAreaAviso: null })
  }
}

export const config: Config = {
  path: '/api/weather',
}
