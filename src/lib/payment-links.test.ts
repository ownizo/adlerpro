import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPremiumLinkWithClient } from './payment-links.server.ts'
import { validatePaymentLinkInput } from './payment-link-validation.ts'

const data = validatePaymentLinkInput({ customerName: 'Client Name', customerEmail: 'client+premium@example.com', insurer: 'Insurer', policyReference: 'POL-1', amount: '1248.36', requestId: 'b45e68aa-251c-4cc6-a7e4-26caf055c543' })
test('creates an exact one-time premium and restricts payment to one completion', async () => {
  const calls: { kind: string; params: any; options: any }[] = []
  const client = {
    prices: { create: async (params: any, options: any) => { calls.push({ kind: 'price', params, options }); return { id: 'price_test' } } },
    paymentLinks: { create: async (params: any, options: any) => { calls.push({ kind: 'link', params, options }); return { url: 'https://buy.stripe.com/test_example', livemode: false } } },
  } as unknown as Parameters<typeof createPremiumLinkWithClient>[0]
  const result = await createPremiumLinkWithClient(client, 'prod_test', data, 'admin-id')
  await createPremiumLinkWithClient(client, 'prod_test', data, 'admin-id')
  assert.equal(calls[0].params.unit_amount, 124836)
  assert.equal(calls[0].params.currency, 'eur')
  assert.equal(calls[0].params.product, 'prod_test')
  assert.equal(calls[0].params.recurring, undefined)
  assert.deepEqual(calls[1].params.line_items, [{ price: 'price_test', quantity: 1, adjustable_quantity: { enabled: false } }])
  assert.deepEqual(calls[1].params.automatic_tax, { enabled: false })
  assert.deepEqual(calls[1].params.invoice_creation, { enabled: false })
  assert.deepEqual(calls[1].params.restrictions, { completed_sessions: { limit: 1 } })
  assert.equal(calls[1].params.allow_promotion_codes, false)
  assert.equal(calls[1].params.submit_type, 'pay')
  assert.deepEqual(calls[1].params.payment_intent_data.metadata, calls[1].params.metadata)
  assert.equal(calls[1].params.metadata.purpose, 'insurance_premium')
  assert.equal(calls[0].options.idempotencyKey, calls[2].options.idempotencyKey)
  assert.equal(calls[1].options.idempotencyKey, calls[3].options.idempotencyKey)
  assert.notEqual(calls[0].options.idempotencyKey, calls[1].options.idempotencyKey)
  assert.equal(new URL(result.url).searchParams.get('prefilled_email'), data.customerEmail)
  assert.equal(result.livemode, false)
})
test('does not expose SDK error details', async () => {
  const client = { prices: { create: async () => { throw new Error('sensitive request details') } } } as unknown as Parameters<typeof createPremiumLinkWithClient>[0]
  await assert.rejects(createPremiumLinkWithClient(client, 'prod_test', data, 'admin-id'), error => error instanceof Error && !error.message.includes('sensitive') && error.message.includes('Unable to create'))
})
