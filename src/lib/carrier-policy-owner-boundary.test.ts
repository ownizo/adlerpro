import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { checkOwnerConsistency } from './carrier-apply-actions.ts'

/**
 * carrier-policy-owner-boundary.test.ts — Reconciliation Editor
 * hardening: focused security review of the authorization/ownership
 * boundary for the manual "existing policy" selector. Consolidates the
 * explicit negative-test checklist from that review in one place —
 * some of these properties are already exercised elsewhere
 * (carrier-apply-actions.test.ts, carrier-apply-admin.test.ts,
 * carrier-reconciliation-editor-mgen-cases.test.ts); this file adds the
 * specific cross-type cases and the save-time/apply-time ordering
 * guarantees that weren't independently pinned down yet.
 *
 * No production logic changed as a result of this review — the
 * boundary was already correctly enforced (both at
 * setCarrierImportRecordApplyActions save-time and at the already-live
 * apply_carrier_import_record RPC apply-time); these tests lock that in.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataSrc = readFileSync(join(__dirname, 'data.ts'), 'utf8')
const migrationsDir = join(__dirname, '..', '..', 'migrations')

function extractDataFnBlock(name: string): string {
  const marker = `export async function ${name}(`
  const startIdx = dataSrc.indexOf(marker)
  assert.ok(startIdx !== -1, `data function "${name}" not found in data.ts`)
  const nextExportIdx = dataSrc.indexOf('\nexport ', startIdx + marker.length)
  return dataSrc.slice(startIdx, nextExportIdx === -1 ? undefined : nextExportIdx)
}

// ── 1. individual A cannot select individual B's policy ──────────────

test('individual A cannot select individual B\'s policy', () => {
  const result = checkOwnerConsistency({
    policyApplyAction: 'link_existing_policy',
    selectedIndividualClientId: 'individual-a',
    selectedCompanyId: null,
    policyOwnerIndividualClientId: 'individual-b',
    policyOwnerCompanyId: undefined,
  })
  assert.equal(result.consistent, false)
})

// ── 2. company A cannot select company B's policy ─────────────────────

test('company A cannot select company B\'s policy', () => {
  const result = checkOwnerConsistency({
    policyApplyAction: 'link_existing_policy',
    selectedIndividualClientId: null,
    selectedCompanyId: 'company-a',
    policyOwnerIndividualClientId: undefined,
    policyOwnerCompanyId: 'company-b',
  })
  assert.equal(result.consistent, false)
})

// ── 3. individual cannot select a company-owned policy ────────────────

test('a selected individual cannot select a company-owned policy', () => {
  const result = checkOwnerConsistency({
    policyApplyAction: 'link_existing_policy',
    selectedIndividualClientId: 'individual-a',
    selectedCompanyId: null,
    policyOwnerIndividualClientId: undefined,
    policyOwnerCompanyId: 'some-real-company',
  })
  assert.equal(result.consistent, false)
})

test('same as above, for update_existing_policy', () => {
  const result = checkOwnerConsistency({
    policyApplyAction: 'update_existing_policy',
    selectedIndividualClientId: 'individual-a',
    selectedCompanyId: null,
    policyOwnerIndividualClientId: undefined,
    policyOwnerCompanyId: 'some-real-company',
  })
  assert.equal(result.consistent, false)
})

// ── 4. company cannot select an individual-owned policy ───────────────

test('a selected company cannot select an individual-owned policy', () => {
  const result = checkOwnerConsistency({
    policyApplyAction: 'link_existing_policy',
    selectedIndividualClientId: null,
    selectedCompanyId: 'company-a',
    policyOwnerIndividualClientId: 'some-real-individual',
    policyOwnerCompanyId: undefined,
  })
  assert.equal(result.consistent, false)
})

test('same as above, for update_existing_policy', () => {
  const result = checkOwnerConsistency({
    policyApplyAction: 'update_existing_policy',
    selectedIndividualClientId: null,
    selectedCompanyId: 'company-a',
    policyOwnerIndividualClientId: 'some-real-individual',
    policyOwnerCompanyId: undefined,
  })
  assert.equal(result.consistent, false)
})

// ── 5/6. missing owner / both owners — listPoliciesForOwner's XOR ─────
// (data.ts is I/O-touching — validated by source inspection, per this
// codebase's established convention; see also
// carrier-reconciliation-editor-admin.test.ts.)

test('listPoliciesForOwner rejects when neither owner is supplied', () => {
  const block = extractDataFnBlock('listPoliciesForOwner')
  assert.match(block, /if \(!individualClientId && !companyId\) \{\s*\n\s*throw new Error\('listPoliciesForOwner: exactly one of individualClientId or companyId is required'\)/)
})

test('listPoliciesForOwner rejects when both owners are supplied', () => {
  const block = extractDataFnBlock('listPoliciesForOwner')
  assert.match(block, /if \(individualClientId && companyId\) \{\s*\n\s*throw new Error\('listPoliciesForOwner: cannot filter by both individualClientId and companyId'\)/)
})

// ── 7. manually forged selectedPolicyId rejected at SAVE time ─────────
// Proves the owner-consistency check runs BEFORE the record is
// persisted, and that a mismatch actually throws (not just "is called
// somewhere") — a forged selectedPolicyId belonging to a different
// customer than the one selected can never reach the database.

test('setCarrierImportRecordApplyActions: the owner-consistency check runs strictly BEFORE the persisting .update() call', () => {
  const block = extractDataFnBlock('setCarrierImportRecordApplyActions')
  const checkCallIdx = block.indexOf('checkOwnerConsistency(')
  const persistIdx = block.indexOf(".from('carrier_import_records')")
  assert.ok(checkCallIdx !== -1, 'owner-consistency check not found')
  assert.ok(persistIdx !== -1, 'persisting update call not found')
  assert.ok(checkCallIdx < persistIdx, 'owner-consistency check must run before the record is persisted')
})

test('setCarrierImportRecordApplyActions: an inconsistent owner check actually throws, aborting the save — not just logged/ignored', () => {
  const block = extractDataFnBlock('setCarrierImportRecordApplyActions')
  assert.match(block, /if \(!check\.consistent\) throw new Error/)
})

test('setCarrierImportRecordApplyActions: the selected policy is looked up server-side (getPolicy) — the browser-supplied id alone is never trusted for its owner fields', () => {
  const block = extractDataFnBlock('setCarrierImportRecordApplyActions')
  const lookupIdx = block.indexOf('const policy = await getPolicy(input.selectedPolicyId)')
  const checkCallIdx = block.indexOf('checkOwnerConsistency(')
  assert.ok(lookupIdx !== -1 && checkCallIdx !== -1)
  assert.ok(lookupIdx < checkCallIdx, 'the policy must be fetched server-side before its owner fields feed the consistency check')
  // The check is built from the SERVER-fetched policy's own owner
  // fields (policy.individualClientId/policy.companyId), never from
  // anything the browser sent about the policy itself.
  assert.match(block, /policyOwnerIndividualClientId: policy\.individualClientId/)
  assert.match(block, /policyOwnerCompanyId: policy\.companyId/)
})

test('setCarrierImportRecordApplyActions: a nonexistent selectedPolicyId is rejected before any owner comparison — never silently ignored', () => {
  const block = extractDataFnBlock('setCarrierImportRecordApplyActions')
  assert.match(block, /if \(!policy\) throw new Error\('setCarrierImportRecordApplyActions: selected policy does not exist'\)/)
})

// ── 8. manually forged selectedPolicyId rejected at APPLY time ────────
// Regression-locked against the exact, ALREADY-LIVE RPC text (this
// review changes neither migration — see the review's own instruction
// not to touch them). Confirms the RPC independently re-derives and
// re-checks ownership from the row it locks, never trusting whatever
// setCarrierImportRecordApplyActions already validated as the only
// gate — so even a record whose selected_policy_id was somehow written
// by a path OTHER than setCarrierImportRecordApplyActions still cannot
// be applied against a mismatched owner.

test('APPLY-TIME REGRESSION LOCK: individual-vs-individual-B AND individual-vs-company-owned are both blocked by the SAME single RPC condition', () => {
  const src = readFileSync(join(migrationsDir, '20260831_crm3_apply_legacy_owner_fix.sql'), 'utf8')
  // v_individual_id branch: policy's real individual owner must match
  // exactly, AND the policy must have no real company owner at all.
  assert.match(
    src,
    /IF v_policy\.individual_client_id::text IS DISTINCT FROM v_individual_id::text OR NULLIF\(BTRIM\(v_policy\.company_id\), ''\) IS NOT NULL OR v_company_id IS NOT NULL THEN\s*\n\s*RAISE EXCEPTION 'apply_carrier_import_record: owner mismatch/,
  )
})

test('APPLY-TIME REGRESSION LOCK: company-vs-company-B AND company-vs-individual-owned are both blocked by the SAME single RPC condition', () => {
  const src = readFileSync(join(migrationsDir, '20260831_crm3_apply_legacy_owner_fix.sql'), 'utf8')
  // v_company_id branch: policy's real (legacy-normalized) company
  // owner must match exactly, AND the policy must have no individual
  // owner at all.
  assert.match(
    src,
    /IF NULLIF\(BTRIM\(v_policy\.company_id\), ''\) IS DISTINCT FROM v_company_id OR v_policy\.individual_client_id IS NOT NULL THEN\s*\n\s*RAISE EXCEPTION 'apply_carrier_import_record: owner mismatch/,
  )
})

test('APPLY-TIME REGRESSION LOCK: the RPC re-fetches the policy itself (FOR UPDATE) rather than trusting any owner fields passed in as parameters', () => {
  const src = readFileSync(join(migrationsDir, '20260831_crm3_apply_legacy_owner_fix.sql'), 'utf8')
  assert.match(src, /SELECT \* INTO v_policy FROM public\.policies WHERE id = v_record\.selected_policy_id FOR UPDATE/)
  // The function signature never accepts a policy-owner override —
  // only ids/new-entity field bundles. Grep the CREATE OR REPLACE
  // FUNCTION signature line itself for this.
  const signatureLine = src.split('\n').find((line) => line.includes('CREATE OR REPLACE FUNCTION public.apply_carrier_import_record('))
  assert.ok(signatureLine)
  assert.doesNotMatch(signatureLine!, /owner|individual_client_id|company_id/i)
})

test('APPLY-TIME REGRESSION LOCK: the RPC reads decision_status/customer_apply_action/policy_apply_action/selected_policy_id from the LOCKED row it fetches by id — never from caller-supplied parameters', () => {
  const src = readFileSync(join(migrationsDir, '20260831_crm3_apply_legacy_owner_fix.sql'), 'utf8')
  assert.match(src, /SELECT \* INTO v_record FROM public\.carrier_import_records WHERE id = p_record_id FOR UPDATE/)
})
