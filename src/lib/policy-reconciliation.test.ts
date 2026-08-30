import test from 'node:test'
import assert from 'node:assert/strict'

import { reconcilePolicy, type PolicyCandidate, type ExternalPolicyInput } from './policy-reconciliation.ts'

function candidate(overrides: Partial<PolicyCandidate> & Pick<PolicyCandidate, 'id'>): PolicyCandidate {
  return { ...overrides }
}

function external(overrides: Partial<ExternalPolicyInput> & Pick<ExternalPolicyInput, 'provider'>): ExternalPolicyInput {
  return { ...overrides }
}

test('1. provider + externalPolicyId linked via external identity => exact', () => {
  const result = reconcilePolicy(
    external({ provider: 'zurich', externalPolicyId: 'ZP-001' }),
    [
      candidate({ id: 'pol_1', provider: 'zurich', externalIdentities: [{ provider: 'zurich', externalPolicyId: 'ZP-001' }] }),
      candidate({ id: 'pol_2', provider: 'zurich' }),
    ],
  )
  assert.equal(result.status, 'exact')
  assert.equal(result.candidateId, 'pol_1')
  assert.ok(result.signals.includes('external_identity'))
})

test('2. provider + unique normalized policy number => exact', () => {
  const result = reconcilePolicy(
    external({ provider: 'zurich', policyNumber: 'pt-2026/001' }),
    [
      candidate({ id: 'pol_1', provider: 'zurich', policyNumber: 'PT-2026/001' }),
      candidate({ id: 'pol_2', provider: 'zurich', policyNumber: 'PT-2026/002' }),
    ],
  )
  assert.equal(result.status, 'exact')
  assert.equal(result.candidateId, 'pol_1')
  assert.ok(result.signals.includes('policy_number'))
})

test('3. same policy number but different provider => must NOT match (new)', () => {
  const result = reconcilePolicy(
    external({ provider: 'zurich', policyNumber: 'PT-2026/001' }),
    [candidate({ id: 'pol_1', provider: 'allianz', policyNumber: 'PT-2026/001' })],
  )
  assert.equal(result.status, 'new')
  assert.equal(result.candidateId, null)
})

test('4. two candidates from the same provider share the normalized number => ambiguous', () => {
  const result = reconcilePolicy(
    external({ provider: 'zurich', policyNumber: 'PT-2026/001' }),
    [
      candidate({ id: 'pol_1', provider: 'zurich', policyNumber: 'pt-2026/001' }),
      candidate({ id: 'pol_2', provider: 'zurich', policyNumber: 'PT-2026/001' }),
    ],
  )
  assert.equal(result.status, 'ambiguous')
  assert.equal(result.candidateId, null)
  assert.deepEqual(result.candidateIds, ['pol_1', 'pol_2'])
})

test('5. no candidate at all => new', () => {
  const result = reconcilePolicy(external({ provider: 'zurich', policyNumber: 'PT-2026/999' }), [])
  assert.equal(result.status, 'new')
  assert.equal(result.candidateId, null)
  assert.deepEqual(result.candidateIds, [])
})

test('6. missing provider on the external policy => never match by policy number', () => {
  const result = reconcilePolicy(
    external({ provider: '', policyNumber: 'PT-2026/001' }),
    [candidate({ id: 'pol_1', provider: 'zurich', policyNumber: 'PT-2026/001' })],
  )
  assert.equal(result.status, 'new')
  assert.equal(result.candidateId, null)
})

test('7. punctuation in the policy number is not globally stripped', () => {
  const result = reconcilePolicy(
    external({ provider: 'zurich', policyNumber: 'PT-2026/001.4' }),
    [
      // A candidate whose punctuation was stripped is NOT the same
      // normalized number as one that kept it — proves punctuation isn't
      // silently discarded by the default normalizer.
      candidate({ id: 'pol_stripped', provider: 'zurich', policyNumber: 'PT20260014' }),
      candidate({ id: 'pol_exact', provider: 'zurich', policyNumber: 'pt-2026/001.4' }),
    ],
  )
  assert.equal(result.status, 'exact')
  assert.equal(result.candidateId, 'pol_exact')
})

test('candidate with unknown provider is never eligible for a policy-number match, even with the same number', () => {
  const result = reconcilePolicy(
    external({ provider: 'zurich', policyNumber: 'PT-2026/001' }),
    [candidate({ id: 'pol_1', policyNumber: 'PT-2026/001' })],
  )
  assert.equal(result.status, 'new')
})

test('external identity claimed by more than one candidate => ambiguous', () => {
  const result = reconcilePolicy(
    external({ provider: 'zurich', externalPolicyId: 'ZP-001' }),
    [
      candidate({ id: 'pol_1', provider: 'zurich', externalIdentities: [{ provider: 'zurich', externalPolicyId: 'ZP-001' }] }),
      candidate({ id: 'pol_2', provider: 'zurich', externalIdentities: [{ provider: 'zurich', externalPolicyId: 'ZP-001' }] }),
    ],
  )
  assert.equal(result.status, 'ambiguous')
  assert.deepEqual(result.candidateIds, ['pol_1', 'pol_2'])
})
