// B2C — regista um documento carregado num sinistro (atualiza DB + Netlify Blobs).
import type { Config } from '@netlify/functions'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as db from '../../src/lib/data'
import { updateClaimOperationalData } from '../../src/lib/claim-ops'
import type { ClaimFileRef } from '../../src/lib/types'

const SB_URL = process.env.VITE_SUPABASE_URL || ''
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function makeAdmin(): SupabaseClient {
  return createClient(SB_URL, SB_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
}

function extractToken(req: Request): string | null {
  const auth = req.headers.get('authorization')
  return auth?.startsWith('Bearer ') ? auth.slice(7) : null
}

async function resolveClientId(
  admin: SupabaseClient,
  userId: string,
  email?: string | null,
): Promise<string | null> {
  const { data: byId } = await admin
    .from('individual_clients').select('id').eq('auth_user_id', userId).maybeSingle()
  if (byId?.id) return byId.id as string
  if (email) {
    const { data: byEmail } = await admin
      .from('individual_clients').select('id').ilike('email', email).maybeSingle()
    if (byEmail?.id) return byEmail.id as string
  }
  return null
}

export default async (req: Request) => {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })

  const token = extractToken(req)
  if (!token) return Response.json({ error: 'Não autenticado' }, { status: 401 })

  const admin = makeAdmin()
  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Token inválido' }, { status: 401 })

  const clientId = await resolveClientId(admin, user.id, user.email)
  if (!clientId) return Response.json({ error: 'Sem acesso' }, { status: 403 })

  const body = await req.json() as {
    claimId: string
    name: string
    contentType?: string
    mimeType?: string
    storagePath: string
    size: number
  }

  const claim = await db.getClaim(body.claimId)
  if (!claim) return Response.json({ error: 'Sinistro não encontrado' }, { status: 404 })
  if (claim.individualClientId !== clientId) return Response.json({ error: 'Sem acesso a este sinistro' }, { status: 403 })

  const individualClient = await db.getIndividualClient(clientId)
  const uploaderName = individualClient?.fullName ?? (user.email ?? 'Cliente')
  const uploadedAt = new Date().toISOString()
  const contentType = body.contentType ?? body.mimeType ?? 'application/octet-stream'
  const fileId = crypto.randomUUID()

  await db.createDocument({
    id: fileId,
    companyId: '',
    individualClientId: clientId,
    name: body.name,
    category: 'claim',
    size: body.size,
    uploadedBy: uploaderName,
    uploadedAt,
    storagePath: body.storagePath,
  })

  const fileRef: ClaimFileRef = {
    id: fileId,
    claimId: body.claimId,
    name: body.name,
    contentType,
    uploadedAt,
    uploadedByName: uploaderName,
    uploadedByRole: 'client',
    storagePath: body.storagePath,
    size: Number(body.size),
  }

  await updateClaimOperationalData(body.claimId, (current) => ({
    ...current,
    documents: [...current.documents, fileRef],
    timeline: [
      ...current.timeline,
      {
        id: crypto.randomUUID(),
        type: 'document' as const,
        message: `Documento adicionado: ${body.name}`,
        createdAt: uploadedAt,
        actorName: uploaderName,
        actorRole: 'client' as const,
      },
    ],
  }))

  return Response.json({ success: true })
}

export const config: Config = { path: '/api/one/register-document' }
