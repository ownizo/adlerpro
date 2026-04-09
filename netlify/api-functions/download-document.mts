import type { Config } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function getSupabaseAdmin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function decodeKey(rawKey: string): string {
  try {
    return decodeURIComponent(rawKey)
  } catch {
    return rawKey
  }
}

function parseStorageKey(input: string): { bucket: string; path: string }[] {
  const key = input.trim().replace(/^\/+/, '')
  if (!key) return []

  const candidates: { bucket: string; path: string }[] = []
  const pushUnique = (bucket: string, path: string) => {
    if (!path) return
    if (!candidates.some((item) => item.bucket === bucket && item.path === path)) {
      candidates.push({ bucket, path })
    }
  }

  if (key.startsWith('documents/')) {
    pushUnique('documents', key.slice('documents/'.length))
  }
  if (key.startsWith('avatars/')) {
    pushUnique('avatars', key.slice('avatars/'.length))
  }

  pushUnique('documents', key)
  pushUnique('avatars', key)
  return candidates
}

export default async (req: Request) => {
  const url = new URL(req.url)
  const rawKey = url.searchParams.get('key')

  if (!rawKey) {
    return new Response('Missing key', { status: 400 })
  }

  const key = decodeKey(rawKey)

  if (key.startsWith('http://') || key.startsWith('https://')) {
    return Response.redirect(key, 302)
  }

  const supabase = getSupabaseAdmin()
  const candidates = parseStorageKey(key)

  for (const candidate of candidates) {
    const { data, error } = await supabase.storage.from(candidate.bucket).createSignedUrl(candidate.path, 300)
    if (!error && data?.signedUrl) {
      return Response.redirect(data.signedUrl, 302)
    }
  }

  return new Response('Document not found', { status: 404 })
}

export const config: Config = {
  path: '/api/download-document',
}
