// B2C — URL assinada para UPLOAD de um documento de sinistro.
// A service role é necessária para criar signed upload URLs no Supabase Storage.
import type { Config } from '@netlify/functions'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SB_URL = process.env.VITE_SUPABASE_URL || ''
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function makeAdmin(): SupabaseClient {
  return createClient(SB_URL, SB_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
}

function extractToken(req: Request): string | null {
  const auth = req.headers.get('authorization')
  return auth?.startsWith('Bearer ') ? auth.slice(7) : null
}

export default async (req: Request) => {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })

  const token = extractToken(req)
  if (!token) return Response.json({ error: 'Não autenticado' }, { status: 401 })

  const admin = makeAdmin()
  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Token inválido' }, { status: 401 })

  const body = await req.json() as { storagePath: string }
  const { storagePath } = body

  // Only allow claims/* paths for B2C clients
  const parts = storagePath?.split('/') ?? []
  if (
    !storagePath ||
    storagePath.includes('..') ||
    parts[0] === '' ||
    parts[0] !== 'claims'
  ) {
    return Response.json({ error: 'Caminho de armazenamento inválido' }, { status: 400 })
  }

  const { data: urlData, error: urlErr } = await admin.storage
    .from('documents').createSignedUploadUrl(storagePath)
  if (urlErr) return Response.json({ error: urlErr.message }, { status: 500 })

  return Response.json({ token: urlData.token, path: urlData.path })
}

export const config: Config = { path: '/api/one/upload-url' }
