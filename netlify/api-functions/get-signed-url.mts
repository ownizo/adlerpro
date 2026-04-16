import type { Config } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

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
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return Response.json({ error: 'Token inválido' }, { status: 401 })
    }

    const body = await req.json()
    const { path } = body

    if (!path || typeof path !== 'string') {
      return Response.json({ error: 'path é obrigatório' }, { status: 400 })
    }

    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(path, 3600)

    if (error) {
      return Response.json({ error: 'Erro ao gerar URL: ' + error.message }, { status: 500 })
    }

    return Response.json({ url: data.signedUrl })
  } catch (error: any) {
    console.error('get-signed-url error:', error)
    return Response.json({ error: 'Erro interno', details: error.message }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/get-signed-url',
}
