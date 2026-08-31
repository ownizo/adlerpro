import test from 'node:test'
import assert from 'node:assert/strict'

import { mapPortfolioRows } from './carrier-import-mappers.ts'

function mgenRow(overrides: Record<string, unknown> = {}) {
  return {
    tomador_id: 'C1',
    tomador: 'Maria Silva',
    nif: '123456789',
    morada: 'Rua A, 10',
    codigo_postal: '1000-001',
    localidade: 'Lisboa',
    pais: 'Portugal',
    telefone: '912345678',
    email: 'maria@example.com',
    nib: '000102030405060708090',
    contrato_id: 'CT-001',
    plano_id: 'P1',
    plano: 'Saude Familia',
    data_inicio: '01/01/2026',
    data_fim: '31/12/2026',
    data_efeito: '01/01/2026',
    premio_total: '1.234,56 €',
    fracionamento: 'mensal',
    estado: 'ativo',
    segmento: 'individual',
    ...overrides,
  }
}

// ── MGEN mapping ──────────────────────────────────────────────────────

test('MGEN MAPPING: recognizes a well-formed row and maps every documented field', () => {
  const result = mapPortfolioRows('mgen', [mgenRow()])
  assert.equal(result.recognized, true)
  assert.equal(result.rows.length, 1)
  const row = result.rows[0]!
  assert.equal(row.externalClientId, 'C1')
  assert.equal(row.customerName, 'Maria Silva')
  assert.equal(row.taxIdRaw, '123456789')
  assert.equal(row.address, 'Rua A, 10')
  assert.equal(row.postalCode, '1000-001')
  assert.equal(row.city, 'Lisboa')
  assert.equal(row.country, 'Portugal')
  assert.equal(row.phone, '912345678')
  assert.equal(row.email, 'maria@example.com')
  assert.equal(row.externalPolicyNumber, 'CT-001')
  assert.equal(row.carrierPlanId, 'P1')
  assert.equal(row.productDescription, 'Saude Familia')
  assert.equal(row.startDate, '2026-01-01')
  assert.equal(row.endDate, '2026-12-31')
  assert.equal(row.effectiveDate, '2026-01-01')
  assert.equal(row.premium, 1234.56)
  assert.equal(row.paymentFrequency, 'mensal')
  assert.equal(row.carrierStatus, 'ativo')
  assert.equal(row.carrierSegment, 'individual')
})

test('MGEN MAPPING: also works with real-world header casing/accents/spacing (via header normalization)', () => {
  const result = mapPortfolioRows('mgen', [
    {
      'Tomador ID': 'C2',
      Tomador: 'João Costa',
      NIF: '987654321',
      'Contrato ID': 'CT-002',
    },
  ])
  assert.equal(result.recognized, true)
  assert.equal(result.rows[0]?.externalClientId, 'C2')
  assert.equal(result.rows[0]?.customerName, 'João Costa')
})

// ── NIB / IBAN removed ────────────────────────────────────────────────

test('NIB REMOVED: nib is never mapped to a ParsedImportRow field and never appears in sanitizedRaw', () => {
  const result = mapPortfolioRows('mgen', [mgenRow({ nib: '000102030405060708090' })])
  const row = result.rows[0]!
  assert.equal((row as any).nib, undefined)
  assert.equal('nib' in row.sanitizedRaw, false)
  assert.equal(JSON.stringify(row.sanitizedRaw).includes('000102030405060708090'), false)
})

test('IBAN REMOVED: an iban-like column, even though not part of the documented MGEN fields, is stripped from sanitizedRaw', () => {
  const result = mapPortfolioRows('mgen', [mgenRow({ iban: 'PT50000201231234567890154' })])
  const row = result.rows[0]!
  assert.equal('iban' in row.sanitizedRaw, false)
  assert.equal(JSON.stringify(row.sanitizedRaw).includes('PT50000201231234567890154'), false)
})

// ── nested sensitive/medical fields redacted ──────────────────────────

test('NESTED SENSITIVE FIELDS REDACTED: a nested medical key inside an extra column survives mapping but is redacted from sanitizedRaw', () => {
  const result = mapPortfolioRows('mgen', [
    mgenRow({ extra_info: { note: 'ok', diagnosis: 'confidential' } }),
  ])
  const row = result.rows[0]!
  assert.equal((row.sanitizedRaw as any).extra_info?.diagnosis, undefined)
  assert.equal((row.sanitizedRaw as any).extra_info?.note, 'ok')
})

// ── empty workbook / unknown format ───────────────────────────────────

test('EMPTY WORKBOOK REJECTED: mapPortfolioRows with zero rows is never recognized', () => {
  const result = mapPortfolioRows('mgen', [])
  assert.equal(result.recognized, false)
  assert.match(result.error ?? '', /MGEN/)
  assert.deepEqual(result.rows, [])
})

test('UNKNOWN MGEN FORMAT REJECTED: rows missing the core MGEN fields are not recognized, never partially mapped', () => {
  const result = mapPortfolioRows('mgen', [{ some_column: 'x', another_column: 'y' }])
  assert.equal(result.recognized, false)
  assert.match(result.error ?? '', /MGEN/)
  assert.deepEqual(result.rows, [])
})

// ── other providers — safe failure ────────────────────────────────────

test('ALLIANZ UNKNOWN FORMAT SAFE FAILURE: never recognized, never stages rows, clear message', () => {
  const result = mapPortfolioRows('allianz', [{ anything: 'x' }])
  assert.equal(result.recognized, false)
  assert.deepEqual(result.rows, [])
  assert.match(result.error ?? '', /Allianz/)
})

test('ZURICH UNKNOWN FORMAT SAFE FAILURE: never recognized, never stages rows, clear message', () => {
  const result = mapPortfolioRows('zurich', [{ anything: 'x' }])
  assert.equal(result.recognized, false)
  assert.deepEqual(result.rows, [])
  assert.match(result.error ?? '', /Zurich/)
})

test('HISCOX UNKNOWN FORMAT SAFE FAILURE: never recognized, never stages rows, clear message', () => {
  const result = mapPortfolioRows('hiscox', [{ anything: 'x' }])
  assert.equal(result.recognized, false)
  assert.deepEqual(result.rows, [])
  assert.match(result.error ?? '', /Hiscox/)
})

test('OTHER PROVIDERS: even a well-formed MGEN-shaped row is never accepted for a different provider (no format guessing)', () => {
  const result = mapPortfolioRows('allianz', [mgenRow()])
  assert.equal(result.recognized, false)
})
