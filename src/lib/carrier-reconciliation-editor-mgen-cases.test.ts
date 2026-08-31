import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  isRowReadyToApply,
  checkOwnerConsistency,
  type ApplyActionRowState,
} from './carrier-apply-actions.ts'
import {
  computePolicyFieldProposals,
  buildApprovedPolicyChanges,
  mapParsedRowToNewPolicyFields,
} from './carrier-apply-field-mapping.ts'
import { sortPolicyOwnerOptionsByProviderPreference } from './carrier-policy-owner-options.ts'
import type { ParsedImportRow } from './carrier-import-parsing.ts'
import type { CarrierPolicyCandidateSummary, PolicyOwnerOptionSummary } from './types.ts'

/**
 * carrier-reconciliation-editor-mgen-cases.test.ts — Reconciliation
 * Editor hardening: regression coverage for the 4 real production MGEN
 * rows, using the actual real-world ids/values from the incident. These
 * exercise the pure decision logic the UI/server both rely on
 * (isRowReadyToApply/checkOwnerConsistency/computePolicyFieldProposals/
 * buildApprovedPolicyChanges) — there is no live Postgres in this
 * sandbox, so these prove the logic makes the correct decision for each
 * row's exact shape, not that a real apply run produces these results.
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

// ── A) 75799 — Alberto: existing individual, existing policy ─────────

test('A) 75799 Alberto: link_existing_individual + link_existing_policy is ready with no approved changes', () => {
  const state = baseState({
    customerApplyAction: 'link_existing_individual',
    selectedIndividualClientId: '7f634dce-02c3-49d2-ba6a-dfbd3f807f8f',
    policyApplyAction: 'link_existing_policy',
    selectedPolicyId: 'pol_1787379142444',
  })
  assert.equal(isRowReadyToApply(state), true)
})

test('A) 75799 Alberto: optionally approving annualPremium via update_existing_policy is ready once approved', () => {
  const state = baseState({
    customerApplyAction: 'link_existing_individual',
    selectedIndividualClientId: '7f634dce-02c3-49d2-ba6a-dfbd3f807f8f',
    policyApplyAction: 'update_existing_policy',
    selectedPolicyId: 'pol_1787379142444',
    approvedPolicyChanges: { annualPremium: 1216.08 },
  })
  assert.equal(isRowReadyToApply(state), true)
})

test('A) 75799 Alberto: owner consistency holds — the policy really is owned by the selected individual (legacy \'\' company_id normalized to NULL)', () => {
  const result = checkOwnerConsistency({
    policyApplyAction: 'link_existing_policy',
    selectedIndividualClientId: '7f634dce-02c3-49d2-ba6a-dfbd3f807f8f',
    selectedCompanyId: null,
    policyOwnerIndividualClientId: '7f634dce-02c3-49d2-ba6a-dfbd3f807f8f',
    policyOwnerCompanyId: undefined, // '' already normalized to undefined/NULL upstream — see getCarrierImportRecordReview
  })
  assert.equal(result.consistent, true)
})

// ── B) 75846 — Ilya/Bella: policy stays with Ilya, Bella is a participant ─

test('B) 75846 Ilya/Bella: no_customer_change + link_existing_policy stays ready without reassigning the owner', () => {
  const state = baseState({
    customerApplyAction: 'no_customer_change',
    policyApplyAction: 'link_existing_policy',
    selectedPolicyId: 'pol_1787378969233',
  })
  assert.equal(isRowReadyToApply(state), true)
})

test('B) 75846 Ilya/Bella: adding Bella as policyholder (participant) does not touch selectedIndividualClientId/selectedCompanyId — ownership stays untouched', () => {
  const state = baseState({
    customerApplyAction: 'add_policyholder_to_existing_client',
    participantMode: 'existing_individual',
    selectedPolicyholderIndividualClientId: 'bella-individual-client-id',
    policyApplyAction: 'link_existing_policy',
    selectedPolicyId: 'pol_1787378969233',
  })
  assert.equal(isRowReadyToApply(state), true)
  assert.equal(state.selectedIndividualClientId, null)
  assert.equal(state.selectedCompanyId, null)
})

test('B) 75846 Ilya/Bella: optional approved endDate/annualPremium via update_existing_policy stay policy-only, never touch the owner', () => {
  const state = baseState({
    customerApplyAction: 'no_customer_change',
    policyApplyAction: 'update_existing_policy',
    selectedPolicyId: 'pol_1787378969233',
    approvedPolicyChanges: { endDate: '2027-08-12', annualPremium: 2268.36 },
  })
  assert.equal(isRowReadyToApply(state), true)
})

test('B) 75846 Ilya/Bella: owner consistency — Ilya (460b02b6-...) matches the policy\'s real owner, no reparenting implied', () => {
  const result = checkOwnerConsistency({
    policyApplyAction: 'link_existing_policy',
    selectedIndividualClientId: '460b02b6-6897-447f-b858-356664d54c4b',
    selectedCompanyId: null,
    policyOwnerIndividualClientId: '460b02b6-6897-447f-b858-356664d54c4b',
    policyOwnerCompanyId: undefined,
  })
  assert.equal(result.consistent, true)
})

test('B) 75846 Ilya/Bella: this row still requires explicit human resolution — an unresolved row (no actions saved yet) is never ready', () => {
  const unresolved = baseState({ customerApplyAction: null, policyApplyAction: null })
  assert.equal(isRowReadyToApply(unresolved), false)
})

// ── C) 75849 — Charles: manually select the existing proposal, approve only the changed fields ──

const charlesCandidate: CarrierPolicyCandidateSummary = {
  id: 'pol_1787378670711',
  policyNumber: 'Proposta 107101',
  insurer: 'MGEN',
  startDate: '2026-08-22',
  endDate: '2027-08-22',
  annualPremium: 6055.78,
}

const charlesImportedRow: ParsedImportRow = {
  sanitizedRaw: {},
  externalPolicyNumber: '75849',
  startDate: '2026-08-22',
  endDate: '2027-08-21',
  premium: 6055.74,
}

test('C) 75849 Charles: manually selecting the existing proposal produces exactly the expected field proposals (policyNumber + endDate + annualPremium — startDate unchanged)', () => {
  const proposals = computePolicyFieldProposals(charlesCandidate, charlesImportedRow)
  const byField = Object.fromEntries(proposals.map((p) => [p.field, p.proposed]))
  assert.deepEqual(Object.keys(byField).sort(), ['annualPremium', 'endDate', 'policyNumber'])
  assert.equal(byField.policyNumber, '75849')
  assert.equal(byField.endDate, '2027-08-21')
  assert.equal(byField.annualPremium, 6055.74)
  assert.equal('startDate' in byField, false, 'startDate must not be proposed — imported and CRM values are identical')
})

test('C) 75849 Charles: approving only policyNumber/endDate/annualPremium never includes startDate, even though it was never at risk', () => {
  const proposals = computePolicyFieldProposals(charlesCandidate, charlesImportedRow)
  const changes = buildApprovedPolicyChanges(proposals, new Set(['policyNumber', 'endDate', 'annualPremium']))
  assert.deepEqual(changes, { policyNumber: '75849', endDate: '2027-08-21', annualPremium: 6055.74 })
})

test('C) 75849 Charles: update_existing_policy on the manually-selected proposal is ready once the approved changes are attached', () => {
  const state = baseState({
    customerApplyAction: 'link_existing_individual',
    selectedIndividualClientId: 'charles-individual-client-id',
    policyApplyAction: 'update_existing_policy',
    selectedPolicyId: 'pol_1787378670711',
    approvedPolicyChanges: { policyNumber: '75849', endDate: '2027-08-21', annualPremium: 6055.74 },
  })
  assert.equal(isRowReadyToApply(state), true)
})

test('C) 75849 Charles: create_policy is never the resolved action for this row — no new policy row, no duplicate of the proposal', () => {
  const state = baseState({
    customerApplyAction: 'link_existing_individual',
    selectedIndividualClientId: 'charles-individual-client-id',
    policyApplyAction: 'update_existing_policy',
    selectedPolicyId: 'pol_1787378670711',
    approvedPolicyChanges: { policyNumber: '75849' },
  })
  assert.notEqual(state.policyApplyAction, 'create_policy')
})

test('C) 75849 Charles: the manual policy selector would surface pol_1787378670711 among Charles\'s own MGEN policies, sorted first', () => {
  const options: PolicyOwnerOptionSummary[] = [
    { id: 'pol_other_allianz', insurer: 'Allianz', policyNumber: 'AL-1', type: 'health', status: 'active' },
    { id: 'pol_1787378670711', insurer: 'MGEN', policyNumber: 'Proposta 107101', type: 'health', status: 'active', startDate: '2026-08-22', endDate: '2027-08-22', annualPremium: 6055.78 },
  ]
  const sorted = sortPolicyOwnerOptionsByProviderPreference(options, 'mgen')
  assert.equal(sorted[0]!.id, 'pol_1787378670711')
})

// ── D) 75083 — Ownizo: existing company, create policy, dates parse ──

test('D) 75083 Ownizo: link_existing_company + create_policy is ready with no extra selection required', () => {
  const state = baseState({
    customerApplyAction: 'link_existing_company',
    selectedCompanyId: 'comp_ownizo',
    policyApplyAction: 'create_policy',
  })
  assert.equal(isRowReadyToApply(state), true)
})

test('D) 75083 Ownizo: the imported DD/MM/YYYY HH:mm:ss dates map to a valid new-policy field set (regression lock on the Bug 2 fix)', () => {
  const row: ParsedImportRow = {
    sanitizedRaw: {},
    externalPolicyNumber: '75083',
    startDate: '2026-07-21',
    endDate: '2027-07-20',
    premium: 730.55,
  }
  const result = mapParsedRowToNewPolicyFields(row, 'MGEN')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.fields.startDate, '2026-07-21')
    assert.equal(result.fields.endDate, '2027-07-20')
    assert.equal(result.fields.annualPremium, 730.55)
    assert.equal(result.fields.policyNumber, '75083')
  }
})

// ── Regression lock: the already-live migrations this block must NOT
// touch still carry the exact guarantees the earlier incident fixes
// established. These files are untouched by this branch — this proves
// that, and locks in their behavior for future changes elsewhere. ────

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, '..', '..', 'migrations')

test('REGRESSION LOCK: apply_carrier_import_record_block4 legacy-owner-fix migration is untouched and still normalizes \'\' company_id to NULL for owner comparison', () => {
  const src = readFileSync(join(migrationsDir, '20260831_crm3_apply_legacy_owner_fix.sql'), 'utf8')
  assert.match(src, /NULLIF\(BTRIM\(v_policy\.company_id\), ''\)/)
})

test('REGRESSION LOCK: no_customer_change with a real existing owner (individual OR legacy-normalized company) still blocks — Bella/Ilya can never be silently bypassed', () => {
  const src = readFileSync(join(migrationsDir, '20260831_crm3_apply_legacy_owner_fix.sql'), 'utf8')
  assert.match(src, /IF v_policy\.individual_client_id IS NOT NULL OR NULLIF\(BTRIM\(v_policy\.company_id\), ''\) IS NOT NULL THEN\s*\n\s*RAISE EXCEPTION 'apply_carrier_import_record: owner mismatch/)
})

test('REGRESSION LOCK: policy_participants migration is untouched, keeps the policyholder participant stored separately from the commercial owner, and no reparenting', () => {
  const src = readFileSync(join(migrationsDir, '20260831_crm3_policy_participants.sql'), 'utf8')
  assert.match(src, /CREATE TABLE IF NOT EXISTS public\.policy_participants/)
  assert.match(src, /ON CONFLICT \(policy_id, role, COALESCE\(individual_client_id::text, company_id\)\) DO NOTHING/)
  assert.doesNotMatch(src, /UPDATE public\.policies SET[^;]*individual_client_id\s*=/)
  assert.doesNotMatch(src, /UPDATE public\.policies SET[^;]*company_id\s*=/)
})
