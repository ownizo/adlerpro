// B2C — adiciona mensagem a um sinistro e envia notificação por email.
import type { Config } from '@netlify/functions'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as db from '../../src/lib/data'
import { updateClaimOperationalData } from '../../src/lib/claim-ops'
import { Resend } from 'resend'

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

async function sendNotificationEmail(params: {
  to?: string | null
  claimId: string
  senderName: string
  body: string
}) {
  const to = params.to?.trim()
  const templateId = process.env['RESEND_TEMPLATE_CLAIMS']
  if (!to || !process.env['RESEND_API_KEY'] || !templateId) return

  const resend = new Resend(process.env['RESEND_API_KEY'])
  const message = params.body.length > 2000 ? `${params.body.slice(0, 1997)}...` : params.body
  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM ?? 'Os Meus Seguros <noreply@adlerrochefort.com>',
      to: [to],
      subject: `Atualização de sinistro ${params.claimId}`,
      react: undefined as any,
      text: `Nova mensagem de ${params.senderName}:\n\n${message}`,
    })
  } catch {
    // Email is best-effort; do not fail the request
  }
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

  const body = await req.json() as { claimId: string; body: string }
  const messageText = body.body?.trim()
  if (!messageText) return Response.json({ error: 'Mensagem vazia' }, { status: 400 })

  const claim = await db.getClaim(body.claimId)
  if (!claim) return Response.json({ error: 'Sinistro não encontrado' }, { status: 404 })
  if (claim.individualClientId !== clientId) return Response.json({ error: 'Sem acesso a este sinistro' }, { status: 403 })

  const individualClient = await db.getIndividualClient(clientId)
  const senderName = individualClient?.fullName ?? (user.email ?? 'Cliente')
  const createdAt = new Date().toISOString()

  // Persist to DB
  await db.createClaimMessage({
    id: crypto.randomUUID(),
    claimId: body.claimId,
    senderType: 'client',
    senderName,
    senderUserId: user.id,
    message: messageText,
    createdAt,
    readAt: createdAt,
  })

  // Update timeline in Netlify Blobs
  await updateClaimOperationalData(body.claimId, (current) => ({
    ...current,
    timeline: [
      ...current.timeline,
      {
        id: crypto.randomUUID(),
        type: 'message' as const,
        message: 'Cliente adicionou uma mensagem',
        createdAt,
        actorName: senderName,
        actorRole: 'client' as const,
      },
    ],
  }))

  // Notify admin
  await sendNotificationEmail({
    to: process.env['CLAIMS_NOTIFICATIONS_TO'],
    claimId: body.claimId,
    senderName,
    body: messageText,
  })

  return Response.json({ success: true })
}

export const config: Config = { path: '/api/one/add-message' }
