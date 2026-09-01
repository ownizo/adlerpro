import test from 'node:test'
import assert from 'node:assert/strict'

import { parsePortfolioWorkbook, MAX_IMPORT_FILE_SIZE_BYTES } from './carrier-excel-workbook.ts'
import { mapPortfolioRows } from './carrier-import-mappers.ts'

async function buildWorkbookBuffer(rows: Record<string, unknown>[]): Promise<Buffer> {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

test('parses a well-formed workbook into row objects keyed by header', async () => {
  const buffer = await buildWorkbookBuffer([
    { tomador_id: 'C1', nif: '123456789' },
    { tomador_id: 'C2', nif: '987654321' },
  ])
  const result = await parsePortfolioWorkbook(buffer, 'portfolio.xlsx')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.rows.length, 2)
    assert.equal(result.rows[0]?.tomador_id, 'C1')
  }
})

test('EMPTY WORKBOOK REJECTED: a workbook with a sheet but no data rows is rejected', async () => {
  const buffer = await buildWorkbookBuffer([])
  const result = await parsePortfolioWorkbook(buffer, 'portfolio.xlsx')
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /no recognizable rows/i)
})

test('an empty (zero-byte) file is rejected', async () => {
  const result = await parsePortfolioWorkbook(Buffer.alloc(0), 'portfolio.xlsx')
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /empty/i)
})

test('rejects a file whose extension is not .xlsx/.xls/.csv', async () => {
  const buffer = await buildWorkbookBuffer([{ a: 1 }])
  const result = await parsePortfolioWorkbook(buffer, 'portfolio.txt')
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /xlsx|xls|csv/i)
})

test('rejects a file larger than the configured maximum', async () => {
  const oversized = Buffer.alloc(MAX_IMPORT_FILE_SIZE_BYTES + 1, 1)
  const result = await parsePortfolioWorkbook(oversized, 'portfolio.xlsx')
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /too large/i)
})

test('rejects bytes that are not a real workbook, without throwing', async () => {
  const garbage = Buffer.from('this is definitely not an xlsx file', 'utf8')
  const result = await parsePortfolioWorkbook(garbage, 'portfolio.xlsx')
  assert.equal(result.ok, false)
})

// ── CSV support (Allianz POLRES.CSV) ────────────────────────────────────
//
// Synthetic fixtures ONLY — real POLRES header names/shape, invented
// values (no production customer names, NIFs, phones, addresses, policy
// numbers or banking details).

function csvBuffer(text: string): Buffer {
  return Buffer.from(text, 'utf8')
}

test('CSV ACCEPTED: a lowercase .csv file is parsed through the same pipeline as Excel', async () => {
  const buffer = csvBuffer('APOLICE;ADESAO\r\n900000001;00001\r\n')
  const result = await parsePortfolioWorkbook(buffer, 'polres.csv')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.rows.length, 1)
    assert.equal(result.rows[0]?.APOLICE, '900000001')
  }
})

test('CSV ACCEPTED: an uppercase .CSV extension (POLRES.CSV) is accepted — extension matching is case-insensitive', async () => {
  const buffer = csvBuffer('APOLICE;ADESAO\r\n900000001;00001\r\n')
  const result = await parsePortfolioWorkbook(buffer, 'POLRES.CSV')
  assert.equal(result.ok, true)
})

test('EXCEL STILL ACCEPTED: .xlsx and .xls both remain accepted, unchanged, after adding CSV support', async () => {
  const buffer = await buildWorkbookBuffer([{ tomador_id: 'C1' }])
  const xlsxResult = await parsePortfolioWorkbook(buffer, 'portfolio.xlsx')
  assert.equal(xlsxResult.ok, true)
  const xlsResult = await parsePortfolioWorkbook(buffer, 'portfolio.xls')
  assert.equal(xlsResult.ok, true)
})

test('CSV: semicolon-delimited POLRES-shaped file parses correctly, with accented headers preserved', async () => {
  const buffer = csvBuffer(
    'MEDIADOR;RAMO;APÓLICE;ADESÃO;NOME TOMADOR;DOC TOMADOR\r\n' +
    'MED001;1289;900000001;00001;Ana Exemplo;900000000\r\n',
  )
  const result = await parsePortfolioWorkbook(buffer, 'polres.csv')
  assert.equal(result.ok, true)
  if (result.ok) {
    const row = result.rows[0]!
    // accented header keys must survive intact for normalizeHeaderName
    // downstream — this is what proves UTF-8 decoding (not mojibake) is
    // happening, not just that SOME value made it through.
    assert.equal(row['APÓLICE'], '900000001')
    assert.equal(row['ADESÃO'], '00001')
    assert.equal(row['NOME TOMADOR'], 'Ana Exemplo')
  }
})

test('CSV: a quoted value containing the delimiter (semicolon) does not split into an extra column', async () => {
  const buffer = csvBuffer(
    'NOME TOMADOR;LOCALIDADE TOMADOR\r\n' +
    '"Exemplo; com ponto e vírgula";Santarém\r\n',
  )
  const result = await parsePortfolioWorkbook(buffer, 'polres.csv')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.rows.length, 1)
    assert.equal(result.rows[0]?.['NOME TOMADOR'], 'Exemplo; com ponto e vírgula')
    assert.equal(result.rows[0]?.['LOCALIDADE TOMADOR'], 'Santarém')
  }
})

test('CSV: comma-delimited file (no semicolons present) also parses correctly, including a quoted comma inside a value', async () => {
  const buffer = csvBuffer(
    'NOME TOMADOR,OBS\r\n' +
    '"Exemplo, com vírgula",plain\r\n',
  )
  const result = await parsePortfolioWorkbook(buffer, 'polres.csv')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.rows.length, 1)
    assert.equal(result.rows[0]?.['NOME TOMADOR'], 'Exemplo, com vírgula')
    assert.equal(result.rows[0]?.OBS, 'plain')
  }
})

test('CSV: Windows CRLF line endings are handled — two data rows are parsed, not merged into one', async () => {
  const buffer = csvBuffer('APOLICE;ADESAO\r\n900000001;00001\r\n900000002;00002\r\n')
  const result = await parsePortfolioWorkbook(buffer, 'polres.csv')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.rows.length, 2)
    assert.equal(result.rows[0]?.APOLICE, '900000001')
    assert.equal(result.rows[1]?.APOLICE, '900000002')
  }
})

test('CSV: ADESÃO "00001" reaches the row as a string with its leading zeros intact, never the number 1', async () => {
  const buffer = csvBuffer('APOLICE;ADESAO\r\n900000001;00001\r\n900000001;00000\r\n')
  const result = await parsePortfolioWorkbook(buffer, 'polres.csv')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.rows[0]?.ADESAO, '00001')
    assert.notEqual(result.rows[0]?.ADESAO, 1)
    assert.equal(result.rows[1]?.ADESAO, '00000')
    assert.notEqual(result.rows[1]?.ADESAO, 0)
  }
})

test('CSV: a leading UTF-8 BOM does not attach to the first header name', async () => {
  const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), csvBuffer('APOLICE;ADESAO\r\n900000001;00001\r\n')])
  const result = await parsePortfolioWorkbook(buffer, 'polres.csv')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.rows[0]?.APOLICE, '900000001')
    assert.equal('APOLICE' in result.rows[0]!, true)
  }
})

test('CSV: an empty trailing column does not corrupt or shift the other columns\' values', async () => {
  const buffer = csvBuffer('APOLICE;ADESAO;\r\n900000001;00001;\r\n')
  const result = await parsePortfolioWorkbook(buffer, 'polres.csv')
  assert.equal(result.ok, true)
  if (result.ok) {
    const row = result.rows[0]!
    assert.equal(row.APOLICE, '900000001')
    assert.equal(row.ADESAO, '00001')
    // no value anywhere in the row is the literal string "undefined"
    assert.equal(JSON.stringify(row).includes('"undefined"'), false)
  }
})

test('CSV: an empty (zero-byte) .csv file is rejected the same way as an empty Excel file', async () => {
  const result = await parsePortfolioWorkbook(Buffer.alloc(0), 'polres.csv')
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /empty/i)
})

test('CSV: a header-only .csv file with no data rows is rejected', async () => {
  const buffer = csvBuffer('APOLICE;ADESAO\r\n')
  const result = await parsePortfolioWorkbook(buffer, 'polres.csv')
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /no recognizable rows/i)
})

test('CSV: a file larger than the configured maximum is rejected the same way as an oversized Excel file', async () => {
  const oversized = Buffer.alloc(MAX_IMPORT_FILE_SIZE_BYTES + 1, 0x31) // '1' repeated — plausible CSV byte
  const result = await parsePortfolioWorkbook(oversized, 'polres.csv')
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /too large/i)
})

// ── same downstream pipeline as Excel: CSV -> mapPortfolioRows ─────────
//
// Proves parsePortfolioWorkbook's CSV output is consumed by the SAME
// mapPortfolioRows('allianz', ...) call as an Excel-sourced upload —
// there is no separate/parallel reconciliation path for CSV — and that
// the banking/direct-debit stripping introduced in PR #105 still applies
// to rows that arrived via CSV.

test('CSV INTEGRATION: a semicolon-delimited POLRES.CSV upload reaches mapPortfolioRows(\'allianz\', ...) and is recognized', async () => {
  const buffer = csvBuffer(
    'RAMO;APÓLICE;ADESÃO;NOME TOMADOR;DOC TOMADOR;OBJECTO/BEM SEGURO\r\n' +
    '1289;900000001;00001;Ana Exemplo;900000000;Objecto de teste\r\n',
  )
  const parsed = await parsePortfolioWorkbook(buffer, 'POLRES.CSV')
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return

  const mapped = mapPortfolioRows('allianz', parsed.rows)
  assert.equal(mapped.recognized, true)
  assert.equal(mapped.rows.length, 1)
  const row = mapped.rows[0]!
  assert.equal(row.externalPolicyNumber, '900000001')
  assert.equal(row.carrierPlanId, '00001') // leading zero survives the full CSV -> mapper round-trip
  assert.equal(row.customerName, 'Ana Exemplo')
})

test('CSV INTEGRATION: banking/direct-debit fields uploaded via CSV are still stripped from sanitizedRaw by the existing PR #105 protections', async () => {
  const buffer = csvBuffer(
    'RAMO;APÓLICE;ADESÃO;NOME TOMADOR;DOC TOMADOR;OBJECTO/BEM SEGURO;NOME BANCO;IBAN;AUTORIZAÇÃO\r\n' +
    '1289;900000001;00001;Ana Exemplo;900000000;Objecto de teste;Banco Fictício;PT50000000000000000000000;AUTH-FAKE-1\r\n',
  )
  const parsed = await parsePortfolioWorkbook(buffer, 'POLRES.CSV')
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return

  const mapped = mapPortfolioRows('allianz', parsed.rows)
  assert.equal(mapped.recognized, true)
  const row = mapped.rows[0]!
  for (const key of ['nome_banco', 'iban', 'autorizacao']) {
    assert.equal(key in row.sanitizedRaw, false, `expected "${key}" to be absent from sanitizedRaw`)
  }
  assert.equal(JSON.stringify(row.sanitizedRaw).includes('PT50000000000000000000000'), false)
  assert.equal(JSON.stringify(row.sanitizedRaw).includes('AUTH-FAKE-1'), false)
  // and legitimate fields are NOT collateral damage
  assert.equal(row.sanitizedRaw['nome_tomador'], 'Ana Exemplo')
})
