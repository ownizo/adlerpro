import type { Config } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { resolveViewerLinks } from '../../src/lib/viewer-access.server.ts'
import { ownsRecord } from '../../src/lib/storage-access.ts'

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
    const policyId = (formData.get('policyId') as string) || ''

    if (!file) {
      return Response.json({ error: 'Ficheiro nao fornecido' }, { status: 400 })
    }

    const allowedMime = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
    const allowedExt = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp'])
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
    const maxSizeBytes = 10 * 1024 * 1024

    if (!['avatar', 'document', 'claim_document', 'policy_document'].includes(uploadType)) {
      return Response.json({ error: 'Tipo de upload inválido' }, { status: 400 })
    }
    if (file.size > 15 * 1024 * 1024) {
      return Response.json({ error: 'Ficheiro excede o tamanho máximo de 15MB' }, { status: 400 })
    }

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

    if (uploadType === 'policy_document') {
      if (file.size > maxSizeBytes) {
        return Response.json({ error: 'Ficheiro excede o tamanho máximo de 10MB' }, { status: 400 })
      }
      if (!allowedMime.has(file.type) || !allowedExt.has(ext)) {
        return Response.json({ error: 'Formato inválido. Use PDF, JPG ou PNG' }, { status: 400 })
      }
      if (!policyId.trim()) {
        return Response.json({ error: 'policyId é obrigatório para upload de apólice' }, { status: 400 })
      }
    }

    // The folder and the owner come from the records the viewer is linked to,
    // never from the request or from user_metadata (which the user can edit).
    const links = await resolveViewerLinks(supabase, user)
    let companyId = links.companyId || ''
    let individualClientId: string | null = links.individualClientId

    if (uploadType === 'policy_document') {
      const { data: policy } = await supabase
        .from('policies')
        .select('company_id, individual_client_id')
        .eq('id', policyId)
        .maybeSingle()
      if (!policy) return Response.json({ error: 'Apólice não encontrada' }, { status: 404 })
      if (!links.isAdmin && !ownsRecord(links, policy)) {
        return Response.json({ error: 'Sem acesso a esta apólice' }, { status: 403 })
      }
      companyId = policy.company_id || ''
      individualClientId = policy.individual_client_id || null
    }

    if (uploadType === 'claim_document') {
      const { data: claim } = await supabase
        .from('claims')
        .select('company_id, individual_client_id')
        .eq('id', claimId)
        .maybeSingle()
      if (!claim) return Response.json({ error: 'Sinistro não encontrado' }, { status: 404 })
      if (!links.isAdmin && !ownsRecord(links, claim)) {
        return Response.json({ error: 'Sem acesso a este sinistro' }, { status: 403 })
      }
      companyId = claim.company_id || ''
    }

    if (uploadType === 'document' && !links.isAdmin && !links.companyId && !links.individualClientId) {
      return Response.json({ error: 'Conta sem cliente associado' }, { status: 403 })
    }

    if (!companyId) companyId = 'general'
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-180) || 'ficheiro'

    const bucket = uploadType === 'avatar' ? 'avatars' : 'documents'
    const path = uploadType === 'avatar'
      ? `${user.id}/avatar.${ext}`
      : uploadType === 'claim_document'
      ? `${companyId}/claims/${claimId}/${Date.now()}_${safeName}`
      : uploadType === 'policy_document'
      ? `${companyId}/policies/${policyId}/${Date.now()}_${safeName}`
      : `${companyId}/${Date.now()}_${safeName}`

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

    // Create DB record for cross-portal visibility
    if (uploadType === 'policy_document') {
      const docRecord = {
        id: crypto.randomUUID(),
        company_id: companyId !== 'general' ? companyId : null,
        individual_client_id: individualClientId,
        name: file.name,
        category: 'policy',
        size: file.size,
        uploaded_by: user.email || user.id,
        uploaded_at: new Date().toISOString(),
        storage_path: uploadData.path,
      }
      const { error: dbError } = await supabase.from('documents').insert(docRecord)
      if (dbError) console.error('DB record error (non-fatal):', dbError.message)
    }

    if (uploadType === 'document') {
      // Generic document upload, linked to the viewer's own client record
      const clientId = individualClientId

      const docRecord = {
        id: crypto.randomUUID(),
        company_id: companyId !== 'general' ? companyId : null,
        individual_client_id: clientId,
        name: file.name,
        category: 'other',
        size: file.size,
        uploaded_by: user.email || user.id,
        uploaded_at: new Date().toISOString(),
        storage_path: uploadData.path,
      }
      const { error: dbError } = await supabase.from('documents').insert(docRecord)
      if (dbError) console.error('DB record error (non-fatal):', dbError.message)
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
