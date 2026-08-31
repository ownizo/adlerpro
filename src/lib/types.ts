export interface Company {
  id: string
  name: string
  nif: string
  sector: string
  contactName: string
  contactEmail: string
  contactPhone: string
  accessEmail?: string
  address: string
  createdAt: string
  marketingOptOut?: boolean
}

export interface CompanyUser {
  id: string
  companyId: string
  name: string
  email: string
  role: 'owner' | 'manager' | 'employee'
  accessPassword?: string
  identityStatus?: 'pending_confirmation' | 'confirmed' | 'already_registered' | 'not_found'
  invitationSentAt?: string
  lastLoginAt?: string
  createdAt: string
  updatedAt?: string
}

export interface UserMetricEvent {
  id: string
  companyId: string
  userId: string
  timestamp: string
  type: 'login' | 'document_upload' | 'policy_create' | 'profile_update' | 'api_sync' | 'other'
  description: string
}

export interface ApiConnection {
  id: string
  service: string
  status: 'connected' | 'error' | 'degraded'
  latency: string
  endpoint: string
  lastSync: string
  notes?: string
}

export interface Policy {
  id: string
  companyId: string
  type: PolicyType
  insurer: string
  policyNumber: string
  description: string
  startDate: string
  endDate: string
  annualPremium: number
  insuredValue: number
  status: 'active' | 'expiring' | 'expired' | 'cancelled'
  createdAt: string
  documentKey?: string
  deductible?: number
  coverages?: string[]
  exclusions?: string[]
  individualClientId?: string
  renewalDate?: string
  paymentFrequency?: string
  visiblePortal?: boolean
  notesInternal?: string
  emergencyContacts?: string
  commissionPercentage?: number
  commissionValue?: number
}

export type PolicyType =
  | 'property'
  | 'liability'
  | 'workers_comp'
  | 'auto'
  | 'health'
  | 'life'
  | 'cyber'
  | 'directors_officers'
  | 'business_interruption'
  | 'other'

export const POLICY_TYPE_LABELS: Record<PolicyType, string> = {
  property: 'Propriedade',
  liability: 'Responsabilidade Civil',
  workers_comp: 'Acidentes de Trabalho',
  auto: 'Automóvel',
  health: 'Saúde',
  life: 'Vida',
  cyber: 'Ciber-Risco',
  directors_officers: 'D&O',
  business_interruption: 'Interrupção de Negócio',
  other: 'Outro',
}

// English variant used only by the /admin backoffice (English-only UI) —
// additive alongside POLICY_TYPE_LABELS, which stays untouched because the
// customer portal (policies.tsx, dashboard.tsx, claims.tsx) reads it in
// Portuguese.
export const POLICY_TYPE_LABELS_EN: Record<PolicyType, string> = {
  property: 'Property',
  liability: 'Liability',
  workers_comp: 'Workers Compensation',
  auto: 'Auto',
  health: 'Health',
  life: 'Life',
  cyber: 'Cyber Risk',
  directors_officers: 'D&O',
  business_interruption: 'Business Interruption',
  other: 'Other',
}

export interface Claim {
  id: string
  policyId: string
  companyId?: string
  individualClientId?: string
  title: string
  description: string
  claimDate: string
  incidentDate: string
  estimatedValue: number
  status: ClaimStatus
  steps: ClaimStep[]
  createdAt: string
}

export type ClaimStatus =
  | 'submitted'
  | 'under_review'
  | 'documentation'
  | 'assessment'
  | 'approved'
  | 'denied'
  | 'paid'

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  submitted: 'Submetido',
  under_review: 'Em Análise',
  documentation: 'Documentação',
  assessment: 'Avaliação',
  approved: 'Aprovado',
  denied: 'Recusado',
  paid: 'Pago',
}

// English variant for /admin only — see POLICY_TYPE_LABELS_EN above for why
// this is additive rather than a rename of CLAIM_STATUS_LABELS.
export const CLAIM_STATUS_LABELS_EN: Record<ClaimStatus, string> = {
  submitted: 'Submitted',
  under_review: 'Under Review',
  documentation: 'Documentation',
  assessment: 'Assessment',
  approved: 'Approved',
  denied: 'Denied',
  paid: 'Paid',
}

export const CLAIM_STATUS_ORDER: ClaimStatus[] = [
  'submitted',
  'under_review',
  'documentation',
  'assessment',
  'approved',
  'paid',
]

export interface ClaimStep {
  status: ClaimStatus
  date: string
  notes?: string
}

export interface Document {
  id: string
  companyId?: string
  individualClientId?: string
  name: string
  category: DocumentCategory
  size: number
  mimeType?: string
  uploadedBy: string
  uploadedByType?: 'admin' | 'client' | 'system'
  uploadedAt: string
  storagePath: string
}

export type DocumentCategory =
  | 'policy'
  | 'claim'
  | 'invoice'
  | 'report'
  | 'certificate'
  | 'other'

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  policy: 'Apólice',
  claim: 'Sinistro',
  invoice: 'Fatura',
  report: 'Relatório',
  certificate: 'Certificado',
  other: 'Outro',
}

export interface Alert {
  id: string
  companyId?: string
  type: 'renewal' | 'claim_update' | 'payment' | 'document' | 'general'
  title: string
  message: string
  read: boolean
  createdAt: string
}

export interface ClaimMessage {
  id: string
  claimId: string
  companyId?: string
  individualClientId?: string
  senderType: 'admin' | 'client'
  senderName: string
  senderUserId?: string
  message: string
  createdAt: string
  readAt?: string | null
}

export interface ClaimParticipant {
  id: string
  name: string
  email?: string
  role: 'admin' | 'client'
}

export interface ClaimTimelineEvent {
  id: string
  type: 'created' | 'status' | 'assignment' | 'note' | 'message' | 'document'
  message: string
  createdAt: string
  actorName: string
  actorRole: 'admin' | 'client' | 'system'
}

export interface ClaimTeamNote {
  id: string
  note: string
  createdAt: string
  authorName: string
}

export interface ClaimTicketMessage {
  id: string
  body: string
  createdAt: string
  senderRole: 'admin' | 'client'
  senderName: string
  senderEmail?: string
}

export interface ClaimFileRef {
  id: string
  claimId: string
  name: string
  contentType: string
  uploadedAt: string
  uploadedByName: string
  uploadedByRole: 'admin' | 'client'
  storagePath: string
  size: number
}

export interface ClaimOperationalData {
  claimId: string
  responsible?: ClaimParticipant
  timeline: ClaimTimelineEvent[]
  teamNotes: ClaimTeamNote[]
  messages: ClaimTicketMessage[]
  documents: ClaimFileRef[]
  updatedAt: string
}

export interface DashboardStats {
  activePolicies: number
  annualPremiums: number
  renewalsIn90Days: number
  openClaims: number
}

export interface AdminFinancialFilters {
  year: number
  month?: number
  companyId?: string
  insurer?: string
}

export interface AdminFinancialTimelinePoint {
  month: number
  monthKey: string
  label: string
  premiums: number
  commissions: number
  isHistorical: boolean
  isProjected: boolean
}

export interface AdminFinancialKpiComparison {
  current: number
  previousMonth: number | null
  previousYear: number | null
  momDeltaPct: number | null
  yoyDeltaPct: number | null
}

export interface AdminFinancialMonthlyPolicyItem {
  policyId: string
  policyNumber: string
  insurer: string
  companyId?: string
  type: string
  paymentFrequency: string
  startDate: string
  endDate: string
  status: string
  premium: number
  commission: number
}

export interface AdminFinancialMonthDetail {
  month: number
  monthKey: string
  label: string
  premiums: number
  commissions: number
  policiesCount: number
  policies: AdminFinancialMonthlyPolicyItem[]
}

export interface AdminFinancialDashboardData {
  summary: {
    totalPremiums: number
    totalCommissions: number
    projectedCommissions: number
    activePolicies: number
    comparisons: {
      totalPremiums: AdminFinancialKpiComparison
      totalCommissions: AdminFinancialKpiComparison
      projectedCommissions: AdminFinancialKpiComparison
      activePolicies: AdminFinancialKpiComparison
    }
  }
  timeline: AdminFinancialTimelinePoint[]
  monthlyDetails: AdminFinancialMonthDetail[]
  projectionHighlights: Array<{
    month: number
    monthKey: string
    label: string
    premiums: number
    commissions: number
  }>
  context: {
    selectedViewMonth: number
    currentMonthInSelectedYear: number | null
  }
  availableFilters: {
    years: number[]
    insurers: string[]
  }
  appliedFilters: {
    year: number
    month?: number
    companyId?: string
    insurer?: string
  }
}

export type RenewalAlertUrgency = 30 | 60 | 90
export type RenewalAlertStatus = 'pending' | 'negotiating' | 'renewed'

export interface RenewalAlertHistoryItem {
  id: string
  alertKey: string
  policyId: string | null
  previousStatus: RenewalAlertStatus | null
  newStatus: RenewalAlertStatus
  previousAssignedTo: string | null
  newAssignedTo: string | null
  previousNextAction: string | null
  newNextAction: string | null
  changedAt: string
}

export interface RenewalAlertItem {
  key: string
  policyId: string
  policyNumber: string
  client: string
  company: string
  policyType: PolicyType
  insurer: string
  value: number
  startDate: string
  renewalDate: string
  daysUntilRenewal: number
  urgency: RenewalAlertUrgency
  status: RenewalAlertStatus
  assignedTo?: string
  nextAction?: string
  history: RenewalAlertHistoryItem[]
  contactEmail?: string
  contactPhone?: string
}

export interface RenewalAlertsResponse {
  generatedAt: string
  total: number
  alerts: RenewalAlertItem[]
  byUrgency: Record<RenewalAlertUrgency, RenewalAlertItem[]>
  summary: {
    totalRenewals: number
    totalValueAtRisk: number
    countsByStatus: Record<RenewalAlertStatus, number>
  }
}

export interface RiskReport {
  id: string
  companyId: string
  generatedAt: string
  content: string
  summary: string
}

export interface IndividualClient {
  id: string
  fullName: string
  nif?: string
  email?: string
  phone?: string
  address?: string
  status: string
  authUserId?: string
  createdAt?: string
  marketingOptOut?: boolean
}

export interface ClientNote {
  id: string
  companyId?: string
  individualClientId?: string
  body: string
  category?: string
  authorName?: string
  createdAt: string
}

export interface ClientTask {
  id: string
  companyId?: string
  individualClientId?: string
  title: string
  description?: string
  dueDate: string              // 'YYYY-MM-DD'
  status: 'pending' | 'done'
  doneAt?: string              // ISO timestamp; undefined enquanto pending
  createdAt: string
  source: 'manual' | 'renewal' | 'opportunity'
  policyId?: string            // FK policies.id; só preenchido na fatia 4
  opportunityId?: string       // FK sales_opportunities.id; follow-up de uma oportunidade (CRM 2)
}

/**
 * Uma submissão de formulário do site público (adlerrochefort.com)
 * já classificada como pessoa singular e associada a um
 * individual_client. Histórico de pedidos, não um pipeline de vendas
 * — ver netlify/api-functions/lead-intake.mts.
 *
 * Deliberadamente não inclui dados sensíveis do formulário original
 * (saúde, datas de nascimento, documentos de identificação, morada) —
 * ver a nota de privacidade em migrations/20260829_website_leads.sql.
 *
 * companyId é opcional e só é preenchido quando o individual_client
 * original é promovido a company (ver adminPromoteToCompany em
 * src/lib/server-fns.ts e migrations/20260830_fix_promote_client_to_company.sql) —
 * exatamente um de companyId/individualClientId está sempre presente
 * (XOR imposto na BD), nunca os dois nem nenhum.
 */
export interface WebsiteLead {
  id: string
  companyId?: string
  individualClientId?: string
  submissionId?: string
  formName: string
  market?: string
  product?: string
  source?: string
  sourceUrl?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
  metadata?: Record<string, string | number | boolean>
  receivedAt: string
  createdAt: string
}

export type SalesOpportunityStage =
  | 'new'
  | 'contacted'
  | 'needs_analysis'
  | 'quoted'
  | 'negotiation'
  | 'won'
  | 'lost'

/**
 * Uma oportunidade comercial no pipeline (CRM 2, fase 1) — BACKOFFICE ONLY,
 * nunca exposta aos portais de cliente. Pertence a uma company OU a um
 * individual_client (XOR, igual a client_notes/client_tasks), nunca às duas
 * nem a nenhuma. Pode nascer de um website_lead (websiteLeadId preenchido,
 * source: 'website') ou ser criada manualmente no admin.
 *
 * Só guarda contexto comercial — nunca dados sensíveis do formulário de
 * origem (saúde, DOB, documentos, NIF, notas clínicas); ver privacidade em
 * migrations/20260829_sales_opportunities.sql.
 */
export interface SalesOpportunity {
  id: string
  companyId?: string
  individualClientId?: string
  websiteLeadId?: string

  title: string
  market?: string
  product?: string

  stage: SalesOpportunityStage

  source?: string
  sourceDetail?: string

  estimatedAnnualPremium?: number
  estimatedRevenue?: number
  currency: string

  assignedTo?: string

  expectedCloseDate?: string   // 'YYYY-MM-DD'
  nextFollowUpAt?: string      // ISO timestamp

  lostReason?: string

  createdAt: string
  updatedAt: string
  closedAt?: string
}

// Campos que um update genérico (adminUpdateSalesOpportunity) pode alterar.
// Deliberadamente exclui id/companyId/individualClientId/websiteLeadId/
// createdAt/closedAt/stage — dono e proveniência não mudam por aqui (stage
// tem a sua própria função, que também deriva closedAt automaticamente) —
// ver pickEditableOpportunityFields em sales-opportunity-rules.ts.
export const SALES_OPPORTUNITY_EDITABLE_FIELDS = [
  'title',
  'market',
  'product',
  'source',
  'sourceDetail',
  'estimatedAnnualPremium',
  'estimatedRevenue',
  'currency',
  'assignedTo',
  'expectedCloseDate',
  'nextFollowUpAt',
  'lostReason',
] as const satisfies readonly (keyof SalesOpportunity)[]

export type SalesOpportunityEditableUpdate = Partial<
  Pick<SalesOpportunity, (typeof SALES_OPPORTUNITY_EDITABLE_FIELDS)[number]>
>

/**
 * Resumo comercial pequeno para o dashboard — sem forecasting complexo.
 * Prémio (o que o cliente paga à seguradora) e receita (o que fica para a
 * Adler) são métricas distintas e nunca se substituem uma à outra — ver
 * computeSalesPipelineStats em sales-opportunity-rules.ts.
 */
export interface SalesPipelineStats {
  openCount: number
  newThisMonthCount: number
  quotedCount: number
  wonThisMonthCount: number
  lostThisMonthCount: number
  /** sum(estimatedAnnualPremium) das oportunidades abertas. */
  openPipelinePremium: number
  /** sum(estimatedRevenue) das oportunidades abertas. */
  openPipelineRevenue: number
  /** sum(estimatedRevenue) das oportunidades won fechadas este mês. */
  wonRevenueThisMonth: number
  /** Oportunidades abertas com next_follow_up_at no passado — ver dashboard "o que precisa de atenção hoje". */
  overdueFollowUpsCount: number
  /** Oportunidades abertas com next_follow_up_at hoje. */
  dueTodayFollowUpsCount: number
}

// =============================================================
// CRM3 — Identity & Reconciliation (Block 2)
//
// Tipos para as 4 tabelas de migrations/20260830_crm3_identity_reconciliation.sql.
// Nomes de campo tal como na BD (camelCase), sem nada de credenciais/
// secrets aqui — ver reconciliation-authority.ts para a config de campos
// autoritativos e client-reconciliation.ts/policy-reconciliation.ts para os
// motores puros que produzem os match statuses.
// =============================================================

// JSON-safe value — used for jsonb columns (metadata/raw_payload/summary)
// instead of Record<string, unknown>: server functions round-trip their
// return value through JSON, and `unknown` isn't assignable to the
// JSON-value bound that inference expects there, which otherwise breaks
// type-checking on every admin*/fetch* fn touching one of these fields.
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export type CarrierSyncMode = 'dry_run' | 'import'

export type CarrierSyncStatus = 'pending' | 'processing' | 'completed' | 'failed'

/** Estado de reconciliação de um registo de import — cliente OU apólice,
 * mesmo vocabulário para os dois (ver carrier_import_records.customer_match_status
 * / policy_match_status na migration). */
export type CarrierMatchStatus =
  | 'unmatched'
  | 'exact'
  | 'probable'
  | 'ambiguous'
  | 'new'
  | 'linked'
  | 'ignored'
  | 'error'

/** Decisão de um Admin sobre um carrier_import_record — nunca cria/apaga/
 * funde nada por si só (ver requisito "Accept... does NOT create/merge"). */
export type CarrierDecisionStatus = 'pending' | 'accepted' | 'rejected' | 'ignored'

// ── CRM3 Block 4 — explicit apply actions ──────────────────────────────
// "Accepted" means only "the Admin accepts this reconciliation record for
// further processing" — it is never, by itself, enough to create or
// update anything. Each accepted row also needs one of these explicit,
// resolved actions on the customer side AND one on the policy side (see
// isRowReadyToApply in carrier-apply-actions.ts, the single source of
// truth for "this row may be applied").
export type CustomerApplyAction =
  | 'link_existing_individual'
  | 'link_existing_company'
  | 'create_individual'
  | 'create_company'
  | 'add_policyholder_to_existing_client'
  | 'no_customer_change'

export type PolicyholderParticipantMode =
  | 'existing_individual'
  | 'existing_company'
  | 'create_individual'
  | 'create_company'

export type PolicyApplyAction =
  | 'link_existing_policy'
  | 'create_policy'
  | 'update_existing_policy'
  | 'no_policy_change'

/** Per-record apply outcome — pending until an apply run processes it;
 * applied/skipped/failed thereafter. Once 'applied', re-applying the
 * same record is always a safe no-op (see apply_carrier_import_record). */
export type CarrierApplyStatus = 'pending' | 'applied' | 'skipped' | 'failed'

/** Run-level apply state (CRM3 Block 4) — not_applied until "Confirm &
 * Apply" is clicked; applying while rows are being processed one by
 * one; applied/partially_failed once every accepted row has been
 * attempted. See adminApplyCarrierSyncRun. */
export type CarrierRunApplyStatus = 'not_applied' | 'applying' | 'applied' | 'partially_failed'

export interface CarrierSyncRun {
  id: string
  provider: string
  mode: CarrierSyncMode
  status: CarrierSyncStatus
  startedAt?: string
  completedAt?: string
  recordsReceived: number
  recordsExactMatch: number
  recordsReview: number
  recordsNew: number
  recordsError: number
  summary: Record<string, Json>
  errorMessage?: string
  createdAt: string

  applyStatus: CarrierRunApplyStatus
  applyStartedAt?: string
  appliedAt?: string
  appliedBy?: string
}

export interface CarrierImportRecord {
  id: string
  syncRunId: string
  provider: string

  externalRecordId?: string
  externalClientId?: string
  externalPolicyId?: string
  externalPolicyNumber?: string

  market?: string

  /** Nunca mostrado por omissão na UI — ver requisito "Never dump the full
   * raw_payload by default" em admin/carrier-integrations. */
  rawPayload: Record<string, Json>

  customerMatchStatus: CarrierMatchStatus
  policyMatchStatus: CarrierMatchStatus

  matchedIndividualClientId?: string
  matchedCompanyId?: string
  matchedPolicyId?: string

  customerMatchReason?: string
  policyMatchReason?: string

  decisionStatus: CarrierDecisionStatus
  decisionNote?: string
  decidedAt?: string

  // ── CRM3 Block 4 — explicit apply actions ──────────────────────────
  // "Accepted" alone never implies any of these — see requirement
  // "NEVER infer a destructive/create/update action merely because
  // decision_status = accepted". A row needs BOTH a customerApplyAction
  // and a policyApplyAction, each with its own required selection,
  // before it may be applied — see isRowReadyToApply in
  // carrier-apply-actions.ts.
  customerApplyAction?: CustomerApplyAction
  policyApplyAction?: PolicyApplyAction
  selectedIndividualClientId?: string
  selectedCompanyId?: string
  selectedPolicyId?: string
  /** Explicit participant mode for an add_policyholder_to_existing_client
   * action. This is distinct from the commercial owner selection and must
   * never be inferred from missing owner ids. */
  selectedPolicyholderMode?: PolicyholderParticipantMode
  /** Participant identity when customerApplyAction adds the imported
   * tomador as a policyholder without changing the policy owner. */
  selectedPolicyholderIndividualClientId?: string
  selectedPolicyholderCompanyId?: string
  /** Only the explicitly approved CRM-policy field changes — never
   * applied just because a policy matched. Subset of { policyNumber,
   * startDate, endDate, annualPremium }. */
  approvedPolicyChanges?: Record<string, Json>

  applyStatus: CarrierApplyStatus
  applyError?: string
  appliedAt?: string

  createdAt: string
  updatedAt: string
}

/** Liga um individual_client OU company (XOR, nunca os dois) ao cliente de
 * uma seguradora — ver external_client_identities na migration. */
export interface ExternalClientIdentity {
  id: string
  individualClientId?: string
  companyId?: string

  provider: string
  externalClientId: string
  externalClientNumber?: string

  taxCountry?: string
  taxIdType?: string
  taxIdRaw?: string
  taxIdNormalized?: string

  metadata: Record<string, Json>

  firstSeenAt: string
  lastSeenAt: string
  createdAt: string
  updatedAt: string
}

/** Liga uma policy interna ao registo de apólice de uma seguradora — ver
 * external_policy_identities na migration. Número de apólice sozinho nunca é
 * a identidade autoritativa (ver requisito "Do not use policy number alone
 * as authoritative identity"). */
export interface ExternalPolicyIdentity {
  id: string
  policyId: string

  provider: string
  externalPolicyId?: string
  externalPolicyNumber: string
  externalPolicyNumberNormalized?: string

  metadata: Record<string, Json>

  firstSeenAt: string
  lastSeenAt: string
  createdAt: string
  updatedAt: string
}

export interface PolicyParticipant {
  id: string
  policyId: string
  individualClientId?: string
  companyId?: string
  role: 'policyholder' | string
  provider?: string
  externalClientId?: string
  source: string
  createdAt: string
  updatedAt: string
}

// ── CRM3 Block 2 — review-safe candidate summaries ──────────────────────
//
// A carrier_import_record's matched_*_id columns are internal ids only —
// exposing them alone to an admin doing manual reconciliation isn't enough
// to safely confirm a match. These summaries carry ONLY the fields already
// shown elsewhere in the ordinary admin People/Companies/Policies views —
// never notes, tasks, opportunities, claims, documents, auth metadata, or
// anything resembling medical information. See
// getCarrierImportRecordReview in src/lib/data.ts, which builds these by
// resolving matched_individual_client_id/matched_company_id/
// matched_policy_id server-side and picking only these fields — nothing
// else about the matched record ever crosses into this summary.

export interface CarrierIndividualCandidateSummary {
  id: string
  fullName: string
  email?: string
  phone?: string
  nif?: string
  address?: string
}

export interface CarrierCompanyCandidateSummary {
  id: string
  name: string
  nif: string
  contactName: string
  contactEmail: string
  contactPhone: string
  address?: string
}

export interface CarrierPolicyCandidateSummary {
  id: string
  policyNumber: string
  insurer: string
  policyType?: string
  startDate?: string
  endDate?: string
  annualPremium?: number
  /** Owner's display name (company name or individual client full name) —
   * resolved because it's cheap (one extra lookup by an id already on the
   * policy row), never a second-hand guess. */
  ownerLabel?: string
  /** Raw owner ids (CRM3 Block 4) — needed to check that a selected
   * customer actually matches this policy's real current owner before
   * "link existing policy" / "update existing policy" may apply (see
   * checkOwnerConsistency in carrier-apply-actions.ts). ownerLabel alone
   * (a display string) isn't enough to compare against a selected id. */
  ownerIndividualClientId?: string
  ownerCompanyId?: string
}

export interface CarrierImportRecordReview {
  record: CarrierImportRecord
  individualCandidate?: CarrierIndividualCandidateSummary
  companyCandidate?: CarrierCompanyCandidateSummary
  policyCandidate?: CarrierPolicyCandidateSummary
}

// ── Reconciliation Editor hardening — manual existing-policy selector ──
//
// The reconciliation engine sometimes downgrades a policy match to
// 'probable' WITHOUT retaining a matchedPolicyId (see carrier-import-
// matching.ts's "Case D" — a customer has an existing same-provider
// policy under a different number, e.g. a proposal number vs the
// definitive one). CarrierImportRecordReview.policyCandidate is then
// empty even though the Admin can plainly see the real policy exists.
// PolicyOwnerOptionSummary is the minimal, review-safe shape for
// listPoliciesForOwner (src/lib/data.ts) — every policy actually owned
// by a specific individual/company, for the Admin to pick from
// explicitly. Never exposes notes/tasks/opportunities/claims/documents.
export interface PolicyOwnerOptionSummary {
  id: string
  insurer: string
  policyNumber: string
  type: string
  startDate?: string
  endDate?: string
  annualPremium?: number
  status: string
  individualClientId?: string
  companyId?: string
}
