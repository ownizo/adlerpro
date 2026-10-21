import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findOrphanPaths, isLinkedPath, type StorageReferences } from './storage-orphans.ts'

const refs: StorageReferences = {
  paths: new Set(['misc/kept.pdf']),
  policyIds: new Set(['pol_1']),
  clientIds: new Set(['c-1']),
  claimIds: new Set(['clm_1']),
}

test('keeps files whose policy, claim or client still exists', () => {
  assert.equal(isLinkedPath('comp_1/policies/pol_1/a.pdf', refs), true)
  assert.equal(isLinkedPath('general/policies/pol_1/a.pdf', refs), true)
  assert.equal(isLinkedPath('comp_1/claims/clm_1/a.pdf', refs), true)
  assert.equal(isLinkedPath('claims/clm_1/a.pdf', refs), true)
  assert.equal(isLinkedPath('individual/c-1/a.pdf', refs), true)
})

test('keeps files referenced directly by a row', () => {
  assert.equal(isLinkedPath('misc/kept.pdf', refs), true)
})

test('flags files of deleted records and unknown layouts', () => {
  assert.deepEqual(
    findOrphanPaths(
      [
        'general/policies/pol_old/a.pdf',
        'individual/c-gone/b.pdf',
        'claims/clm_gone/c.pdf',
        'loose.pdf',
        'individual/c-1/.emptyFolderPlaceholder',
        'individual/c-1/ok.pdf',
      ],
      refs
    ),
    ['general/policies/pol_old/a.pdf', 'individual/c-gone/b.pdf', 'claims/clm_gone/c.pdf', 'loose.pdf']
  )
})
