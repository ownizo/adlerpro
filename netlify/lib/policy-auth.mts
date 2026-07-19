import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
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

  const isAdmin = Array.isArray(user.app_metadata?.roles) && user.app_metadata.roles.includes('admin')
  if (isAdmin) return { user, policy, isAdmin }

  if (policy.individual_client_id) {
    const { data: client } = await supabase
      .from('individual_clients')
      .select('id')
      .eq('id', policy.individual_client_id)
      .or(`auth_user_id.eq.${user.id}${user.email ? `,email.ilike.${user.email}` : ''}`)
      .maybeSingle()
    if (client) return { user, policy, isAdmin }
  }

  if (policy.company_id && user.email) {
    const { data: companyUser } = await supabase
      .from('company_users')
      .select('id')
      .eq('company_id', policy.company_id)
      .ilike('email', user.email)
      .maybeSingle()
    if (companyUser) return { user, policy, isAdmin }
  }

  throw new Response('Sem acesso a esta apólice', { status: 403 })
}

export async function authenticateRequest(req: Request) {
  const token = extractToken(req)
  if (!token) throw new Response('Não autenticado', { status: 401 })

  const { data: { user }, error: userError } = await supabase.auth.getUser(token)
  if (userError || !user) throw new Response('Não autenticado', { status: 401 })
  return user
}
