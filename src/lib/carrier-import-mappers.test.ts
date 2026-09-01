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

test('MGEN MAPPING: rehydrates the sanitized raw payload shape used by first-apply retries', () => {
  const result = mapPortfolioRows('mgen', [mgenRow({
    data_inicio: '21/07/2026 00:00:00',
    data_fim: '20/07/2027 00:00:00',
    premio_total: '730,55',
    contrato_id: '75083',
  }), mgenRow({
    data_inicio: '22/08/2026 00:00:00',
    data_fim: '21/08/2027 00:00:00',
    premio_total: '6.055,74',
    contrato_id: '75849',
  })])
  assert.equal(result.recognized, true)
  if (result.recognized) {
    assert.deepEqual(result.rows.map(({ startDate, endDate, premium, externalPolicyNumber, sanitizedRaw }) => ({
      startDate, endDate, premium, externalPolicyNumber,
      rawStartDate: sanitizedRaw.data_inicio,
      rawEndDate: sanitizedRaw.data_fim,
    })), [
      {
        startDate: '2026-07-21', endDate: '2027-07-20', premium: 730.55, externalPolicyNumber: '75083',
        rawStartDate: '21/07/2026 00:00:00', rawEndDate: '20/07/2027 00:00:00',
      },
      {
        startDate: '2026-08-22', endDate: '2027-08-21', premium: 6055.74, externalPolicyNumber: '75849',
        rawStartDate: '22/08/2026 00:00:00', rawEndDate: '21/08/2027 00:00:00',
      },
    ])
  }
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

// ── Allianz POLRES mapping (CRM3 Block 3 — real mapper) ─────────────────
//
// Synthetic fixture ONLY — same real POLRES header names/shape as the
// production export, but every value below is invented (no production
// customer names, NIFs, phones, addresses, policy numbers or banking
// details — see requirement "TESTS").

function allianzRow(overrides: Record<string, unknown> = {}) {
  return {
    MEDIADOR: 'MED001',
    COLABORADOR: 'COL001',
    RAMO: '1289',
    'APÓLICE': '900000001',
    'ADESÃO': '00001',
    'NOME TOMADOR': 'Ana Exemplo',
    'MOR.TOMADOR': 'Rua Fictícia, 1',
    'C.POSTAL TOMADOR': '2000-001',
    'LOCALIDADE TOMADOR': 'Santarém',
    'TLF TOMADOR': '911000000',
    'DOC TOMADOR': '900000000',
    'PROFISSÃO TOMADOR': 'Engenheira',
    'D.NASCIMENTO TOMADOR': '01/01/1980',
    'D.EMISSÃO': '01/01/2026',
    'D.INICIO': '01/01/2026',
    'D.FIM': '31/12/2026',
    'D.ANULAÇÃO': '',
    'F.PAGAMENTO': 'anual',
    TIPO: 'individual',
    'OBJECTO/BEM SEGURO': 'Objecto de teste',
    'COD SUBRAMO S1': 'SR1',
    'PRÉMIO COM.S1': '123,45',
    'NOME BANCO': 'Banco Fictício',
    'CÓD BANCO': '0001',
    'AGÊNCIA BANC.': '0002',
    'CTA BANCO': '000000000',
    'DÍGITO CONTROLO': '00',
    IBAN: 'PT50000000000000000000000',
    BIC: 'FAKEXXXX',
    'AUTORIZAÇÃO': 'AUTH-FAKE-1',
    ...overrides,
  }
}

test('ALLIANZ MAPPING: a well-formed POLRES row is recognized', () => {
  const result = mapPortfolioRows('allianz', [allianzRow()])
  assert.equal(result.recognized, true)
  assert.equal(result.rows.length, 1)
})

test('ALLIANZ MAPPING: a random Excel spreadsheet is rejected, never partially mapped', () => {
  const result = mapPortfolioRows('allianz', [{ Name: 'x', Policy: 'y', TaxId: 'z' }])
  assert.equal(result.recognized, false)
  assert.deepEqual(result.rows, [])
  assert.match(result.error ?? '', /Allianz/)
})

test('ALLIANZ MAPPING: customerName/taxId/address/postal/city/phone are mapped from NOME/DOC/MOR/C.POSTAL/LOCALIDADE/TLF TOMADOR', () => {
  const result = mapPortfolioRows('allianz', [allianzRow()])
  const row = result.rows[0]!
  assert.equal(row.customerName, 'Ana Exemplo')
  assert.equal(row.taxIdRaw, '900000000')
  assert.equal(row.address, 'Rua Fictícia, 1')
  assert.equal(row.postalCode, '2000-001')
  assert.equal(row.city, 'Santarém')
  assert.equal(row.phone, '911000000')
  assert.equal(row.externalClientId, undefined) // no proven immutable Allianz client id — never set
})

test('ALLIANZ MAPPING: APÓLICE is preserved as externalPolicyNumber, ADESÃO as carrierPlanId, RAMO as carrierSegment (untranslated)', () => {
  const result = mapPortfolioRows('allianz', [allianzRow()])
  const row = result.rows[0]!
  assert.equal(row.externalPolicyNumber, '900000001')
  assert.equal(row.carrierPlanId, '00001')
  assert.equal(row.carrierSegment, '1289')
  assert.equal(row.paymentFrequency, 'anual')
  assert.equal(row.productDescription, 'Objecto de teste')
})

test('ALLIANZ MAPPING: ADESÃO "00001" is preserved exactly — leading zeroes never become a number', () => {
  const result = mapPortfolioRows('allianz', [allianzRow({ 'ADESÃO': '00000' })])
  assert.equal(result.rows[0]!.carrierPlanId, '00000')
  assert.notEqual(result.rows[0]!.carrierPlanId, 0)
})

test('ALLIANZ MAPPING: two rows with the same APÓLICE and ADESÃO 00001/00002 remain two separate rows with the same externalPolicyNumber (POLICY + ADHESION edge case)', () => {
  const result = mapPortfolioRows('allianz', [
    allianzRow({ 'APÓLICE': '208231303', 'ADESÃO': '00001' }),
    allianzRow({ 'APÓLICE': '208231303', 'ADESÃO': '00002' }),
  ])
  assert.equal(result.recognized, true)
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[0]!.externalPolicyNumber, '208231303')
  assert.equal(result.rows[1]!.externalPolicyNumber, '208231303')
  assert.equal(result.rows[0]!.carrierPlanId, '00001')
  assert.equal(result.rows[1]!.carrierPlanId, '00002')
  // never collapsed/merged into a single combined identifier
  assert.doesNotMatch(result.rows[0]!.externalPolicyNumber ?? '', /\/|-00/)
})

test('ALLIANZ MAPPING: D.ANULAÇÃO with a valid date maps carrierStatus to cancelled', () => {
  const result = mapPortfolioRows('allianz', [allianzRow({ 'D.ANULAÇÃO': '14/02/2026' })])
  assert.equal(result.rows[0]!.carrierStatus, 'cancelled')
})

test('ALLIANZ MAPPING: blank D.ANULAÇÃO maps carrierStatus to active', () => {
  const result = mapPortfolioRows('allianz', [allianzRow({ 'D.ANULAÇÃO': '' })])
  assert.equal(result.rows[0]!.carrierStatus, 'active')
})

test('ALLIANZ MAPPING: cancellation/replacement edge case — old (cancelled) and replacement (active) rows both survive independently', () => {
  const result = mapPortfolioRows('allianz', [
    allianzRow({ 'APÓLICE': '208052165', 'D.ANULAÇÃO': '14/02/2026' }),
    allianzRow({ 'APÓLICE': '208052510', 'APÓLICE SUBST': '208052165', 'D.ANULAÇÃO': '' }),
  ])
  assert.equal(result.recognized, true)
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[0]!.carrierStatus, 'cancelled')
  assert.equal(result.rows[0]!.externalPolicyNumber, '208052165')
  assert.equal(result.rows[1]!.carrierStatus, 'active')
  assert.equal(result.rows[1]!.externalPolicyNumber, '208052510')
})

test('ALLIANZ MAPPING: APÓLICE SUBST survives in sanitizedRaw', () => {
  const result = mapPortfolioRows('allianz', [
    allianzRow({ 'APÓLICE SUBST': '208052165', 'ADESÃO SUBST.': '00001' }),
  ])
  const row = result.rows[0]!
  assert.equal(row.sanitizedRaw['apolice_subst'], '208052165')
  assert.equal(row.sanitizedRaw['adesao_subst.'], '00001')
})

test('ALLIANZ MAPPING: PRÉMIO COM.S1/S2/S3 survive sanitizedRaw but `premium` is never set (not proven safe yet)', () => {
  const result = mapPortfolioRows('allianz', [
    allianzRow({ 'PRÉMIO COM.S1': '123,45', 'COD SUBRAMO S2': 'SR2', 'PRÉMIO COM.S2': '67,89', 'COD SUBRAMO S3': 'SR3', 'PRÉMIO COM.S3': '10,00' }),
  ])
  const row = result.rows[0]!
  assert.equal(row.premium, undefined)
  assert.equal(row.sanitizedRaw['premio_com.s1'], '123,45')
  assert.equal(row.sanitizedRaw['premio_com.s2'], '67,89')
  assert.equal(row.sanitizedRaw['premio_com.s3'], '10,00')
})

test('ALLIANZ MAPPING: D.INICIO/D.FIM survive sanitizedRaw but startDate/endDate are never set (not proven safe yet)', () => {
  const result = mapPortfolioRows('allianz', [allianzRow({ 'D.INICIO': '01/01/2026', 'D.FIM': '31/12/2026' })])
  const row = result.rows[0]!
  assert.equal(row.startDate, undefined)
  assert.equal(row.endDate, undefined)
  assert.equal(row.effectiveDate, undefined)
  assert.equal(row.sanitizedRaw['d.inicio'], '01/01/2026')
  assert.equal(row.sanitizedRaw['d.fim'], '31/12/2026')
  assert.equal(row.sanitizedRaw['d.emissao'], '01/01/2026')
})

test('ALLIANZ MAPPING: all banking/direct-debit fields are absent from sanitizedRaw', () => {
  const result = mapPortfolioRows('allianz', [allianzRow()])
  const row = result.rows[0]!
  for (const key of ['nome_banco', 'cod_banco', 'agencia_banc.', 'cta_banco', 'digito_controlo', 'iban', 'bic', 'autorizacao']) {
    assert.equal(key in row.sanitizedRaw, false, `expected "${key}" to be absent from sanitizedRaw`)
  }
  assert.equal(JSON.stringify(row.sanitizedRaw).includes('PT50000000000000000000000'), false)
  assert.equal(JSON.stringify(row.sanitizedRaw).includes('FAKEXXXX'), false)
  assert.equal(JSON.stringify(row.sanitizedRaw).includes('AUTH-FAKE-1'), false)
})

test('ALLIANZ MAPPING: a malformed NUL-only trailing header is absent from sanitizedRaw', () => {
  const result = mapPortfolioRows('allianz', [allianzRow({ '\u0000\u0000\u0000': 'trailing garbage column' })])
  const row = result.rows[0]!
  assert.equal(JSON.stringify(row.sanitizedRaw).includes('trailing garbage column'), false)
})

test('ALLIANZ MAPPING: empty source values do not become the literal string "undefined"', () => {
  const result = mapPortfolioRows('allianz', [allianzRow({ 'OBJECTO/BEM SEGURO': '', 'F.PAGAMENTO': '' })])
  const row = result.rows[0]!
  assert.notEqual(row.productDescription, 'undefined')
  assert.notEqual(row.paymentFrequency, 'undefined')
  assert.equal(JSON.stringify(row).includes('"undefined"'), false)
})

test('ALLIANZ MAPPING: empty workbook is never recognized', () => {
  const result = mapPortfolioRows('allianz', [])
  assert.equal(result.recognized, false)
  assert.match(result.error ?? '', /Allianz/)
  assert.deepEqual(result.rows, [])
})

test('ALLIANZ MAPPING: rows missing the core POLRES fields are not recognized, never partially mapped', () => {
  const result = mapPortfolioRows('allianz', [{ RAMO: '1289', 'NOME TOMADOR': 'Ana Exemplo' }])
  assert.equal(result.recognized, false)
  assert.deepEqual(result.rows, [])
})

test('ALLIANZ MAPPING: core fields alone (no structural field) are still not recognized — generic NIF/name/policy is not enough', () => {
  const result = mapPortfolioRows('allianz', [{
    'APÓLICE': '900000001',
    'ADESÃO': '00001',
    'NOME TOMADOR': 'Ana Exemplo',
    'DOC TOMADOR': '900000000',
    RAMO: '1289',
  }])
  assert.equal(result.recognized, false)
})

test('ALLIANZ MAPPING: does not call the unknownFormatMapper placeholder anymore — a real POLRES row is actually mapped, not just safely rejected', () => {
  const result = mapPortfolioRows('allianz', [allianzRow()])
  assert.equal(result.recognized, true)
  assert.equal(result.error, undefined)
  assert.notEqual(result.rows.length, 0)
})

// ── other providers — safe failure ────────────────────────────────────

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
