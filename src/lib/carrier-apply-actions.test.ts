import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isValidCustomerApplyAction,
  isValidPolicyApplyAction,
  isRowReadyToApply,
  isRowApplicable,
  checkOwnerConsistency,
  computeRunApplyReadiness,
  describeRowApplyResult,
  type ApplyActionRowState,
} from './carrier-apply-actions.ts'

/**
 * carrier-apply-actions.test.ts — CRM3 Block 4: proves the "accepted ≠
 * apply" boundary. Every accepted row must ALSO carry an explicit,
 * resolved apply action before it can be applied — see requirement
 * "NEVER infer a destructive/create/update action merely because
 * decision_status = accepted".
 */

function baseState(overrides: Partial<ApplyActionRowState> = {}): ApplyActionRowState {
  return {
    decisionStatus: 'accepted',
    customerApplyAction: null,
    policyApplyAction: null,
    selectedIndividualClientId: null,
    selectedCompanyId: null,
    selectedPolicyId: null,
    participantMode: null,
    selectedPolicyholderIndividualClientId: null,
    selectedPolicyholderCompanyId: null,
    approvedPolicyChanges: null,
    ...overrides,
  }
}

// ── enum validation ──────────────────────────────────────────────────

test('isValidCustomerApplyAction / isValidPolicyApplyAction accept only the allowlisted values', () => {
  assert.equal(isValidCustomerApplyAction('link_existing_individual'), true)
  assert.equal(isValidCustomerApplyAction('delete_individual'), false)
  assert.equal(isValidCustomerApplyAction(''), false)
  assert.equal(isValidCustomerApplyAction(undefined), false)
  assert.equal(isValidPolicyApplyAction('create_policy'), true)
  assert.equal(isValidPolicyApplyAction('reparent_policy'), false)
})

// ── ACCEPTED ROW WITHOUT APPLY ACTION CANNOT APPLY ──────────────────

test('an accepted row with no customerApplyAction/policyApplyAction is never ready to apply', () => {
  assert.equal(isRowReadyToApply(baseState()), false)
})

test('an accepted row with only a customerApplyAction (no policyApplyAction) is not ready', () => {
  assert.equal(isRowReadyToApply(baseState({ customerApplyAction: 'no_customer_change' })), false)
})

test('link_existing_individual without a selected individual id is not ready', () => {
  assert.equal(
    isRowReadyToApply(baseState({ customerApplyAction: 'link_existing_individual', policyApplyAction: 'no_policy_change' })),
    false,
  )
})

test('link_existing_individual WITH a selected individual id is ready', () => {
  assert.equal(
    isRowReadyToApply(
      baseState({
        customerApplyAction: 'link_existing_individual',
        selectedIndividualClientId: 'ind-1',
        policyApplyAction: 'no_policy_change',
      }),
    ),
    true,
  )
})

test('link_existing_company without a selected company id is not ready', () => {
  assert.equal(
    isRowReadyToApply(baseState({ customerApplyAction: 'link_existing_company', policyApplyAction: 'no_policy_change' })),
    false,
  )
})

test('create_individual / create_company / no_customer_change never require a selected id', () => {
  for (const action of ['create_individual', 'create_company', 'no_customer_change'] as const) {
    assert.equal(
      isRowReadyToApply(baseState({ customerApplyAction: action, policyApplyAction: 'no_policy_change' })),
      true,
    )
  }
})

test('link_existing_policy without a selected policy id is not ready', () => {
  assert.equal(
    isRowReadyToApply(baseState({ customerApplyAction: 'no_customer_change', policyApplyAction: 'link_existing_policy' })),
    false,
  )
})

test('link_existing_policy WITH a selected policy id is ready', () => {
  assert.equal(
    isRowReadyToApply(
      baseState({ customerApplyAction: 'no_customer_change', policyApplyAction: 'link_existing_policy', selectedPolicyId: 'pol-1' }),
    ),
    true,
  )
})

// ── APPROVED POLICY CHANGES ARE REQUIRED FOR update_existing_policy ──

test('update_existing_policy without approvedPolicyChanges is not ready — Admin must explicitly approve field changes', () => {
  assert.equal(
    isRowReadyToApply(
      baseState({ customerApplyAction: 'no_customer_change', policyApplyAction: 'update_existing_policy', selectedPolicyId: 'pol-1' }),
    ),
    false,
  )
})

test('update_existing_policy with an EMPTY approvedPolicyChanges object is still not ready', () => {
  assert.equal(
    isRowReadyToApply(
      baseState({
        customerApplyAction: 'no_customer_change',
        policyApplyAction: 'update_existing_policy',
        selectedPolicyId: 'pol-1',
        approvedPolicyChanges: {},
      }),
    ),
    false,
  )
})

test('update_existing_policy WITH a non-empty approvedPolicyChanges is ready', () => {
  assert.equal(
    isRowReadyToApply(
      baseState({
        customerApplyAction: 'no_customer_change',
        policyApplyAction: 'update_existing_policy',
        selectedPolicyId: 'pol-1',
        approvedPolicyChanges: { policyNumber: '75849' },
      }),
    ),
    true,
  )
})

// ── REJECTED/IGNORED/PENDING ROWS NEVER APPLY, REGARDLESS OF ACTIONS ─

test('a fully-resolved row that is rejected/ignored/pending is never applicable', () => {
  for (const decisionStatus of ['rejected', 'ignored', 'pending'] as const) {
    const state = baseState({
      decisionStatus,
      customerApplyAction: 'create_individual',
      policyApplyAction: 'create_policy',
    })
    assert.equal(isRowReadyToApply(state), false)
    assert.equal(isRowApplicable(state), false)
  }
})

test('isRowApplicable requires BOTH accepted AND ready', () => {
  assert.equal(
    isRowApplicable(baseState({ decisionStatus: 'accepted', customerApplyAction: 'create_individual', policyApplyAction: 'create_policy' })),
    true,
  )
})

test('policyholder participant action requires an explicit participant mode and the matching participant identity', () => {
  assert.equal(isRowReadyToApply(baseState({
    customerApplyAction: 'add_policyholder_to_existing_client',
    policyApplyAction: 'link_existing_policy',
    selectedPolicyId: 'pol-75846',
    participantMode: 'existing_individual',
    selectedPolicyholderIndividualClientId: 'bella',
  })), true)
  assert.equal(isRowReadyToApply(baseState({
    customerApplyAction: 'add_policyholder_to_existing_client',
    policyApplyAction: 'link_existing_policy',
    selectedPolicyId: 'pol-75846',
    participantMode: 'create_company',
  })), true)
  assert.equal(isRowReadyToApply(baseState({
    customerApplyAction: 'add_policyholder_to_existing_client',
    policyApplyAction: 'create_policy',
    selectedPolicyId: null,
    participantMode: 'existing_individual',
    selectedPolicyholderIndividualClientId: 'bella',
  })), false)
  assert.equal(isRowReadyToApply(baseState({
    customerApplyAction: 'add_policyholder_to_existing_client',
    policyApplyAction: 'link_existing_policy',
    selectedPolicyId: 'pol-75846',
    participantMode: null,
  })), false)
})

test('policyholder participant action is an explicit allowlisted customer action', () => {
  assert.equal(isValidCustomerApplyAction('add_policyholder_to_existing_client'), true)
})

// ── OWNER CONSISTENCY ────────────────────────────────────────────────

test('checkOwnerConsistency: linking an existing policy whose owner matches the selected individual is consistent', () => {
  const result = checkOwnerConsistency({
    policyApplyAction: 'link_existing_policy',
    selectedIndividualClientId: 'ind-1',
    selectedCompanyId: null,
    policyOwnerIndividualClientId: 'ind-1',
    policyOwnerCompanyId: undefined,
  })
  assert.equal(result.consistent, true)
})

test('checkOwnerConsistency: correct individual with legacy blank company_id is consistent', () => {
  assert.equal(checkOwnerConsistency({
    policyApplyAction: 'link_existing_policy', selectedIndividualClientId: 'ind-1', selectedCompanyId: null,
    policyOwnerIndividualClientId: 'ind-1', policyOwnerCompanyId: '',
  }).consistent, true)
})

test('checkOwnerConsistency: correct individual with NULL company_id is consistent', () => {
  assert.equal(checkOwnerConsistency({
    policyApplyAction: 'link_existing_policy', selectedIndividualClientId: 'ind-1', selectedCompanyId: null,
    policyOwnerIndividualClientId: 'ind-1', policyOwnerCompanyId: null,
  }).consistent, true)
})

test('checkOwnerConsistency: linking an existing policy whose owner does NOT match the selected individual blocks — the Bella/Ilya scenario', () => {
  const result = checkOwnerConsistency({
    policyApplyAction: 'link_existing_policy',
    selectedIndividualClientId: 'ind-new',
    selectedCompanyId: null,
    policyOwnerIndividualClientId: 'ind-existing-owner',
    policyOwnerCompanyId: undefined,
  })
  assert.equal(result.consistent, false)
  assert.ok(result.reason)
})

test('checkOwnerConsistency: update_existing_policy is checked exactly like link_existing_policy', () => {
  const result = checkOwnerConsistency({
    policyApplyAction: 'update_existing_policy',
    selectedIndividualClientId: 'ind-new',
    selectedCompanyId: null,
    policyOwnerIndividualClientId: 'ind-existing-owner',
    policyOwnerCompanyId: undefined,
  })
  assert.equal(result.consistent, false)
})

test('checkOwnerConsistency: create_policy / no_policy_change are never blocked by this check (nothing existing to compare against)', () => {
  for (const policyApplyAction of ['create_policy', 'no_policy_change'] as const) {
    const result = checkOwnerConsistency({
      policyApplyAction,
      selectedIndividualClientId: 'ind-new',
      selectedCompanyId: null,
      policyOwnerIndividualClientId: 'someone-else',
      policyOwnerCompanyId: undefined,
    })
    assert.equal(result.consistent, true)
  }
})

test('checkOwnerConsistency: no selected owner does not bypass a policy with an owner', () => {
  const result = checkOwnerConsistency({
    policyApplyAction: 'link_existing_policy',
    selectedIndividualClientId: null,
    selectedCompanyId: null,
    policyOwnerIndividualClientId: 'someone',
    policyOwnerCompanyId: undefined,
  })
  assert.equal(result.consistent, false)
})

test('checkOwnerConsistency: wrong individual is blocked even if the company dimension is blank', () => {
  assert.equal(checkOwnerConsistency({
    policyApplyAction: 'link_existing_policy', selectedIndividualClientId: 'ind-selected', selectedCompanyId: null,
    policyOwnerIndividualClientId: 'someone', policyOwnerCompanyId: '',
  }).consistent, false)
})

test('checkOwnerConsistency: company owner match/mismatch works the same way as individual', () => {
  assert.equal(
    checkOwnerConsistency({
      policyApplyAction: 'link_existing_policy',
      selectedIndividualClientId: null,
      selectedCompanyId: 'comp-1',
      policyOwnerCompanyId: 'comp-1',
    }).consistent,
    true,
  )
  assert.equal(
    checkOwnerConsistency({
      policyApplyAction: 'link_existing_policy',
      selectedIndividualClientId: null,
      selectedCompanyId: 'comp-1',
      policyOwnerCompanyId: 'comp-other',
    }).consistent,
    false,
  )
})

test('checkOwnerConsistency: actual company owner mismatch is blocked', () => {
  assert.equal(checkOwnerConsistency({
    policyApplyAction: 'link_existing_policy', selectedIndividualClientId: null, selectedCompanyId: 'comp-1',
    policyOwnerIndividualClientId: null, policyOwnerCompanyId: 'comp-other',
  }).consistent, false)
})

test('checkOwnerConsistency: correct company owner is consistent only with no individual owner', () => {
  assert.equal(checkOwnerConsistency({
    policyApplyAction: 'link_existing_policy', selectedIndividualClientId: null, selectedCompanyId: 'comp-1',
    policyOwnerIndividualClientId: null, policyOwnerCompanyId: 'comp-1',
  }).consistent, true)
})

// ── RUN-LEVEL READINESS SUMMARY ──────────────────────────────────────

test('computeRunApplyReadiness: an empty run cannot be applied', () => {
  const readiness = computeRunApplyReadiness([])
  assert.equal(readiness.acceptedCount, 0)
  assert.equal(readiness.canApply, false)
})

test('computeRunApplyReadiness: any unresolved accepted row blocks canApply and is counted', () => {
  const rows: ApplyActionRowState[] = [
    baseState({ customerApplyAction: 'create_individual', policyApplyAction: 'create_policy' }),
    baseState(), // accepted but unresolved
  ]
  const readiness = computeRunApplyReadiness(rows)
  assert.equal(readiness.acceptedCount, 2)
  assert.equal(readiness.readyCount, 1)
  assert.equal(readiness.unresolvedCount, 1)
  assert.equal(readiness.canApply, false)
})

test('computeRunApplyReadiness: all rows resolved allows apply and tallies the summary correctly (the four-record MGEN scenario)', () => {
  const rows: ApplyActionRowState[] = [
    // 75799 — use existing customer, use existing policy
    baseState({ customerApplyAction: 'link_existing_individual', selectedIndividualClientId: 'a', policyApplyAction: 'link_existing_policy', selectedPolicyId: 'p1' }),
    // 75846 — Admin resolves the identity conflict by creating a new client
    baseState({ customerApplyAction: 'create_individual', policyApplyAction: 'link_existing_policy', selectedPolicyId: 'p2' }),
    // 75849 — use existing customer, approve a policy number change
    baseState({ customerApplyAction: 'link_existing_individual', selectedIndividualClientId: 'c', policyApplyAction: 'update_existing_policy', selectedPolicyId: 'p3', approvedPolicyChanges: { policyNumber: '75849' } }),
    // 75083 — use existing company, create new policy
    baseState({ customerApplyAction: 'link_existing_company', selectedCompanyId: 'comp-1', policyApplyAction: 'create_policy' }),
  ]
  const readiness = computeRunApplyReadiness(rows)
  assert.equal(readiness.acceptedCount, 4)
  assert.equal(readiness.readyCount, 4)
  assert.equal(readiness.unresolvedCount, 0)
  assert.equal(readiness.canApply, true)
  assert.equal(readiness.willLinkCustomers, 3)
  assert.equal(readiness.willCreateIndividuals, 1)
  assert.equal(readiness.willLinkPolicies, 2)
  assert.equal(readiness.willUpdatePolicies, 1)
  assert.equal(readiness.willCreatePolicies, 1)
})

test('computeRunApplyReadiness: rejected/ignored/pending rows are excluded from acceptedCount entirely', () => {
  const rows: ApplyActionRowState[] = [
    baseState({ decisionStatus: 'rejected' }),
    baseState({ decisionStatus: 'ignored' }),
    baseState({ decisionStatus: 'pending' }),
  ]
  const readiness = computeRunApplyReadiness(rows)
  assert.equal(readiness.acceptedCount, 0)
  assert.equal(readiness.canApply, false)
})

// ── PER-ROW RESULT LABELS ────────────────────────────────────────────

test('describeRowApplyResult labels every possible outcome', () => {
  assert.equal(describeRowApplyResult('applied'), 'Applied')
  assert.equal(describeRowApplyResult('already_applied'), 'Already applied')
  assert.equal(describeRowApplyResult('skipped'), 'Skipped')
  assert.equal(describeRowApplyResult('failed'), 'Failed')
})
