import { test } from 'node:test'
import assert from 'node:assert/strict'
import Stripe from 'stripe'
import { createPremiumCheckoutWithClient, reconcilePremiumPayment } from './payment-links.server.ts'
import { validatePaymentLinkInput } from './payment-link-validation.ts'
import { checkoutStatus, assertPremiumSession } from './premium-payment-status.ts'
import type { PremiumPayment } from './premium-payment-status.ts'
import type { PremiumPaymentStore } from './premium-payments-store.server.ts'
import { handlePremiumWebhookWithDependencies } from './premium-payment-webhook.server.ts'

const data = validatePaymentLinkInput({ customerName: 'Client Name', customerEmail: 'client+premium@example.com', insurer: 'Insurer', policyReference: 'POL-1', amount: '1248.36', requestId: 'b45e68aa-251c-4cc6-a7e4-26caf055c543' })
const paymentId = 'ec0ae50c-e5df-4e68-bd85-026940d21af4'
const origin = 'https://admin.example.com'

function fixture() {
  let row: PremiumPayment | null = null
  let failUpdate = false
  let conflict = false
  const customers: Stripe.Customer[] = []
  const customerCalls: { kind: string; params: any; options?: any }[] = []
  const calls: { kind: string; params: any; options: any }[] = []
  const session = {
    id: 'cs_test_premium', object: 'checkout.session', mode: 'payment', currency: 'eur',
    amount_total: 124836, amount_subtotal: 124836, livemode: false, status: 'open', payment_status: 'unpaid',
    payment_intent: null, url: 'https://checkout.stripe.com/c/pay/test_premium',
    metadata: { purpose: 'insurance_premium', premium_payment_id: paymentId },
  } as unknown as Stripe.Checkout.Session
  const store: PremiumPaymentStore = {
    async reserve(input) {
      row ??= { ...input, id: paymentId, stripe_checkout_session_id: null, stripe_payment_intent_id: null, checkout_url: null, status: 'created', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), paid_at: null, version: 0 }
      return structuredClone(row)
    },
    async get() { if (!row) throw new Error('Not found'); return structuredClone(row) },
    async bySession(id) { if (row?.stripe_checkout_session_id !== id) throw new Error('Not found'); return structuredClone(row) },
    async update(current, patch) {
      if (failUpdate) throw new Error('Database unavailable')
      if (conflict) { conflict = false; return null }
      if (row?.version !== current.version) return null
      row = { ...row, ...patch, version: row.version + 1 }
      return structuredClone(row)
    },
  }
  const stripe = new Stripe('sk_test_unit_test_only')
  stripe.customers.list = ((params: any) => {
    customerCalls.push({ kind: 'list', params })
    return { async *[Symbol.asyncIterator]() { yield* customers } }
  }) as unknown as typeof stripe.customers.list
  stripe.customers.create = (async (params: any, options: any) => {
    customerCalls.push({ kind: 'create', params, options })
    return { id: 'cus_premium', livemode: false, ...params }
  }) as unknown as typeof stripe.customers.create
  stripe.products.retrieve = (async () => ({ id: 'prod_test', active: true, livemode: false })) as unknown as typeof stripe.products.retrieve
  stripe.prices.create = (async (params: any, options: any) => { calls.push({ kind: 'price', params, options }); return { id: 'price_test' } }) as unknown as typeof stripe.prices.create
  stripe.checkout.sessions.create = (async (params: any, options: any) => { calls.push({ kind: 'session', params, options }); return structuredClone(session) }) as unknown as typeof stripe.checkout.sessions.create
  stripe.checkout.sessions.retrieve = (async () => structuredClone(session)) as unknown as typeof stripe.checkout.sessions.retrieve
  stripe.checkout.sessions.list = (async () => ({ data: [structuredClone(session)] })) as unknown as typeof stripe.checkout.sessions.list
  const create = () => createPremiumCheckoutWithClient(stripe, store, 'prod_test', data, 'admin-id', origin)
  return { stripe, store, session, calls, customerCalls, customers, create, get row() { return row! }, set failUpdate(value: boolean) { failUpdate = value }, set conflict(value: boolean) { conflict = value } }
}

function intent(status: Stripe.PaymentIntent.Status, lastError = false) {
  return { id: 'pi_premium', object: 'payment_intent', amount: 124836, amount_received: status === 'succeeded' ? 124836 : 0, currency: 'eur', livemode: false, status, last_payment_error: lastError ? { message: 'Declined' } : null, metadata: { purpose: 'insurance_premium', premium_payment_id: paymentId } } as unknown as Stripe.PaymentIntent
}

test('creates exact EUR Checkout using the exact allowed methods and Customer; no invoice/tax/discount/subscription', async () => {
  const f = fixture()
  const result = await f.create()
  const [price, checkout] = f.calls
  assert.equal(price.params.product, 'prod_test')
  assert.equal(price.params.unit_amount, 124836)
  assert.equal(price.params.currency, 'eur')
  assert.equal(price.params.recurring, undefined)
  assert.equal(checkout.params.mode, 'payment')
  assert.equal(checkout.params.ui_mode, 'hosted_page')
  assert.deepEqual(checkout.params.payment_method_types, ['card', 'mb_way', 'revolut_pay', 'sepa_debit', 'customer_balance'])
  for (const method of ['amazon_pay', 'link', 'klarna', 'bancontact', 'eps', 'satispay', 'multibanco', 'us_bank_account', 'apple_pay', 'google_pay']) {
    assert.equal(checkout.params.payment_method_types.includes(method), false, `${method} must not be an explicit payment method`)
  }
  assert.equal(checkout.params.currency, 'eur')
  assert.equal(checkout.params.customer, 'cus_premium')
  assert.equal(checkout.params.customer_email, undefined)
  assert.deepEqual(checkout.params.wallet_options, { link: { display: 'never' } })
  assert.deepEqual(checkout.params.payment_method_options, {
    customer_balance: { funding_type: 'bank_transfer', bank_transfer: { type: 'eu_bank_transfer' } },
  })
  assert.deepEqual(f.customerCalls[0], { kind: 'list', params: { email: data.customerEmail, limit: 100 } })
  assert.deepEqual(f.customerCalls[1].params, {
    name: data.customerName, email: data.customerEmail,
    metadata: { purpose: 'insurance_premium_customer', customer_name: data.customerName, customer_email: data.customerEmail },
  })
  assert.deepEqual(checkout.params.adaptive_pricing, { enabled: false })
  assert.deepEqual(checkout.params.automatic_tax, { enabled: false })
  assert.deepEqual(checkout.params.invoice_creation, { enabled: false })
  assert.equal(checkout.params.allow_promotion_codes, false)
  for (const key of ['discounts', 'subscription_data', 'shipping_options', 'automatic_surcharge']) assert.equal(checkout.params[key], undefined)
  assert.deepEqual(checkout.params.line_items, [{ price: 'price_test', quantity: 1, adjustable_quantity: { enabled: false } }])
  assert.deepEqual(checkout.params.payment_intent_data.metadata, checkout.params.metadata)
  assert.deepEqual(checkout.params.metadata, { purpose: 'insurance_premium', premium_payment_id: paymentId, created_by: 'admin-id', customer_name: data.customerName, customer_email: data.customerEmail, insurer: data.insurer, policy_reference: data.policyReference })
  assert.equal(checkout.params.success_url, `${origin}/admin/payment-links?session_id={CHECKOUT_SESSION_ID}`)
  assert.equal(checkout.params.cancel_url, `${origin}/admin/payment-links?cancelled=1`)
  assert.equal(result.url, f.session.url)
  assert.equal(new URL(result.url!).searchParams.has('prefilled_email'), false)
  assert.equal(result.status, 'created')
  assert.equal(result.livemode, false)
})

test('reuses an exact-email Customer in the payment environment without creating another', async () => {
  const f = fixture()
  f.customers.push(
    { id: 'cus_other_email', email: 'other@example.com', livemode: false } as Stripe.Customer,
    { id: 'cus_other_mode', email: data.customerEmail, livemode: true } as Stripe.Customer,
    { id: 'cus_existing', email: data.customerEmail, livemode: false } as Stripe.Customer,
  )
  await f.create()
  assert.equal(f.customerCalls.filter(call => call.kind === 'create').length, 0)
  assert.equal(f.calls[1].params.customer, 'cus_existing')
  assert.equal(f.calls[1].params.customer_email, undefined)
})

test('persistent retries reuse the session; partial failures reuse distinct Stripe keys', async () => {
  const f = fixture()
  f.failUpdate = true
  await assert.rejects(f.create())
  f.failUpdate = false
  const result = await f.create()
  assert.equal(f.calls[0].options.idempotencyKey, f.calls[2].options.idempotencyKey)
  assert.equal(f.calls[1].options.idempotencyKey, f.calls[3].options.idempotencyKey)
  assert.notEqual(f.calls[0].options.idempotencyKey, f.calls[1].options.idempotencyKey)
  const creations = f.customerCalls.filter(call => call.kind === 'create')
  assert.equal(creations.length, 2)
  assert.equal(creations[0].options.idempotencyKey, `insurance-premium:admin-id:${data.requestId}:customer`)
  assert.equal(creations[0].options.idempotencyKey, creations[1].options.idempotencyKey)
  assert.notEqual(creations[0].options.idempotencyKey, f.calls[0].options.idempotencyKey)
  assert.notEqual(creations[0].options.idempotencyKey, f.calls[1].options.idempotencyKey)
  assert.equal((await f.create()).sessionId, result.sessionId)
  assert.equal(f.calls.length, 4)
  await assert.rejects(createPremiumCheckoutWithClient(f.stripe, f.store, 'prod_test', { ...data, amountCents: 10 }, 'admin-id', origin), /different payment details/)
})

test('refuses to recreate an uncertain attempt after the Stripe idempotency window', async () => {
  const f = fixture()
  f.failUpdate = true
  await assert.rejects(f.create())
  f.row.created_at = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  f.failUpdate = false
  await assert.rejects(f.create(), /too old/)
  assert.equal(f.calls.length, 2)
})

test('completed unpaid stays pending; delayed methods settle later or fail', async () => {
  const f = fixture()
  await f.create()
  f.session.status = 'complete'
  f.session.payment_intent = intent('processing')
  assert.equal((await reconcilePremiumPayment(f.stripe, f.store, paymentId, f.session.id)).status, 'pending')
  assert.equal(f.row.paid_at, null)
  f.session.payment_intent = intent('requires_payment_method', true)
  assert.equal((await reconcilePremiumPayment(f.stripe, f.store, paymentId, f.session.id)).status, 'failed')
  f.session.payment_intent = intent('succeeded')
  f.session.payment_status = 'paid'
  f.conflict = true
  assert.equal((await reconcilePremiumPayment(f.stripe, f.store, paymentId, f.session.id)).status, 'paid')
  assert.ok(f.row.paid_at)
  const paidAt = f.row.paid_at
  f.session.payment_intent = intent('requires_payment_method', true)
  f.session.payment_status = 'unpaid'
  assert.equal((await reconcilePremiumPayment(f.stripe, f.store, paymentId, f.session.id)).status, 'paid')
  assert.equal(f.row.paid_at, paidAt)
})

test('expiry is distinct from pending and currency/amount/identity mismatches cannot mark paid', async () => {
  const f = fixture()
  await f.create()
  f.session.status = 'expired'
  assert.equal(checkoutStatus(f.session), 'expired')
  f.session.status = 'complete'
  assert.equal(checkoutStatus(f.session), 'pending')
  for (const patch of [{ currency: 'usd' }, { amount_total: 124837 }, { livemode: true }, { metadata: { premium_payment_id: 'other' } }, { payment_intent: { ...intent('succeeded'), amount_received: 1 } }]) {
    assert.throws(() => assertPremiumSession({ ...f.session, ...patch } as Stripe.Checkout.Session, f.row))
  }
})

const secret = 'whsec_local_unit_test_only'
function signedRequest(stripe: Stripe, payload: string, timestamp?: number) {
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp })
  return new Request('https://admin.example.com/api/stripe-webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': header } })
}
function eventPayload(type: string, object: unknown) {
  return JSON.stringify({ id: 'evt_unit', object: 'event', type, livemode: false, data: { object } })
}

for (const method of ['sepa_debit', 'customer_balance'] as const) {
  for (const outcome of ['succeeded', 'failed'] as const) {
    test(`${method}: completion stays Pending until actual ${outcome} settlement`, async () => {
      const f = fixture()
      await f.create()
      const pendingIntent = {
        ...intent(method === 'sepa_debit' ? 'processing' : 'requires_action'),
        payment_method_types: [method],
        ...(method === 'customer_balance' ? { next_action: { type: 'display_bank_transfer_instructions' } } : {}),
      } as Stripe.PaymentIntent
      f.session.payment_intent = pendingIntent
      // Instructions can already exist while the Checkout Session is still open.
      assert.equal((await reconcilePremiumPayment(f.stripe, f.store, paymentId, f.session.id)).status, 'pending')
      f.session.status = 'complete'
      const completed = eventPayload('checkout.session.completed', f.session)
      assert.equal((await handlePremiumWebhookWithDependencies(signedRequest(f.stripe, completed), f.stripe, secret, f.store)).status, 200)
      assert.equal(f.row.status, 'pending')
      assert.equal(f.row.paid_at, null)
      f.session.payment_intent = { ...intent('processing'), payment_method_types: [method] }
      const processing = eventPayload('payment_intent.processing', f.session.payment_intent)
      assert.equal((await handlePremiumWebhookWithDependencies(signedRequest(f.stripe, processing), f.stripe, secret, f.store)).status, 200)
      assert.equal(f.row.status, 'pending')
      f.session.payment_intent = {
        ...intent(outcome === 'succeeded' ? 'succeeded' : 'requires_payment_method', outcome === 'failed'),
        payment_method_types: [method],
      }
      for (const type of [
        outcome === 'succeeded' ? 'payment_intent.succeeded' : 'payment_intent.payment_failed',
        outcome === 'succeeded' ? 'checkout.session.async_payment_succeeded' : 'checkout.session.async_payment_failed',
      ]) {
        const payload = eventPayload(type, type.startsWith('checkout.') ? f.session : f.session.payment_intent)
        assert.equal((await handlePremiumWebhookWithDependencies(signedRequest(f.stripe, payload), f.stripe, secret, f.store)).status, 200)
        assert.equal(f.row.status, outcome === 'succeeded' ? 'paid' : 'failed')
        assert.equal(Boolean(f.row.paid_at), outcome === 'succeeded')
      }
      // A delayed completion event must not override the current settlement result.
      assert.equal((await handlePremiumWebhookWithDependencies(signedRequest(f.stripe, completed), f.stripe, secret, f.store)).status, 200)
      assert.equal(f.row.status, outcome === 'succeeded' ? 'paid' : 'failed')
    })
  }
}

test('webhook rejects missing, invalid, stale and tampered signatures before storage access', async () => {
  const f = fixture()
  const payload = eventPayload('checkout.session.completed', f.session)
  const missing = new Request('https://admin.example.com/api/stripe-webhook', { method: 'POST', body: payload })
  const tampered = signedRequest(f.stripe, payload)
  const changed = new Request(tampered.url, { method: 'POST', headers: tampered.headers, body: payload + ' ' })
  const invalid = new Request(tampered.url, { method: 'POST', headers: { 'stripe-signature': 'invalid' }, body: payload })
  for (const request of [missing, changed, invalid, signedRequest(f.stripe, payload, 1)]) {
    assert.equal((await handlePremiumWebhookWithDependencies(request, f.stripe, secret, f.store)).status, 400)
  }
  assert.equal(Boolean(f.row), false)
  assert.equal((await handlePremiumWebhookWithDependencies(signedRequest(f.stripe, payload), f.stripe, '', f.store)).status, 503)
})

test('signed webhooks cover session/intent events, duplicates, early delivery, and DB retry', async () => {
  const f = fixture()
  f.failUpdate = true
  await assert.rejects(f.create()) // Reservation exists, session response has not been saved.
  f.session.status = 'complete'
  f.session.payment_intent = intent('processing')
  const completed = eventPayload('checkout.session.completed', f.session)
  assert.equal((await handlePremiumWebhookWithDependencies(signedRequest(f.stripe, completed), f.stripe, secret, f.store)).status, 500)
  f.failUpdate = false
  assert.equal((await handlePremiumWebhookWithDependencies(signedRequest(f.stripe, completed), f.stripe, secret, f.store)).status, 200)
  assert.equal(f.row.status, 'pending')
  for (const type of ['checkout.session.async_payment_failed', 'payment_intent.payment_failed']) {
    f.session.payment_intent = intent('requires_payment_method', true)
    const payload = eventPayload(type, type.startsWith('checkout.') ? f.session : f.session.payment_intent)
    assert.equal((await handlePremiumWebhookWithDependencies(signedRequest(f.stripe, payload), f.stripe, secret, f.store)).status, 200)
    assert.equal(f.row.status, 'failed')
  }
  f.session.payment_status = 'paid'
  f.session.payment_intent = intent('succeeded')
  for (const type of ['checkout.session.async_payment_succeeded', 'payment_intent.succeeded', 'checkout.session.completed']) {
    const payload = eventPayload(type, type.startsWith('checkout.') ? f.session : f.session.payment_intent)
    for (let duplicate = 0; duplicate < 2; duplicate++) assert.equal((await handlePremiumWebhookWithDependencies(signedRequest(f.stripe, payload), f.stripe, secret, f.store)).status, 200)
    assert.equal(f.row.status, 'paid')
  }
  // Replay the old unpaid completion: current Stripe state remains authoritative.
  assert.equal((await handlePremiumWebhookWithDependencies(signedRequest(f.stripe, completed), f.stripe, secret, f.store)).status, 200)
  assert.equal(f.row.status, 'paid')
})

test('webhook ignores unrelated events and persists expiration without marking it paid', async () => {
  const f = fixture()
  const unrelated = eventPayload('checkout.session.completed', { ...f.session, metadata: {} })
  assert.equal((await handlePremiumWebhookWithDependencies(signedRequest(f.stripe, unrelated), f.stripe, secret, f.store)).status, 200)
  const unsupported = eventPayload('customer.created', {})
  assert.equal((await handlePremiumWebhookWithDependencies(signedRequest(f.stripe, unsupported), f.stripe, secret, f.store)).status, 200)
  assert.equal(Boolean(f.row), false)
  await f.create()
  f.session.status = 'expired'
  const expired = eventPayload('checkout.session.expired', f.session)
  assert.equal((await handlePremiumWebhookWithDependencies(signedRequest(f.stripe, expired), f.stripe, secret, f.store)).status, 200)
  assert.equal(f.row.status, 'expired')
  assert.equal(f.row.paid_at, null)
})
