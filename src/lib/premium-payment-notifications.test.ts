import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dispatchPremiumNotifications } from './premium-payment-notifications.server.ts'
import { premiumPaymentEmail } from './premium-payment-email.ts'
import type { PremiumEmail, NotificationStatus } from './premium-payment-email.ts'
import type { PremiumNotification, PremiumNotificationStore } from './premium-notifications-store.server.ts'
import type { PremiumPayment } from './premium-payment-status.ts'

const now = Date.now()
const payment = {
  id: 'payment-1', status: 'pending', customer_name: '<Client & Name>', customer_email: 'client@example.com',
  insurer: 'Hiscox', policy_reference: 'POL-123', amount_cents: 124836, currency: 'eur',
  short_code: 'X7Km92AbCdEfGh12', payment_methods: ['customer_balance', 'sepa_debit'], livemode: true,
} as PremiumPayment
const from = 'Adler & Rochefort <noreply@adlerrochefort.com>'
function fixture() {
  const rows: PremiumNotification[] = []
  const deliveries = new Map<string, PremiumEmail>()
  let failCustomer = false
  let failSave = false
  let attempts = 0
  let currentStatus: PremiumPayment['status'] = 'pending'
  const enqueue = (status: NotificationStatus) => {
    for (const audience of status === 'expired' ? ['internal'] as const : ['customer', 'internal'] as const) {
      const id = `${status}-${audience}`
      if (!rows.some(row => row.id === id)) rows.push({
        id, payment_id: payment.id, status, audience, payment_snapshot: { ...payment, status },
        first_attempt_at: null, delivery_payload: null, sent_at: null, skipped_at: null,
      })
    }
  }
  const store: PremiumNotificationStore = {
    async currentStatus() { return currentStatus },
    async list() { return structuredClone(rows.filter(row => !row.sent_at && !row.skipped_at)) },
    async prepare(notification, payload) {
      const row = rows.find(item => item.id === notification.id)!
      if (!row.first_attempt_at) { row.first_attempt_at = new Date(now).toISOString(); row.delivery_payload = structuredClone(payload) }
      return structuredClone(row)
    },
    async sent(id) { if (failSave) throw new Error('DB failure'); rows.find(row => row.id === id)!.sent_at = new Date(now).toISOString() },
    async skip(id) { rows.find(row => row.id === id)!.skipped_at = new Date(now).toISOString() },
  }
  const send = async (payload: PremiumEmail, key: string) => {
    attempts++
    if (failCustomer && payload.to[0] === payment.customer_email) throw new Error('provider unavailable')
    if (deliveries.has(key)) assert.deepEqual(deliveries.get(key), payload)
    else deliveries.set(key, structuredClone(payload))
    return `email-${key}`
  }
  const dispatch = (status: NotificationStatus, time = now) => { currentStatus = status; return dispatchPremiumNotifications({ ...payment, status }, store, send, from, time) }
  return { rows, deliveries, enqueue, dispatch, store, send, get attempts() { return attempts }, set failCustomer(value: boolean) { failCustomer = value }, set failSave(value: boolean) { failSave = value } }
}

test('pending -> paid sends once per audience/status, including concurrent and repeated webhooks', async () => {
  const f = fixture()
  f.enqueue('pending')
  await Promise.all([f.dispatch('pending'), f.dispatch('pending')])
  await f.dispatch('pending')
  assert.equal(f.deliveries.size, 2)
  f.enqueue('paid')
  await f.dispatch('paid')
  const attempts = f.attempts
  await f.dispatch('paid')
  assert.equal(f.attempts, attempts)
  assert.equal(f.deliveries.size, 4)
  assert.ok([...f.deliveries.values()].some(email => email.subject === 'Your payment has been confirmed'))
})
test('one recipient failure does not block the other and only the failed recipient retries', async () => {
  const f = fixture()
  f.enqueue('failed'); f.failCustomer = true
  await assert.rejects(f.dispatch('failed'))
  assert.equal(f.deliveries.size, 1)
  assert.equal([...f.deliveries.values()][0].to[0], 'insurance@adlerrochefort.com')
  f.failCustomer = false
  await f.dispatch('failed')
  assert.equal(f.deliveries.size, 2)
  assert.equal(f.attempts, 3)
})
test('provider acceptance followed by DB failure reuses frozen payload and idempotency key', async () => {
  const f = fixture()
  f.enqueue('paid'); f.failSave = true
  await assert.rejects(f.dispatch('paid'))
  assert.equal(f.deliveries.size, 2)
  f.failSave = false
  await dispatchPremiumNotifications({ ...payment, status: 'paid' }, f.store, f.send, 'changed@example.com', now)
  assert.equal(f.deliveries.size, 2)
  assert.ok(f.rows.every(row => row.sent_at))
})
test('ambiguous attempts beyond safe provider window are held rather than resent', async () => {
  const f = fixture()
  f.enqueue('paid'); f.failSave = true
  await assert.rejects(f.dispatch('paid'))
  f.failSave = false
  const attempts = f.attempts
  await assert.rejects(f.dispatch('paid', now + 23 * 60 * 60 * 1000))
  assert.equal(f.attempts, attempts)
  assert.equal(f.deliveries.size, 2)
})
test('obsolete pending/failure messages are skipped, expired notifies internal only', async () => {
  const f = fixture()
  f.enqueue('pending'); f.enqueue('failed'); f.enqueue('paid')
  await f.dispatch('paid')
  assert.equal(f.deliveries.size, 2)
  assert.equal(f.rows.filter(row => row.skipped_at).length, 4)
  const expired = fixture()
  expired.enqueue('expired'); await expired.dispatch('expired')
  assert.equal(expired.deliveries.size, 1)
  assert.equal([...expired.deliveries.values()][0].to[0], 'insurance@adlerrochefort.com')
})
test('English emails include exact premium details, honest method labels, safe HTML and short links', () => {
  const email = premiumPaymentEmail(payment, 'pending', 'customer', from)
  for (const value of ['1248.36 EUR', 'Currency: EUR', payment.customer_name, payment.customer_email, 'Hiscox', 'POL-123', 'Bank Transfer', 'SEPA Direct Debit', 'Status: Pending', '/p/X7Km92AbCdEfGh12', 'may take time to confirm']) assert.ok(email.text.includes(value))
  assert.ok(email.html.includes('&lt;Client &amp; Name&gt;'))
  assert.ok(!email.html.includes('<Client'))
  assert.ok(!email.text.includes('checkout.stripe.com'))
  assert.equal(email.replyTo, 'insurance@adlerrochefort.com')
  assert.match(premiumPaymentEmail({ ...payment, livemode: false }, 'paid', 'internal', from).subject, /^\[TEST\]/)
})

test('a stale reconciled snapshot cannot suppress a newer queued paid notification', async () => {
  const f = fixture()
  f.enqueue('paid')
  f.store.currentStatus = async () => 'paid'
  await dispatchPremiumNotifications({ ...payment, status: 'pending' }, f.store, f.send, from, now)
  assert.equal(f.deliveries.size, 2)
  assert.ok(f.rows.every(row => row.sent_at && !row.skipped_at))
})
