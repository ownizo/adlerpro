import test from 'node:test'
import assert from 'node:assert/strict'

import { isActiveClaim, normalizeClaimsByPolicy, selectPreferredClaimForPolicy } from './claim-resolution.ts'
import type { Claim } from './types'

function makeClaim(overrides: Partial<Claim>): Claim {
  return {
    id: 'clm_default',
    policyId: 'pol_default',
    title: 'Sinistro',
    description: 'Descricao',
    claimDate: '2026-04-11',
    incidentDate: '2026-04-11',
    estimatedValue: 0,
    status: 'submitted',
    steps: [],
    createdAt: '2026-04-11T10:00:00.000Z',
    ...overrides,
  }
}

test('isActiveClaim treats paid and denied as inactive', () => {
  assert.equal(isActiveClaim(makeClaim({ status: 'submitted' })), true)
  assert.equal(isActiveClaim(makeClaim({ status: 'approved' })), true)
  assert.equal(isActiveClaim(makeClaim({ status: 'paid' })), false)
  assert.equal(isActiveClaim(makeClaim({ status: 'denied' })), false)
})

test('selectPreferredClaimForPolicy prefers most recent active claim', () => {
  const olderActive = makeClaim({
    id: 'clm_old',
    policyId: 'pol_1',
    status: 'under_review',
    createdAt: '2026-04-10T09:00:00.000Z',
  })
  const newerActive = makeClaim({
    id: 'clm_new',
    policyId: 'pol_1',
    status: 'assessment',
    createdAt: '2026-04-11T09:00:00.000Z',
  })
  const newerClosed = makeClaim({
    id: 'clm_closed',
    policyId: 'pol_1',
    status: 'paid',
    createdAt: '2026-04-11T12:00:00.000Z',
  })

  const selected = selectPreferredClaimForPolicy([olderActive, newerClosed, newerActive])

  assert.equal(selected?.id, 'clm_new')
})

test('normalizeClaimsByPolicy keeps one preferred claim per policy', () => {
  const claims = [
    makeClaim({
      id: 'clm_1a',
      policyId: 'pol_1',
      status: 'submitted',
      createdAt: '2026-04-10T08:00:00.000Z',
    }),
    makeClaim({
      id: 'clm_1b',
      policyId: 'pol_1',
      status: 'under_review',
      createdAt: '2026-04-11T08:00:00.000Z',
    }),
    makeClaim({
      id: 'clm_2a',
      policyId: 'pol_2',
      status: 'paid',
      createdAt: '2026-04-09T08:00:00.000Z',
    }),
  ]

  const normalized = normalizeClaimsByPolicy(claims)

  assert.equal(normalized.length, 2)
  assert.deepEqual(normalized.map((claim) => claim.id), ['clm_1b', 'clm_2a'])
})
