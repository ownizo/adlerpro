// OAuth 2.1 (authorization code + PKCE, dynamic client registration) for the
// Claude CRM connector. Only Claude's redirect URIs can register, and only a
// signed-in backoffice admin can approve a connection.

import { sb, sha256, randomToken, pkceS256 } from './core.ts'

export const ACCESS_TTL_S = 3600
export const REFRESH_TTL_S = 90 * 24 * 3600
const CODE_TTL_S = 300

/** Redirect URIs Claude uses (hosted apps + Claude Code loopback). */
export function isAllowedRedirect(uri: string): boolean {
  let u: URL
  try { u = new URL(uri) } catch { return false }
  if (u.protocol === 'https:' && (u.host === 'claude.ai' || u.host === 'claude.com') && u.pathname === '/api/mcp/auth_callback') return true
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.pathname === '/callback') return true
  return false
}

function sameRedirect(registered: string[], uri: string): boolean {
  if (registered.includes(uri)) return true
  // loopback: port-agnostic match (RFC 8252 §7.3)
  try {
    const u = new URL(uri)
    if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return false
    return registered.some((r) => {
      try { const x = new URL(r); return x.hostname === u.hostname && x.pathname === u.pathname && x.protocol === u.protocol } catch { return false }
    })
  } catch { return false }
}

export async function registerClient(body: { redirect_uris?: unknown; client_name?: unknown }) {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : []
  if (!uris.length || !uris.every(isAllowedRedirect)) return { error: 'invalid_redirect_uri' as const }
  const client_id = `ar_${randomToken(16)}`
  const client_name = typeof body.client_name === 'string' ? body.client_name.slice(0, 120) : 'Claude'
  const { error } = await sb().from('mcp_oauth_clients').insert({ client_id, client_name, redirect_uris: uris })
  if (error) throw new Error(error.message)
  return { client_id, client_name, redirect_uris: uris }
}

export async function getClient(clientId: string) {
  const { data } = await sb().from('mcp_oauth_clients').select('client_id, client_name, redirect_uris').eq('client_id', clientId).maybeSingle()
  return data as { client_id: string; client_name: string | null; redirect_uris: string[] } | null
}

export async function validateAuthorizeRequest(p: { client_id?: string; redirect_uri?: string; code_challenge?: string; code_challenge_method?: string; response_type?: string }) {
  if (p.response_type !== 'code') return { error: 'unsupported_response_type' }
  if (!p.client_id || !p.redirect_uri) return { error: 'invalid_request' }
  const client = await getClient(p.client_id)
  if (!client) return { error: 'invalid_client' }
  if (!sameRedirect(client.redirect_uris, p.redirect_uri)) return { error: 'invalid_redirect_uri' }
  if (!p.code_challenge || p.code_challenge_method !== 'S256') return { error: 'invalid_request', description: 'PKCE S256 is required' }
  return { client }
}

export async function issueCode(p: { client_id: string; redirect_uri: string; code_challenge: string; scope?: string; user_id: string }) {
  const code = randomToken(32)
  const { error } = await sb().from('mcp_oauth_codes').insert({
    code_hash: await sha256(code), client_id: p.client_id, redirect_uri: p.redirect_uri,
    code_challenge: p.code_challenge, scope: p.scope ?? 'crm', user_id: p.user_id,
    expires_at: new Date(Date.now() + CODE_TTL_S * 1000).toISOString(),
  })
  if (error) throw new Error(error.message)
  return code
}

async function issueTokens(client_id: string, user_id: string | null, family: string) {
  const access = randomToken(32)
  const refresh = randomToken(40)
  const now = Date.now()
  const { error } = await sb().from('mcp_oauth_tokens').insert([
    { token_hash: await sha256(access), kind: 'access', client_id, user_id, family, expires_at: new Date(now + ACCESS_TTL_S * 1000).toISOString() },
    { token_hash: await sha256(refresh), kind: 'refresh', client_id, user_id, family, expires_at: new Date(now + REFRESH_TTL_S * 1000).toISOString() },
  ])
  if (error) throw new Error(error.message)
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: 'crm' }
}

type TokenResult = { ok: true; body: Record<string, unknown> } | { ok: false; error: string; description?: string }

export async function exchangeCode(p: { code?: string; redirect_uri?: string; client_id?: string; code_verifier?: string }): Promise<TokenResult> {
  if (!p.code || !p.client_id || !p.code_verifier || !p.redirect_uri) return { ok: false, error: 'invalid_request' }
  const hash = await sha256(p.code)
  const { data: row } = await sb().from('mcp_oauth_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('code_hash', hash).is('used_at', null)
    .select('client_id, redirect_uri, code_challenge, user_id, expires_at').maybeSingle()
  if (!row) return { ok: false, error: 'invalid_grant' }
  if (row.client_id !== p.client_id || row.redirect_uri !== p.redirect_uri) return { ok: false, error: 'invalid_grant' }
  if (Date.parse(row.expires_at) < Date.now()) return { ok: false, error: 'invalid_grant', description: 'code expired' }
  if ((await pkceS256(p.code_verifier)) !== row.code_challenge) return { ok: false, error: 'invalid_grant', description: 'PKCE mismatch' }
  return { ok: true, body: await issueTokens(row.client_id, row.user_id, crypto.randomUUID()) }
}

export async function refresh(p: { refresh_token?: string; client_id?: string }): Promise<TokenResult> {
  if (!p.refresh_token) return { ok: false, error: 'invalid_request' }
  const hash = await sha256(p.refresh_token)
  const { data: row } = await sb().from('mcp_oauth_tokens').select('client_id, user_id, family, expires_at, revoked_at, kind').eq('token_hash', hash).maybeSingle()
  if (!row || row.kind !== 'refresh') return { ok: false, error: 'invalid_grant' }
  if (p.client_id && p.client_id !== row.client_id) return { ok: false, error: 'invalid_grant' }
  if (row.revoked_at) {
    // refresh-token reuse: revoke the whole family
    await sb().from('mcp_oauth_tokens').update({ revoked_at: new Date().toISOString() }).eq('family', row.family).is('revoked_at', null)
    return { ok: false, error: 'invalid_grant' }
  }
  if (Date.parse(row.expires_at) < Date.now()) return { ok: false, error: 'invalid_grant' }
  await sb().from('mcp_oauth_tokens').update({ revoked_at: new Date().toISOString() }).eq('token_hash', hash)
  return { ok: true, body: await issueTokens(row.client_id, row.user_id, row.family) }
}

export async function verifyAccessToken(token: string): Promise<boolean> {
  if (!token || token.length < 20) return false
  const { data } = await sb().from('mcp_oauth_tokens').select('kind, expires_at, revoked_at').eq('token_hash', await sha256(token)).maybeSingle()
  return !!data && data.kind === 'access' && !data.revoked_at && Date.parse(data.expires_at) > Date.now()
}

export async function revokeAll() {
  await sb().from('mcp_oauth_tokens').update({ revoked_at: new Date().toISOString() }).is('revoked_at', null)
}
