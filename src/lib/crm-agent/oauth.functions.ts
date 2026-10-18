import { createServerFn } from '@tanstack/react-start'
import { requireRoleMiddleware } from '@/middleware/identity'

type AuthorizeInput = {
  response_type?: string
  client_id?: string
  redirect_uri?: string
  state?: string
  code_challenge?: string
  code_challenge_method?: string
  scope?: string
}

function pick(data: AuthorizeInput): AuthorizeInput {
  const s = (v: unknown) => (typeof v === 'string' ? v.slice(0, 2048) : undefined)
  return {
    response_type: s(data?.response_type), client_id: s(data?.client_id), redirect_uri: s(data?.redirect_uri),
    state: s(data?.state), code_challenge: s(data?.code_challenge), code_challenge_method: s(data?.code_challenge_method), scope: s(data?.scope),
  }
}

/** Validates the authorization request so the consent screen can show who is asking. */
export const checkCrmAuthorization = createServerFn({ method: 'POST' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator(pick)
  .handler(async ({ data }) => {
    const { validateAuthorizeRequest } = await import('./oauth')
    const r = await validateAuthorizeRequest(data)
    if ('error' in r) return { ok: false as const, error: r.error }
    return { ok: true as const, clientName: r.client.client_name ?? 'Claude' }
  })

/** Admin approves → returns the redirect back to Claude with a one-time code. */
export const approveCrmAuthorization = createServerFn({ method: 'POST' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator(pick)
  .handler(async ({ data, context }) => {
    const { validateAuthorizeRequest, issueCode } = await import('./oauth')
    const { logActivity } = await import('./core')
    const r = await validateAuthorizeRequest(data)
    if ('error' in r) throw new Error(r.error)
    const code = await issueCode({
      client_id: data.client_id!, redirect_uri: data.redirect_uri!, code_challenge: data.code_challenge!,
      scope: data.scope, user_id: (context as { user: { id: string } }).user.id,
    })
    await logActivity('hugo', 'connect_claude', 'oauth_client', data.client_id!, `Ligação do Claude ao CRM autorizada (${r.client.client_name ?? 'Claude'})`)
    const url = new URL(data.redirect_uri!)
    url.searchParams.set('code', code)
    if (data.state) url.searchParams.set('state', data.state)
    return { redirect: url.toString() }
  })

/** Disconnect every Claude session (revokes all tokens). */
export const revokeCrmConnections = createServerFn({ method: 'POST' })
  .middleware([requireRoleMiddleware('admin')])
  .handler(async () => {
    const { revokeAll } = await import('./oauth')
    await revokeAll()
    return { ok: true }
  })

/** Connection status + recent activity for the /admin/claude page. */
export const fetchClaudeStatus = createServerFn({ method: 'GET' })
  .middleware([requireRoleMiddleware('admin')])
  .handler(async () => {
    const { sb } = await import('./core')
    const now = new Date().toISOString()
    const [{ count }, { data: activity }] = await Promise.all([
      sb().from('mcp_oauth_tokens').select('family', { count: 'exact', head: true }).eq('kind', 'refresh').is('revoked_at', null).gt('expires_at', now),
      sb().from('crm_activity').select('created_at, actor, action, summary').order('created_at', { ascending: false }).limit(40),
    ])
    return { activeConnections: count ?? 0, activity: (activity ?? []) as Array<{ created_at: string; actor: string; action: string; summary: string | null }> }
  })
