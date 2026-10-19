import test from 'node:test'
import assert from 'node:assert/strict'
import { suggestApplyActions, looksLikeCompanyTaxId } from './carrier-apply-actions.ts'
import { inferPolicyType } from './carrier-apply-field-mapping.ts'

const base = { externalPolicyNumber: '1047983', startDate: '2026-10-10', endDate: '2027-10-09' }

test('new client + new policy → create individual + create policy', () => {
  const s = suggestApplyActions({ ...base, customerMatchStatus: 'new', policyMatchStatus: 'new', customerName: 'Hein Example', taxId: '307499995' })
  assert.deepEqual(s, { ok: true, customerApplyAction: 'create_individual', policyApplyAction: 'create_policy', selectedIndividualClientId: undefined, selectedCompanyId: undefined, selectedPolicyId: undefined })
})

test('company NIF → create company', () => {
  const s = suggestApplyActions({ ...base, customerMatchStatus: 'new', policyMatchStatus: 'new', customerName: 'ACME Lda', taxId: '515123456' })
  assert.equal(s.ok && s.customerApplyAction, 'create_company')
  assert.equal(looksLikeCompanyTaxId('307499995'), false)
})

test('exact matches → link existing client and policy', () => {
  const s = suggestApplyActions({ ...base, customerMatchStatus: 'exact', policyMatchStatus: 'exact', matchedIndividualClientId: 'ic1', matchedPolicyId: 'p1' })
  assert.equal(s.ok, true)
  if (s.ok) {
    assert.equal(s.customerApplyAction, 'link_existing_individual')
    assert.equal(s.selectedIndividualClientId, 'ic1')
    assert.equal(s.policyApplyAction, 'link_existing_policy')
    assert.equal(s.selectedPolicyId, 'p1')
  }
})

test('no suggestion when tomador missing, dates missing or match uncertain', () => {
  assert.equal(suggestApplyActions({ ...base, customerMatchStatus: 'new', policyMatchStatus: 'new' }).ok, false)
  assert.equal(suggestApplyActions({ customerMatchStatus: 'new', policyMatchStatus: 'new', customerName: 'X', externalPolicyNumber: '1' }).ok, false)
  assert.equal(suggestApplyActions({ ...base, customerMatchStatus: 'probable', policyMatchStatus: 'new', customerName: 'X' }).ok, false)
})

test('policy type from product', () => {
  assert.equal(inferPolicyType({ sanitizedRaw: {}, productDescription: 'Holiday Homes', carrierSegment: 'Arte e clientes privados' }, 'Hiscox'), 'property')
  assert.equal(inferPolicyType({ sanitizedRaw: {}, productDescription: 'Home Insurance Plus' }, 'Innovarisk'), 'property')
  assert.equal(inferPolicyType({ sanitizedRaw: {}, productDescription: 'Plano X' }, 'MGEN'), 'health')
  assert.equal(inferPolicyType({ sanitizedRaw: {}, productDescription: 'Plano X' }, 'Zurich'), 'other')
})

test('company name without NIF → review, never creates an individual', async () => {
  const { looksLikeCompanyName } = await import('./carrier-apply-actions.ts')
  assert.equal(looksLikeCompanyName('RODOPIO CHARME ATIVIDADES TURISTICAS HOTELEIRAS'), true)
  assert.equal(looksLikeCompanyName('HUGO MIGUEL REBOLO GONÇALVES'), false)
  const s = suggestApplyActions({ ...base, customerMatchStatus: 'new', policyMatchStatus: 'new', customerName: 'ACME LDA' })
  assert.equal(s.ok, false)
  assert.equal(inferPolicyType({ sanitizedRaw: {}, productDescription: 'M.RISCOS EMPRESA' }, 'Fidelidade'), 'property')
  assert.equal(inferPolicyType({ sanitizedRaw: {}, productDescription: 'AUTOMOVEL' }, 'Allianz'), 'auto')
})
