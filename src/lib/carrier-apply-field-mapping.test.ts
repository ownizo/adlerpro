import test from 'node:test'
import assert from 'node:assert/strict'

import {
  mapParsedRowToNewIndividualFields,
  mapParsedRowToNewCompanyFields,
  mapParsedRowToNewPolicyFields,
  computePolicyFieldProposals,
  buildApprovedPolicyChanges,
  findInvalidApprovedPolicyChangeKeys,
  APPROVED_POLICY_CHANGE_KEYS,
} from './carrier-apply-field-mapping.ts'
import type { ParsedImportRow } from './carrier-import-parsing.ts'
import type { CarrierPolicyCandidateSummary } from './types.ts'

function row(overrides: Partial<ParsedImportRow> = {}): ParsedImportRow {
  return { sanitizedRaw: {}, ...overrides }
}

// ── new individual / company field mapping ──────────────────────────

test('mapParsedRowToNewIndividualFields requires a customer name; a missing name blocks creation with a clear error', () => {
  const result = mapParsedRowToNewIndividualFields(row())
  assert.equal(result.ok, false)
})

test('mapParsedRowToNewIndividualFields maps only allowlisted imported fields, never invents anything', () => {
  const result = mapParsedRowToNewIndividualFields(row({ customerName: 'Ana Silva', taxIdRaw: '123456789', email: 'ana@example.com', phone: '910000000', address: 'Rua X' }))
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.deepEqual(result.fields, { fullName: 'Ana Silva', nif: '123456789', email: 'ana@example.com', phone: '910000000', address: 'Rua X' })
  }
})

test('mapParsedRowToNewCompanyFields requires both a name and a NIF', () => {
  assert.equal(mapParsedRowToNewCompanyFields(row({ customerName: 'Acme Lda' })).ok, false)
  assert.equal(mapParsedRowToNewCompanyFields(row({ taxIdRaw: '500000000' })).ok, false)
  assert.equal(mapParsedRowToNewCompanyFields(row({ customerName: 'Acme Lda', taxIdRaw: '500000000' })).ok, true)
})

// ── new policy field mapping (MGEN health portfolio) ─────────────────

test('mapParsedRowToNewPolicyFields requires policy number, start date, and end date', () => {
  assert.equal(mapParsedRowToNewPolicyFields(row(), 'MGEN').ok, false)
  assert.equal(mapParsedRowToNewPolicyFields(row({ externalPolicyNumber: '75083' }), 'MGEN').ok, false)
  assert.equal(mapParsedRowToNewPolicyFields(row({ externalPolicyNumber: '75083', startDate: '2026-01-01' }), 'MGEN').ok, false)
})

test('mapParsedRowToNewPolicyFields: insuredValue defaults to 0 (no source field in a health feed) and type defaults to health', () => {
  const result = mapParsedRowToNewPolicyFields(
    row({ externalPolicyNumber: '75083', startDate: '2026-01-01', endDate: '2026-12-31' }),
    'MGEN',
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.fields.insuredValue, 0)
    assert.equal(result.fields.type, 'health')
    assert.equal(result.fields.insurer, 'MGEN')
    assert.equal(result.fields.policyNumber, '75083')
  }
})

test('mapParsedRowToNewPolicyFields: never overwrites with null — a missing premium becomes 0, not null/undefined', () => {
  const result = mapParsedRowToNewPolicyFields(
    row({ externalPolicyNumber: '75083', startDate: '2026-01-01', endDate: '2026-12-31' }),
    'MGEN',
  )
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.fields.annualPremium, 0)
})

test('mapParsedRowToNewPolicyFields: a present premium/description is used as-is', () => {
  const result = mapParsedRowToNewPolicyFields(
    row({ externalPolicyNumber: '75083', startDate: '2026-01-01', endDate: '2026-12-31', premium: 450.5, productDescription: 'Saude Individual' }),
    'MGEN',
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.fields.annualPremium, 450.5)
    assert.equal(result.fields.description, 'Saude Individual')
  }
})

// ── policy field proposals / approved changes diff ───────────────────

const candidate: CarrierPolicyCandidateSummary = {
  id: 'pol-1',
  policyNumber: 'PROP-0001',
  insurer: 'MGEN',
  startDate: '2025-01-01',
  endDate: '2025-12-31',
  annualPremium: 300,
}

test('computePolicyFieldProposals: no candidate means no proposals at all', () => {
  assert.deepEqual(computePolicyFieldProposals(undefined, row({ externalPolicyNumber: '75849' })), [])
})

test('computePolicyFieldProposals: a proposal number differing from the CRM definitive number is proposed, never auto-applied — policy 75849 scenario', () => {
  const proposals = computePolicyFieldProposals(candidate, row({ externalPolicyNumber: '75849' }))
  const policyNumberProposal = proposals.find((p) => p.field === 'policyNumber')
  assert.ok(policyNumberProposal)
  assert.equal(policyNumberProposal!.current, 'PROP-0001')
  assert.equal(policyNumberProposal!.proposed, '75849')
})

test('computePolicyFieldProposals: identical values never produce a proposal', () => {
  const proposals = computePolicyFieldProposals(candidate, row({ externalPolicyNumber: 'PROP-0001', startDate: '2025-01-01', endDate: '2025-12-31', premium: 300 }))
  assert.deepEqual(proposals, [])
})

test('computePolicyFieldProposals: dates and premium differences are each proposed independently', () => {
  const proposals = computePolicyFieldProposals(candidate, row({ startDate: '2026-01-01', endDate: '2026-12-31', premium: 350 }))
  const fields = proposals.map((p) => p.field).sort()
  assert.deepEqual(fields, ['annualPremium', 'endDate', 'startDate'])
})

test('buildApprovedPolicyChanges: only explicitly approved fields are ever included — unapproved fields never leak through', () => {
  const proposals = computePolicyFieldProposals(candidate, row({ externalPolicyNumber: '75849', premium: 350 }))
  const changes = buildApprovedPolicyChanges(proposals, new Set(['policyNumber']))
  assert.deepEqual(changes, { policyNumber: '75849' })
  assert.equal('annualPremium' in changes, false)
})

test('buildApprovedPolicyChanges: approving nothing produces an empty object (matches isRowReadyToApply blocking update_existing_policy on empty changes)', () => {
  const proposals = computePolicyFieldProposals(candidate, row({ externalPolicyNumber: '75849' }))
  const changes = buildApprovedPolicyChanges(proposals, new Set())
  assert.deepEqual(changes, {})
})

test('buildApprovedPolicyChanges: approving every proposed field includes them all', () => {
  const proposals = computePolicyFieldProposals(candidate, row({ externalPolicyNumber: '75849', startDate: '2026-01-01', endDate: '2026-12-31', premium: 350 }))
  const changes = buildApprovedPolicyChanges(proposals, new Set(['policyNumber', 'startDate', 'endDate', 'annualPremium']))
  assert.deepEqual(changes, { policyNumber: '75849', startDate: '2026-01-01', endDate: '2026-12-31', annualPremium: 350 })
})

// ── HARDENING 3 — approved_policy_changes key allowlist ──────────────

test('findInvalidApprovedPolicyChangeKeys: the allowed subset (policyNumber/startDate/endDate/annualPremium/status) passes with no invalid keys', () => {
  assert.deepEqual(
    findInvalidApprovedPolicyChangeKeys({ policyNumber: '75849', startDate: '2026-01-01', endDate: '2026-12-31', annualPremium: 350, status: 'active' }),
    [],
  )
})

test('findInvalidApprovedPolicyChangeKeys: a subset of the allowlist is still fully allowed', () => {
  assert.deepEqual(findInvalidApprovedPolicyChangeKeys({ policyNumber: '75849' }), [])
})

test('findInvalidApprovedPolicyChangeKeys: an unknown key is rejected (reported), never silently dropped', () => {
  assert.deepEqual(findInvalidApprovedPolicyChangeKeys({ policyNumber: '75849', insuredValue: 999999 }), ['insuredValue'])
})

test('findInvalidApprovedPolicyChangeKeys: reports every unknown key, not just the first', () => {
  assert.deepEqual(
    findInvalidApprovedPolicyChangeKeys({ nib: '12345', hackerField: true }).sort(),
    ['hackerField', 'nib'],
  )
})

test('findInvalidApprovedPolicyChangeKeys: an empty object has no invalid keys (emptiness itself is rejected elsewhere, by isRowReadyToApply, for update_existing_policy)', () => {
  assert.deepEqual(findInvalidApprovedPolicyChangeKeys({}), [])
})

test('APPROVED_POLICY_CHANGE_KEYS is exactly the five-key allowlist from the review', () => {
  assert.deepEqual([...APPROVED_POLICY_CHANGE_KEYS].sort(), ['annualPremium', 'endDate', 'policyNumber', 'startDate', 'status'].sort())
})
