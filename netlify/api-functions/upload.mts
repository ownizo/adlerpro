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
      return Response.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const supabase = getSupabaseAdmin()
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return Response.json({ error: 'Token invalido' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const uploadType = (formData.get('type') as string) || 'document'
    const claimId = (formData.get('claimId') as string) || ''

    if (!file) {
      return Response.json({ error: 'Ficheiro nao fornecido' }, { status: 400 })
    }

    const allowedMime = new Set(['application/pdf', 'image/jpeg', 'image/png'])
    const allowedExt = new Set(['pdf', 'jpg', 'jpeg', 'png'])
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
    const maxSizeBytes = 10 * 1024 * 1024

    if (uploadType === 'claim_document') {
      if (file.size > maxSizeBytes) {
        return Response.json({ error: 'Ficheiro excede o tamanho máximo de 10MB' }, { status: 400 })
      }
      if (!allowedMime.has(file.type) || !allowedExt.has(ext)) {
        return Response.json({ error: 'Formato inválido. Use PDF, JPG ou PNG' }, { status: 400 })
      }
      if (!claimId.trim()) {
        return Response.json({ error: 'claimId é obrigatório para upload de sinistro' }, { status: 400 })
      }
    }

    const bucket = uploadType === 'avatar' ? 'avatars' : 'documents'
    const path = uploadType === 'avatar'
      ? `${user.id}/avatar.${ext}`
      : uploadType === 'claim_document'
      ? `${user.user_metadata?.company_id || 'general'}/claims/${claimId}/${Date.now()}_${file.name}`
      : `${user.user_metadata?.company_id || 'general'}/${Date.now()}_${file.name}`

    const buffer = await file.arrayBuffer()
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, buffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: uploadType === 'avatar',
      })

    if (uploadError) {
      console.error('Upload error:', uploadError)
      return Response.json({ error: 'Erro ao guardar ficheiro: ' + uploadError.message }, { status: 500 })
    }

    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(uploadData.path)

    return Response.json({
      url: publicUrl,
      path: uploadData.path,
      name: file.name,
      size: file.size,
      type: file.type,
    })
  } catch (error: any) {
    console.error('Upload error:', error)
    return Response.json({ error: 'Erro ao carregar ficheiro', details: error.message }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/upload',
}
