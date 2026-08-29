import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeEmail, isValidEmail } from './email.ts'

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  Maria@Example.com '), 'maria@example.com')
  assert.equal(normalizeEmail('MARIA@EXAMPLE.COM'), 'maria@example.com')
  assert.equal(normalizeEmail('maria@example.com'), 'maria@example.com')
})

test('normalizeEmail treats null/undefined/empty as empty string', () => {
  assert.equal(normalizeEmail(null), '')
  assert.equal(normalizeEmail(undefined), '')
  assert.equal(normalizeEmail('   '), '')
})

test('isValidEmail accepts well-formed addresses regardless of case/whitespace', () => {
  assert.equal(isValidEmail('maria@example.com'), true)
  assert.equal(isValidEmail(' MARIA@EXAMPLE.COM '), true)
})

test('isValidEmail rejects malformed or empty input', () => {
  assert.equal(isValidEmail(''), false)
  assert.equal(isValidEmail('   '), false)
  assert.equal(isValidEmail(undefined), false)
  assert.equal(isValidEmail('not-an-email'), false)
  assert.equal(isValidEmail('missing-domain@'), false)
  assert.equal(isValidEmail('@missing-local.com'), false)
})
