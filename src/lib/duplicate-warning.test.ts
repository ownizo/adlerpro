import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getCompanyDuplicateWarnings,
  getPersonDuplicateWarnings,
  getPolicyDuplicateWarnings,
} from './duplicate-warning.ts'

// A checksum-valid PT NIF (see identity-normalization.test.ts) and an
// invalid one, reused across several cases below.
const VALID_PT_NIF = '123456789'
const INVALID_PT_NIF = '111111111'

// ── PERSON ────────────────────────────────────────────────────────────────

test('PERSON: valid PT tax ID duplicate => strong warning', () => {
  const warnings = getPersonDuplicateWarnings(
    { nif: VALID_PT_NIF },
    [{ id: 'ind_1', nif: VALID_PT_NIF }],
  )
  const taxWarning = warnings.find((w) => w.type === 'tax_id')
  assert.ok(taxWarning, 'expected a tax_id warning')
  assert.equal(taxWarning?.severity, 'strong')
  assert.deepEqual(taxWarning?.candidateIds, ['ind_1'])
})

test('PERSON: invalid PT tax ID => no strong tax-id warning, even if textually identical', () => {
  const warnings = getPersonDuplicateWarnings(
    { nif: INVALID_PT_NIF },
    [{ id: 'ind_1', nif: INVALID_PT_NIF }],
  )
  assert.equal(warnings.find((w) => w.type === 'tax_id'), undefined)
})

test('PERSON: same normalized email => possible warning', () => {
  const warnings = getPersonDuplicateWarnings(
    { email: 'Someone@Example.com' },
    [{ id: 'ind_1', email: 'someone@example.com' }],
  )
  const emailWarning = warnings.find((w) => w.type === 'email')
  assert.ok(emailWarning)
  assert.equal(emailWarning?.severity, 'possible')
  assert.deepEqual(emailWarning?.candidateIds, ['ind_1'])
})

test('PERSON: same normalized phone => possible warning', () => {
  const warnings = getPersonDuplicateWarnings(
    { phone: '(912) 345-678' },
    [{ id: 'ind_1', phone: '912345678' }],
  )
  const phoneWarning = warnings.find((w) => w.type === 'phone')
  assert.ok(phoneWarning)
  assert.equal(phoneWarning?.severity, 'possible')
  assert.deepEqual(phoneWarning?.candidateIds, ['ind_1'])
})

test('PERSON: unrelated records never produce any warning (creation is never blocked either way)', () => {
  const warnings = getPersonDuplicateWarnings(
    { nif: VALID_PT_NIF, email: 'a@example.com', phone: '911111111' },
    [{ id: 'ind_1', nif: '500000000', email: 'b@example.com', phone: '922222222' }],
  )
  assert.deepEqual(warnings, [])
})

test('PERSON: warnings never mutate the input or candidate objects', () => {
  const input = { nif: VALID_PT_NIF, email: 'x@example.com' }
  const candidate = { id: 'ind_1', nif: VALID_PT_NIF, email: 'x@example.com' }
  const inputCopy = { ...input }
  const candidateCopy = { ...candidate }
  getPersonDuplicateWarnings(input, [candidate])
  assert.deepEqual(input, inputCopy)
  assert.deepEqual(candidate, candidateCopy)
})

test('PERSON: foreign tax id only warns when jurisdiction is explicit and equal on both sides', () => {
  const matches = getPersonDuplicateWarnings(
    { nif: 'B-12345678', taxCountry: 'ES' },
    [{ id: 'ind_1', nif: 'B-12345678', taxCountry: 'ES' }],
  )
  assert.ok(matches.find((w) => w.type === 'tax_id'))

  const noJurisdiction = getPersonDuplicateWarnings(
    { nif: 'B-12345678', taxCountry: 'ES' },
    [{ id: 'ind_1', nif: 'B-12345678' }], // candidate jurisdiction unknown
  )
  assert.equal(noJurisdiction.find((w) => w.type === 'tax_id'), undefined)

  const differentJurisdiction = getPersonDuplicateWarnings(
    { nif: 'B-12345678', taxCountry: 'ES' },
    [{ id: 'ind_1', nif: 'B-12345678', taxCountry: 'FR' }],
  )
  assert.equal(differentJurisdiction.find((w) => w.type === 'tax_id'), undefined)
})

// ── COMPANY ──────────────────────────────────────────────────────────────

test('COMPANY: valid PT NIPC duplicate => strong warning', () => {
  const warnings = getCompanyDuplicateWarnings(
    { nif: VALID_PT_NIF, name: 'Acme Lda' },
    [{ id: 'cmp_1', nif: VALID_PT_NIF, name: 'Acme Unipessoal Lda' }],
  )
  const taxWarning = warnings.find((w) => w.type === 'tax_id')
  assert.ok(taxWarning)
  assert.equal(taxWarning?.severity, 'strong')
  assert.deepEqual(taxWarning?.candidateIds, ['cmp_1'])
})

test('COMPANY: same normalized contact email => possible warning', () => {
  const warnings = getCompanyDuplicateWarnings(
    { contactEmail: 'Geral@Acme.pt' },
    [{ id: 'cmp_1', contactEmail: 'geral@acme.pt' }],
  )
  const emailWarning = warnings.find((w) => w.type === 'email')
  assert.ok(emailWarning)
  assert.equal(emailWarning?.severity, 'possible')
})

test('COMPANY: phone alone (different company name) is never enough for a warning', () => {
  const warnings = getCompanyDuplicateWarnings(
    { contactPhone: '211234567', name: 'Acme Lda' },
    [{ id: 'cmp_1', contactPhone: '211234567', name: 'Totally Different Company' }],
  )
  assert.equal(warnings.find((w) => w.type === 'phone'), undefined)
})

test('COMPANY: same phone + same normalized name => possible warning', () => {
  const warnings = getCompanyDuplicateWarnings(
    { contactPhone: '(21) 123-4567', name: 'Acme Lda' },
    [{ id: 'cmp_1', contactPhone: '211234567', name: 'ACME   LDA' }],
  )
  const phoneWarning = warnings.find((w) => w.type === 'phone')
  assert.ok(phoneWarning)
  assert.equal(phoneWarning?.severity, 'possible')
})

// ── POLICY ───────────────────────────────────────────────────────────────

test('POLICY: same provider + same normalized number => warning', () => {
  const warnings = getPolicyDuplicateWarnings(
    { insurer: 'zurich', policyNumber: 'pt-2026/001' },
    [{ id: 'pol_1', insurer: 'zurich', policyNumber: 'PT-2026/001' }],
  )
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0]?.type, 'policy_number')
  assert.deepEqual(warnings[0]?.candidateIds, ['pol_1'])
})

test('POLICY: same number but different insurer/provider => no duplicate warning', () => {
  const warnings = getPolicyDuplicateWarnings(
    { insurer: 'zurich', policyNumber: 'PT-2026/001' },
    [{ id: 'pol_1', insurer: 'allianz', policyNumber: 'PT-2026/001' }],
  )
  assert.deepEqual(warnings, [])
})

test('POLICY: punctuation is preserved according to the current normalizer (not globally stripped)', () => {
  const warnings = getPolicyDuplicateWarnings(
    { insurer: 'zurich', policyNumber: 'PT-2026/001.4' },
    [{ id: 'pol_stripped', insurer: 'zurich', policyNumber: 'PT20260014' }],
  )
  // Punctuation-stripped candidate does NOT match the punctuated input —
  // proves the conservative default normalizer is actually in effect here.
  assert.deepEqual(warnings, [])
})

test('POLICY: never enforces a global unique constraint — no warning is ever a hard block', () => {
  const warnings = getPolicyDuplicateWarnings(
    { insurer: 'zurich', policyNumber: 'PT-2026/001' },
    [
      { id: 'pol_1', insurer: 'zurich', policyNumber: 'PT-2026/001' },
      { id: 'pol_2', insurer: 'zurich', policyNumber: 'PT-2026/001' },
    ],
  )
  // Multiple matches are still just ONE informational warning listing both
  // candidates — never an exception, never a hard failure.
  assert.equal(warnings.length, 1)
  assert.deepEqual(warnings[0]?.candidateIds, ['pol_1', 'pol_2'])
})
