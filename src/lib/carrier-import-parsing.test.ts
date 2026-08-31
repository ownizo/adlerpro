import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeHeaderName,
  normalizeRowKeys,
  parseAmountSafely,
  parseImportDateSafely,
  stripBankingFields,
} from './carrier-import-parsing.ts'

// ── header normalization ──────────────────────────────────────────────

test('normalizeHeaderName: trims, lowercases, collapses whitespace, strips accents, joins with underscore', () => {
  assert.equal(normalizeHeaderName('  Código Postal  '), 'codigo_postal')
  assert.equal(normalizeHeaderName('Data Início'), 'data_inicio')
  assert.equal(normalizeHeaderName('NIF'), 'nif')
  assert.equal(normalizeHeaderName('Tomador   ID'), 'tomador_id')
})

test('normalizeHeaderName: null/undefined/empty => empty string', () => {
  assert.equal(normalizeHeaderName(null), '')
  assert.equal(normalizeHeaderName(undefined), '')
  assert.equal(normalizeHeaderName('   '), '')
})

test('normalizeRowKeys: normalizes every key, drops keys that normalize to empty, never mutates the input', () => {
  const input = { ' Tomador ': 'Maria', '': 'ignored', NIF: '123456789' }
  const inputSnapshot = { ...input }
  const result = normalizeRowKeys(input)
  assert.deepEqual(result, { tomador: 'Maria', nif: '123456789' })
  assert.deepEqual(input, inputSnapshot)
})

// ── dates parsed safely ──────────────────────────────────────────────

test('parseImportDateSafely: a native Date is formatted as ISO', () => {
  assert.equal(parseImportDateSafely(new Date(Date.UTC(2026, 0, 1))), '2026-01-01')
})

test('parseImportDateSafely: DD/MM/AAAA (Portuguese) is parsed unambiguously', () => {
  assert.equal(parseImportDateSafely('31/12/2026'), '2026-12-31')
  assert.equal(parseImportDateSafely('01-01-2026'), '2026-01-01')
  assert.equal(parseImportDateSafely('01.06.2026'), '2026-06-01')
})

test('parseImportDateSafely: Portuguese carrier timestamps are parsed as DD/MM/YYYY', () => {
  assert.equal(parseImportDateSafely('21/07/2026 00:00:00'), '2026-07-21')
  assert.equal(parseImportDateSafely('20/07/2027 00:00:00'), '2027-07-20')
  assert.equal(parseImportDateSafely('22/08/2026 00:00:00'), '2026-08-22')
  assert.equal(parseImportDateSafely('21/08/2027 00:00:00'), '2027-08-21')
})

test('parseImportDateSafely: ISO AAAA-MM-DD is accepted as-is', () => {
  assert.equal(parseImportDateSafely('2026-03-15'), '2026-03-15')
})

test('parseImportDateSafely: never throws, never guesses an ambiguous or invalid value', () => {
  assert.equal(parseImportDateSafely('13/13/2026'), undefined) // invalid month
  assert.equal(parseImportDateSafely('not a date'), undefined)
  assert.equal(parseImportDateSafely(''), undefined)
  assert.equal(parseImportDateSafely(undefined), undefined)
  assert.equal(parseImportDateSafely(12345), undefined) // raw Excel serial number, not a Date object
  assert.doesNotThrow(() => parseImportDateSafely({}))
  assert.doesNotThrow(() => parseImportDateSafely(new Date('invalid')))
})

// ── premium parsed safely ─────────────────────────────────────────────

test('parseAmountSafely: native numbers pass through', () => {
  assert.equal(parseAmountSafely(1234.56), 1234.56)
})

test('parseAmountSafely: Portuguese format "1.234,56 €" is parsed correctly', () => {
  assert.equal(parseAmountSafely('1.234,56 €'), 1234.56)
  assert.equal(parseAmountSafely('1.234,56'), 1234.56)
})

test('parseAmountSafely: simple decimal formats are parsed', () => {
  assert.equal(parseAmountSafely('1234.56'), 1234.56)
  assert.equal(parseAmountSafely('1234,56'), 1234.56)
  assert.equal(parseAmountSafely('500'), 500)
})

test('parseAmountSafely: never throws on garbage, returns undefined instead', () => {
  assert.equal(parseAmountSafely('not a number'), undefined)
  assert.equal(parseAmountSafely(''), undefined)
  assert.equal(parseAmountSafely(undefined), undefined)
  assert.equal(parseAmountSafely(NaN), undefined)
  assert.doesNotThrow(() => parseAmountSafely({}))
})

// ── banking-field stripping ───────────────────────────────────────────

test('stripBankingFields: removes nib/iban/bank-account-like keys, keeps everything else, never mutates input', () => {
  const input = { nib: '000102030405060708090', iban: 'PT50000201231234567890154', bankAccountNumber: '12345', tomador: 'Maria', nif: '123456789' }
  const snapshot = { ...input }
  const result = stripBankingFields(input)
  assert.deepEqual(result, { tomador: 'Maria', nif: '123456789' })
  assert.deepEqual(input, snapshot)
})

test('stripBankingFields: case-insensitive and matches common variants (SWIFT/BIC/account number)', () => {
  const input = { NIB: 'x', IBAN: 'x', swift: 'x', BIC: 'x', account_number: 'x', keep: 'y' }
  const result = stripBankingFields(input)
  assert.deepEqual(result, { keep: 'y' })
})
