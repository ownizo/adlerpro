import test from 'node:test'
import assert from 'node:assert/strict'

import { redactSensitivePayload } from './carrier-payload-redaction.ts'

test('top-level medical key is removed', () => {
  const input = { policyNumber: 'PT-2026/001', medicalHistory: 'flu, 2019' }
  const result = redactSensitivePayload(input) as Record<string, unknown>
  assert.equal('medicalHistory' in result, false)
  assert.equal(result.policyNumber, 'PT-2026/001')
})

test('nested diagnosis key is removed', () => {
  const input = {
    policyNumber: 'PT-2026/001',
    beneficiary: {
      name: 'Maria Silva',
      diagnosis: 'confidential',
    },
  }
  const result = redactSensitivePayload(input) as any
  assert.equal('diagnosis' in result.beneficiary, false)
  assert.equal(result.beneficiary.name, 'Maria Silva')
})

test('deeply nested treatment/medication keys are removed', () => {
  const input = {
    external: {
      client: {
        history: {
          treatmentPlan: 'confidential',
          medicationList: ['confidential'],
          lastVisit: '2026-01-01',
        },
      },
    },
  }
  const result = redactSensitivePayload(input) as any
  const history = result.external.client.history
  assert.equal('treatmentPlan' in history, false)
  assert.equal('medicationList' in history, false)
  assert.equal(history.lastVisit, '2026-01-01')
})

test('medical key inside an array object is removed', () => {
  const input = {
    claims: [
      { id: 'c1', diagnosis: 'confidential', amount: 100 },
      { id: 'c2', amount: 200 },
    ],
  }
  const result = redactSensitivePayload(input) as any
  assert.equal('diagnosis' in result.claims[0], false)
  assert.equal(result.claims[0].id, 'c1')
  assert.equal(result.claims[0].amount, 100)
  assert.deepEqual(result.claims[1], { id: 'c2', amount: 200 })
})

test('non-sensitive sibling fields remain intact alongside a redacted field', () => {
  const input = { policyNumber: 'PT-2026/001', insurer: 'zurich', patientNotes: 'confidential', market: 'PT' }
  const result = redactSensitivePayload(input) as Record<string, unknown>
  assert.equal(result.policyNumber, 'PT-2026/001')
  assert.equal(result.insurer, 'zurich')
  assert.equal(result.market, 'PT')
  assert.equal('patientNotes' in result, false)
})

test('original input object is not mutated', () => {
  const input = {
    policyNumber: 'PT-2026/001',
    beneficiary: { name: 'Maria Silva', diagnosis: 'confidential' },
  }
  const snapshot = JSON.parse(JSON.stringify(input))
  redactSensitivePayload(input)
  assert.deepEqual(input, snapshot)
})

test('ordinary policy/client identifiers remain visible', () => {
  const input = {
    externalPolicyId: 'ZP-001',
    externalClientId: 'ZC-001',
    externalPolicyNumber: 'PT-2026/001',
    market: 'PT',
  }
  const result = redactSensitivePayload(input)
  assert.deepEqual(result, input)
})

test('raw nested medical values cannot survive merely because their parent key is non-sensitive', () => {
  const input = {
    // "wrapper" and "details" are themselves innocuous key names, but their
    // descendants are sensitive at various depths — none of them should
    // shield the sensitive keys nested inside.
    wrapper: {
      details: {
        clinicalNotes: 'confidential',
        nested: {
          hospitalAdmission: 'confidential',
          safeField: 'kept',
        },
      },
      safeSibling: 'kept',
    },
  }
  const result = redactSensitivePayload(input) as any
  assert.equal('clinicalNotes' in result.wrapper.details, false)
  assert.equal('hospitalAdmission' in result.wrapper.details.nested, false)
  assert.equal(result.wrapper.details.nested.safeField, 'kept')
  assert.equal(result.wrapper.safeSibling, 'kept')
})

test('primitives and null are returned unchanged', () => {
  assert.equal(redactSensitivePayload('hello'), 'hello')
  assert.equal(redactSensitivePayload(42), 42)
  assert.equal(redactSensitivePayload(true), true)
  assert.equal(redactSensitivePayload(null), null)
  assert.equal(redactSensitivePayload(undefined), undefined)
})

test('arrays of primitives are preserved as-is', () => {
  const input = { tags: ['a', 'b', 'c'] }
  const result = redactSensitivePayload(input) as any
  assert.deepEqual(result.tags, ['a', 'b', 'c'])
})

test('key matching is case-insensitive and substring-based, matching the sensitive-key concept', () => {
  const input = { Diagnosis: 'x', MEDICAL_HISTORY: 'x', PatientId: 'x', hospitalName: 'x', keep: 'x' }
  const result = redactSensitivePayload(input) as Record<string, unknown>
  assert.deepEqual(result, { keep: 'x' })
})

test('does not inspect free-text values for medical words — only key names are evaluated', () => {
  const input = { notes: 'patient had a diagnosis of flu', reference: 'medical' }
  const result = redactSensitivePayload(input) as Record<string, unknown>
  // "notes" is not a sensitive key name, so its free-text value survives
  // untouched even though it mentions medical words.
  assert.equal(result.notes, 'patient had a diagnosis of flu')
  // "reference" is likewise not a sensitive key name, even though its
  // VALUE happens to be the word "medical" — values are never inspected.
  assert.equal(result.reference, 'medical')
})
