import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectivePolicyStatus, lisbonToday } from './policy-status.ts'

test('derives renewal due and expired from the end date', () => {
  const today = '2026-10-21'
  assert.equal(effectivePolicyStatus('active', '2027-03-01', today), 'active')
  assert.equal(effectivePolicyStatus('active', '2026-11-20', today), 'expiring')
  assert.equal(effectivePolicyStatus('active', '2026-11-21', today), 'active')
  assert.equal(effectivePolicyStatus('active', '2026-10-21', today), 'expiring')
  assert.equal(effectivePolicyStatus('active', '2026-10-20', today), 'expired')
  assert.equal(effectivePolicyStatus('expiring', '2026-10-01', today), 'expired')
  assert.equal(effectivePolicyStatus('active', '2026-10-25T00:00:00Z', today), 'expiring')
})

test('keeps stored final states and policies without an end date', () => {
  assert.equal(effectivePolicyStatus('cancelled', '2027-01-01', '2026-10-21'), 'cancelled')
  assert.equal(effectivePolicyStatus('expired', '2027-01-01', '2026-10-21'), 'expired')
  assert.equal(effectivePolicyStatus('active', '', '2026-10-21'), 'active')
  assert.equal(effectivePolicyStatus('active', undefined, '2026-10-21'), 'active')
})

test('today follows the Lisbon calendar', () => {
  assert.equal(lisbonToday(new Date('2026-10-21T23:30:00Z')), '2026-10-22')
  assert.equal(lisbonToday(new Date('2026-01-15T23:30:00Z')), '2026-01-15')
})
