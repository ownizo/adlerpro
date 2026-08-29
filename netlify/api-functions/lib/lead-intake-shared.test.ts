import test from 'node:test'
import assert from 'node:assert/strict'

import { parseLeadIntakePayload } from './lead-intake-shared.ts'

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Maria Silva',
    email: 'maria@example.com',
    formName: 'cotacao-habitacao',
    ...overrides,
  }
}

test('accepts a minimal valid payload and normalizes the email', () => {
  const result = parseLeadIntakePayload(basePayload({ email: '  MARIA@EXAMPLE.COM ' }))
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.email, 'maria@example.com')
    assert.equal(result.value.name, 'Maria Silva')
    assert.equal(result.value.formName, 'cotacao-habitacao')
  }
})

test('rejects a missing/empty name without inventing one', () => {
  assert.equal(parseLeadIntakePayload(basePayload({ name: '' })).ok, false)
  assert.equal(parseLeadIntakePayload(basePayload({ name: '   ' })).ok, false)
  const { name: _drop, ...withoutName } = basePayload()
  assert.equal(parseLeadIntakePayload(withoutName).ok, false)
})

test('rejects an invalid or missing email', () => {
  assert.equal(parseLeadIntakePayload(basePayload({ email: 'not-an-email' })).ok, false)
  assert.equal(parseLeadIntakePayload(basePayload({ email: '' })).ok, false)
  const { email: _drop, ...withoutEmail } = basePayload()
  assert.equal(parseLeadIntakePayload(withoutEmail).ok, false)
})

test('rejects a missing formName', () => {
  const { formName: _drop, ...withoutFormName } = basePayload()
  assert.equal(parseLeadIntakePayload(withoutFormName).ok, false)
})

test('rejects non-object payloads', () => {
  assert.equal(parseLeadIntakePayload(null).ok, false)
  assert.equal(parseLeadIntakePayload('a string').ok, false)
  assert.equal(parseLeadIntakePayload([1, 2, 3]).ok, false)
})

test('carries utm fields through when present, empty object when absent', () => {
  const result = parseLeadIntakePayload(
    basePayload({ utm: { source: 'instagram', medium: 'bio', campaign: 'saude-expat' } }),
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.utm.source, 'instagram')
    assert.equal(result.value.utm.medium, 'bio')
    assert.equal(result.value.utm.campaign, 'saude-expat')
    assert.equal(result.value.utm.content, undefined)
  }
})

test('PRIVACY: fields outside the allowlist never survive into the sanitized value', () => {
  const result = parseLeadIntakePayload(
    basePayload({
      health_preexisting: 'diabetes, asthma',
      saude_preexistentes: 'sim, hipertensão',
      dob: '1980-01-01',
      nif: '123456789',
      cartaoCidadao: '12345678',
      // Even nested inside metadata, only flat string/number/boolean primitives
      // survive — nested objects are dropped wholesale rather than flattened,
      // so a sensitive value hidden a level deep cannot sneak through.
      metadata: {
        branchLabel: 'Saúde',
        nested: { health_preexisting: 'diabetes' },
      },
    }),
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    const serialized = JSON.stringify(result.value)
    assert.equal(serialized.includes('diabetes'), false)
    assert.equal(serialized.includes('asthma'), false)
    assert.equal(serialized.includes('hipertensão'), false)
    assert.equal(serialized.includes('123456789'), false)
    assert.equal(serialized.includes('12345678'), false)
    assert.equal(serialized.includes('1980-01-01'), false)
    assert.deepEqual(result.value.metadata, { branchLabel: 'Saúde' })
  }
})

test('caps metadata to a small number of flat keys', () => {
  const bigMetadata = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, `v${i}`]))
  const result = parseLeadIntakePayload(basePayload({ metadata: bigMetadata }))
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.ok(Object.keys(result.value.metadata ?? {}).length <= 20)
  }
})
