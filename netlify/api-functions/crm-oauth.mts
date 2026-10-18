import type { Config } from '@netlify/functions'
import { registerClient, exchangeCode, refresh } from '../../src/lib/crm-agent/oauth.ts'

// OAuth endpoints + discovery metadata for the Claude CRM connector.
// The consent screen itself is the app route /oauth/authorize.

export const config: Config = {
  path: [
    '/oauth/register',
    '/oauth/token',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/api/mcp',
  ],
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } })
}

function origin(req: Request) {
  const u = new URL(req.url)
  return `https://${u.host}`
}

export default async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const path = new URL(req.url).pathname.replace(/\/$/, '')
  const base = origin(req)

  if (path === '/.well-known/oauth-authorization-server') {
    return json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['crm'],
    })
  }

  if (path.startsWith('/.well-known/oauth-protected-resource')) {
    return json({
      resource: `${base}/api/mcp`,
      authorization_servers: [base],
      scopes_supported: ['crm'],
      bearer_methods_supported: ['header'],
      resource_name: 'Adler & Rochefort CRM',
    })
  }

  if (path === '/oauth/register' && req.method === 'POST') {
    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { return json({ error: 'invalid_client_metadata' }, 400) }
    const r = await registerClient(body)
    if ('error' in r) return json({ error: r.error, error_description: 'Only Claude redirect URIs are accepted.' }, 400)
    return json({
      client_id: r.client_id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: r.client_name,
      redirect_uris: r.redirect_uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }, 201)
  }

  if (path === '/oauth/token' && req.method === 'POST') {
    const ct = req.headers.get('content-type') || ''
    const params: Record<string, string> = {}
    if (ct.includes('application/json')) {
      try { Object.assign(params, await req.json()) } catch { return json({ error: 'invalid_request' }, 400) }
    } else {
      new URLSearchParams(await req.text()).forEach((v, k) => { params[k] = v })
    }
    let result
    if (params.grant_type === 'authorization_code') result = await exchangeCode(params)
    else if (params.grant_type === 'refresh_token') result = await refresh(params)
    else return json({ error: 'unsupported_grant_type' }, 400)
    if (!result.ok) return json({ error: result.error, error_description: result.description }, 400)
    return json(result.body)
  }

  return json({ error: 'not_found' }, 404)
}
