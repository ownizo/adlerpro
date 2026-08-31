import test from 'node:test'
import assert from 'node:assert/strict'

import { computeImportFingerprint } from './carrier-import-fingerprint.ts'
import type { ParsedImportRow } from './carrier-import-parsing.ts'

function row(sanitizedRaw: Record<string, unknown>): ParsedImportRow {
  return { sanitizedRaw: sanitizedRaw as any }
}

test('DUPLICATE/REPEATED FILE FINGERPRINT: identical provider + content produces the identical fingerprint', () => {
  const rows = [row({ tomador_id: 'C1', nif: '123456789' }), row({ tomador_id: 'C2', nif: '987654321' })]
  const fp1 = computeImportFingerprint('mgen', rows)
  const fp2 = computeImportFingerprint('mgen', rows)
  assert.equal(fp1, fp2)
})

test('fingerprint is independent of row order', () => {
  const a = row({ tomador_id: 'C1', nif: '123456789' })
  const b = row({ tomador_id: 'C2', nif: '987654321' })
  assert.equal(computeImportFingerprint('mgen', [a, b]), computeImportFingerprint('mgen', [b, a]))
})

test('fingerprint is independent of key insertion order within a row', () => {
  const a = row({ tomador_id: 'C1', nif: '123456789' })
  const b = row({ nif: '123456789', tomador_id: 'C1' })
  assert.equal(computeImportFingerprint('mgen', [a]), computeImportFingerprint('mgen', [b]))
})

test('different content produces a different fingerprint', () => {
  const a = [row({ tomador_id: 'C1', nif: '123456789' })]
  const b = [row({ tomador_id: 'C1', nif: '999999999' })]
  assert.notEqual(computeImportFingerprint('mgen', a), computeImportFingerprint('mgen', b))
})

test('the same content under a different provider never collides (provider is part of the hash)', () => {
  const rows = [row({ tomador_id: 'C1', nif: '123456789' })]
  assert.notEqual(computeImportFingerprint('mgen', rows), computeImportFingerprint('allianz', rows))
})

test('fingerprint is a deterministic hex string, never empty', () => {
  const fp = computeImportFingerprint('mgen', [row({ a: 1 })])
  assert.match(fp, /^[0-9a-f]{64}$/)
})
