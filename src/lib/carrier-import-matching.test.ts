import test from 'node:test'
import assert from 'node:assert/strict'

import { matchPortfolioRows, classifyStagedRowForCounts, type PortfolioMatchingContext } from './carrier-import-matching.ts'
import type { ParsedImportRow } from './carrier-import-parsing.ts'

const VALID_PT_NIF = '123456789'

function emptyContext(overrides: Partial<PortfolioMatchingContext> = {}): PortfolioMatchingContext {
  return {
    individualClients: [],
    companies: [],
    policies: [],
    externalClientIdentities: [],
    externalPolicyIdentities: [],
    ...overrides,
  }
}

function row(overrides: Partial<ParsedImportRow> = {}): ParsedImportRow {
  return { sanitizedRaw: {}, ...overrides }
}

// ── valid existing-client exact matching ─────────────────────────────

test('EXACT MATCHING: valid PT NIF matching an existing individual client => exact, even with a slightly different name (case A)', () => {
  const [result] = matchPortfolioRows(
    'mgen',
    [row({ taxIdRaw: VALID_PT_NIF, customerName: 'Maria Silva' })],
    emptyContext({ individualClients: [{ id: 'ind_1', fullName: 'Maria S. Silva', nif: VALID_PT_NIF }] }),
  )
  assert.equal(result!.customerMatchStatus, 'exact')
  assert.equal(result!.matchedIndividualClientId, 'ind_1')
  assert.equal(result!.matchedCompanyId, undefined)
})

test('EXACT MATCHING: valid PT NIF matching an existing company => exact', () => {
  const [result] = matchPortfolioRows(
    'mgen',
    [row({ taxIdRaw: '500000000' })],
    emptyContext({ companies: [{ id: 'cmp_1', name: 'Acme Lda', nif: '500000000' }] }),
  )
  assert.equal(result!.customerMatchStatus, 'exact')
  assert.equal(result!.matchedCompanyId, 'cmp_1')
})

test('EXACT MATCHING: existing external identity for provider + externalClientId is authoritative', () => {
  const [result] = matchPortfolioRows(
    'mgen',
    [row({ externalClientId: 'EXT-1' })],
    emptyContext({
      individualClients: [{ id: 'ind_1', fullName: 'Someone' }],
      externalClientIdentities: [{ provider: 'mgen', externalClientId: 'EXT-1', individualClientId: 'ind_1' }],
    }),
  )
  assert.equal(result!.customerMatchStatus, 'exact')
  assert.equal(result!.matchedIndividualClientId, 'ind_1')
})

// ── probable/review matching ──────────────────────────────────────────

test('PROBABLE/REVIEW MATCHING: matching email + name, different NIF => probable, never auto-merged (case B)', () => {
  const [result] = matchPortfolioRows(
    'mgen',
    [row({ customerName: 'Maria Silva', email: 'maria@example.com', taxIdRaw: '111111111' })], // invalid checksum NIF
    emptyContext({
      individualClients: [{ id: 'ind_1', fullName: 'Maria Silva', email: 'maria@example.com', nif: '999999999' }],
    }),
  )
  assert.equal(result!.customerMatchStatus, 'probable')
  assert.notEqual(result!.customerMatchStatus, 'exact')
})

test('PROBABLE/REVIEW MATCHING: matching phone + name => probable', () => {
  const [result] = matchPortfolioRows(
    'mgen',
    [row({ customerName: 'Joao Costa', phone: '912345678' })],
    emptyContext({ individualClients: [{ id: 'ind_1', fullName: 'Joao Costa', phone: '912345678' }] }),
  )
  assert.equal(result!.customerMatchStatus, 'probable')
})

// ── new client matching ───────────────────────────────────────────────

test('NEW CLIENT MATCHING: no meaningful candidate => new, no matched owner set', () => {
  const [result] = matchPortfolioRows(
    'mgen',
    [row({ customerName: 'Totally New Person', taxIdRaw: '222222222' })],
    emptyContext({ individualClients: [{ id: 'ind_1', fullName: 'Unrelated Person', nif: '333333333' }] }),
  )
  assert.equal(result!.customerMatchStatus, 'new')
  assert.equal(result!.matchedIndividualClientId, undefined)
  assert.equal(result!.matchedCompanyId, undefined)
})

// ── provider-scoped policy matching ───────────────────────────────────

test('PROVIDER-SCOPED POLICY MATCHING: exact policy number match only when the candidate policy is recognized as the same provider', () => {
  const [result] = matchPortfolioRows(
    'mgen',
    [row({ externalPolicyNumber: 'CT-001' })],
    emptyContext({ policies: [{ id: 'pol_1', insurer: 'MGEN', policyNumber: 'CT-001' }] }),
  )
  assert.equal(result!.policyMatchStatus, 'exact')
  assert.equal(result!.matchedPolicyId, 'pol_1')
})

test('PROVIDER-SCOPED POLICY MATCHING: same number under an unrelated insurer is never matched — no cross-provider identity', () => {
  const [result] = matchPortfolioRows(
    'mgen',
    [row({ externalPolicyNumber: 'CT-001' })],
    emptyContext({ policies: [{ id: 'pol_1', insurer: 'Allianz Portugal', policyNumber: 'CT-001' }] }),
  )
  assert.notEqual(result!.policyMatchStatus, 'exact')
})

test('PROVIDER-SCOPED POLICY MATCHING: a policy whose insurer text cannot be tied to any provider is never eligible for a number match', () => {
  const [result] = matchPortfolioRows(
    'mgen',
    [row({ externalPolicyNumber: 'CT-001' })],
    emptyContext({ policies: [{ id: 'pol_1', insurer: 'Seguradora Desconhecida', policyNumber: 'CT-001' }] }),
  )
  assert.notEqual(result!.policyMatchStatus, 'exact')
})

// ── case C: existing client + existing policy ─────────────────────────

test('CASE C: client exists and policy exists under the same MGEN policy number => existing client + existing policy', () => {
  const [result] = matchPortfolioRows(
    'mgen',
    [row({ taxIdRaw: VALID_PT_NIF, externalPolicyNumber: 'CT-001' })],
    emptyContext({
      individualClients: [{ id: 'ind_1', fullName: 'Maria Silva', nif: VALID_PT_NIF }],
      policies: [{ id: 'pol_1', insurer: 'MGEN', policyNumber: 'CT-001', individualClientId: 'ind_1' }],
    }),
  )
  assert.equal(result!.customerMatchStatus, 'exact')
  assert.equal(result!.matchedIndividualClientId, 'ind_1')
  assert.equal(result!.policyMatchStatus, 'exact')
  assert.equal(result!.matchedPolicyId, 'pol_1')
})

// ── case D: proposal-number vs definitive-number remains review ───────

test('CASE D: customer matched, but only a differently-numbered policy exists for them => policy stays review, never silently new', () => {
  const [result] = matchPortfolioRows(
    'mgen',
    [row({ taxIdRaw: VALID_PT_NIF, externalPolicyNumber: 'DEFINITIVE-999' })],
    emptyContext({
      individualClients: [{ id: 'ind_1', fullName: 'Maria Silva', nif: VALID_PT_NIF }],
      policies: [{ id: 'pol_1', insurer: 'MGEN', policyNumber: 'PROPOSAL-123', individualClientId: 'ind_1' }],
    }),
  )
  assert.equal(result!.customerMatchStatus, 'exact')
  assert.equal(result!.policyMatchStatus, 'probable')
  assert.notEqual(result!.policyMatchStatus, 'new')
  assert.match(result!.policyMatchReason, /different number/i)
})

// ── case E: existing company, new policy ──────────────────────────────

test('CASE E: company exists by NIPC but imported policy does not => existing company + new policy candidate', () => {
  const [result] = matchPortfolioRows(
    'mgen',
    [row({ taxIdRaw: '500000000', externalPolicyNumber: 'CT-777' })],
    emptyContext({ companies: [{ id: 'cmp_1', name: 'Acme Lda', nif: '500000000' }] }), // no policies at all
  )
  assert.equal(result!.customerMatchStatus, 'exact')
  assert.equal(result!.matchedCompanyId, 'cmp_1')
  assert.equal(result!.policyMatchStatus, 'new')
})

// ── case F: conflicting dates/premium remains review ───────────────────

test('EXISTING POLICY WITH CONFLICTING DATES/PREMIUM REMAINS REVIEW: exact number match, but premium disagrees => downgraded to review, never silently overwritten', () => {
  const [result] = matchPortfolioRows(
    'mgen',
    [row({ externalPolicyNumber: 'CT-001', premium: 500 })],
    emptyContext({ policies: [{ id: 'pol_1', insurer: 'MGEN', policyNumber: 'CT-001', annualPremium: 800 }] }),
  )
  assert.equal(result!.policyMatchStatus, 'probable')
  assert.match(result!.policyMatchReason, /premium/i)
})

test('EXISTING POLICY WITH CONFLICTING DATES: exact number match, but start date disagrees => review', () => {
  const [result] = matchPortfolioRows(
    'mgen',
    [row({ externalPolicyNumber: 'CT-001', startDate: '2026-06-01' })],
    emptyContext({ policies: [{ id: 'pol_1', insurer: 'MGEN', policyNumber: 'CT-001', startDate: '2026-01-01' }] }),
  )
  assert.equal(result!.policyMatchStatus, 'probable')
  assert.match(result!.policyMatchReason, /start date/i)
})

test('no conflict when dates/premium agree => stays exact', () => {
  const [result] = matchPortfolioRows(
    'mgen',
    [row({ externalPolicyNumber: 'CT-001', premium: 800, startDate: '2026-01-01' })],
    emptyContext({ policies: [{ id: 'pol_1', insurer: 'MGEN', policyNumber: 'CT-001', annualPremium: 800, startDate: '2026-01-01' }] }),
  )
  assert.equal(result!.policyMatchStatus, 'exact')
})

// ── preview never mutates candidates / classification ──────────────────

test('classifyStagedRowForCounts: buckets correctly into exact/review/new/error', () => {
  assert.equal(classifyStagedRowForCounts({ row: row(), customerMatchStatus: 'exact', customerMatchReason: '', policyMatchStatus: 'exact', policyMatchReason: '' }), 'exact')
  assert.equal(classifyStagedRowForCounts({ row: row(), customerMatchStatus: 'probable', customerMatchReason: '', policyMatchStatus: 'exact', policyMatchReason: '' }), 'review')
  assert.equal(classifyStagedRowForCounts({ row: row(), customerMatchStatus: 'exact', customerMatchReason: '', policyMatchStatus: 'ambiguous', policyMatchReason: '' }), 'review')
  assert.equal(classifyStagedRowForCounts({ row: row(), customerMatchStatus: 'new', customerMatchReason: '', policyMatchStatus: 'new', policyMatchReason: '' }), 'new')
  assert.equal(classifyStagedRowForCounts({ row: row(), customerMatchStatus: 'error', customerMatchReason: '', policyMatchStatus: 'new', policyMatchReason: '' }), 'error')
})

test('does not mutate the context arrays passed in', () => {
  const context = emptyContext({ individualClients: [{ id: 'ind_1', fullName: 'Maria Silva', nif: VALID_PT_NIF }] })
  const snapshot = JSON.parse(JSON.stringify(context))
  matchPortfolioRows('mgen', [row({ taxIdRaw: VALID_PT_NIF })], context)
  assert.deepEqual(context, snapshot)
})
