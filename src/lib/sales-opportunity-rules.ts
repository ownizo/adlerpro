/**
 * sales-opportunity-rules.ts — regras puras do pipeline comercial (CRM 2,
 * fase 1). Sem I/O, sem Supabase — testado em sales-opportunity-rules.test.ts.
 * data.ts/server-fns.ts chamam estas funções em vez de reimplementar a lógica
 * inline, para que a mesma regra sirva o intake automático (website) e a
 * criação manual no admin.
 */
import { SALES_OPPORTUNITY_EDITABLE_FIELDS } from './types.ts'
import type {
  SalesOpportunity,
  SalesOpportunityStage,
  SalesOpportunityEditableUpdate,
  SalesPipelineStats,
  WebsiteLead,
} from './types.ts'

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

// -----------------------------------------------------------------------------
// Hardening (revisão pré-migration): a oportunidade comercial nunca pode
// reduzir a robustez do intake já existente (client + website_lead). Em vez
// de decidir "só tenta criar a opportunity quando o lead é novo" (a regra
// antiga, e errada: um retry depois de a opportunity ter falhado ficaria
// para sempre sem oportunidade), o lead-intake.mts tenta SEMPRE
// find-or-create a oportunidade depois de obter/reutilizar o website_lead —
// idempotente via o índice único parcial em website_lead_id, nunca por uma
// flag "já foi tentado". Ver isWebsiteLeadIdUniqueViolation abaixo e o
// controlo de fluxo em lead-intake.mts.
// -----------------------------------------------------------------------------

/**
 * Confirma que um erro 23505 (unique_violation) do INSERT em
 * sales_opportunities veio mesmo do índice único parcial em
 * website_lead_id, e não de outra constraint futura na mesma tabela — nunca
 * assumir genericamente que qualquer 23505 aqui significa "já existe uma
 * opportunity para este lead". Só depois de confirmar isto é que
 * createSalesOpportunityForWebsiteLead tenta reaproveitar uma linha
 * existente; mesmo assim, o lookup final que confirma que essa linha existe
 * de facto continua a ser a garantia definitiva (ver data.ts).
 */
export function isWebsiteLeadIdUniqueViolation(error: { code?: string | null; message?: string | null }): boolean {
  if (error.code !== '23505') return false
  const message = (error.message ?? '').toLowerCase()
  return message.includes('sales_opportunities_website_lead_id_uidx')
}

/**
 * Allowlist runtime dos campos que adminUpdateSalesOpportunity pode alterar
 * — não confiar só no tipo TypeScript de entrada (que já restringe isto em
 * compile-time; isto é a mesma regra aplicada em runtime, no data layer,
 * antes de qualquer update chegar ao Supabase). Qualquer chave fora de
 * SALES_OPPORTUNITY_EDITABLE_FIELDS (id, companyId, individualClientId,
 * websiteLeadId, createdAt, closedAt, stage) é silenciosamente descartada.
 */
export function pickEditableOpportunityFields(
  updates: Record<string, unknown>,
): SalesOpportunityEditableUpdate {
  const picked: Record<string, unknown> = {}
  for (const field of SALES_OPPORTUNITY_EDITABLE_FIELDS) {
    if (field in updates) picked[field] = updates[field]
  }
  return picked as SalesOpportunityEditableUpdate
}

const VALID_MARKETS = new Set(['PT', 'ES'])

/** market só PT/ES nesta fase; undefined/null são aceites (mercado ainda não determinado). */
export function isValidSalesOpportunityMarket(market: unknown): boolean {
  if (market == null || market === '') return true
  return typeof market === 'string' && VALID_MARKETS.has(market)
}

export function isValidSalesOpportunityStage(stage: unknown): stage is SalesOpportunityStage {
  return typeof stage === 'string' && (SALES_OPPORTUNITY_STAGES as string[]).includes(stage)
}

export function isValidSalesOpportunitySource(source: unknown): boolean {
  if (source == null || source === '') return true
  return typeof source === 'string' && (SALES_OPPORTUNITY_SOURCES as string[]).includes(source)
}

/**
 * Estatísticas do pipeline para o dashboard — pura, para poder confirmar por
 * teste que prémio e receita nunca se confundem (ver requisito "pipeline
 * value — corrigir semântica"). getSalesPipelineStats em data.ts só busca as
 * oportunidades e chama isto.
 */
export function computeSalesPipelineStats(opportunities: SalesOpportunity[], now: Date = new Date()): SalesPipelineStats {
  const isThisMonth = (iso?: string) => {
    if (!iso) return false
    const d = new Date(iso)
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  }

  const stats: SalesPipelineStats = {
    openCount: 0,
    newThisMonthCount: 0,
    quotedCount: 0,
    wonThisMonthCount: 0,
    lostThisMonthCount: 0,
    openPipelinePremium: 0,
    openPipelineRevenue: 0,
    wonRevenueThisMonth: 0,
  }

  for (const opp of opportunities) {
    const isOpen = !isClosedStage(opp.stage)
    if (isOpen) {
      stats.openCount++
      // Nunca substituir uma métrica pela outra quando falta — prémio e
      // receita são conceitos diferentes (o que o cliente paga vs. o que
      // fica para a Adler), mesmo quando só um dos dois está preenchido.
      stats.openPipelinePremium += opp.estimatedAnnualPremium ?? 0
      stats.openPipelineRevenue += opp.estimatedRevenue ?? 0
    }
    if (opp.stage === 'quoted') stats.quotedCount++
    if (isThisMonth(opp.createdAt)) stats.newThisMonthCount++
    if (opp.stage === 'won' && isThisMonth(opp.closedAt)) {
      stats.wonThisMonthCount++
      stats.wonRevenueThisMonth += opp.estimatedRevenue ?? 0
    }
    if (opp.stage === 'lost' && isThisMonth(opp.closedAt)) stats.lostThisMonthCount++
  }

  return stats
}

/**
 * sales_opportunities.next_follow_up_at é um resumo/cache comercial;
 * client_tasks é a fonte operacional das tarefas (ver requisito "follow-up
 * consistency"). Quando já existe uma tarefa pendente ligada à oportunidade
 * mas com uma data diferente da agora pedida, a tarefa tem de ser
 * atualizada em vez de ficar dessincronizada — nunca duas datas
 * contraditórias. ensureFollowUpTaskForOpportunity em data.ts usa isto para
 * decidir se faz UPDATE à tarefa existente.
 */
export function followUpTaskNeedsDateUpdate(existingDueDate: string, requestedDueDate: string): boolean {
  return existingDueDate !== requestedDueDate
}

/**
 * Contexto seguro de um website_lead para mostrar no detalhe da
 * oportunidade — nunca o objeto completo (que inclui `metadata`, pensado
 * para o CRM em geral mas não para aqui) e nunca nada além do que já está
 * listado no requisito "website lead context". Reutiliza o WebsiteLead já
 * carregado (ver getWebsiteLeadsByIndividualClientId) em vez de duplicar
 * estes campos em sales_opportunities.
 */
export interface WebsiteLeadContext {
  formName: string
  sourceUrl?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  receivedAt: string
}

export function pickWebsiteLeadContextFields(lead: WebsiteLead): WebsiteLeadContext {
  return {
    formName: lead.formName,
    sourceUrl: lead.sourceUrl,
    utmSource: lead.utmSource,
    utmMedium: lead.utmMedium,
    utmCampaign: lead.utmCampaign,
    receivedAt: lead.receivedAt,
  }
}
