import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeClaimDocuments } from './claim-documents.ts'
import type { ClaimFileRef, Document } from './types'

const portalUpload: Document = {
  id: 'doc-portal',
  individualClientId: 'cli_1',
  name: 'Simulacao.pdf',
  category: 'claim',
  size: 647_000,
  uploadedBy: 'Rita Testes',
  uploadedAt: '2026-10-21T19:52:46.351Z',
  storagePath: 'claims/clm_1/1792612362215-Simulacao.pdf',
}

test('a file uploaded on the other site is added to the claim with a timeline entry', () => {
  const merged = mergeClaimDocuments({ claimId: 'clm_1', documents: [], timeline: [], dbDocuments: [portalUpload] })
  assert.equal(merged.documents.length, 1)
  assert.equal(merged.documents[0].name, 'Simulacao.pdf')
  assert.equal(merged.documents[0].contentType, 'application/pdf')
  assert.equal(merged.documents[0].uploadedByRole, 'client')
  assert.equal(merged.timeline.length, 1)
  assert.equal(merged.timeline[0].message, 'Document added: Simulacao.pdf')
})

test('a file this site already knows is not listed twice', () => {
  const known: ClaimFileRef = {
    id: 'doc-portal',
    claimId: 'clm_1',
    name: 'Simulacao.pdf',
    contentType: 'application/pdf',
    uploadedAt: portalUpload.uploadedAt,
    uploadedByName: 'Rita Testes',
    uploadedByRole: 'client',
    storagePath: portalUpload.storagePath,
    size: 647_000,
  }
  const merged = mergeClaimDocuments({ claimId: 'clm_1', documents: [known], timeline: [], dbDocuments: [portalUpload] })
  assert.equal(merged.documents.length, 1)
  assert.equal(merged.timeline.length, 0)
})

test('files of another claim with a similar id are ignored', () => {
  const other = { ...portalUpload, id: 'doc-other', storagePath: 'claims/clmX1/123-other.pdf' }
  const merged = mergeClaimDocuments({ claimId: 'clm_1', documents: [], timeline: [], dbDocuments: [other] })
  assert.equal(merged.documents.length, 0)
})
