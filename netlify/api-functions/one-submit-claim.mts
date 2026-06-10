// B2C — criação/atualização de sinistro para o cliente individual autenticado.
import type { Config } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import * as db from '../../src/lib/data'
import { selectPreferredClaimForPolicy } from '../../src/lib/claim-resolution'
import type { Claim } from '../../src/lib/types'

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
  if (!clientId) return Response.json({ error: 'Cliente individual não identificado' }, { status: 403 })

  const body = await req.json() as {
    policyId: string
    title: string
    description: string
    incidentDate: string
    estimatedValue?: number
  }

  const policy = await db.getPolicy(body.policyId)
  if (!policy) return Response.json({ error: 'Apólice não encontrada' }, { status: 404 })
  if (policy.individualClientId !== clientId) {
    return Response.json({ error: 'Sem acesso a esta apólice' }, { status: 403 })
  }

  const existingClaims = await db.getClaimsByPolicyId(body.policyId)
  const existing = selectPreferredClaimForPolicy(existingClaims)

  if (existing) {
    await db.updateClaim(existing.id, {
      individualClientId: clientId,
      title: body.title,
      description: body.description,
      incidentDate: body.incidentDate,
      estimatedValue: Number(body.estimatedValue || 0),
    })
    return Response.json({ id: existing.id, reused: true })
  }

  const nowIso = new Date().toISOString()
  const claimId = `clm_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
  const newClaim: Claim = {
    id: claimId,
    policyId: body.policyId,
    individualClientId: clientId,
    title: body.title,
    description: body.description,
    claimDate: nowIso.split('T')[0],
    incidentDate: body.incidentDate,
    estimatedValue: Number(body.estimatedValue || 0),
    status: 'submitted',
    steps: [{ status: 'submitted', date: nowIso.split('T')[0], notes: 'Sinistro submetido pelo cliente' }],
    createdAt: nowIso,
  } as unknown as Claim

  await db.createClaim(newClaim)
  return Response.json({ id: claimId, reused: false })
}

export const config: Config = { path: '/api/one/submit-claim' }
