import { createClient } from '@supabase/supabase-js'
import { canAccessStoragePath, isAdminUser, resolveViewerLinks } from '../../src/lib/viewer-access.server.ts'
import { ownsRecord } from '../../src/lib/storage-access.ts'

export const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { autoRefreshToken: false, persistSession: false } },
)

function parseCookieToken(cookie: string): string | null {
  const chunks = cookie.split(';').map((part) => part.trim())
  const authChunks = chunks
    .map((part) => {
      const separator = part.indexOf('=')
      return separator === -1 ? null : [part.slice(0, separator), part.slice(separator + 1)] as const
    })
    .filter((part): part is readonly [string, string] => Boolean(part?.[0]?.match(/^sb-[^-]+-auth-token(?:\.\d+)?$/)))
    .sort(([a], [b]) => a.localeCompare(b))

  if (!authChunks.length) return null

  try {
    const raw = decodeURIComponent(authChunks.map(([, value]) => value).join(''))
    const json = raw.startsWith('base64-')
      ? Buffer.from(raw.slice(7), 'base64').toString('utf-8')
      : raw
    const parsed = JSON.parse(json)
    if (typeof parsed === 'string') return parsed
    if (Array.isArray(parsed)) return parsed[0] ?? null
    return parsed?.access_token ?? null
  } catch {
    return null
  }
}

function extractToken(req: Request): string | null {
  const authorization = req.headers.get('authorization')
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7)
  return parseCookieToken(req.headers.get('cookie') || '')
}

export async function authorizePolicyRequest(req: Request, policyId: string) {
  const user = await authenticateRequest(req)

  const { data: policy, error: policyError } = await supabase
    .from('policies')
    .select('id, company_id, individual_client_id')
    .eq('id', policyId)
    .single()
  if (policyError || !policy) throw new Response('Apólice não encontrada', { status: 404 })

  const links = await resolveViewerLinks(supabase, user)
  if (links.isAdmin || ownsRecord(links, policy)) return { user, policy, isAdmin: links.isAdmin, links }

  throw new Response('Sem acesso a esta apólice', { status: 403 })
}

/** Authenticates the request and checks the viewer may use this path of the `documents` bucket. */
export async function authorizeStoragePath(req: Request, path: unknown) {
  const user = await authenticateRequest(req)
  const links = await resolveViewerLinks(supabase, user)
  if (!(await canAccessStoragePath(supabase, links, path))) {
    throw new Response('Sem acesso a este documento', { status: 403 })
  }
  return { user, links }
}

/** Authenticates the request and requires an agency (admin) account. */
export async function authorizeAdminRequest(req: Request) {
  const user = await authenticateRequest(req)
  if (!isAdminUser(user)) throw new Response('Sem acesso', { status: 403 })
  return user
}

export async function authenticateRequest(req: Request) {
  const token = extractToken(req)
  if (!token) throw new Response('Não autenticado', { status: 401 })

  const { data: { user }, error: userError } = await supabase.auth.getUser(token)
  if (userError || !user) throw new Response('Não autenticado', { status: 401 })
  return user
}
