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
  companyId: string
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
  companyId: string
  name: string
  category: DocumentCategory
  size: number
  uploadedBy: string
  uploadedAt: string
  blobKey: string
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
  companyId: string
  type: 'renewal' | 'claim_update' | 'payment' | 'document' | 'general'
  title: string
  message: string
  read: boolean
  createdAt: string
}

export interface DashboardStats {
  activePolicies: number
  annualPremiums: number
  renewalsIn90Days: number
  openClaims: number
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
  createdAt?: string
}
