// B2C — URL assinada para descarregar um documento do cliente.
// Usa supabaseAdmin.storage.createSignedUrl (service role obrigatório).
import type { Config } from '@netlify/functions'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as db from '../../src/lib/data'
import { getClaimOperationalData } from '../../src/lib/claim-ops'

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

  const body = await req.json() as { claimId?: string; documentId: string }

  // Try DB lookup first (documents table)
  const dbDoc = await db.getDocument(body.documentId)
  if (dbDoc?.storagePath) {
    // Verify ownership: document must belong to this individual client
    if (dbDoc.individualClientId && dbDoc.individualClientId !== clientId) {
      return Response.json({ error: 'Sem acesso a este documento' }, { status: 403 })
    }
    const { data: urlData, error: urlErr } = await admin.storage
      .from('documents').createSignedUrl(dbDoc.storagePath, 3600)
    if (urlErr) return Response.json({ error: urlErr.message }, { status: 500 })
    return Response.json({ url: urlData.signedUrl, name: dbDoc.name })
  }

  // Fallback: look up in Netlify Blobs operational data
  if (!body.claimId) return Response.json({ error: 'Documento não encontrado' }, { status: 404 })

  const claim = await db.getClaim(body.claimId)
  if (!claim) return Response.json({ error: 'Sinistro não encontrado' }, { status: 404 })
  if (claim.individualClientId !== clientId) return Response.json({ error: 'Sem acesso' }, { status: 403 })

  const ops = await getClaimOperationalData(body.claimId)
  const doc = ops.documents.find((d) => d.id === body.documentId)
  if (!doc) return Response.json({ error: 'Documento não encontrado' }, { status: 404 })

  const { data: urlData, error: urlErr } = await admin.storage
    .from('documents').createSignedUrl(doc.storagePath, 3600)
  if (urlErr) return Response.json({ error: urlErr.message }, { status: 500 })
  return Response.json({ url: urlData.signedUrl, name: doc.name })
}

export const config: Config = { path: '/api/one/document-url' }
