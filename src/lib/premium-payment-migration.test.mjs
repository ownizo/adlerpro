import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('premium migration backfills safely, is rerunnable, and preserves service-role isolation', async () => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);`)
    await db.exec(await readFile(new URL('../../migrations/20260919_premium_payments.sql', import.meta.url), 'utf8'))
    const insert = `INSERT INTO public.premium_payments
      (request_key, request_fingerprint, customer_name, customer_email, amount_cents, insurer, policy_reference, livemode)
      SELECT 'request-' || i, repeat('a', 64), 'Client', 'client@example.com', 12345, 'Insurer', 'POL-1', false FROM generate_series(1, 1000) i`
    await db.exec(insert)
    const migration = await readFile(new URL('../../migrations/20260921_premium_payment_methods_short_links.sql', import.meta.url), 'utf8')
    await db.exec(migration)
    const before = (await db.query('SELECT id, short_code, payment_methods FROM public.premium_payments ORDER BY id')).rows
    assert.equal(before.length, 1000)
    assert.equal(new Set(before.map(row => row.short_code)).size, 1000)
    for (const row of before) {
      assert.match(row.short_code, /^[A-Za-z0-9_-]{16}$/)
      assert.deepEqual(row.payment_methods, ['card', 'mb_way', 'revolut_pay', 'customer_balance', 'sepa_debit'])
    }
    await db.exec(migration)
    assert.deepEqual((await db.query('SELECT id, short_code, payment_methods FROM public.premium_payments ORDER BY id')).rows, before)
    for (const methods of ["ARRAY[]::text[]", "ARRAY['link']", "ARRAY['card', NULL]", 'NULL']) {
      await assert.rejects(db.exec(`UPDATE public.premium_payments SET payment_methods = ${methods} WHERE request_key = 'request-1'`))
    }
    await assert.rejects(db.exec(`UPDATE public.premium_payments SET short_code = (SELECT short_code FROM public.premium_payments WHERE request_key = 'request-2') WHERE request_key = 'request-1'`))
    await assert.rejects(db.exec(`UPDATE public.premium_payments SET short_code = NULL WHERE request_key = 'request-1'`))
    await assert.rejects(db.exec(`UPDATE public.premium_payments SET short_code = '../bad' WHERE request_key = 'request-1'`))
    assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.premium_payments'::regclass")).rows[0].relrowsecurity, true)
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`)
      await assert.rejects(db.query('SELECT * FROM public.premium_payments'))
      await db.exec('RESET ROLE')
    }
    await db.exec('SET ROLE service_role')
    assert.equal((await db.query('SELECT count(*)::int AS count FROM public.premium_payments')).rows[0].count, 1000)
    await db.exec("UPDATE public.premium_payments SET payment_methods = ARRAY['customer_balance'] WHERE request_key = 'request-1'")
    const row = (await db.query("SELECT payment_methods FROM public.premium_payments WHERE request_key = 'request-1'")).rows[0]
    assert.deepEqual(row.payment_methods, ['customer_balance'])
  } finally { await db.close() }
})
