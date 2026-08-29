/**
 * sales-opportunity-rules.ts — regras puras do pipeline comercial (CRM 2,
 * fase 1). Sem I/O, sem Supabase — testado em sales-opportunity-rules.test.ts.
 * data.ts/server-fns.ts chamam estas funções em vez de reimplementar a lógica
 * inline, para que a mesma regra sirva o intake automático (website) e a
 * criação manual no admin.
 */
import type { SalesOpportunityStage } from './types'

export const SALES_OPPORTUNITY_STAGES: SalesOpportunityStage[] = [
  'new',
  'contacted',
  'needs_analysis',
  'quoted',
  'negotiation',
  'won',
  'lost',
]

export const SALES_OPPORTUNITY_STAGE_LABELS_PT: Record<SalesOpportunityStage, string> = {
  new: 'Novo',
  contacted: 'Contactado',
  needs_analysis: 'Análise',
  quoted: 'Cotação enviada',
  negotiation: 'Negociação',
  won: 'Ganho',
  lost: 'Perdido',
}

// O admin não tem hoje um sistema de traduções real (grep a src/lib/i18n ou
// equivalente não encontra nada) — labels PT são as únicas usadas na UI. Este
// mapa fica pronto para quando/se existir, sem criar um sistema paralelo.
export const SALES_OPPORTUNITY_STAGE_LABELS_EN: Record<SalesOpportunityStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  needs_analysis: 'Needs analysis',
  quoted: 'Quoted',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
}

export type SalesOpportunitySource =
  | 'website'
  | 'referral'
  | 'phone'
  | 'email'
  | 'whatsapp'
  | 'google'
  | 'meta'
  | 'partner'
  | 'existing_client'
  | 'manual'
  | 'other'

export const SALES_OPPORTUNITY_SOURCES: SalesOpportunitySource[] = [
  'website',
  'referral',
  'phone',
  'email',
  'whatsapp',
  'google',
  'meta',
  'partner',
  'existing_client',
  'manual',
  'other',
]

export const SALES_OPPORTUNITY_SOURCE_LABELS_PT: Record<SalesOpportunitySource, string> = {
  website: 'Website',
  referral: 'Referência',
  phone: 'Telefone',
  email: 'Email',
  whatsapp: 'WhatsApp',
  google: 'Google',
  meta: 'Meta (Facebook/Instagram)',
  partner: 'Parceiro',
  existing_client: 'Cliente existente',
  manual: 'Manual',
  other: 'Outro',
}

// product IDs reutilizados tal como já existem no sistema (ver
// adlerrochefort/netlify/functions/lib/lead-classification.mjs) — nenhuma
// taxonomia nova é criada aqui. Só um rótulo PT para o título/UI; um product
// sem entrada aqui cai no fallback humanizado (nunca bloqueia a criação).
const PRODUCT_LABELS_PT: Record<string, string> = {
  health: 'Seguro de Saúde',
  home: 'Seguro Habitação',
  auto: 'Seguro Automóvel',
  tvde: 'Seguro TVDE',
  life: 'Seguro de Vida',
  'mortgage-protection': 'Proteção de Crédito Habitação',
  landlord: 'Seguro Senhorio',
  'short-term-rental': 'Seguro Alojamento Local',
  'private-clients': 'Private Clients',
  'professional-liability': 'RC Profissional',
  'event-liability': 'RC Organização de Eventos',
  'business-multirisk': 'Multirriscos Empresarial',
  fleet: 'Seguro de Frota',
  condominium: 'Seguro Condomínio',
  cyber: 'Riscos Cibernéticos',
  'workers-comp': 'Acidentes de Trabalho',
  contact: 'Contacto Geral',
  relocation: 'Relocation Services',
  'fiscal-representation': 'Representação Fiscal',
  'mediator-change': 'Mudança de Mediador',
  'insurance-review': 'Revisão de Seguros',
  valuables: 'Coleções e Valores',
  general: 'Pedido Geral',
  other: 'Outro',
}

// Exportado para popular o <select> de produto na UI (com opção "Outro" +
// campo livre) sem criar uma segunda lista desincronizada da primeira.
export const SALES_OPPORTUNITY_PRODUCT_OPTIONS: Array<{ id: string; label: string }> = Object.entries(
  PRODUCT_LABELS_PT,
).map(([id, label]) => ({ id, label }))

function humaniseProductId(product: string): string {
  return product
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function productLabel(product: string | null | undefined): string {
  if (!product) return 'Pedido'
  return PRODUCT_LABELS_PT[product] ?? humaniseProductId(product)
}

/**
 * Título legível "Produto — Cliente" (ex.: "Seguro de Saúde — Anna Weber").
 * Só para leitura na UI — nunca usar para decidir stage/entityType/o que
 * seja; essa é sempre a razão de ser desta função existir separadamente do
 * resto dos campos.
 */
export function buildOpportunityTitle(product: string | null | undefined, clientName: string): string {
  const name = clientName.trim() || 'Cliente'
  return `${productLabel(product)} — ${name}`
}

export function isClosedStage(stage: SalesOpportunityStage): boolean {
  return stage === 'won' || stage === 'lost'
}

/**
 * Deriva o novo `closedAt` ao mudar de stage — a única side-effect que uma
 * mudança de stage provoca automaticamente (ver requisito "regras de
 * stage"). Não cria policy nem faz mais nada além disto.
 *
 *   -> won / lost   : closedAt = agora
 *   won/lost -> aberto (reopen) : closedAt = null
 *   aberto -> aberto (ex.: contacted -> quoted) : closedAt inalterado
 */
export function computeClosedAtForStageChange(
  nextStage: SalesOpportunityStage,
  nowIso: string,
): string | null {
  return isClosedStage(nextStage) ? nowIso : null
}

export interface OpportunityOwnerInput {
  companyId?: string | null
  individualClientId?: string | null
}

export type OpportunityOwnerValidation =
  | { ok: true }
  | { ok: false; error: 'missing_owner' | 'both_owners' }

/**
 * Espelha em TypeScript o CHECK XOR da BD (sales_opportunities_scope_xor) —
 * defesa em profundidade: falha cedo e com um erro legível antes de sequer
 * chamar o Supabase, em vez de depender só do erro 23514 da BD.
 */
export function validateOpportunityOwner(input: OpportunityOwnerInput): OpportunityOwnerValidation {
  const hasCompany = !!input.companyId && input.companyId.trim() !== ''
  const hasIndividual = !!input.individualClientId && input.individualClientId.trim() !== ''
  if (hasCompany && hasIndividual) return { ok: false, error: 'both_owners' }
  if (!hasCompany && !hasIndividual) return { ok: false, error: 'missing_owner' }
  return { ok: true }
}

export interface WebsiteLeadOpportunityInput {
  individualClientId: string
  websiteLeadId: string
  clientName: string
  market?: string
  product?: string
}

export interface WebsiteLeadOpportunityPayload {
  individualClientId: string
  websiteLeadId: string
  title: string
  market?: string
  product?: string
  stage: 'new'
  source: 'website'
  currency: 'EUR'
}

/**
 * Constrói o payload de INSERT para a oportunidade gerada a partir de um
 * website_lead — ver requisitos "defaults para website" (source='website',
 * stage='new') e "não perder source" (market/product preservados tal como
 * vieram do website_lead, nunca reescritos). Pura, para poder confirmar por
 * teste que market='ES'/source='website' sobrevivem sem precisar de
 * Supabase — data.ts usa isto diretamente no INSERT.
 */
export function buildWebsiteLeadOpportunityPayload(input: WebsiteLeadOpportunityInput): WebsiteLeadOpportunityPayload {
  return {
    individualClientId: input.individualClientId,
    websiteLeadId: input.websiteLeadId,
    title: buildOpportunityTitle(input.product, input.clientName),
    market: input.market,
    product: input.product,
    stage: 'new',
    source: 'website',
    currency: 'EUR',
  }
}

/**
 * Decide se uma nova submissão do website deve gerar uma sales_opportunity.
 * Só quando o website_lead é genuinamente novo — um retry da mesma
 * submissão (duplicateSubmission) nunca deve gerar uma segunda
 * oportunidade. Ver requisito "só criar quando o website_lead for
 * realmente novo".
 */
export function shouldCreateOpportunityForWebsiteLead(websiteLeadCreated: boolean): boolean {
  return websiteLeadCreated
}
