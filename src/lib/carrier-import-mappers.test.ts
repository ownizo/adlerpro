import test from 'node:test'
import assert from 'node:assert/strict'

import { mapPortfolioRows } from './carrier-import-mappers.ts'
import { normalizeRowKeys } from './carrier-import-parsing.ts'

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

test('HISCOX RANDOM FORMAT SAFE FAILURE: a non-MyHiscox sheet is never recognized, never stages rows, clear message', () => {
  const result = mapPortfolioRows('hiscox', [{ anything: 'x' }])
  assert.equal(result.recognized, false)
  assert.deepEqual(result.rows, [])
  assert.match(result.error ?? '', /Hiscox/)
})

test('OTHER PROVIDERS: even a well-formed MGEN-shaped row is never accepted for a different provider (no format guessing)', () => {
  const result = mapPortfolioRows('allianz', [mgenRow()])
  assert.equal(result.recognized, false)
})

// ── Hiscox MyHiscox export (CRM3 Block 3 — real mapper) ─────────────────
//
// Synthetic fixtures only — same 8 columns as the real MyHiscox export,
// never real customer data.

function hiscoxRow(overrides: Record<string, unknown> = {}) {
  return {
    'Referência': 1000001,
    'Área de negócio': 'Arte e clientes privados',
    'Produto': 'Holiday Homes',
    'Tomador': 'Jane Example',
    'NIPC/NIF': 123456789,
    'Data de efeito': new Date(Date.UTC(2026, 9, 10)),
    'Prémio total': '1256,02 €',
    'Estado': 'Ativa',
    ...overrides,
  }
}

test('HISCOX MAPPING: a well-formed MyHiscox row is recognized and maps every documented field', () => {
  const result = mapPortfolioRows('hiscox', [hiscoxRow()])
  assert.equal(result.recognized, true)
  const row = result.rows[0]!
  assert.equal(row.externalPolicyNumber, '1000001')
  assert.equal(row.carrierSegment, 'Arte e clientes privados')
  assert.equal(row.productDescription, 'Holiday Homes')
  assert.equal(row.customerName, 'Jane Example')
  assert.equal(row.taxIdRaw, '123456789')
  assert.equal(row.effectiveDate, '2026-10-10')
  assert.equal(row.premium, 1256.02)
  assert.equal(row.carrierStatus, 'active')
})

test('HISCOX MAPPING: fields the export does not carry are never invented', () => {
  const row = mapPortfolioRows('hiscox', [hiscoxRow()]).rows[0]!
  assert.equal(row.externalClientId, undefined)
  assert.equal(row.address, undefined)
  assert.equal(row.email, undefined)
  assert.equal(row.phone, undefined)
  // Data de efeito is not proven to be the current period start — never
  // promoted to startDate/endDate.
  assert.equal(row.startDate, undefined)
  assert.equal(row.endDate, undefined)
})

test('HISCOX MAPPING: premium below 1000 without thousands separator parses ("395,16 €")', () => {
  const row = mapPortfolioRows('hiscox', [hiscoxRow({ 'Prémio total': '395,16 €' })]).rows[0]!
  assert.equal(row.premium, 395.16)
})

test('HISCOX MAPPING: "-" placeholders for Tomador/NIF are treated as empty, never as a name or tax id', () => {
  const result = mapPortfolioRows('hiscox', [hiscoxRow({ 'Tomador': '-', 'NIPC/NIF': '-' })])
  assert.equal(result.recognized, true)
  const row = result.rows[0]!
  assert.equal(row.customerName, undefined)
  assert.equal(row.taxIdRaw, undefined)
  assert.equal(row.externalPolicyNumber, '1000001')
})

test('HISCOX MAPPING: unknown Estado values are preserved untranslated; cancelled-like values normalize', () => {
  assert.equal(mapPortfolioRows('hiscox', [hiscoxRow({ 'Estado': 'Anulada' })]).rows[0]!.carrierStatus, 'cancelled')
  assert.equal(mapPortfolioRows('hiscox', [hiscoxRow({ 'Estado': 'Suspensa' })]).rows[0]!.carrierStatus, 'Suspensa')
})

test('HISCOX MAPPING: re-mapping the stored sanitizedRaw (apply retry path) yields the same fields', () => {
  const first = mapPortfolioRows('hiscox', [hiscoxRow()]).rows[0]!
  // Round-trip through JSON exactly like carrier_import_records.raw_payload.
  const stored = JSON.parse(JSON.stringify(first.sanitizedRaw)) as Record<string, unknown>
  const again = mapPortfolioRows('hiscox', [stored])
  assert.equal(again.recognized, true)
  const { sanitizedRaw: _a, ...firstFields } = first
  const { sanitizedRaw: _b, ...againFields } = again.rows[0]!
  assert.deepEqual(againFields, firstFields)
})

test('HISCOX MAPPING: an MGEN- or Allianz-shaped row is never accepted as Hiscox (no format guessing)', () => {
  assert.equal(mapPortfolioRows('hiscox', [mgenRow()]).recognized, false)
  assert.equal(mapPortfolioRows('hiscox', [allianzRow()]).recognized, false)
})

test('HISCOX MAPPING: a MyHiscox row is never accepted for another provider', () => {
  assert.equal(mapPortfolioRows('mgen', [hiscoxRow()]).recognized, false)
  assert.equal(mapPortfolioRows('allianz', [hiscoxRow()]).recognized, false)
})

test('HISCOX exportPortfolio (Oct 2026): tomador under a duplicated "Área de Negócio" header, period dates, e-mail', () => {
  const header = { 'Referência': '1047983', 'Mediador de Seguros': 'OWNIZO UNIPESSOAL LDA (Adler & Rochefort)', 'Área de Negócio': 'Arte e clientes privados', 'Produto': 'Holiday Homes', 'Área de Negócio_1': 'Hein Example', 'E-mail do tomador': 'hein@example.com', 'NIPC/NIF': '307499995', 'Data de Efeito': '10/10/2026', 'Data de Término': '09/10/2027', 'Data de cancelamento': '-', 'Prémio total': '445,96', 'Commissão': '98,75', 'Fracionamento do Pagamento': 'Annual', 'Estado': 'Ativa' }
  const blank = { 'Referência': '151084', 'Área de Negócio': 'Arte e clientes privados', 'Produto': 'Holiday Homes', 'Data de Efeito': '18/09/2026', 'Data de Término': '17/09/2027', 'Prémio total': '395,16', 'Estado': 'Ativa' }
  const result = mapPortfolioRows('hiscox', [blank, header].map(normalizeRowKeys))
  assert.equal(result.recognized, true)
  const r = result.rows[1]!
  assert.equal(r.customerName, 'Hein Example')
  assert.equal(r.email, 'hein@example.com')
  assert.equal(r.carrierSegment, 'Arte e clientes privados')
  assert.equal(r.startDate, '2026-10-10')
  assert.equal(r.endDate, '2027-10-09')
  assert.equal(r.premium, 445.96)
  assert.equal(r.paymentFrequency, 'Annual')
  assert.equal(r.carrierStatus, 'active')
  assert.equal(result.rows[0]!.customerName, undefined)
})

test('INNOVARISK Policy List: policy, client, address, period (end = day before renewal), premium, status', () => {
  const row = { 'Nº da Apólice': 2563658, 'NIF': '320814360', 'Tomador': 'Jeffrey Example', 'Morada': 'Lote 54, Luz, 8600-146 Lagos, Portugal', 'AddressLine1': 'Aldeamento X, Lote 54', 'AddressLine2': '', 'AddressLine3': 'Luz', 'AddressLine4': 'Lagos', 'Postcode': '8600-146', 'Country': 'PRT', 'Frequência': 'Anual', 'Forma de Pagamento': 'Aviso de Recibo', 'Estado': 'Active', 'Produto': 'Home Insurance Plus', 'Moeda': 'EUR', 'Prémio Anual': 2206.85, 'Data de Inicio': new Date(Date.UTC(2026, 9, 6)), 'Data da Renovação': new Date(Date.UTC(2027, 9, 6)), 'Capital Seguro': 1415000, 'CodigoProduto': 'EDR' }
  const result = mapPortfolioRows('innovarisk', [normalizeRowKeys(row)])
  assert.equal(result.recognized, true)
  const r = result.rows[0]!
  assert.equal(r.externalPolicyNumber, '2563658')
  assert.equal(r.taxIdRaw, '320814360')
  assert.equal(r.customerName, 'Jeffrey Example')
  assert.equal(r.address, 'Aldeamento X, Lote 54')
  assert.equal(r.city, 'Lagos')
  assert.equal(r.postalCode, '8600-146')
  assert.equal(r.startDate, '2026-10-06')
  assert.equal(r.endDate, '2027-10-05')
  assert.equal(r.premium, 2206.85)
  assert.equal(r.carrierStatus, 'active')
  assert.equal(r.carrierPlanId, 'EDR')
  assert.equal(mapPortfolioRows('innovarisk', [{ anything: 'x' }]).recognized, false)
})
