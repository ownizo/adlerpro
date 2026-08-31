import test from 'node:test'
import assert from 'node:assert/strict'

import { parsePortfolioWorkbook, MAX_IMPORT_FILE_SIZE_BYTES } from './carrier-excel-workbook.ts'

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

test('rejects a file whose extension is not .xlsx/.xls', async () => {
  const buffer = await buildWorkbookBuffer([{ a: 1 }])
  const result = await parsePortfolioWorkbook(buffer, 'portfolio.csv')
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /xlsx|xls/i)
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
