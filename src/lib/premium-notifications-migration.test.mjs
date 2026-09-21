import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('notification outbox is atomic, deduplicated, rerunnable, and service-role only', async () => {
  const db = new PGlite()
  const sql = name => readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8')
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);')
    await db.exec(await sql('20260919_premium_payments.sql'))
    await db.exec(await sql('20260921_premium_payment_methods_short_links.sql'))
    await db.exec(`INSERT INTO public.premium_payments (request_key, request_fingerprint, customer_name, customer_email, amount_cents, insurer, policy_reference, livemode)
      VALUES ('request', repeat('a',64), 'Client', 'client@example.com', 124836, 'Hiscox', 'POL-123', false)`)
    const migration = await sql('20260921_premium_payment_notifications.sql')
    await db.exec(migration)
    assert.equal((await db.query('SELECT * FROM public.premium_payment_notifications')).rows.length, 0)
    await db.exec('SET ROLE service_role')
    await db.exec("UPDATE public.premium_payments SET status = 'pending'")
    await db.exec("UPDATE public.premium_payments SET status = 'pending'")
    const pending = (await db.query('SELECT * FROM public.premium_payment_notifications ORDER BY audience')).rows
    assert.equal(pending.length, 2)
    assert.equal(pending[0].payment_snapshot.amount_cents, 124836)
    assert.equal(pending[0].payment_snapshot.status, 'pending')
    await db.exec("UPDATE public.premium_payments SET status = 'failed'; UPDATE public.premium_payments SET status = 'pending'")
    assert.equal((await db.query('SELECT * FROM public.premium_payment_notifications')).rows.length, 4)
    await db.exec("UPDATE public.premium_payments SET status = 'paid', paid_at = now()")
    assert.equal((await db.query("SELECT * FROM public.premium_payment_notifications WHERE status = 'paid'")).rows.length, 2)
    // Both state and queued intent roll back if their transaction fails.
    await db.exec('BEGIN')
    await db.exec("UPDATE public.premium_payments SET status = 'expired', paid_at = NULL")
    await db.exec('ROLLBACK')
    assert.equal((await db.query("SELECT * FROM public.premium_payment_notifications WHERE status = 'expired'")).rows.length, 0)
    assert.equal((await db.query('SELECT status FROM public.premium_payments')).rows[0].status, 'paid')
    await db.exec('RESET ROLE')
    await db.exec(migration)
    assert.equal((await db.query('SELECT * FROM public.premium_payment_notifications')).rows.length, 6)
    await db.exec(`INSERT INTO public.premium_payments (request_key, request_fingerprint, customer_name, customer_email, amount_cents, insurer, policy_reference, livemode)
      VALUES ('expired-request', repeat('b',64), 'Client', 'client@example.com', 100, 'Hiscox', 'POL-2', false)`)
    await db.exec("UPDATE public.premium_payments SET status = 'expired' WHERE request_key = 'expired-request'")
    const expired = (await db.query("SELECT audience FROM public.premium_payment_notifications WHERE status = 'expired'")).rows
    assert.deepEqual(expired, [{ audience: 'internal' }])
    assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.premium_payment_notifications'::regclass")).rows[0].relrowsecurity, true)
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`)
      await assert.rejects(db.query('SELECT * FROM public.premium_payment_notifications'))
      await assert.rejects(db.exec("UPDATE public.premium_payment_notifications SET sent_at = now()"))
      await db.exec('RESET ROLE')
    }
    await assert.rejects(db.exec(`INSERT INTO public.premium_payment_notifications (payment_id,status,audience,payment_snapshot)
      SELECT payment_id,status,audience,payment_snapshot FROM public.premium_payment_notifications LIMIT 1`))
  } finally { await db.close() }
})
