import test from 'node:test'
import assert from 'node:assert/strict'

import { sortPolicyOwnerOptionsByProviderPreference } from './carrier-policy-owner-options.ts'
import type { PolicyOwnerOptionSummary } from './types.ts'

/**
 * carrier-policy-owner-options.test.ts — Reconciliation Editor hardening:
 * proves the manual "existing policy" selector orders same-provider
 * policies first WITHOUT ever dropping a policy from the list (ordering
 * only, never filtering — the actual owner-scoping is a server-side SQL
 * filter in listPoliciesForOwner, tested separately by source
 * inspection).
 */

function option(overrides: Partial<PolicyOwnerOptionSummary> = {}): PolicyOwnerOptionSummary {
  return {
    id: 'pol_x',
    insurer: 'MGEN',
    policyNumber: '000',
    type: 'health',
    status: 'active',
    ...overrides,
  }
}

test('sortPolicyOwnerOptionsByProviderPreference: same-provider policies come first', () => {
  const options = [
    option({ id: 'pol_allianz', insurer: 'Allianz' }),
    option({ id: 'pol_mgen', insurer: 'MGEN' }),
  ]
  const sorted = sortPolicyOwnerOptionsByProviderPreference(options, 'mgen')
  assert.deepEqual(sorted.map((o) => o.id), ['pol_mgen', 'pol_allianz'])
})

test('sortPolicyOwnerOptionsByProviderPreference: never drops a policy — same length in, same length out', () => {
  const options = [
    option({ id: 'a', insurer: 'Zurich' }),
    option({ id: 'b', insurer: 'MGEN' }),
    option({ id: 'c', insurer: 'Hiscox' }),
  ]
  const sorted = sortPolicyOwnerOptionsByProviderPreference(options, 'mgen')
  assert.equal(sorted.length, 3)
  assert.deepEqual([...sorted.map((o) => o.id)].sort(), ['a', 'b', 'c'])
})

test('sortPolicyOwnerOptionsByProviderPreference: is case/substring tolerant, reusing the same rule the reconciliation engine uses', () => {
  const options = [
    option({ id: 'pol_lower', insurer: 'mgen seguros' }),
    option({ id: 'pol_other', insurer: 'Allianz' }),
  ]
  const sorted = sortPolicyOwnerOptionsByProviderPreference(options, 'mgen')
  assert.equal(sorted[0]!.id, 'pol_lower')
})

test('sortPolicyOwnerOptionsByProviderPreference: does not mutate the input array', () => {
  const options = [option({ id: 'a', insurer: 'Allianz' }), option({ id: 'b', insurer: 'MGEN' })]
  const original = [...options]
  sortPolicyOwnerOptionsByProviderPreference(options, 'mgen')
  assert.deepEqual(options, original)
})

test('sortPolicyOwnerOptionsByProviderPreference: an empty list stays empty', () => {
  assert.deepEqual(sortPolicyOwnerOptionsByProviderPreference([], 'mgen'), [])
})

test('sortPolicyOwnerOptionsByProviderPreference: no same-provider policy — order is otherwise unchanged (stable sort)', () => {
  const options = [option({ id: 'a', insurer: 'Allianz' }), option({ id: 'b', insurer: 'Zurich' })]
  const sorted = sortPolicyOwnerOptionsByProviderPreference(options, 'mgen')
  assert.deepEqual(sorted.map((o) => o.id), ['a', 'b'])
})
