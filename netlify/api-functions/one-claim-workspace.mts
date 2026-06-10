// B2C — workspace de um sinistro (claim + apólice + operações da Netlify Blob store).
import type { Config } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import * as db from '../../src/lib/data'
import { getClaimOperationalData } from '../../src/lib/claim-ops'
import { claimMessageToTicketMessage } from '../../src/lib/claim-message-sync'

const SB_URL = process.env.VITE_SUPABASE_URL || ''
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function makeAdmin() {
  return createClient(SB_URL, SB_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
}

function extractToken(req: Request): string | null {
  const auth = req.headers.get('authorization')
  return auth?.startsWith('Bearer ') ? auth.slice(7) : null
}

async function resolveClientId(
  admin: ReturnType<typeof makeAdmin>,
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

  const body = await req.json() as { claimId: string }
  const claim = await db.getClaim(body.claimId)
  if (!claim) return Response.json({ error: 'Sinistro não encontrado' }, { status: 404 })
  if (claim.individualClientId !== clientId) return Response.json({ error: 'Sem acesso a este sinistro' }, { status: 403 })

  const [policy, individualClient, ops, dbMessages] = await Promise.all([
    db.getPolicy(claim.policyId),
    db.getIndividualClient(clientId),
    getClaimOperationalData(body.claimId),
    db.getClaimMessages(body.claimId),
  ])

  // Merge DB messages + legacy blob messages, deduplicated
  const blobMessages = ops.messages ?? []
  const dbAsTicket = dbMessages.map(claimMessageToTicketMessage)
  const blobKeys = new Set(blobMessages.map((m) => `${m.senderRole}::${m.createdAt}::${m.body.trim()}`))
  const merged = [
    ...blobMessages,
    ...dbAsTicket.filter((m) => !blobKeys.has(`${m.senderRole}::${m.createdAt}::${m.body.trim()}`)),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  return Response.json({
    claim,
    policy,
    company: null,
    individualClient,
    operations: { ...ops, messages: merged },
  })
}

export const config: Config = { path: '/api/one/claim-workspace' }
