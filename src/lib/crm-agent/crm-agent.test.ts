import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAllowedRedirect } from './oauth.ts'
import { pkceS256, cleanSearch, normalizePolicyNumber, addDays } from './core.ts'
import { CRM_TOOLS } from './tools.ts'

test('only Claude redirect URIs can register', () => {
  assert.equal(isAllowedRedirect('https://claude.ai/api/mcp/auth_callback'), true)
  assert.equal(isAllowedRedirect('https://claude.com/api/mcp/auth_callback'), true)
  assert.equal(isAllowedRedirect('http://localhost:3118/callback'), true)
  assert.equal(isAllowedRedirect('http://127.0.0.1:50211/callback'), true)
  assert.equal(isAllowedRedirect('https://evil.example/api/mcp/auth_callback'), false)
  assert.equal(isAllowedRedirect('https://claude.ai.evil.example/api/mcp/auth_callback'), false)
  assert.equal(isAllowedRedirect('http://claude.ai/api/mcp/auth_callback'), false)
  assert.equal(isAllowedRedirect('https://claude.ai/other'), false)
  assert.equal(isAllowedRedirect('not a url'), false)
})

test('PKCE S256 matches RFC 7636 test vector', async () => {
  assert.equal(await pkceS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
})

test('helpers', () => {
  assert.equal(cleanSearch('a,b(c)*%d'), 'a b c d')
  assert.equal(normalizePolicyNumber(' 0011084844 '), '11084844')
  assert.equal(normalizePolicyNumber('me 66246744'), 'ME66246744')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
})

test('tool catalogue is well-formed and has no delete tools', () => {
  const names = CRM_TOOLS.map((t) => t.name)
  assert.equal(new Set(names).size, names.length)
  for (const t of CRM_TOOLS) {
    assert.match(t.name, /^[a-z_]{3,40}$/)
    assert.equal(t.inputSchema.type, 'object')
    assert.ok(t.description.length > 20)
    assert.ok(!/delete|remove/.test(t.name))
  }
  assert.ok(names.includes('today_overview'))
})

test('tools validate input before touching the database', async () => {
  const tool = (n: string) => CRM_TOOLS.find((t) => t.name === n)!
  await assert.rejects(tool('search').handler({}), /query is required/)
  await assert.rejects(tool('create_task').handler({}), /title is required/)
  await assert.rejects(tool('get_client').handler({}), /required/)
  await assert.rejects(tool('get_client').handler({ individual_client_id: 'a', company_id: 'b' }), /not both/)
  await assert.rejects(tool('log_email').handler({ gmail_message_id: 'x', direction: 'sideways', sent_at: '2026-10-18T10:00:00Z' }), /direction/)
  await assert.rejects(tool('upsert_policy').handler({ insurer: 'Allianz' }), /policy_number/)
  await assert.rejects(tool('update_opportunity').handler({}), /opportunity_id/)
})

test('MCP endpoint asks for OAuth when no token is sent', async () => {
  const { default: handler } = await import('../../../netlify/api-functions/mcp.mts')
  const res = await handler(new Request('https://admin.adlerrochefort.com/api/mcp', { method: 'POST', body: '{}' }))
  assert.equal(res.status, 401)
  assert.match(res.headers.get('www-authenticate') ?? '', /resource_metadata="https:\/\/admin\.adlerrochefort\.com\/\.well-known\/oauth-protected-resource\/api\/mcp"/)
})

test('OAuth discovery metadata', async () => {
  const { default: handler } = await import('../../../netlify/api-functions/crm-oauth.mts')
  const as = await (await handler(new Request('https://admin.adlerrochefort.com/.well-known/oauth-authorization-server'))).json()
  assert.equal(as.issuer, 'https://admin.adlerrochefort.com')
  assert.deepEqual(as.code_challenge_methods_supported, ['S256'])
  assert.equal(as.registration_endpoint, 'https://admin.adlerrochefort.com/oauth/register')
  const pr = await (await handler(new Request('https://admin.adlerrochefort.com/.well-known/oauth-protected-resource/api/mcp'))).json()
  assert.equal(pr.resource, 'https://admin.adlerrochefort.com/api/mcp')
  assert.deepEqual(pr.authorization_servers, ['https://admin.adlerrochefort.com'])
  const bad = await handler(new Request('https://admin.adlerrochefort.com/oauth/register', { method: 'POST', body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'] }), headers: { 'content-type': 'application/json' } }))
  assert.equal(bad.status, 400)
})
