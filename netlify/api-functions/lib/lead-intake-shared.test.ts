import test from 'node:test'
import assert from 'node:assert/strict'

import { parseLeadIntakePayload, buildLeadIntakeResponse } from './lead-intake-shared.ts'

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

// ── Hardening: opportunity creation is best-effort, never fails the intake ──

// A: lead novo + opportunity success -> ok true
test('buildLeadIntakeResponse: fresh lead + opportunity created -> ok:true with both flags true', () => {
  const response = buildLeadIntakeResponse({
    clientId: 'client-1',
    clientCreated: true,
    leadCreated: true,
    opportunityCreated: true,
  })
  assert.deepEqual(response, {
    ok: true,
    clientId: 'client-1',
    clientCreated: true,
    leadCreated: true,
    duplicateSubmission: false,
    opportunityCreated: true,
  })
})

// B: lead novo + opportunity failure -> lead permanece válido, resposta
// global continua ok, opportunityCreated false
test('buildLeadIntakeResponse: fresh lead + opportunity failure -> still ok:true, leadCreated:true, opportunityCreated:false', () => {
  const response = buildLeadIntakeResponse({
    clientId: 'client-1',
    clientCreated: true,
    leadCreated: true,
    opportunityCreated: false,
  })
  assert.equal(response.ok, true)
  assert.equal(response.leadCreated, true)
  assert.equal(response.opportunityCreated, false)
  assert.equal(response.duplicateSubmission, false)
})

// C/D: retry — lead reutilizado. A resposta continua ok:true e nunca expõe
// se por trás disto houve uma cura de uma falha anterior ou uma reutilização
// pura; o que importa é nunca haver erro nem duplicado.
test('buildLeadIntakeResponse: retry (lead reused) + opportunity healed on this attempt -> duplicateSubmission true, opportunityCreated true', () => {
  const response = buildLeadIntakeResponse({
    clientId: 'client-1',
    clientCreated: false,
    leadCreated: false,
    opportunityCreated: true,
  })
  assert.equal(response.ok, true)
  assert.equal(response.duplicateSubmission, true)
  assert.equal(response.opportunityCreated, true)
})

test('buildLeadIntakeResponse: retry (lead reused) + opportunity already existed -> opportunityCreated false, still ok', () => {
  const response = buildLeadIntakeResponse({
    clientId: 'client-1',
    clientCreated: false,
    leadCreated: false,
    opportunityCreated: false,
  })
  assert.equal(response.ok, true)
  assert.equal(response.duplicateSubmission, true)
  assert.equal(response.opportunityCreated, false)
})

test('buildLeadIntakeResponse: never accepts or leaks an internal error message', () => {
  // A própria assinatura da função não tem parâmetro para uma mensagem de
  // erro — este teste documenta essa garantia estrutural.
  const response = buildLeadIntakeResponse({
    clientId: 'client-1',
    clientCreated: true,
    leadCreated: true,
    opportunityCreated: false,
  })
  const serialized = JSON.stringify(response)
  assert.equal(serialized.includes('Supabase'), false)
  assert.equal(serialized.includes('error'), false)
})
