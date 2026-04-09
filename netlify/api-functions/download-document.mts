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

function isMissingColumnError(error: unknown, column: string): boolean {
  const message = String((error as { message?: string } | null)?.message ?? '').toLowerCase()
  return message.includes('column') && message.includes(column.toLowerCase()) && message.includes('does not exist')
}

async function getDocumentStorageReferences(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  key: string
): Promise<string[]> {
  const references = new Set<string>()

  const tryAdd = (value?: string | null) => {
    if (typeof value === 'string' && value.trim().length > 0) references.add(value.trim())
  }

  const modernByStorage = await supabase
    .from('documents')
    .select('storage_path, blob_key')
    .eq('storage_path', key)
    .maybeSingle()

  if (!modernByStorage.error && modernByStorage.data) {
    tryAdd(modernByStorage.data.storage_path)
    tryAdd(modernByStorage.data.blob_key)
    return Array.from(references)
  }

  if (modernByStorage.error && isMissingColumnError(modernByStorage.error, 'storage_path')) {
    const legacyByBlob = await supabase
      .from('documents')
      .select('blob_key')
      .eq('blob_key', key)
      .maybeSingle()
    if (!legacyByBlob.error && legacyByBlob.data?.blob_key) {
      tryAdd(legacyByBlob.data.blob_key)
    }
    return Array.from(references)
  }

  if (modernByStorage.error && isMissingColumnError(modernByStorage.error, 'blob_key')) {
    const modernOnly = await supabase
      .from('documents')
      .select('storage_path')
      .eq('storage_path', key)
      .maybeSingle()
    if (!modernOnly.error && modernOnly.data?.storage_path) {
      tryAdd(modernOnly.data.storage_path)
    }
    return Array.from(references)
  }

  const modernByBlob = await supabase
    .from('documents')
    .select('storage_path, blob_key')
    .eq('blob_key', key)
    .maybeSingle()

  if (!modernByBlob.error && modernByBlob.data) {
    tryAdd(modernByBlob.data.storage_path)
    tryAdd(modernByBlob.data.blob_key)
  }

  return Array.from(references)
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
  const references = await getDocumentStorageReferences(supabase, key)
  for (const reference of references) {
    for (const parsed of parseStorageKey(reference)) {
      if (!candidates.some((candidate) => candidate.bucket === parsed.bucket && candidate.path === parsed.path)) {
        candidates.push(parsed)
      }
    }
  }

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
