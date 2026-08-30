import test from 'node:test'
import assert from 'node:assert/strict'

import { reconcileClient, type ClientCandidate, type ExternalClientInput } from './client-reconciliation.ts'

function candidate(overrides: Partial<ClientCandidate> & Pick<ClientCandidate, 'id' | 'type'>): ClientCandidate {
  return { ...overrides }
}

function external(overrides: Partial<ExternalClientInput> & Pick<ExternalClientInput, 'provider'>): ExternalClientInput {
  return { ...overrides }
}

test('1. provider + externalClientId matching an existing external identity => exact', () => {
  const result = reconcileClient(
    external({ provider: 'zurich', externalClientId: 'Z-001' }),
    [
      candidate({
        id: 'ind_1',
        type: 'individual',
        externalIdentities: [{ provider: 'zurich', externalClientId: 'Z-001' }],
      }),
      candidate({ id: 'ind_2', type: 'individual' }),
    ],
  )
  assert.equal(result.status, 'exact')
  assert.equal(result.candidateId, 'ind_1')
  assert.deepEqual(result.candidateIds, ['ind_1'])
  assert.ok(result.signals.includes('external_identity'))
})

test('2. exactly one PT-normalized-NIF candidate => exact', () => {
  const result = reconcileClient(
    external({ provider: 'zurich', taxId: '123.456.789', taxCountry: 'PT' }),
    [
      candidate({ id: 'ind_1', type: 'individual', taxId: '123456789', taxCountry: 'PT' }),
      candidate({ id: 'ind_2', type: 'individual', taxId: '999999999', taxCountry: 'PT' }),
    ],
  )
  assert.equal(result.status, 'exact')
  assert.equal(result.candidateId, 'ind_1')
  assert.ok(result.signals.includes('tax_id_jurisdiction'))
})

test('3. two candidates share the same PT-normalized NIF => ambiguous', () => {
  const result = reconcileClient(
    external({ provider: 'zurich', taxId: '123456789', taxCountry: 'PT' }),
    [
      candidate({ id: 'ind_1', type: 'individual', taxId: '123.456.789', taxCountry: 'PT' }),
      candidate({ id: 'ind_2', type: 'individual', taxId: '123-456-789', taxCountry: 'Portugal' }),
    ],
  )
  assert.equal(result.status, 'ambiguous')
  assert.equal(result.candidateId, null)
  assert.deepEqual(result.candidateIds, ['ind_1', 'ind_2'])
})

test('4. same NIF digits but different tax jurisdiction => NOT exact', () => {
  const result = reconcileClient(
    external({ provider: 'zurich', taxId: '123456789', taxCountry: 'PT' }),
    [candidate({ id: 'ind_1', type: 'individual', taxId: '123456789', taxCountry: 'ES' })],
  )
  assert.notEqual(result.status, 'exact')
})

test('5. exact normalized email + same normalized name => probable', () => {
  const result = reconcileClient(
    external({ provider: 'zurich', email: 'Maria.Silva@example.com', name: 'Maria Silva' }),
    [candidate({ id: 'ind_1', type: 'individual', email: 'maria.silva@example.com', name: 'MARIA   SILVA' })],
  )
  assert.equal(result.status, 'probable')
  assert.equal(result.candidateId, 'ind_1')
  assert.ok(result.signals.includes('email_name'))
})

test('6. exact normalized phone + same normalized name => probable', () => {
  const result = reconcileClient(
    external({ provider: 'zurich', phone: '(912) 345-678', name: 'Joao Costa' }),
    [candidate({ id: 'ind_1', type: 'individual', phone: '912345678', name: 'João Costa' })],
  )
  assert.equal(result.status, 'probable')
  assert.equal(result.candidateId, 'ind_1')
  assert.ok(result.signals.includes('phone_name'))
})

test('7. name alone is never enough for exact', () => {
  const result = reconcileClient(
    external({ provider: 'zurich', name: 'Ana Pereira' }),
    [candidate({ id: 'ind_1', type: 'individual', name: 'Ana Pereira' })],
  )
  assert.notEqual(result.status, 'exact')
  // name-only agreement is still a meaningful signal (rule 5) — with a
  // single candidate that resolves to PROBABLE, never EXACT.
  assert.equal(result.status, 'probable')
})

test('8. no meaningful signal at all => new', () => {
  const result = reconcileClient(
    external({ provider: 'zurich', name: 'Someone Unrelated' }),
    [candidate({ id: 'ind_1', type: 'individual', name: 'Completely Different Person', email: 'other@example.com' })],
  )
  assert.equal(result.status, 'new')
  assert.equal(result.candidateId, null)
  assert.deepEqual(result.candidateIds, [])
})

test('9. two equally probable candidates => ambiguous, never auto-picked', () => {
  const result = reconcileClient(
    external({ provider: 'zurich', name: 'Pedro Alves' }),
    [
      candidate({ id: 'ind_1', type: 'individual', name: 'Pedro Alves' }),
      candidate({ id: 'ind_2', type: 'individual', name: 'Pedro Alves' }),
    ],
  )
  assert.equal(result.status, 'ambiguous')
  assert.equal(result.candidateId, null)
  assert.deepEqual(result.candidateIds, ['ind_1', 'ind_2'])
})

test('10. candidate array order never changes the result', () => {
  const ext = external({ provider: 'zurich', name: 'Pedro Alves' })
  const a = candidate({ id: 'ind_1', type: 'individual', name: 'Pedro Alves' })
  const b = candidate({ id: 'ind_2', type: 'individual', name: 'Pedro Alves' })

  const forward = reconcileClient(ext, [a, b])
  const reversed = reconcileClient(ext, [b, a])

  assert.deepEqual(forward, reversed)
})

test('external identity claimed by more than one candidate => ambiguous, not the first one found', () => {
  const result = reconcileClient(
    external({ provider: 'zurich', externalClientId: 'Z-001' }),
    [
      candidate({ id: 'ind_1', type: 'individual', externalIdentities: [{ provider: 'zurich', externalClientId: 'Z-001' }] }),
      candidate({ id: 'ind_2', type: 'individual', externalIdentities: [{ provider: 'zurich', externalClientId: 'Z-001' }] }),
    ],
  )
  assert.equal(result.status, 'ambiguous')
  assert.deepEqual(result.candidateIds, ['ind_1', 'ind_2'])
})

test('company candidates are matched the same way and candidateType is reported correctly', () => {
  const result = reconcileClient(
    external({ provider: 'zurich', taxId: '500123456', taxCountry: 'PT' }),
    [candidate({ id: 'cmp_1', type: 'company', taxId: '500123456', taxCountry: 'PT' })],
  )
  assert.equal(result.status, 'exact')
  assert.equal(result.candidateType, 'company')
  assert.equal(result.candidateId, 'cmp_1')
})
