// B2C — limpa a flag must_change_password do utilizador autenticado.
// Requer Admin API do Supabase (service role).
import type { Config } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.VITE_SUPABASE_URL || ''
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function extractToken(req: Request): string | null {
  const auth = req.headers.get('authorization')
  return auth?.startsWith('Bearer ') ? auth.slice(7) : null
}

export default async (req: Request) => {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })

  const token = extractToken(req)
  if (!token) return Response.json({ error: 'Não autenticado' }, { status: 401 })

  const admin = createClient(SB_URL, SB_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Token inválido' }, { status: 401 })

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { must_change_password: false },
  })
  if (error) return Response.json({ error: 'Falha ao actualizar estado da conta.' }, { status: 500 })

  return Response.json({ success: true })
}

export const config: Config = { path: '/api/one/clear-password' }
