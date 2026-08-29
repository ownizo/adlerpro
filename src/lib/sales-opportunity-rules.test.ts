import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildOpportunityTitle,
  buildWebsiteLeadOpportunityPayload,
  computeClosedAtForStageChange,
  isClosedStage,
  shouldCreateOpportunityForWebsiteLead,
  validateOpportunityOwner,
} from './sales-opportunity-rules.ts'
import type { SalesOpportunityStage } from './types.ts'

test('buildOpportunityTitle produces a readable "product — client" label', () => {
  assert.equal(buildOpportunityTitle('health', 'Anna Weber'), 'Seguro de Saúde — Anna Weber')
  assert.equal(buildOpportunityTitle('professional-liability', 'João Silva'), 'RC Profissional — João Silva')
})

test('buildOpportunityTitle falls back to a humanised id for an unknown product, never throws', () => {
  assert.equal(buildOpportunityTitle('some-new-product', 'Maria Silva'), 'Some New Product — Maria Silva')
})

test('buildOpportunityTitle never crashes on a missing product or empty name', () => {
  assert.equal(buildOpportunityTitle(undefined, 'Maria Silva'), 'Pedido — Maria Silva')
  assert.equal(buildOpportunityTitle('health', ''), 'Seguro de Saúde — Cliente')
})

test('isClosedStage is true only for won/lost', () => {
  assert.equal(isClosedStage('won'), true)
  assert.equal(isClosedStage('lost'), true)
  assert.equal(isClosedStage('new'), false)
  assert.equal(isClosedStage('contacted'), false)
  assert.equal(isClosedStage('needs_analysis'), false)
  assert.equal(isClosedStage('quoted'), false)
  assert.equal(isClosedStage('negotiation'), false)
})

test('stage -> won sets closedAt', () => {
  const now = '2026-08-29T12:00:00.000Z'
  assert.equal(computeClosedAtForStageChange('won', now), now)
})

test('stage -> lost sets closedAt', () => {
  const now = '2026-08-29T12:00:00.000Z'
  assert.equal(computeClosedAtForStageChange('lost', now), now)
})

test('won/lost -> reopen (any open stage) clears closedAt', () => {
  const now = '2026-08-29T12:00:00.000Z'
  const openStages: SalesOpportunityStage[] = ['new', 'contacted', 'needs_analysis', 'quoted', 'negotiation']
  for (const stage of openStages) {
    assert.equal(computeClosedAtForStageChange(stage, now), null, `expected reopening into "${stage}" to clear closedAt`)
  }
})

test('new -> contacted (an open-to-open transition) never sets closedAt', () => {
  const now = '2026-08-29T12:00:00.000Z'
  assert.equal(computeClosedAtForStageChange('contacted', now), null)
})

test('PRIVACY: buildWebsiteLeadOpportunityPayload never carries through fields outside its allowlisted input', () => {
  // Simula um erro de chamada onde alguém passa campos extra (dados
  // sensíveis do formulário de origem) para além dos aceites — a
  // assinatura da função já não os aceitaria em TypeScript, mas o teste
  // confirma que mesmo assim eles não sobreviveriam ao objeto devolvido.
  const inputWithExtraFields = {
    individualClientId: 'client-1',
    websiteLeadId: 'lead-1',
    clientName: 'Maria Silva',
    market: 'PT',
    product: 'health',
    health_preexisting: 'diabetes, asthma',
    dob: '1980-01-01',
  }
  const payload = buildWebsiteLeadOpportunityPayload(inputWithExtraFields as unknown as Parameters<typeof buildWebsiteLeadOpportunityPayload>[0])
  const serialized = JSON.stringify(payload)
  assert.equal(serialized.includes('diabetes'), false)
  assert.equal(serialized.includes('1980-01-01'), false)
})

test('validateOpportunityOwner: exactly one of company/individual is valid', () => {
  assert.deepEqual(validateOpportunityOwner({ companyId: 'acme', individualClientId: undefined }), { ok: true })
  assert.deepEqual(validateOpportunityOwner({ companyId: undefined, individualClientId: 'uuid-1' }), { ok: true })
})

test('validateOpportunityOwner: rejects both owners present', () => {
  const result = validateOpportunityOwner({ companyId: 'acme', individualClientId: 'uuid-1' })
  assert.deepEqual(result, { ok: false, error: 'both_owners' })
})

test('validateOpportunityOwner: rejects no owner present', () => {
  assert.deepEqual(validateOpportunityOwner({}), { ok: false, error: 'missing_owner' })
  assert.deepEqual(validateOpportunityOwner({ companyId: '', individualClientId: '' }), {
    ok: false,
    error: 'missing_owner',
  })
})

test('shouldCreateOpportunityForWebsiteLead mirrors the website_lead creation outcome', () => {
  assert.equal(shouldCreateOpportunityForWebsiteLead(true), true)
  assert.equal(shouldCreateOpportunityForWebsiteLead(false), false)
})

test('buildWebsiteLeadOpportunityPayload: market ES is preserved, never rewritten', () => {
  const payload = buildWebsiteLeadOpportunityPayload({
    individualClientId: 'client-1',
    websiteLeadId: 'lead-1',
    clientName: 'Laura Fernández',
    market: 'ES',
    product: 'home',
  })
  assert.equal(payload.market, 'ES')
})

test('buildWebsiteLeadOpportunityPayload: source is always "website", stage is always "new"', () => {
  const payload = buildWebsiteLeadOpportunityPayload({
    individualClientId: 'client-1',
    websiteLeadId: 'lead-1',
    clientName: 'Anna Weber',
    market: 'PT',
    product: 'health',
  })
  assert.equal(payload.source, 'website')
  assert.equal(payload.stage, 'new')
  assert.equal(payload.currency, 'EUR')
})

test('buildWebsiteLeadOpportunityPayload: builds a readable title and preserves the FK ids', () => {
  const payload = buildWebsiteLeadOpportunityPayload({
    individualClientId: 'client-1',
    websiteLeadId: 'lead-1',
    clientName: 'Anna Weber',
    market: 'PT',
    product: 'health',
  })
  assert.equal(payload.title, 'Seguro de Saúde — Anna Weber')
  assert.equal(payload.individualClientId, 'client-1')
  assert.equal(payload.websiteLeadId, 'lead-1')
})
