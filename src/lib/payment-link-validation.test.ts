import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eurToCents, validatePaymentLinkInput } from './payment-link-validation.ts'

test('EUR decimal conversion preserves exact cents', () => {
  for (const [value, expected] of [['1248.36', 124836], ['1248,36', 124836], ['0.01', 1], ['1.1', 110], ['10', 1000], ['999999.99', 99999999]] as const) assert.equal(eurToCents(value), expected)
})
test('rejects ambiguous, rounded, nonpositive and out-of-range premiums', () => {
  for (const value of ['', '0', '-1', '1.001', '1,248.36', '1.248,36', '1e3', 'Infinity', 'NaN', '1000000', '1.', '.1', 1, null]) assert.throws(() => eurToCents(value))
})
const input = { customerName: 'José Smith', customerEmail: 'client+policy@example.com', amount: '1248.36', insurer: 'Insurer', policyReference: 'POL-1', requestId: 'b45e68aa-251c-4cc6-a7e4-26caf055c543' }
test('validates and trims metadata', () => {
  assert.deepEqual(validatePaymentLinkInput({ ...input, customerName: ' José Smith ' }), { customerName: 'José Smith', customerEmail: input.customerEmail, amountCents: 124836, insurer: 'Insurer', policyReference: 'POL-1', requestId: input.requestId })
})
test('rejects missing fields, invalid emails and untrusted request identifiers', () => {
  for (const key of Object.keys(input)) assert.throws(() => validatePaymentLinkInput({ ...input, [key]: '' }))
  for (const patch of [{ customerName: '123' }, { customerEmail: 'a@b' }, { insurer: 'x'.repeat(501) }, { policyReference: 'x\n' }, { requestId: 'arbitrary' }, { amount: {} }]) assert.throws(() => validatePaymentLinkInput({ ...input, ...patch }))
  assert.throws(() => validatePaymentLinkInput(null))
})
