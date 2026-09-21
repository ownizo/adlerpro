import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePremiumShortLink, safeCheckoutUrl } from './premium-shortlink.server.ts'
import { shortPaymentUrl } from './premium-shortlink-origin.ts'
import { paymentResult } from './premium-payment-status.ts'
import type { PremiumPayment } from './premium-payment-status.ts'

const code = 'X7Km92AbCdEfGh12'
const payment = { short_code: code, status: 'created', checkout_url: 'https://checkout.adlerrochefort.com/c/pay/test', stripe_checkout_session_id: 'cs_test' } as PremiumPayment
const store = (row: PremiumPayment | null) => ({ async byShortCode() { return row } })

test('public active link redirects without HTML, status mutations, or caching', async () => {
  for (const status of ['created', 'pending'] as const) {
    const row = { ...payment, status }
    const before = structuredClone(row)
    const response = await resolvePremiumShortLink(code, store(row))
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('location'), payment.checkout_url)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
    assert.equal(await response.text(), '')
    assert.deepEqual(row, before)
  }
})

test('missing, malformed, paid, expired, failed and incomplete links do not redirect', async () => {
  for (const [row, message] of [
    [null, 'Payment link not found'],
    [{ ...payment, status: 'expired' }, 'This payment link has expired.'],
    [{ ...payment, status: 'paid' }, 'This insurance premium has already been paid.'],
    [{ ...payment, status: 'failed' }, 'This payment link is unavailable.'],
    [{ ...payment, checkout_url: null }, 'This payment link is unavailable.'],
    [{ ...payment, stripe_checkout_session_id: null }, 'This payment link is unavailable.'],
  ] as const) {
    const response = await resolvePremiumShortLink(code, store(row))
    assert.equal(response.headers.has('location'), false)
    const html = await response.text()
    assert.ok(html.includes(message))
    assert.ok(!html.includes('https://checkout'))
  }
  const response = await resolvePremiumShortLink('../bad', { async byShortCode() { throw new Error('must not query') } })
  assert.equal(response.status, 404)
  const unavailable = await resolvePremiumShortLink(code, { async byShortCode() { throw new Error('secret database detail') } })
  assert.equal(unavailable.status, 503)
  assert.ok(!(await unavailable.text()).includes('secret database detail'))
})

test('redirect allowlist rejects arbitrary hosts, credentials, ports, and protocols', async () => {
  for (const url of ['https://evil.example/pay', 'http://checkout.stripe.com/pay', 'javascript:alert(1)', '//checkout.stripe.com/pay', 'https://checkout.stripe.com.evil.example/pay', 'https://checkout.stripe.com@evil.example/pay', 'https://evil@checkout.stripe.com/pay', 'https://checkout.stripe.com:444/pay', 'https://buy.stripe.com/test']) {
    assert.equal(safeCheckoutUrl(url), null)
    const response = await resolvePremiumShortLink(code, store({ ...payment, checkout_url: url }))
    assert.equal(response.headers.has('location'), false)
  }
  assert.equal(safeCheckoutUrl('https://checkout.stripe.com/c/pay/test'), 'https://checkout.stripe.com/c/pay/test')
})

test('short origin is normalized with a safe fixed fallback', () => {
  assert.equal(shortPaymentUrl(code, ''), `https://admin.adlerrochefort.com/p/${code}`)
  assert.equal(shortPaymentUrl(code, 'https://pay.adlerrochefort.com/'), `https://pay.adlerrochefort.com/p/${code}`)
  for (const origin of ['https://pay.example/path', 'https://pay.example/?x=1', 'https://pay.example/#x', 'https://user:pass@pay.example', 'http://pay.example', 'javascript:alert(1)']) assert.throws(() => shortPaymentUrl(code, origin))
  assert.throws(() => shortPaymentUrl('../bad', 'https://pay.example'))
})

test('refreshed Admin results reconstruct the configured short URL without the raw Checkout URL', () => {
  const previous = process.env.PAYMENT_SHORTLINK_ORIGIN
  try {
    process.env.PAYMENT_SHORTLINK_ORIGIN = 'https://pay.adlerrochefort.com/'
    const result = paymentResult({ ...payment, payment_methods: ['customer_balance', 'sepa_debit'] })
    assert.equal(result.shortCode, code)
    assert.equal(result.shortUrl, `https://pay.adlerrochefort.com/p/${code}`)
    assert.deepEqual(result.paymentMethods, ['customer_balance', 'sepa_debit'])
    assert.equal(JSON.stringify(result).includes(payment.checkout_url!), false)
  } finally {
    if (previous === undefined) delete process.env.PAYMENT_SHORTLINK_ORIGIN
    else process.env.PAYMENT_SHORTLINK_ORIGIN = previous
  }
})
