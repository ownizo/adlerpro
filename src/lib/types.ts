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
}

export interface CompanyUser {
  id: string
  companyId: string
  name: string
  email: string
  role: 'owner' | 'manager' | 'employee'
  accessPassword: string
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
  | 'cyber'
  | 'directors_officers'
  | 'business_interruption'

export const POLICY_TYPE_LABELS: Record<PolicyType, string> = {
  property: 'Propriedade',
  liability: 'Responsabilidade Civil',
  workers_comp: 'Acidentes de Trabalho',
  auto: 'Automóvel',
  health: 'Saúde',
  cyber: 'Ciber-Risco',
  directors_officers: 'D&O',
  business_interruption: 'Interrupção de Negócio',
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
export type RenewalAlertStatus = 'pendente' | 'tratado' | 'em_negociacao' | 'renovado'

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
}

export interface IpmaForecastDay {
  forecastDate: string
  idWeatherType: number
  tMin: string
  tMax: string
  precipitaProb: string
  classWindSpeed: number
  predWindDir: string
  classPrecInt?: number
  latitude?: string
  longitude?: string
}

export interface IpmaWarning {
  awarenessTypeName: string
  awarenessLevelID: 'green' | 'yellow' | 'orange' | 'red'
  idAreaAviso: string
  startTime: string
  endTime: string
  text: string
}

export type SocialPostStatus = 'draft' | 'scheduled' | 'published'
export type SocialNetwork = 'instagram' | 'linkedin' | 'facebook'

export interface SocialPost {
  id: string
  topic: string
  status: SocialPostStatus
  networks: SocialNetwork[]
  contentInstagram?: string
  contentLinkedin?: string
  contentFacebook?: string
  imageUrl?: string
  scheduledAt?: string
  publishedAt?: string
  createdAt: string
  updatedAt: string
}
