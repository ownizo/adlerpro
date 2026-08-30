import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeEmail,
  normalizePhone,
  normalizePolicyNumber,
  normalizeTaxCountry,
  normalizeTaxId,
  providerPolicyNormalizers,
} from './identity-normalization.ts'

// ── email ──────────────────────────────────────────────────────────────

test('normalizeEmail: trims and lowercases', () => {
  assert.equal(normalizeEmail('  Someone@Example.COM  '), 'someone@example.com')
})

test('normalizeEmail: +alias is preserved, never stripped', () => {
  assert.equal(normalizeEmail('Someone+billing@Example.com'), 'someone+billing@example.com')
})

test('normalizeEmail: Gmail dots are never altered', () => {
  assert.equal(normalizeEmail('some.one@gmail.com'), 'some.one@gmail.com')
  assert.notEqual(normalizeEmail('some.one@gmail.com'), normalizeEmail('someone@gmail.com'))
})

test('normalizeEmail: empty/blank/missing => null', () => {
  assert.equal(normalizeEmail(''), null)
  assert.equal(normalizeEmail('   '), null)
  assert.equal(normalizeEmail(undefined), null)
  assert.equal(normalizeEmail(null), null)
})

// ── phone ──────────────────────────────────────────────────────────────

test('normalizePhone: removes display-only whitespace, parentheses, hyphens', () => {
  assert.equal(normalizePhone('(912) 345-678'), '912345678')
})

test('normalizePhone: preserves a leading + exactly as given', () => {
  assert.equal(normalizePhone('+351 912 345 678'), '+351912345678')
})

test('normalizePhone: never invents or completes a country code', () => {
  // A local PT number without indicative must NOT become +351...
  assert.equal(normalizePhone('912345678'), '912345678')
})

test('normalizePhone: empty/blank/missing => null', () => {
  assert.equal(normalizePhone(''), null)
  assert.equal(normalizePhone('   '), null)
  assert.equal(normalizePhone(undefined), null)
})

// ── tax country bucket ───────────────────────────────────────────────────

test('normalizeTaxCountry: PT/PRT/Portugal (any case) all bucket to "PT"', () => {
  assert.equal(normalizeTaxCountry('PT'), 'PT')
  assert.equal(normalizeTaxCountry('prt'), 'PT')
  assert.equal(normalizeTaxCountry('Portugal'), 'PT')
})

test('normalizeTaxCountry: other countries are uppercased, unknown/empty => null', () => {
  assert.equal(normalizeTaxCountry('es'), 'ES')
  assert.equal(normalizeTaxCountry(''), null)
  assert.equal(normalizeTaxCountry(undefined), null)
})

// ── tax id / NIF ─────────────────────────────────────────────────────────

test('normalizeTaxId: PT NIF removes spaces, dots and hyphens', () => {
  assert.equal(normalizeTaxId('123.456.789', 'PT'), '123456789')
  assert.equal(normalizeTaxId('123 456 789', 'Portugal'), '123456789')
  assert.equal(normalizeTaxId('123-456-789', 'PRT'), '123456789')
})

test('normalizeTaxId: PT NIF preserves letters present in malformed input (no validation, only normalization)', () => {
  assert.equal(normalizeTaxId('PT 123.456.789', 'PT'), 'PT123456789')
})

test('normalizeTaxId: foreign/unknown tax id is preserved conservatively — no punctuation stripped', () => {
  assert.equal(normalizeTaxId('B-12345678', 'ES'), 'B-12345678')
  assert.equal(normalizeTaxId('12.345.678/0001-95', 'BR'), '12.345.678/0001-95')
})

test('normalizeTaxId: unknown/foreign only uppercases and collapses internal whitespace', () => {
  assert.equal(normalizeTaxId('  ab   cd  ', 'FR'), 'AB CD')
})

test('normalizeTaxId: empty/blank/missing => null', () => {
  assert.equal(normalizeTaxId('', 'PT'), null)
  assert.equal(normalizeTaxId('   ', 'PT'), null)
  assert.equal(normalizeTaxId(undefined, 'PT'), null)
})

// ── policy number ────────────────────────────────────────────────────────

test('normalizePolicyNumber: punctuation is preserved by default (no global stripping)', () => {
  assert.equal(normalizePolicyNumber('pt-2026/001.4'), 'PT-2026/001.4')
})

test('normalizePolicyNumber: trims and uppercases', () => {
  assert.equal(normalizePolicyNumber('  abc-123  '), 'ABC-123')
})

test('normalizePolicyNumber: collapses repeated whitespace', () => {
  assert.equal(normalizePolicyNumber('ABC   123'), 'ABC 123')
})

test('normalizePolicyNumber: empty/blank/missing => null', () => {
  assert.equal(normalizePolicyNumber(''), null)
  assert.equal(normalizePolicyNumber('   '), null)
  assert.equal(normalizePolicyNumber(undefined), null)
})

test('normalizePolicyNumber: uses a provider-specific normalizer when one is registered, conservative default otherwise', () => {
  assert.equal(Object.keys(providerPolicyNormalizers).length, 0, 'no carrier-specific normalizer should exist yet')

  // Prove the provider-normalizer seam actually works, without inventing a
  // real carrier's rule — cleaned up immediately after the assertion.
  providerPolicyNormalizers['__test_provider__'] = (value) => value.replace(/-/g, '')
  try {
    assert.equal(normalizePolicyNumber('ab-12', '__test_provider__'), 'ab12')
    assert.equal(normalizePolicyNumber('ab-12', 'some_other_provider'), 'AB-12')
  } finally {
    delete providerPolicyNormalizers['__test_provider__']
  }
})
