import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyStoragePath, escapeLikePattern, ownsRecord } from './storage-access.ts'

test('classifies the bucket layouts by the record they belong to', () => {
  assert.deepEqual(classifyStoragePath('comp_1/policies/pol_1/file.pdf'), { kind: 'policy', policyId: 'pol_1' })
  assert.deepEqual(classifyStoragePath('general/policies/pol_2/a/b.pdf'), { kind: 'policy', policyId: 'pol_2' })
  assert.deepEqual(classifyStoragePath('claims/clm_1/photo.jpg'), { kind: 'claim', claimId: 'clm_1' })
  assert.deepEqual(classifyStoragePath('comp_1/claims/clm_2/photo.jpg'), { kind: 'claim', claimId: 'clm_2' })
  assert.deepEqual(classifyStoragePath('individual/ic_1/doc.pdf'), { kind: 'individual', individualClientId: 'ic_1' })
  assert.deepEqual(classifyStoragePath('comp_1/123_doc.pdf'), { kind: 'other' })
})

test('refuses paths that must never be served', () => {
  for (const bad of ['', '/comp/policies/p/f', 'a/../policies/p/f', 'comp/policies/p/../../x', 'a//b', 'a\\b', './a', 'x'.repeat(1025), null, 42, {}]) {
    assert.equal(classifyStoragePath(bad), null, String(bad))
  }
})

test('a folder without a file is not a policy or claim target', () => {
  assert.deepEqual(classifyStoragePath('comp_1/policies/pol_1'), { kind: 'other' })
  assert.deepEqual(classifyStoragePath('individual/ic_1'), { kind: 'other' })
})

test('escapes LIKE wildcards so an email matches only itself', () => {
  assert.equal(escapeLikePattern('john_smith@x.com'), 'john\\_smith@x.com')
  assert.equal(escapeLikePattern('a%b\\c'), 'a\\%b\\\\c')
  assert.equal(escapeLikePattern('plain@x.com'), 'plain@x.com')
})

test('ownership needs a matching company or personal client', () => {
  const company = { isAdmin: false, companyId: 'c1', individualClientId: null }
  const person = { isAdmin: false, companyId: null, individualClientId: 'i1' }
  const nobody = { isAdmin: false, companyId: null, individualClientId: null }
  assert.equal(ownsRecord(company, { company_id: 'c1' }), true)
  assert.equal(ownsRecord(company, { company_id: 'c2' }), false)
  assert.equal(ownsRecord(person, { individual_client_id: 'i1', company_id: 'c9' }), true)
  assert.equal(ownsRecord(person, { individual_client_id: 'i2' }), false)
  assert.equal(ownsRecord(nobody, { company_id: null, individual_client_id: null }), false)
  assert.equal(ownsRecord(company, null), false)
})
