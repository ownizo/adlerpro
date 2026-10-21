import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveViewerLinks } from './viewer-access.server.ts'

type Row = Record<string, string | null>

/** Minimal stand-in for the Supabase query builder used by resolveViewerLinks. */
function fakeSupabase(tables: Record<string, Row[]>) {
  const updates: { table: string; id: string; values: Row }[] = []
  function from(table: string) {
    const filters: ((r: Row) => boolean)[] = []
    let values: Row | null = null
    let limit = Infinity
    const run = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
    const q: any = {
      select: () => q,
      update: (v: Row) => { values = v; return q },
      eq: (c: string, v: string) => { filters.push((r) => r[c] === v); return q },
      is: (c: string, v: null) => { filters.push((r) => (r[c] ?? null) === v); return q },
      ilike: (c: string, pattern: string) => {
        const literal = pattern.replace(/\\(.)/g, '$1')
        assert.ok(!/(^|[^\\])[%_]/.test(pattern), `unescaped wildcard in ${pattern}`)
        filters.push((r) => (r[c] ?? '').toLowerCase() === literal.toLowerCase())
        return q
      },
      limit: (n: number) => { limit = n; return q },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => {
        if (values) {
          for (const r of run()) { Object.assign(r, values); updates.push({ table, id: r.id as string, values }) }
          resolve({ error: null })
        } else resolve({ data: run().slice(0, limit), error: null })
      },
    }
    return q
  }
  return { sb: { from } as any, updates }
}

const confirmed = { email_confirmed_at: '2026-10-01T00:00:00Z', app_metadata: {} }

test('links by internal id first', async () => {
  const { sb, updates } = fakeSupabase({
    individual_clients: [{ id: 'ic_1', auth_user_id: 'u1', email: 'other@x.com' }],
    company_users: [],
  })
  const links = await resolveViewerLinks(sb, { id: 'u1', email: 'me@x.com', ...confirmed })
  assert.deepEqual(links, { isAdmin: false, companyId: null, individualClientId: 'ic_1' })
  assert.equal(updates.length, 0)
})

test('falls back to the exact email once and stores the internal id', async () => {
  const { sb, updates } = fakeSupabase({
    individual_clients: [{ id: 'ic_2', auth_user_id: null, email: 'Ana@X.com' }],
    company_users: [{ id: 'cu_1', company_id: 'c1', auth_user_id: null, email: 'ana@x.com' }],
  })
  const links = await resolveViewerLinks(sb, { id: 'u2', email: 'ana@x.com', ...confirmed })
  assert.deepEqual(links, { isAdmin: false, companyId: 'c1', individualClientId: 'ic_2' })
  assert.deepEqual(updates.map((u) => [u.table, u.id]).sort(), [['company_users', 'cu_1'], ['individual_clients', 'ic_2']])
})

test('an underscore in the email is not a wildcard', async () => {
  const { sb } = fakeSupabase({ individual_clients: [{ id: 'ic_3', auth_user_id: null, email: 'johnXsmith@x.com' }], company_users: [] })
  const links = await resolveViewerLinks(sb, { id: 'u3', email: 'john_smith@x.com', ...confirmed })
  assert.equal(links.individualClientId, null)
})

test('never links by email when unconfirmed, already linked elsewhere, or ambiguous', async () => {
  const tables = {
    individual_clients: [
      { id: 'ic_4', auth_user_id: 'someone-else', email: 'a@x.com' },
      { id: 'ic_5', auth_user_id: null, email: 'b@x.com' },
      { id: 'ic_6', auth_user_id: null, email: 'b@x.com' },
    ],
    company_users: [],
  }
  const { sb, updates } = fakeSupabase(tables)
  assert.equal((await resolveViewerLinks(sb, { id: 'u4', email: 'a@x.com', ...confirmed })).individualClientId, null)
  assert.equal((await resolveViewerLinks(sb, { id: 'u5', email: 'b@x.com', ...confirmed })).individualClientId, null)
  assert.equal((await resolveViewerLinks(sb, { id: 'u6', email: 'c@x.com', email_confirmed_at: undefined, app_metadata: {} })).individualClientId, null)
  assert.equal(updates.length, 0)
})

test('agency staff are not linked to a client record', async () => {
  const { sb } = fakeSupabase({ individual_clients: [{ id: 'ic_7', auth_user_id: 'u7', email: 'x@x.com' }], company_users: [] })
  assert.deepEqual(await resolveViewerLinks(sb, { id: 'u7', email: 'x@x.com', email_confirmed_at: 'x', app_metadata: { roles: ['admin'] } }), { isAdmin: true, companyId: null, individualClientId: null })
})
