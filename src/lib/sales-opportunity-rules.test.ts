import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SALES_OPPORTUNITY_STAGES,
  buildOpportunityTitle,
  buildWebsiteLeadOpportunityPayload,
  computeClosedAtForStageChange,
  computeSalesPipelineStats,
  followUpTaskNeedsDateUpdate,
  isClosedStage,
  isValidSalesOpportunityMarket,
  isValidSalesOpportunitySource,
  isValidSalesOpportunityStage,
  isWebsiteLeadIdUniqueViolation,
  pickEditableOpportunityFields,
  pickWebsiteLeadContextFields,
  validateOpportunityOwner,
} from './sales-opportunity-rules.ts'
import type { SalesOpportunity, SalesOpportunityStage, WebsiteLead } from './types.ts'

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

// ── E: 23505 só é idempotente para o índice de website_lead_id ────────────
test('isWebsiteLeadIdUniqueViolation: true only for a 23505 naming the website_lead_id index', () => {
  assert.equal(
    isWebsiteLeadIdUniqueViolation({
      code: '23505',
      message: 'duplicate key value violates unique constraint "sales_opportunities_website_lead_id_uidx"',
    }),
    true,
  )
})

test('isWebsiteLeadIdUniqueViolation: false for a 23505 on a different constraint — must propagate, not silently swallow', () => {
  assert.equal(
    isWebsiteLeadIdUniqueViolation({
      code: '23505',
      message: 'duplicate key value violates unique constraint "sales_opportunities_pkey"',
    }),
    false,
  )
})

test('isWebsiteLeadIdUniqueViolation: false for any non-23505 error code', () => {
  assert.equal(isWebsiteLeadIdUniqueViolation({ code: '23514', message: 'sales_opportunities_scope_xor' }), false)
  assert.equal(isWebsiteLeadIdUniqueViolation({ code: null, message: 'sales_opportunities_website_lead_id_uidx' }), false)
})

// ── G: update genérico não consegue alterar owner/websiteLeadId/createdAt/closedAt/stage ──
test('pickEditableOpportunityFields: strips owner, websiteLeadId, createdAt, closedAt and stage', () => {
  const attempted = {
    id: 'opp-1',
    companyId: 'acme',
    individualClientId: 'client-1',
    websiteLeadId: 'lead-1',
    createdAt: '2020-01-01T00:00:00.000Z',
    closedAt: '2020-01-02T00:00:00.000Z',
    stage: 'won',
    product: 'health',
    assignedTo: 'agent@adlerrochefort.com',
  }
  const picked = pickEditableOpportunityFields(attempted)
  assert.deepEqual(picked, { product: 'health', assignedTo: 'agent@adlerrochefort.com' })
  assert.equal('id' in picked, false)
  assert.equal('companyId' in picked, false)
  assert.equal('individualClientId' in picked, false)
  assert.equal('websiteLeadId' in picked, false)
  assert.equal('createdAt' in picked, false)
  assert.equal('closedAt' in picked, false)
  assert.equal('stage' in picked, false)
})

test('pickEditableOpportunityFields: allows every field explicitly meant to be editable', () => {
  const attempted = {
    title: 'Novo título',
    market: 'ES',
    product: 'home',
    source: 'referral',
    sourceDetail: 'Indicação do João',
    estimatedAnnualPremium: 500,
    estimatedRevenue: 100,
    currency: 'EUR',
    assignedTo: 'agent@adlerrochefort.com',
    expectedCloseDate: '2026-09-30',
    nextFollowUpAt: '2026-09-01T10:00:00.000Z',
    lostReason: 'Preço',
  }
  assert.deepEqual(pickEditableOpportunityFields(attempted), attempted)
})

// ── Enum validation server-side (não confiar só no TypeScript) ────────────
test('isValidSalesOpportunityMarket: only PT/ES, but empty/undefined is allowed (not yet determined)', () => {
  assert.equal(isValidSalesOpportunityMarket('PT'), true)
  assert.equal(isValidSalesOpportunityMarket('ES'), true)
  assert.equal(isValidSalesOpportunityMarket(undefined), true)
  assert.equal(isValidSalesOpportunityMarket(null), true)
  assert.equal(isValidSalesOpportunityMarket(''), true)
  assert.equal(isValidSalesOpportunityMarket('EN'), false)
  assert.equal(isValidSalesOpportunityMarket('US'), false)
})

test('isValidSalesOpportunityStage: only the seven known stages', () => {
  for (const stage of SALES_OPPORTUNITY_STAGES) {
    assert.equal(isValidSalesOpportunityStage(stage), true)
  }
  assert.equal(isValidSalesOpportunityStage('archived'), false)
  assert.equal(isValidSalesOpportunityStage(''), false)
  assert.equal(isValidSalesOpportunityStage(undefined), false)
})

test('isValidSalesOpportunitySource: only the defined taxonomy, empty/undefined allowed', () => {
  assert.equal(isValidSalesOpportunitySource('website'), true)
  assert.equal(isValidSalesOpportunitySource('whatsapp'), true)
  assert.equal(isValidSalesOpportunitySource(undefined), true)
  assert.equal(isValidSalesOpportunitySource(''), true)
  assert.equal(isValidSalesOpportunitySource('tiktok'), false)
})

// ── F: premium e revenue nunca são confundidos nos KPIs ────────────────────
function makeOpportunity(overrides: Partial<SalesOpportunity>): SalesOpportunity {
  return {
    id: 'opp',
    individualClientId: 'client-1',
    title: 'Oportunidade',
    stage: 'new',
    currency: 'EUR',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

test('computeSalesPipelineStats: open pipeline premium and revenue are summed separately, never mixed', () => {
  const now = new Date('2026-08-29T12:00:00.000Z')
  const opportunities = [
    makeOpportunity({ id: '1', stage: 'new', estimatedAnnualPremium: 1000 }),
    makeOpportunity({ id: '2', stage: 'contacted', estimatedRevenue: 200 }),
    makeOpportunity({ id: '3', stage: 'quoted', estimatedAnnualPremium: 500, estimatedRevenue: 80 }),
  ]
  const stats = computeSalesPipelineStats(opportunities, now)
  assert.equal(stats.openPipelinePremium, 1500) // 1000 + 0 + 500 — nunca usa revenue como fallback
  assert.equal(stats.openPipelineRevenue, 280) // 0 + 200 + 80 — nunca usa premium como fallback
  assert.equal(stats.openCount, 3)
  assert.equal(stats.quotedCount, 1)
})

test('computeSalesPipelineStats: won revenue this month never falls back to premium when revenue is missing', () => {
  const now = new Date('2026-08-29T12:00:00.000Z')
  const opportunities = [
    makeOpportunity({
      id: '1',
      stage: 'won',
      closedAt: '2026-08-15T00:00:00.000Z',
      estimatedAnnualPremium: 900,
      // estimatedRevenue ausente de propósito
    }),
  ]
  const stats = computeSalesPipelineStats(opportunities, now)
  assert.equal(stats.wonRevenueThisMonth, 0, 'must not use estimatedAnnualPremium as a stand-in for revenue')
  assert.equal(stats.wonThisMonthCount, 1)
})

test('computeSalesPipelineStats: closed (won/lost) opportunities never count towards the open pipeline', () => {
  const now = new Date('2026-08-29T12:00:00.000Z')
  const opportunities = [
    makeOpportunity({ id: '1', stage: 'won', closedAt: now.toISOString(), estimatedAnnualPremium: 1000, estimatedRevenue: 200 }),
    makeOpportunity({ id: '2', stage: 'lost', closedAt: now.toISOString(), estimatedAnnualPremium: 500 }),
  ]
  const stats = computeSalesPipelineStats(opportunities, now)
  assert.equal(stats.openCount, 0)
  assert.equal(stats.openPipelinePremium, 0)
  assert.equal(stats.openPipelineRevenue, 0)
  assert.equal(stats.lostThisMonthCount, 1)
})

// ── H: follow-up mantém next_follow_up_at e client_task coerentes ─────────
test('followUpTaskNeedsDateUpdate: true only when the requested date actually differs', () => {
  assert.equal(followUpTaskNeedsDateUpdate('2026-09-01', '2026-09-05'), true)
  assert.equal(followUpTaskNeedsDateUpdate('2026-09-01', '2026-09-01'), false)
})

// ── I: website lead context não expõe metadata/raw sensitive fields ───────
test('pickWebsiteLeadContextFields: only form_name/source_url/utm_*/received_at, never metadata', () => {
  const lead: WebsiteLead = {
    id: 'lead-1',
    individualClientId: 'client-1',
    formName: 'expat-health-quote',
    market: 'PT',
    product: 'health',
    source: 'website',
    sourceUrl: 'https://adlerrochefort.com/en/health-insurance-quote/',
    utmSource: 'instagram',
    utmMedium: 'bio',
    utmCampaign: 'saude-expat',
    utmContent: undefined,
    utmTerm: undefined,
    metadata: { branchLabel: 'Saúde', language: 'EN' },
    receivedAt: '2026-08-29T10:00:00.000Z',
    createdAt: '2026-08-29T10:00:00.000Z',
  }
  const context = pickWebsiteLeadContextFields(lead)
  assert.deepEqual(context, {
    formName: 'expat-health-quote',
    sourceUrl: 'https://adlerrochefort.com/en/health-insurance-quote/',
    utmSource: 'instagram',
    utmMedium: 'bio',
    utmCampaign: 'saude-expat',
    receivedAt: '2026-08-29T10:00:00.000Z',
  })
  assert.equal('metadata' in context, false)
  assert.equal(JSON.stringify(context).includes('branchLabel'), false)
})
