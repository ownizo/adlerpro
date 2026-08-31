/**
 * data.ts — Camada de acesso a dados via Supabase
 * Substitui o Netlify Blobs por Supabase PostgreSQL.
 * Converte automaticamente entre camelCase (TypeScript) e snake_case (Supabase).
 */
import { createClient } from '@supabase/supabase-js'
import { POLICY_TYPE_LABELS } from './types'
import type {
  Company,
  CompanyUser,
  Policy,
  PolicyType,
  Claim,
  Document,
  Alert,
  RiskReport,
  ApiConnection,
  UserMetricEvent,
  IndividualClient,
  ClaimMessage,
  ClientNote,
  ClientTask,
  WebsiteLead,
  SalesOpportunity,
  SalesOpportunityStage,
  SalesPipelineStats,
  CarrierSyncRun,
  CarrierSyncStatus,
  CarrierImportRecord,
  CarrierMatchStatus,
  CarrierDecisionStatus,
  ExternalClientIdentity,
  ExternalPolicyIdentity,
  Json,
  CarrierIndividualCandidateSummary,
  CarrierCompanyCandidateSummary,
  CarrierPolicyCandidateSummary,
  CarrierImportRecordReview,
  CustomerApplyAction,
  PolicyApplyAction,
  CarrierRunApplyStatus,
} from './types'
import {
  buildWebsiteLeadOpportunityPayload,
  computeClosedAtForStageChange,
  computeSalesPipelineStats,
  followUpTaskNeedsDateUpdate,
  isValidSalesOpportunityMarket,
  isValidSalesOpportunitySource,
  isValidSalesOpportunityStage,
  isWebsiteLeadIdUniqueViolation,
  pickEditableOpportunityFields,
  validateOpportunityOwner,
} from './sales-opportunity-rules'
import { normalizePolicyNumber } from './identity-normalization'
import { CARRIER_PROVIDER_LABELS, type CarrierProviderId } from './carrier-providers'
import type { StagedRowMatch } from './carrier-import-matching'
import { mapPortfolioRows } from './carrier-import-mappers'
import type { ParsedImportRow } from './carrier-import-parsing'
import {
  isRowReadyToApply,
  isValidCustomerApplyAction,
  isValidPolicyApplyAction,
  checkOwnerConsistency,
  type ApplyActionRowState,
} from './carrier-apply-actions'
import {
  mapParsedRowToNewIndividualFields,
  mapParsedRowToNewCompanyFields,
  mapParsedRowToNewPolicyFields,
} from './carrier-apply-field-mapping'

// ============================================================
// Cliente Supabase (server-side — usa service_role key)
// Singleton: criado uma vez e reutilizado em todas as chamadas
// ============================================================
let _sbAdmin: ReturnType<typeof createClient> | null = null

function getSupabaseAdmin() {
  if (_sbAdmin) return _sbAdmin
  const url =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) ||
    process.env['VITE_SUPABASE_URL'] ||
    ''
  const key =
    process.env['SUPABASE_SERVICE_ROLE_KEY'] ||
    (typeof import.meta !== 'undefined' && import.meta.env?.SUPABASE_SERVICE_ROLE_KEY) ||
    ''
  _sbAdmin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _sbAdmin
}

// ============================================================
// Utilitários de conversão camelCase ↔ snake_case
// ============================================================
function toSnake(str: string): string {
  return str.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`)
}

function toCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

function objectToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    result[toSnake(k)] = v
  }
  return result
}

function objectToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    result[toCamel(k)] = v
  }
  return result
}

function rowsToCamel<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((r) => objectToCamel(r) as T)
}

// ============================================================
// Companies
// ============================================================
export async function getCompanies(): Promise<Company[]> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('companies').select('*').order('created_at', { ascending: true })
  if (error) { console.error('getCompanies error:', error); return [] }
  return rowsToCamel<Company>(data ?? [])
}

export async function getCompany(id: string): Promise<Company | undefined> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('companies').select('*').eq('id', id).single()
  if (error) return undefined
  return objectToCamel(data) as Company
}

export async function createCompany(company: Company): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('companies').insert(objectToSnake(company as unknown as Record<string, unknown>))
  if (error) console.error('createCompany error:', error)
}

export async function updateCompany(id: string, updates: Partial<Company>): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('companies').update(objectToSnake(updates as Record<string, unknown>)).eq('id', id)
  if (error) console.error('updateCompany error:', error)
}

export async function deleteCompany(id: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('companies').delete().eq('id', id)
  if (error) throw new Error(`deleteCompany: ${error.message}`)
}

export async function deleteCompanyRelations(companyId: string): Promise<void> {
  const sb = getSupabaseAdmin()

  const { data: companyPolicies } = await sb
    .from('policies')
    .select('id')
    .eq('company_id', companyId)
  const policyIds = (companyPolicies ?? []).map((p: { id: string }) => p.id)

  if (policyIds.length > 0) {
    const fkResults = await Promise.all([
      sb.from('renewal_alerts_state').delete().in('policy_id', policyIds),
      sb.from('renewal_alerts_history').delete().in('policy_id', policyIds),
    ])
    const fkErrors = fkResults.filter((r) => r.error).map((r) => r.error!.message)
    if (fkErrors.length > 0) throw new Error(`deleteCompanyRelations (renewal alerts): ${fkErrors.join('; ')}`)
  }

  const { data: companyClaims } = await sb
    .from('claims')
    .select('id')
    .eq('company_id', companyId)
  const claimIds = (companyClaims ?? []).map((c: { id: string }) => c.id)

  if (claimIds.length > 0) {
    const msgResult = await sb.from('claim_messages').delete().in('claim_id', claimIds)
    if (msgResult.error) throw new Error(`deleteCompanyRelations (claim_messages): ${msgResult.error.message}`)
  }

  const docResult = await sb.from('documents').delete().eq('company_id', companyId)
  if (docResult.error) throw new Error(`deleteCompanyRelations (documents): ${docResult.error.message}`)

  const results = await Promise.all([
    sb.from('claims').delete().eq('company_id', companyId),
    sb.from('policies').delete().eq('company_id', companyId),
    sb.from('alerts').delete().eq('company_id', companyId),
    sb.from('risk_reports').delete().eq('company_id', companyId),
    sb.from('company_users').delete().eq('company_id', companyId),
    sb.from('user_metric_events').delete().eq('company_id', companyId),
  ])
  const errors = results.filter((r) => r.error).map((r) => r.error!.message)
  if (errors.length > 0) throw new Error(`deleteCompanyRelations: ${errors.join('; ')}`)
}

// ============================================================
// Company Users
// ============================================================
export async function getCompanyUsers(companyId?: string): Promise<CompanyUser[]> {
  const sb = getSupabaseAdmin()
  let query = sb.from('company_users').select('*').order('created_at', { ascending: true })
  if (companyId) query = query.eq('company_id', companyId)
  const { data, error } = await query
  if (error) { console.error('getCompanyUsers error:', error); return [] }
  return rowsToCamel<CompanyUser>(data ?? [])
}

export async function getCompanyUserByEmail(email: string): Promise<CompanyUser | undefined> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('company_users')
    .select('*')
    .ilike('email', email)
    .single()
  if (error) return undefined
  return objectToCamel(data) as CompanyUser
}

export async function createCompanyUser(user: CompanyUser): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('company_users').insert(objectToSnake(user as unknown as Record<string, unknown>))
  if (error) console.error('createCompanyUser error:', error)
}

export async function updateCompanyUser(id: string, updates: Partial<CompanyUser>): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('company_users').update(objectToSnake(updates as Record<string, unknown>)).eq('id', id)
  if (error) console.error('updateCompanyUser error:', error)
}

export async function deleteCompanyUser(id: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('company_users').delete().eq('id', id)
  if (error) throw new Error(`deleteCompanyUser: ${error.message}`)
}

// ============================================================
// Policies
// ============================================================
export async function getPolicies(companyId?: string): Promise<Policy[]> {
  const sb = getSupabaseAdmin()
  let query = sb.from('policies').select('*').order('created_at', { ascending: true })
  if (companyId) query = query.eq('company_id', companyId)
  const { data, error } = await query
  if (error) { console.error('getPolicies error:', error); return [] }
  return rowsToCamel<Policy>(data ?? [])
}

export async function getPoliciesByIndividualClientId(individualClientId: string): Promise<Policy[]> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('policies')
    .select('*')
    .eq('individual_client_id', individualClientId)
    .order('created_at', { ascending: true })
  if (error) { console.error('getPoliciesByIndividualClientId error:', error); return [] }
  return rowsToCamel<Policy>(data ?? [])
}

export async function getPolicy(id: string): Promise<Policy | undefined> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('policies').select('*').eq('id', id).single()
  if (error) return undefined
  return objectToCamel(data) as Policy
}

export async function createPolicy(policy: Policy): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('policies').insert(objectToSnake(policy as unknown as Record<string, unknown>))
  if (error) throw new Error(`createPolicy: ${error.message}`)
}

export async function updatePolicy(id: string, updates: Partial<Policy>): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('policies').update(objectToSnake(updates as Record<string, unknown>)).eq('id', id)
  if (error) console.error('updatePolicy error:', error)
}

export async function deletePolicy(id: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('policies').delete().eq('id', id)
  if (error) throw new Error(`deletePolicy: ${error.message}`)
}

// ============================================================
// Claims
// ============================================================
export async function getClaims(companyId?: string): Promise<Claim[]> {
  const sb = getSupabaseAdmin()
  let query = sb.from('claims').select('*').order('created_at', { ascending: true })
  if (companyId) query = query.eq('company_id', companyId)
  const { data, error } = await query
  if (error) { console.error('getClaims error:', error); return [] }
  return rowsToCamel<Claim>(data ?? [])
}

export async function getClaimsByIndividualClientId(individualClientId: string): Promise<Claim[]> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('claims')
    .select('*')
    .eq('individual_client_id', individualClientId)
    .order('created_at', { ascending: true })
  if (error) { console.error('getClaimsByIndividualClientId error:', error); return [] }
  return rowsToCamel<Claim>(data ?? [])
}

export async function getClaimsByPolicyId(policyId: string): Promise<Claim[]> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('claims')
    .select('*')
    .eq('policy_id', policyId)
    .order('created_at', { ascending: true })
  if (error) { console.error('getClaimsByPolicyId error:', error); return [] }
  return rowsToCamel<Claim>(data ?? [])
}

export async function getClaim(id: string): Promise<Claim | undefined> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('claims').select('*').eq('id', id).single()
  if (error) return undefined
  return objectToCamel(data) as Claim
}

export async function createClaim(claim: Claim): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('claims').insert(objectToSnake(claim as unknown as Record<string, unknown>))
  if (error) throw new Error(`Falha ao criar sinistro: ${error.message}`)
}

export async function updateClaim(id: string, updates: Partial<Claim>): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('claims').update(objectToSnake(updates as Record<string, unknown>)).eq('id', id)
  if (error) throw new Error(`Falha ao atualizar sinistro: ${error.message}`)
}

// ============================================================
// Documents
// ============================================================
export async function getDocuments(companyId?: string): Promise<Document[]> {
  const sb = getSupabaseAdmin()
  let query = sb.from('documents').select('*').order('uploaded_at', { ascending: false })
  if (companyId) query = query.eq('company_id', companyId)
  const { data, error } = await query
  if (error) { console.error('getDocuments error:', error); return [] }
  return rowsToCamel<Document>(data ?? [])
}

export async function createDocument(doc: Document): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('documents').insert(objectToSnake(doc as unknown as Record<string, unknown>))
  if (error) console.error('createDocument error:', error)
}

export async function getDocument(id: string): Promise<Document | undefined> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('documents').select('*').eq('id', id).single()
  if (error) return undefined
  return objectToCamel(data) as Document
}

export async function updateDocument(id: string, updates: Partial<Document>): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('documents').update(objectToSnake(updates as Record<string, unknown>)).eq('id', id)
  if (error) console.error('updateDocument error:', error)
}

export async function deleteDocument(id: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('documents').delete().eq('id', id)
  if (error) throw new Error(`deleteDocument: ${error.message}`)
}

export async function getClaimDocuments(claimId: string, companyId?: string): Promise<Document[]> {
  const sb = getSupabaseAdmin()
  let query = sb
    .from('documents')
    .select('*')
    .eq('claim_id', claimId)
    .order('uploaded_at', { ascending: false })
  if (companyId) query = query.eq('company_id', companyId)
  const { data, error } = await query
  if (error) { console.error('getClaimDocuments error:', error); return [] }
  return rowsToCamel<Document>(data ?? [])
}

// ============================================================
// Claim Messages
// ============================================================
export async function getClaimMessages(claimId: string): Promise<ClaimMessage[]> {
  const sb = getSupabaseAdmin()
  const query = sb
    .from('claim_messages')
    .select('*')
    .eq('claim_id', claimId)
    .order('created_at', { ascending: true })
  const { data, error } = await query
  if (error) { console.error('getClaimMessages error:', error); return [] }
  return rowsToCamel<ClaimMessage>(data ?? [])
}

export async function createClaimMessage(message: ClaimMessage): Promise<void> {
  const sb = getSupabaseAdmin()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { companyId: _c, individualClientId: _i, readAt: _r, ...insertable } = message
  const { error } = await sb.from('claim_messages').insert(objectToSnake(insertable as unknown as Record<string, unknown>))
  if (error) {
    console.error('createClaimMessage error:', error)
    throw new Error(`Falha ao guardar mensagem: ${error.message}`)
  }
}

export async function markClaimMessagesReadForClient(claimId: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb
    .from('claim_messages')
    .update({ is_read: true })
    .eq('claim_id', claimId)
    .eq('sender_type', 'admin')
    .eq('is_read', false)
  if (error) console.error('markClaimMessagesReadForClient error:', error)
}

export async function markClaimMessagesReadForIndividualClient(claimId: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb
    .from('claim_messages')
    .update({ is_read: true })
    .eq('claim_id', claimId)
    .eq('sender_type', 'admin')
    .eq('is_read', false)
  if (error) console.error('markClaimMessagesReadForIndividualClient error:', error)
}

// ============================================================
// Alerts
// ============================================================
export async function getAlerts(companyId?: string): Promise<Alert[]> {
  const sb = getSupabaseAdmin()
  let query = sb.from('alerts').select('*').order('created_at', { ascending: false })
  if (companyId) query = query.eq('company_id', companyId)
  const { data, error } = await query
  if (error) { console.error('getAlerts error:', error); return [] }
  return rowsToCamel<Alert>(data ?? [])
}

export async function createAlert(alert: Alert): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('alerts').insert(objectToSnake(alert as unknown as Record<string, unknown>))
  if (error) console.error('createAlert error:', error)
}

export async function markAlertRead(id: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('alerts').update({ read: true }).eq('id', id)
  if (error) console.error('markAlertRead error:', error)
}

export async function clearAlerts(): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('alerts').delete().neq('id', 'XXXXX')
  if (error) console.error('clearAlerts error:', error)
}

export async function clearAlertsForCompany(companyId: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('alerts').delete().eq('company_id', companyId)
  if (error) console.error('clearAlertsForCompany error:', error)
}

// ============================================================
// Risk Reports
// ============================================================
export async function getRiskReports(companyId?: string): Promise<RiskReport[]> {
  const sb = getSupabaseAdmin()
  let query = sb.from('risk_reports').select('*').order('generated_at', { ascending: false })
  if (companyId) query = query.eq('company_id', companyId)
  const { data, error } = await query
  if (error) { console.error('getRiskReports error:', error); return [] }
  return rowsToCamel<RiskReport>(data ?? [])
}

export async function createRiskReport(report: RiskReport): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('risk_reports').insert(objectToSnake(report as unknown as Record<string, unknown>))
  if (error) console.error('createRiskReport error:', error)
}

// ============================================================
// API Connections
// ============================================================
export async function getApiConnections(): Promise<ApiConnection[]> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('api_connections').select('*')
  if (error) { console.error('getApiConnections error:', error); return [] }
  return rowsToCamel<ApiConnection>(data ?? [])
}

export async function updateApiConnection(id: string, updates: Partial<ApiConnection>): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('api_connections').update(objectToSnake(updates as Record<string, unknown>)).eq('id', id)
  if (error) console.error('updateApiConnection error:', error)
}

// ============================================================
// User Metric Events
// ============================================================
export async function getUserMetricEvents(companyId?: string): Promise<UserMetricEvent[]> {
  const sb = getSupabaseAdmin()
  let query = sb.from('user_metric_events').select('*').order('timestamp', { ascending: false })
  if (companyId) query = query.eq('company_id', companyId)
  const { data, error } = await query
  if (error) { console.error('getUserMetricEvents error:', error); return [] }
  return rowsToCamel<UserMetricEvent>(data ?? [])
}

export async function createUserMetricEvent(event: UserMetricEvent): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('user_metric_events').insert(objectToSnake(event as unknown as Record<string, unknown>))
  if (error) console.error('createUserMetricEvent error:', error)
}

// ============================================================
// Individual Clients
// ============================================================
export async function getIndividualClients(): Promise<IndividualClient[]> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('individual_clients').select('*').order('full_name', { ascending: true })
  if (error) { console.error('getIndividualClients error:', error); return [] }
  return rowsToCamel<IndividualClient>(data ?? [])
}

export async function getIndividualClient(id: string): Promise<IndividualClient | undefined> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('individual_clients').select('*').eq('id', id).single()
  if (error) return undefined
  return objectToCamel(data) as IndividualClient
}

export async function createIndividualClient(client: Omit<IndividualClient, 'id' | 'createdAt'>): Promise<{ id: string }> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('individual_clients')
    .insert(objectToSnake(client as unknown as Record<string, unknown>))
    .select('id')
    .single()
  if (error) throw error
  return { id: data.id }
}

export async function updateIndividualClient(id: string, updates: Partial<IndividualClient>): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb
    .from('individual_clients')
    .update(objectToSnake(updates as Record<string, unknown>))
    .eq('id', id)
  if (error) console.error('updateIndividualClient error:', error)
}

export async function deleteIndividualClient(id: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('individual_clients').delete().eq('id', id)
  if (error) throw new Error(`deleteIndividualClient: ${error.message}`)
}

export async function deleteIndividualClientRelations(clientId: string): Promise<void> {
  const sb = getSupabaseAdmin()

  const { data: clientPolicies } = await sb
    .from('policies')
    .select('id')
    .eq('individual_client_id', clientId)
  const policyIds = (clientPolicies ?? []).map((p: { id: string }) => p.id)

  if (policyIds.length > 0) {
    const fkResults = await Promise.all([
      sb.from('renewal_alerts_state').delete().in('policy_id', policyIds),
      sb.from('renewal_alerts_history').delete().in('policy_id', policyIds),
    ])
    const fkErrors = fkResults.filter((r) => r.error).map((r) => r.error!.message)
    if (fkErrors.length > 0) throw new Error(`deleteIndividualClientRelations (renewal alerts): ${fkErrors.join('; ')}`)
  }

  const { data: clientClaims } = await sb
    .from('claims')
    .select('id')
    .eq('individual_client_id', clientId)
  const claimIds = (clientClaims ?? []).map((c: { id: string }) => c.id)

  if (claimIds.length > 0) {
    const msgResult = await sb.from('claim_messages').delete().in('claim_id', claimIds)
    if (msgResult.error) throw new Error(`deleteIndividualClientRelations (claim_messages): ${msgResult.error.message}`)
  }

  const docResult = await sb.from('documents').delete().eq('individual_client_id', clientId)
  if (docResult.error) throw new Error(`deleteIndividualClientRelations (documents): ${docResult.error.message}`)

  const results = await Promise.all([
    sb.from('claims').delete().eq('individual_client_id', clientId),
    sb.from('policies').delete().eq('individual_client_id', clientId),
  ])
  const errors = results.filter((r) => r.error).map((r) => r.error!.message)
  if (errors.length > 0) throw new Error(`deleteIndividualClientRelations: ${errors.join('; ')}`)
}

export interface PromoteIndividualClientToCompanyResult {
  companyId: string
  alreadyExisted: boolean
  policies: number
  claims: number
  documents: number
  clientNotes: number
  clientTasks: number
  salesOpportunities: number
  websiteLeads: number
}

/**
 * Promove um individual_client a company — INTEIRAMENTE dentro de uma única
 * chamada RPC (ver promote_individual_client_to_company em
 * migrations/20260830_fix_promote_client_to_company.sql), que corre numa só
 * transação implícita do Postgres:
 *   a. lê o individual_client de origem (só o id atravessa esta fronteira —
 *      nome/nif/email/telefone nunca são confiados ao chamador);
 *   b. resolve uma company existente pelo NIF exato, se não vazio;
 *   c. cria a company de destino se nenhuma foi encontrada;
 *   d. re-parenta TUDO o que pertencia ao individual_client
 *      (policies/claims/documents/client_notes/client_tasks/
 *      sales_opportunities/website_leads);
 *   e. só depois apaga o individual_client.
 * Se qualquer passo falhar — incluindo a criação da company em (c) — o
 * Postgres reverte tudo: nunca fica uma company nova órfã nem uma promoção
 * parcial. Isto substitui uma primeira versão desta função em que a
 * resolução/criação da company acontecia em TypeScript, fora da transação
 * (bug: uma company nova sobrevivia se o re-parenting seguinte falhasse).
 *
 * NÃO usar deleteIndividualClientRelations aqui: essa função apaga
 * definitivamente claims/policies (e as suas dependências), o que é o
 * comportamento certo para "apagar cliente" mas destruiria o histórico de
 * CRM (claims, notas, tarefas, oportunidades, website leads) numa promoção,
 * que é uma operação de re-parenting, não de delete.
 */
export async function promoteIndividualClientToCompany(
  clientId: string,
): Promise<PromoteIndividualClientToCompanyResult> {
  const sb = getSupabaseAdmin()
  const { data, error } = await (sb.rpc as any)('promote_individual_client_to_company', {
    p_client_id: clientId,
  }).single()
  if (error) throw new Error(`promoteIndividualClientToCompany: ${error.message}`)
  if (!data) throw new Error('promoteIndividualClientToCompany: sem resultado da RPC')
  const row = data as {
    company_id: string
    already_existed: boolean
    policies: number
    claims: number
    documents: number
    client_notes: number
    client_tasks: number
    sales_opportunities: number
    website_leads: number
  }
  return {
    companyId: row.company_id,
    alreadyExisted: row.already_existed,
    policies: row.policies,
    claims: row.claims,
    documents: row.documents,
    clientNotes: row.client_notes,
    clientTasks: row.client_tasks,
    salesOpportunities: row.sales_opportunities,
    websiteLeads: row.website_leads,
  }
}

// ============================================================
// Website Leads — intake do site público (adlerrochefort.com)
// ============================================================

/**
 * Encontra ou cria o individual_client dono de `email` (já
 * normalizado pelo chamador — ver src/lib/email.ts normalizeEmail).
 * Delega no lado da BD (função find_or_create_individual_client_by_email,
 * ver migrations/20260829_website_leads.sql) para que a verificação e
 * a criação sejam atómicas mesmo com duas submissões concorrentes do
 * mesmo email — algo que um SELECT seguido de INSERT em dois pedidos
 * HTTP separados não garante.
 *
 * Nunca atualiza um cliente já existente (nome/telefone ficam como
 * estavam) — ver requisito "não alterar clientes existentes".
 */
export async function findOrCreateIndividualClientByEmail(input: {
  email: string
  fullName: string
  phone?: string
}): Promise<{ id: string; created: boolean }> {
  const sb = getSupabaseAdmin()
  // .rpc() só tipa bem com tipos gerados a partir do schema (não usados neste
  // projeto — ver os `never`/`Record<string, unknown>` já pré-existentes em
  // todo este ficheiro para .insert()/.update()); cast pontual, mesma causa.
  const { data, error } = await (sb.rpc as any)('find_or_create_individual_client_by_email', {
    p_email: input.email,
    p_full_name: input.fullName,
    p_phone: input.phone ?? null,
  }).single()
  if (error) throw new Error(`findOrCreateIndividualClientByEmail: ${error.message}`)
  const row = data as { client_id: string; created: boolean }
  return { id: row.client_id, created: row.created }
}

export type CreateWebsiteLeadResult =
  | { created: true; id: string }
  // A mesma submission_id já tinha gerado uma linha (retry do Netlify Forms
  // ou reprocessamento manual) — não duplica, devolve o lead existente.
  | { created: false; duplicate: true; id: string }

export async function createWebsiteLead(
  lead: Omit<WebsiteLead, 'id' | 'createdAt'>,
): Promise<CreateWebsiteLeadResult> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('website_leads')
    .insert(objectToSnake(lead as unknown as Record<string, unknown>))
    .select('id')
    .single()

  if (!error) return { created: true, id: data.id as string }

  // 23505 = unique_violation. Só website_leads_submission_id_uidx pode disparar
  // aqui (não há outra constraint UNIQUE na tabela), então isto é sempre uma
  // submissão duplicada, nunca um erro genuíno a esconder.
  if (error.code === '23505' && lead.submissionId) {
    const { data: existing, error: selErr } = await sb
      .from('website_leads')
      .select('id')
      .eq('submission_id', lead.submissionId)
      .single()
    if (selErr || !existing) throw new Error(`createWebsiteLead (duplicate lookup): ${selErr?.message ?? 'not found'}`)
    return { created: false, duplicate: true, id: existing.id as string }
  }

  throw new Error(`createWebsiteLead: ${error.message}`)
}

export async function getWebsiteLeadsByIndividualClientId(individualClientId: string): Promise<WebsiteLead[]> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('website_leads')
    .select('*')
    .eq('individual_client_id', individualClientId)
    .order('received_at', { ascending: false })
  if (error) { console.error('getWebsiteLeadsByIndividualClientId error:', error); return [] }
  return rowsToCamel<WebsiteLead>(data ?? [])
}

/**
 * Website leads de uma company — só populado depois de um
 * individual_client com histórico de pedidos ser promovido a company
 * (ver adminPromoteToCompany / promote_individual_client_to_company_relations
 * em migrations/20260830_fix_promote_client_to_company.sql). Nenhum lead é
 * criado diretamente com company_id hoje (o intake endpoint só serve
 * pessoas singulares — ver 20260829_website_leads.sql).
 */
export async function getWebsiteLeadsByCompanyId(companyId: string): Promise<WebsiteLead[]> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('website_leads')
    .select('*')
    .eq('company_id', companyId)
    .order('received_at', { ascending: false })
  if (error) { console.error('getWebsiteLeadsByCompanyId error:', error); return [] }
  return rowsToCamel<WebsiteLead>(data ?? [])
}

/** IDs de clientes com pelo menos um website_lead — usado só para mostrar o
 * indicador "Origem: Website" na listagem de clientes individuais do admin.
 * individual_client_id pode ser NULL desde que website_leads passou a
 * suportar company_id (promoção a company) — filtrado aqui para nunca
 * incluir `null` no Set. */
export async function getWebsiteLeadIndividualClientIds(): Promise<Set<string>> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('website_leads').select('individual_client_id')
  if (error) { console.error('getWebsiteLeadIndividualClientIds error:', error); return new Set() }
  return new Set(
    (data ?? [])
      .map((r: { individual_client_id: string | null }) => r.individual_client_id)
      .filter((id): id is string => id != null),
  )
}

// ============================================================
// Sales Opportunities — pipeline comercial (CRM 2, fase 1)
// BACKOFFICE ONLY: nunca chamado a partir de rotas /one/* nem exposto a
// clientes autenticados (B2B ou B2C) — ver RLS em
// migrations/20260829_sales_opportunities.sql.
// ============================================================
export interface SalesOpportunityFilters {
  stage?: SalesOpportunityStage
  market?: string
  product?: string
  source?: string
  assignedTo?: string
  /** 'open' = nem won nem lost; omitido = todas. */
  status?: 'open' | 'won' | 'lost'
  /** Pesquisa livre — cliente/empresa (via join), produto ou título. */
  search?: string
}

export async function getSalesOpportunities(filters: SalesOpportunityFilters = {}): Promise<SalesOpportunity[]> {
  const sb = getSupabaseAdmin()
  let query = sb.from('sales_opportunities').select('*').order('created_at', { ascending: false })

  if (filters.stage) query = query.eq('stage', filters.stage)
  if (filters.market) query = query.eq('market', filters.market)
  if (filters.product) query = query.eq('product', filters.product)
  if (filters.source) query = query.eq('source', filters.source)
  if (filters.assignedTo) query = query.eq('assigned_to', filters.assignedTo)
  if (filters.status === 'won') query = query.eq('stage', 'won')
  else if (filters.status === 'lost') query = query.eq('stage', 'lost')
  else if (filters.status === 'open') query = query.not('stage', 'in', '("won","lost")')
  // Pesquisa por cliente/empresa faz-se em memória no server-fn, depois de
  // cruzar com individual_clients/companies (sales_opportunities não tem o
  // nome do cliente numa coluna própria) — aqui só o filtro por título/produto,
  // que já vive nesta tabela.
  if (filters.search) query = query.or(`title.ilike.%${filters.search}%,product.ilike.%${filters.search}%`)

  const { data, error } = await query
  if (error) { console.error('getSalesOpportunities error:', error); return [] }
  return rowsToCamel<SalesOpportunity>(data ?? [])
}

export async function getSalesOpportunity(id: string): Promise<SalesOpportunity | undefined> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('sales_opportunities').select('*').eq('id', id).single()
  if (error) return undefined
  return objectToCamel(data) as SalesOpportunity
}

export async function getSalesOpportunitiesByOwner(
  scope: { companyId?: string; individualClientId?: string },
): Promise<SalesOpportunity[]> {
  const sb = getSupabaseAdmin()
  let query = sb.from('sales_opportunities').select('*').order('created_at', { ascending: false })
  if (scope.companyId) query = query.eq('company_id', scope.companyId)
  else if (scope.individualClientId) query = query.eq('individual_client_id', scope.individualClientId)
  else return []
  const { data, error } = await query
  if (error) { console.error('getSalesOpportunitiesByOwner error:', error); return [] }
  return rowsToCamel<SalesOpportunity>(data ?? [])
}

export async function createSalesOpportunity(
  opportunity: Omit<SalesOpportunity, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<{ id: string }> {
  const ownerCheck = validateOpportunityOwner(opportunity)
  if (!ownerCheck.ok) throw new Error(`createSalesOpportunity: ${ownerCheck.error}`)
  if (!isValidSalesOpportunityStage(opportunity.stage)) throw new Error('createSalesOpportunity: invalid_stage')
  if (!isValidSalesOpportunityMarket(opportunity.market)) throw new Error('createSalesOpportunity: invalid_market')
  if (!isValidSalesOpportunitySource(opportunity.source)) throw new Error('createSalesOpportunity: invalid_source')

  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('sales_opportunities')
    .insert(objectToSnake(opportunity as unknown as Record<string, unknown>))
    .select('id')
    .single()
  if (error) throw new Error(`createSalesOpportunity: ${error.message}`)
  return { id: data.id as string }
}

export type CreateSalesOpportunityForWebsiteLeadResult =
  | { created: true; id: string }
  // O website_lead já tinha uma oportunidade (submission_id idempotente já
  // garante que isto só acontece num retry/reprocessamento, nunca por um
  // segundo pedido genuíno) — devolve a existente em vez de duplicar.
  | { created: false; id: string }

/**
 * Cria a oportunidade comercial associada a um website_lead recém-criado.
 * Chamado só quando o lead é genuinamente novo — ver
 * shouldCreateOpportunityForWebsiteLead em sales-opportunity-rules.ts — mas
 * mesmo assim protegido ao nível da BD pelo índice único parcial em
 * website_lead_id, para o caso de o próprio chamador ser reprocessado.
 */
export async function createSalesOpportunityForWebsiteLead(input: {
  individualClientId: string
  websiteLeadId: string
  clientName: string
  market?: string
  product?: string
}): Promise<CreateSalesOpportunityForWebsiteLeadResult> {
  const sb = getSupabaseAdmin()
  const payload = buildWebsiteLeadOpportunityPayload(input)
  const { data, error } = await sb
    .from('sales_opportunities')
    .insert(objectToSnake(payload as unknown as Record<string, unknown>))
    .select('id')
    .single()

  if (!error) return { created: true, id: data.id as string }

  // Não assumir genericamente que qualquer 23505 nesta tabela significa
  // "já existe uma opportunity para este website_lead" — confirma primeiro
  // que foi mesmo o índice único de website_lead_id que disparou (defesa
  // contra uma futura constraint UNIQUE nesta tabela ser mal interpretada
  // como idempotência de lead). Só depois disso tenta reaproveitar uma
  // linha existente; se essa linha afinal não existir, propaga o erro em
  // vez de fingir sucesso.
  if (isWebsiteLeadIdUniqueViolation(error)) {
    const { data: existing, error: selErr } = await sb
      .from('sales_opportunities')
      .select('id')
      .eq('website_lead_id', input.websiteLeadId)
      .single()
    if (selErr || !existing) {
      throw new Error(`createSalesOpportunityForWebsiteLead (lookup): ${selErr?.message ?? 'not found'}`)
    }
    return { created: false, id: existing.id as string }
  }

  throw new Error(`createSalesOpportunityForWebsiteLead: ${error.message}`)
}

/**
 * Update genérico da oportunidade — restrito à allowlist de campos
 * editáveis (ver SALES_OPPORTUNITY_EDITABLE_FIELDS/pickEditableOpportunityFields):
 * dono (companyId/individualClientId), websiteLeadId, id, createdAt,
 * closedAt e stage nunca mudam por aqui, mesmo que um chamador os inclua em
 * `updates` — são silenciosamente descartados. Stage tem a sua própria
 * função (updateSalesOpportunityStage), que também deriva closedAt.
 */
export async function updateSalesOpportunity(
  id: string,
  updates: Record<string, unknown>,
): Promise<void> {
  const editable = pickEditableOpportunityFields(updates)
  if ('market' in editable && !isValidSalesOpportunityMarket(editable.market)) {
    throw new Error('updateSalesOpportunity: invalid_market')
  }
  if ('source' in editable && !isValidSalesOpportunitySource(editable.source)) {
    throw new Error('updateSalesOpportunity: invalid_source')
  }
  const payload = { ...editable, updatedAt: new Date().toISOString() }
  const sb = getSupabaseAdmin()
  const { error } = await sb
    .from('sales_opportunities')
    .update(objectToSnake(payload as Record<string, unknown>))
    .eq('id', id)
  if (error) throw new Error(`updateSalesOpportunity: ${error.message}`)
}

/**
 * Muda o stage e deriva closedAt automaticamente (won/lost -> agora; reopen
 * para um stage aberto -> null) — ver computeClosedAtForStageChange. Não
 * cria policy nem faz mais nada além disto (ver requisito "regras de
 * stage").
 */
export async function updateSalesOpportunityStage(
  id: string,
  stage: SalesOpportunityStage,
  extra: { lostReason?: string | null } = {},
): Promise<void> {
  // Não confiar só no tipo TypeScript — um pedido direto ao server-fn (fora
  // do frontend) contorna o compilador. A BD também tem o seu próprio CHECK
  // (defesa em profundidade), mas rejeitar aqui evita gastar um round-trip
  // com um valor já sabido inválido.
  if (!isValidSalesOpportunityStage(stage)) throw new Error('updateSalesOpportunityStage: invalid_stage')
  const nowIso = new Date().toISOString()
  const closedAt = computeClosedAtForStageChange(stage, nowIso)
  const updates: Record<string, unknown> = {
    stage,
    closedAt,
    updatedAt: nowIso,
  }
  if ('lostReason' in extra) updates.lostReason = extra.lostReason ?? null

  const sb = getSupabaseAdmin()
  const { error } = await sb.from('sales_opportunities').update(objectToSnake(updates)).eq('id', id)
  if (error) throw new Error(`updateSalesOpportunityStage: ${error.message}`)
}

export async function deleteSalesOpportunity(id: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('sales_opportunities').delete().eq('id', id)
  if (error) throw new Error(`deleteSalesOpportunity: ${error.message}`)
}

/**
 * Resumo pequeno para o dashboard — sem forecasting complexo. O cálculo em
 * si é puro (computeSalesPipelineStats, em sales-opportunity-rules.ts, onde
 * está testado); esta função só busca os dados.
 */
export async function getSalesPipelineStats(): Promise<SalesPipelineStats> {
  const all = await getSalesOpportunities()
  return computeSalesPipelineStats(all)
}

/**
 * Cria uma client_task de follow-up ligada à oportunidade, evitando
 * duplicar quando já existe uma tarefa pendente para a mesma oportunidade
 * (ver requisito "evitar duplicação de tarefas para o mesmo follow-up").
 */
/**
 * sales_opportunities.next_follow_up_at é um resumo/cache comercial;
 * client_tasks é a fonte operacional das tarefas (ver
 * followUpTaskNeedsDateUpdate em sales-opportunity-rules.ts). Esta função é
 * o único ponto onde um follow-up é definido a partir de uma oportunidade,
 * para nunca haver duas datas contraditórias:
 *   - sem tarefa pendente ainda -> cria uma nova, ligada por opportunity_id
 *   - já existe uma tarefa pendente com a mesma data -> reutiliza-a
 *   - já existe mas com outra data -> atualiza essa tarefa (nunca cria uma
 *     segunda)
 * Em qualquer um dos casos, opportunity.next_follow_up_at fica sempre igual
 * à data pedida no fim.
 */
export async function ensureFollowUpTaskForOpportunity(input: {
  opportunityId: string
  title: string
  dueDate: string
  companyId?: string
  individualClientId?: string
}): Promise<{ created: boolean; task: ClientTask }> {
  const sb = getSupabaseAdmin()
  const { data: existingRows, error: selErr } = await sb
    .from('client_tasks')
    .select('*')
    .eq('opportunity_id', input.opportunityId)
    .eq('status', 'pending')
    .eq('source', 'opportunity')
    .limit(1)
  if (selErr) throw new Error(`ensureFollowUpTaskForOpportunity (lookup): ${selErr.message}`)

  let result: { created: boolean; task: ClientTask }

  if (existingRows && existingRows.length > 0) {
    const existingTask = objectToCamel(existingRows[0]) as ClientTask
    if (followUpTaskNeedsDateUpdate(existingTask.dueDate, input.dueDate)) {
      const { error: updErr } = await sb
        .from('client_tasks')
        .update({ due_date: input.dueDate })
        .eq('id', existingTask.id)
      if (updErr) throw new Error(`ensureFollowUpTaskForOpportunity (update): ${updErr.message}`)
      result = { created: false, task: { ...existingTask, dueDate: input.dueDate } }
    } else {
      result = { created: false, task: existingTask }
    }
  } else {
    const task: ClientTask = {
      id: crypto.randomUUID(),
      companyId: input.companyId,
      individualClientId: input.individualClientId,
      title: input.title,
      dueDate: input.dueDate,
      status: 'pending',
      createdAt: new Date().toISOString(),
      source: 'opportunity',
      opportunityId: input.opportunityId,
    }
    await createClientTask(task)
    result = { created: true, task }
  }

  // Mantém o resumo comercial em sincronia num único ponto — ver comentário
  // acima. nextFollowUpAt está na allowlist de campos editáveis, por isso
  // este updateSalesOpportunity interno nunca é bloqueado pela allowlist.
  await updateSalesOpportunity(input.opportunityId, { nextFollowUpAt: input.dueDate })

  return result
}

// ============================================================
// Client Notes
// ============================================================
export async function getClientNotes(
  scope: { companyId?: string; individualClientId?: string },
): Promise<ClientNote[]> {
  const sb = getSupabaseAdmin()
  let query = sb.from('client_notes').select('*').order('created_at', { ascending: false })
  if (scope.companyId) query = query.eq('company_id', scope.companyId)
  else if (scope.individualClientId) query = query.eq('individual_client_id', scope.individualClientId)
  else return []
  const { data, error } = await query
  if (error) { console.error('getClientNotes error:', error); return [] }
  return rowsToCamel<ClientNote>(data ?? [])
}

export async function createClientNote(note: ClientNote): Promise<void> {
  // XOR: exatamente um de {companyId, individualClientId}; '' conta como ausente
  const hasCompany = !!note.companyId && note.companyId.trim() !== ''
  const hasIndividual = !!note.individualClientId && note.individualClientId.trim() !== ''
  if (hasCompany === hasIndividual) {
    throw new Error('createClientNote: a nota deve pertencer a exatamente um de {companyId, individualClientId}')
  }
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('client_notes').insert(objectToSnake(note as unknown as Record<string, unknown>))
  if (error) throw new Error(`createClientNote: ${error.message}`)
}

export async function deleteClientNote(id: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('client_notes').delete().eq('id', id)
  if (error) throw new Error(`deleteClientNote: ${error.message}`)
}

// ============================================================
// Client Tasks
// ============================================================
export async function getClientTasks(
  scope: { companyId?: string; individualClientId?: string },
  filter?: { status?: 'pending' | 'done' },
): Promise<ClientTask[]> {
  const sb = getSupabaseAdmin()
  let query = sb.from('client_tasks').select('*').order('due_date', { ascending: true })
  if (scope.companyId) query = query.eq('company_id', scope.companyId)
  else if (scope.individualClientId) query = query.eq('individual_client_id', scope.individualClientId)
  else return []
  if (filter?.status) query = query.eq('status', filter.status)
  const { data, error } = await query
  if (error) { console.error('getClientTasks error:', error); return [] }
  return rowsToCamel<ClientTask>(data ?? [])
}

export async function createClientTask(task: ClientTask): Promise<void> {
  // XOR: exatamente um de {companyId, individualClientId}; '' conta como ausente
  const hasCompany = !!task.companyId && task.companyId.trim() !== ''
  const hasIndividual = !!task.individualClientId && task.individualClientId.trim() !== ''
  if (hasCompany === hasIndividual) {
    throw new Error('createClientTask: a tarefa deve pertencer a exatamente um de {companyId, individualClientId}')
  }
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('client_tasks').insert(objectToSnake(task as unknown as Record<string, unknown>))
  if (error) throw new Error(`createClientTask: ${error.message}`)
}

export async function updateClientTaskStatus(
  id: string,
  status: 'pending' | 'done',
): Promise<void> {
  const sb = getSupabaseAdmin()
  const updates: Record<string, unknown> = { status }
  if (status === 'done') updates.done_at = new Date().toISOString()
  else updates.done_at = null
  const { error } = await sb.from('client_tasks').update(updates).eq('id', id)
  if (error) throw new Error(`updateClientTaskStatus: ${error.message}`)
}

export async function deleteClientTask(id: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('client_tasks').delete().eq('id', id)
  if (error) throw new Error(`deleteClientTask: ${error.message}`)
}

export async function getAllTasksByDueDate(
  filter?: { status?: 'pending' | 'done' },
): Promise<ClientTask[]> {
  const sb = getSupabaseAdmin()
  let query = sb.from('client_tasks').select('*').order('due_date', { ascending: true })
  if (filter?.status) query = query.eq('status', filter.status)
  const { data, error } = await query
  if (error) { console.error('getAllTasksByDueDate error:', error); return [] }
  return rowsToCamel<ClientTask>(data ?? [])
}

// ============================================================
// Renewal Tasks — geração automática a partir de apólices a expirar
// ============================================================

// Subtrai N dias a uma data YYYY-MM-DD usando UTC para evitar desfasamentos de timezone
function subtractDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

export async function generateRenewalTasks(): Promise<{ created: number; skipped: number }> {
  const sb = getSupabaseAdmin()

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const in60Days = new Date(today)
  in60Days.setUTCDate(in60Days.getUTCDate() + 60)
  const todayStr = today.toISOString().slice(0, 10)
  const in60DaysStr = in60Days.toISOString().slice(0, 10)

  type PolicyRow = {
    id: string; type: string; insurer: string; policy_number: string
    end_date: string; company_id: string; individual_client_id: string | null
  }

  const { data: rawPolicies, error: policiesError } = await sb
    .from('policies')
    .select('id, type, insurer, policy_number, end_date, company_id, individual_client_id')
    .in('status', ['active', 'expiring'])
    .not('end_date', 'is', null)
    .gte('end_date', todayStr)
    .lte('end_date', in60DaysStr)

  if (policiesError) throw new Error(`generateRenewalTasks (fetch): ${policiesError.message}`)
  const policies = (rawPolicies ?? []) as unknown as PolicyRow[]
  if (policies.length === 0) return { created: 0, skipped: 0 }

  let created = 0
  let skipped = 0

  for (const policy of policies) {
    const dueDate = subtractDays(policy.end_date, 14)
    const typeLabel = POLICY_TYPE_LABELS[policy.type as PolicyType] ?? policy.type
    const title = `Renovar apólice — ${typeLabel} ${policy.insurer} · ${policy.policy_number}`

    // Anti-duplicação: policy_id + source + due_date identifica univocamente o ciclo
    // Não filtra por status — tarefa 'done' do mesmo ciclo não deve regenerar
    const { count, error: countError } = await sb
      .from('client_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('policy_id', policy.id)
      .eq('source', 'renewal')
      .eq('due_date', dueDate)

    if (countError) {
      console.error(`generateRenewalTasks: erro ao verificar duplicado (policy ${policy.id}):`, countError)
      continue
    }
    if ((count ?? 0) > 0) { skipped++; continue }

    // Scope XOR: individual_client_id tem prioridade se preenchido
    const row: Record<string, unknown> = {
      id: crypto.randomUUID(),
      title,
      due_date: dueDate,
      status: 'pending',
      source: 'renewal',
      policy_id: policy.id,
      created_at: new Date().toISOString(),
    }
    if (policy.individual_client_id) row.individual_client_id = policy.individual_client_id
    else row.company_id = policy.company_id

    const { error: insertError } = await sb.from('client_tasks').insert(row)
    if (insertError) {
      console.error(`generateRenewalTasks: erro ao inserir (policy ${policy.id}):`, insertError)
      continue
    }
    created++
  }

  return { created, skipped }
}

// ============================================================
// File storage (mantido para compatibilidade — usa Netlify Blobs apenas para ficheiros)
// ============================================================
export function fileStore() {
  try {
    const { getStore } = require('@netlify/blobs')
    return getStore('portal-files')
  } catch {
    return null
  }
}

// ============================================================
// Marketing — resolução de destinatários (partilhado entre
// previewMarketingAudience e a Netlify Function marketing-send)
// ============================================================
export interface MarketingRecipient {
  email: string
  name: string
  type: 'company' | 'company_user' | 'individual_client'
  refId: string
}

export interface ResolvedMarketingRecipients {
  recipients: MarketingRecipient[]
  totalRaw: number    // com email válido, antes de filtrar opt-outs
  afterOptOut: number // depois de excluir opt-outs, antes de deduplicar
  afterDedup: number  // lista final = recipients.length
}

export async function resolveMarketingRecipients(
  audience: 'companies' | 'company_users' | 'individual_clients' | 'all',
): Promise<ResolvedMarketingRecipients> {
  const sb = getSupabaseAdmin()

  type RawRow = { email: string; name: string; type: MarketingRecipient['type']; refId: string; optOut: boolean }
  const raw: RawRow[] = []

  // Fonte A — companies: contact_email como principal, access_email como fallback.
  // 1 destinatário por empresa; marketing_opt_out filtrado abaixo em TypeScript.
  if (audience === 'companies' || audience === 'all') {
    const { data: d } = await sb.from('companies').select('*').order('name', { ascending: true })
    const rows = (d ?? []) as unknown as Array<{
      id: string; name: string | null; contact_email: string | null; access_email: string | null; marketing_opt_out: boolean
    }>
    for (const c of rows) {
      const email = (c.contact_email || c.access_email || '').trim()
      if (!email) continue
      raw.push({ email, name: c.name ?? '', type: 'company', refId: c.id, optOut: c.marketing_opt_out ?? false })
    }
  }

  // Fonte B — company_users: owners + managers; sem coluna marketing_opt_out própria.
  if (audience === 'company_users' || audience === 'all') {
    const { data: d } = await sb.from('company_users').select('*').in('role', ['owner', 'manager']).order('name', { ascending: true })
    const rows = (d ?? []) as unknown as Array<{ id: string; name: string | null; email: string | null; role: string }>
    for (const u of rows) {
      const email = (u.email || '').trim()
      if (!email) continue
      raw.push({ email, name: u.name ?? '', type: 'company_user', refId: u.id, optOut: false })
    }
  }

  // Fonte C — individual_clients: marketing_opt_out filtrado abaixo em TypeScript.
  if (audience === 'individual_clients' || audience === 'all') {
    const { data: d } = await sb.from('individual_clients').select('*').not('email', 'is', null).order('full_name', { ascending: true })
    const rows = (d ?? []) as unknown as Array<{
      id: string; full_name: string | null; email: string | null; marketing_opt_out: boolean
    }>
    for (const ic of rows) {
      const email = (ic.email || '').trim()
      if (!email) continue
      raw.push({ email, name: ic.full_name ?? '', type: 'individual_client', refId: ic.id, optOut: ic.marketing_opt_out ?? false })
    }
  }

  const totalRaw = raw.length

  // Excluir opt-outs
  const afterOptOutList = raw.filter((r) => !r.optOut)
  const afterOptOut = afterOptOutList.length

  // Deduplicar por email (case-insensitive, preserva a primeira ocorrência — A → B → C)
  const seen = new Set<string>()
  const recipients: MarketingRecipient[] = []
  for (const r of afterOptOutList) {
    const key = r.email.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      recipients.push({ email: r.email, name: r.name, type: r.type, refId: r.refId })
    }
  }

  return { recipients, totalRaw, afterOptOut, afterDedup: recipients.length }
}

// ============================================================
// CRM3 — Identity & Reconciliation (Block 2)
//
// Camada de acesso às 4 tabelas de
// migrations/20260830_crm3_identity_reconciliation.sql. Segue exatamente o
// mesmo padrão service-role de todo este ficheiro. NUNCA cria/atualiza/apaga
// um individual_client/company/policy a partir de dados de staging, nunca
// faz merge, nunca sincroniza campos de seguradora para policies, e nunca
// aceita automaticamente um match probable/ambiguous — ver requisito
// explícito da Block 2 "The data layer must NOT...".
// ============================================================

function isUniqueViolationOn(error: { code?: string | null; message?: string | null }, constraintName: string): boolean {
  if (error.code !== '23505') return false
  return (error.message ?? '').toLowerCase().includes(constraintName.toLowerCase())
}

// ── Carrier sync runs ────────────────────────────────────────

export interface CarrierSyncRunFilters {
  provider?: string
  status?: CarrierSyncStatus
}

export async function listCarrierSyncRuns(options: CarrierSyncRunFilters = {}): Promise<CarrierSyncRun[]> {
  const sb = getSupabaseAdmin()
  let query = sb.from('carrier_sync_runs').select('*').order('created_at', { ascending: false })
  if (options.provider) query = query.eq('provider', options.provider)
  if (options.status) query = query.eq('status', options.status)
  const { data, error } = await query
  if (error) { console.error('listCarrierSyncRuns error:', error); return [] }
  return rowsToCamel<CarrierSyncRun>(data ?? [])
}

export async function getCarrierSyncRun(runId: string): Promise<CarrierSyncRun | undefined> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('carrier_sync_runs').select('*').eq('id', runId).single()
  if (error) return undefined
  return objectToCamel(data) as unknown as CarrierSyncRun
}

// ── Carrier import records (staging) ────────────────────────

export interface CarrierImportRecordFilters {
  customerMatchStatus?: CarrierMatchStatus
  policyMatchStatus?: CarrierMatchStatus
  decisionStatus?: CarrierDecisionStatus
}

export async function listCarrierImportRecords(
  runId: string,
  options: CarrierImportRecordFilters = {},
): Promise<CarrierImportRecord[]> {
  const sb = getSupabaseAdmin()
  let query = sb
    .from('carrier_import_records')
    .select('*')
    .eq('sync_run_id', runId)
    .order('created_at', { ascending: true })
  if (options.customerMatchStatus) query = query.eq('customer_match_status', options.customerMatchStatus)
  if (options.policyMatchStatus) query = query.eq('policy_match_status', options.policyMatchStatus)
  if (options.decisionStatus) query = query.eq('decision_status', options.decisionStatus)
  const { data, error } = await query
  if (error) { console.error('listCarrierImportRecords error:', error); return [] }
  return rowsToCamel<CarrierImportRecord>(data ?? [])
}

export async function getCarrierImportRecord(recordId: string): Promise<CarrierImportRecord | undefined> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('carrier_import_records').select('*').eq('id', recordId).single()
  if (error) return undefined
  return objectToCamel(data) as unknown as CarrierImportRecord
}

/**
 * Resolves a carrier_import_record's matched_individual_client_id/
 * matched_company_id/matched_policy_id into review-safe summaries — see
 * CarrierImportRecordReview in types.ts for exactly which fields are
 * exposed and why. Never invents a candidate: if a matched_*_id is absent,
 * or the row it points at no longer exists, that candidate is simply
 * omitted (`undefined`), never fabricated from partial data.
 *
 * Only ever reads individual_clients/companies/policies (via the existing
 * getIndividualClient/getCompany/getPolicy) — no notes/tasks/opportunities/
 * claims/documents table is touched here, and nothing from those tables
 * could leak into the summary even if a caller tried, since the return
 * shape is fixed to CarrierIndividualCandidateSummary/
 * CarrierCompanyCandidateSummary/CarrierPolicyCandidateSummary.
 */
export async function getCarrierImportRecordReview(recordId: string): Promise<CarrierImportRecordReview | undefined> {
  const record = await getCarrierImportRecord(recordId)
  if (!record) return undefined

  let individualCandidate: CarrierIndividualCandidateSummary | undefined
  if (record.matchedIndividualClientId) {
    const client = await getIndividualClient(record.matchedIndividualClientId)
    if (client) {
      individualCandidate = {
        id: client.id,
        fullName: client.fullName,
        email: client.email,
        phone: client.phone,
        nif: client.nif,
        address: client.address,
      }
    }
  }

  let companyCandidate: CarrierCompanyCandidateSummary | undefined
  if (record.matchedCompanyId) {
    const company = await getCompany(record.matchedCompanyId)
    if (company) {
      companyCandidate = {
        id: company.id,
        name: company.name,
        nif: company.nif,
        contactName: company.contactName,
        contactEmail: company.contactEmail,
        contactPhone: company.contactPhone,
        address: company.address,
      }
    }
  }

  let policyCandidate: CarrierPolicyCandidateSummary | undefined
  if (record.matchedPolicyId) {
    const policy = await getPolicy(record.matchedPolicyId)
    if (policy) {
      // Owner label is one cheap extra lookup by an id already on the
      // policy row — never a guess, and never touches notes/tasks/
      // opportunities/claims for that owner.
      let ownerLabel: string | undefined
      if (policy.companyId) {
        ownerLabel = (await getCompany(policy.companyId))?.name
      } else if (policy.individualClientId) {
        ownerLabel = (await getIndividualClient(policy.individualClientId))?.fullName
      }
      policyCandidate = {
        id: policy.id,
        policyNumber: policy.policyNumber,
        insurer: policy.insurer,
        policyType: policy.type,
        startDate: policy.startDate,
        endDate: policy.endDate,
        annualPremium: policy.annualPremium,
        ownerLabel,
        // CRM3 Block 4 — the raw owner ids, needed to check that a
        // selected customer actually matches this policy's real owner
        // (see checkOwnerConsistency). Never fabricated: mirrors
        // whichever of policy.companyId/policy.individualClientId is
        // actually set.
        ownerIndividualClientId: policy.individualClientId || undefined,
        ownerCompanyId: policy.companyId || undefined,
      }
    }
  }

  return { record, individualCandidate, companyCandidate, policyCandidate }
}

// ── External identities (lookup) ────────────────────────────

export async function findExternalClientIdentity(
  provider: string,
  externalClientId: string,
): Promise<ExternalClientIdentity | undefined> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('external_client_identities')
    .select('*')
    .eq('provider', provider)
    .eq('external_client_id', externalClientId)
    .maybeSingle()
  if (error || !data) return undefined
  return objectToCamel(data) as unknown as ExternalClientIdentity
}

export async function findExternalPolicyIdentity(
  provider: string,
  externalPolicyId: string,
): Promise<ExternalPolicyIdentity | undefined> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('external_policy_identities')
    .select('*')
    .eq('provider', provider)
    .eq('external_policy_id', externalPolicyId)
    .maybeSingle()
  if (error || !data) return undefined
  return objectToCamel(data) as unknown as ExternalPolicyIdentity
}

/**
 * Lookup for the FALLBACK link path only (externalPolicyId absent) —
 * deliberately scoped to policyId (never a global provider+number lookup):
 * a match on a different internal policy is not "found" here at all, it is
 * simply invisible to this function, because policy_number is
 * reconciliation evidence for one already-known policy, never a
 * cross-policy identity claim (see createExternalPolicyIdentity below and
 * migrations/20260830_crm3_identity_reconciliation.sql).
 */
async function findExternalPolicyIdentityByFallbackKey(
  policyId: string,
  provider: string,
  externalPolicyNumberNormalized: string,
): Promise<ExternalPolicyIdentity | undefined> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('external_policy_identities')
    .select('*')
    .eq('policy_id', policyId)
    .eq('provider', provider)
    .eq('external_policy_number_normalized', externalPolicyNumberNormalized)
    .is('external_policy_id', null)
    .maybeSingle()
  if (error || !data) return undefined
  return objectToCamel(data) as unknown as ExternalPolicyIdentity
}

// ── External identities (link/create) ───────────────────────

export interface CreateExternalClientIdentityInput {
  individualClientId?: string
  companyId?: string
  provider: string
  externalClientId: string
  externalClientNumber?: string
  taxCountry?: string
  taxIdType?: string
  taxIdRaw?: string
  taxIdNormalized?: string
  metadata?: Record<string, Json>
}

export type CreateExternalClientIdentityResult =
  | { status: 'created'; identity: ExternalClientIdentity }
  // (provider, externalClientId) já existia e já apontava para o MESMO
  // dono — sucesso idempotente, nada é alterado.
  | { status: 'already_linked'; identity: ExternalClientIdentity }
  // (provider, externalClientId) já existia mas apontava para um dono
  // DIFERENTE — nunca move uma identidade existente de um dono para outro
  // silenciosamente (ver requisito "Do not silently move an existing
  // identity from one CRM owner to another").
  | { status: 'conflict'; identity: ExternalClientIdentity }

/**
 * Liga (ou cria a ligação de) um cliente de seguradora a exatamente um
 * individual_client OU company — nunca aos dois, nunca a nenhum (XOR
 * validado aqui, antes de tocar na BD; o CHECK da migration é a rede de
 * segurança final). A uniqueness real é a da BD — UNIQUE(provider,
 * external_client_id) — este código nunca decide "já existe" só por uma
 * leitura prévia sem proteção: se o INSERT ainda assim colidir (corrida
 * entre duas chamadas concorrentes), volta a consultar em vez de assumir.
 */
export async function createExternalClientIdentity(
  input: CreateExternalClientIdentityInput,
): Promise<CreateExternalClientIdentityResult> {
  const hasIndividual = !!input.individualClientId && input.individualClientId.trim() !== ''
  const hasCompany = !!input.companyId && input.companyId.trim() !== ''
  if (hasIndividual === hasCompany) {
    throw new Error('createExternalClientIdentity: exactly one of individualClientId or companyId is required')
  }
  if (!input.provider || !input.externalClientId) {
    throw new Error('createExternalClientIdentity: provider and externalClientId are required')
  }

  const sameOwnerAs = (identity: ExternalClientIdentity): boolean =>
    hasIndividual ? identity.individualClientId === input.individualClientId : identity.companyId === input.companyId

  const existing = await findExternalClientIdentity(input.provider, input.externalClientId)
  if (existing) {
    return { status: sameOwnerAs(existing) ? 'already_linked' : 'conflict', identity: existing }
  }

  const sb = getSupabaseAdmin()
  const now = new Date().toISOString()
  const payload = {
    id: crypto.randomUUID(),
    individualClientId: input.individualClientId,
    companyId: input.companyId,
    provider: input.provider,
    externalClientId: input.externalClientId,
    externalClientNumber: input.externalClientNumber,
    taxCountry: input.taxCountry,
    taxIdType: input.taxIdType,
    taxIdRaw: input.taxIdRaw,
    taxIdNormalized: input.taxIdNormalized,
    metadata: input.metadata ?? {},
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  }
  const { data, error } = await sb
    .from('external_client_identities')
    .insert(objectToSnake(payload as unknown as Record<string, unknown>) as any)
    .select('*')
    .single()

  if (error) {
    if (isUniqueViolationOn(error, 'external_client_identities_provider_external_id_uidx')) {
      const raced = await findExternalClientIdentity(input.provider, input.externalClientId)
      if (raced) return { status: sameOwnerAs(raced) ? 'already_linked' : 'conflict', identity: raced }
    }
    throw new Error(`createExternalClientIdentity: ${error.message}`)
  }
  return { status: 'created', identity: objectToCamel(data) as unknown as ExternalClientIdentity }
}

export interface CreateExternalPolicyIdentityInput {
  policyId: string
  provider: string
  externalPolicyNumber: string
  externalPolicyId?: string
  // Deliberately NO externalPolicyNumberNormalized field — a caller-
  // supplied normalization is never trusted as authoritative (see
  // requirement). The only normalized value ever stored is the one this
  // function derives itself, below, via normalizePolicyNumber.
  metadata?: Record<string, Json>
}

export type CreateExternalPolicyIdentityResult =
  | { status: 'created'; identity: ExternalPolicyIdentity }
  // Idempotent — same identity already existed for the same owner. Two
  // distinct cases collapse into this one status:
  //   - externalPolicyId present: (provider, externalPolicyId) already
  //     pointed at this SAME internal policy.
  //   - externalPolicyId absent (fallback path): a fallback row already
  //     existed for this SAME policy_id + provider + normalized number.
  | { status: 'already_linked'; identity: ExternalPolicyIdentity }
  // ONLY possible on the externalPolicyId-present path: (provider,
  // externalPolicyId) already pertence a OUTRA policy interna. The
  // fallback (number-only) path never produces this status — a number
  // match against a different internal policy is not authoritative and is
  // never even looked up (see below).
  | { status: 'conflict'; identity: ExternalPolicyIdentity }

/**
 * Liga (ou cria a ligação de) uma apólice de seguradora a uma policy
 * interna.
 *
 * Duas fontes de identidade, com garantias muito diferentes:
 *
 *   A) externalPolicyId presente — AUTORITATIVA, inalterada nesta revisão:
 *      (provider, externalPolicyId) só pode apontar para UMA policy
 *      interna (UNIQUE parcial na migration). Mesma policy -> already_linked;
 *      policy diferente -> conflict.
 *
 *   B) externalPolicyId ausente — FALLBACK, apenas idempotente DENTRO da
 *      MESMA policy interna (nunca uma identidade cross-policy — ver
 *      requisito "Do not use policy number alone as authoritative
 *      identity" / "Never interpret a number match against ANOTHER
 *      internal policy as an authoritative identity conflict"). Verifica
 *      SÓ se já existe uma ligação fallback para (policyId, provider,
 *      número normalizado) — nunca consulta outras policies, por isso este
 *      caminho nunca pode devolver 'conflict'.
 *
 * O número normalizado NUNCA vem do chamador — é sempre derivado aqui,
 * server-side, via normalizePolicyNumber (mesmo normalizador usado em todo
 * o CRM3), porque um valor de normalização vindo do browser não pode ser
 * confiado como autoritativo.
 *
 * Corrida (dois pedidos concorrentes a criar a mesma ligação): o INSERT
 * pode colidir com qualquer um dos dois UNIQUE índices da migration
 * (provider+externalPolicyId, ou policy_id+provider+número normalizado
 * fallback) — em ambos os casos volta a consultar e devolve
 * already_linked/conflict a partir do que realmente ficou gravado, nunca
 * assume.
 */
export async function createExternalPolicyIdentity(
  input: CreateExternalPolicyIdentityInput,
): Promise<CreateExternalPolicyIdentityResult> {
  if (!input.policyId || !input.provider || !input.externalPolicyNumber) {
    throw new Error('createExternalPolicyIdentity: policyId, provider and externalPolicyNumber are required')
  }

  const externalPolicyNumberNormalized = normalizePolicyNumber(input.externalPolicyNumber, input.provider)

  if (input.externalPolicyId) {
    // A) Authoritative path — unchanged.
    const existing = await findExternalPolicyIdentity(input.provider, input.externalPolicyId)
    if (existing) {
      return { status: existing.policyId === input.policyId ? 'already_linked' : 'conflict', identity: existing }
    }
  } else if (externalPolicyNumberNormalized) {
    // B) Fallback path — idempotent within the same policy only.
    const existing = await findExternalPolicyIdentityByFallbackKey(
      input.policyId,
      input.provider,
      externalPolicyNumberNormalized,
    )
    if (existing) {
      return { status: 'already_linked', identity: existing }
    }
  }

  const sb = getSupabaseAdmin()
  const now = new Date().toISOString()
  const payload = {
    id: crypto.randomUUID(),
    policyId: input.policyId,
    provider: input.provider,
    externalPolicyId: input.externalPolicyId,
    externalPolicyNumber: input.externalPolicyNumber,
    externalPolicyNumberNormalized,
    metadata: input.metadata ?? {},
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  }
  const { data, error } = await sb
    .from('external_policy_identities')
    .insert(objectToSnake(payload as unknown as Record<string, unknown>) as any)
    .select('*')
    .single()

  if (error) {
    if (input.externalPolicyId && isUniqueViolationOn(error, 'external_policy_identities_provider_external_id_uidx')) {
      const raced = await findExternalPolicyIdentity(input.provider, input.externalPolicyId)
      if (raced) return { status: raced.policyId === input.policyId ? 'already_linked' : 'conflict', identity: raced }
    }
    if (
      !input.externalPolicyId &&
      externalPolicyNumberNormalized &&
      isUniqueViolationOn(error, 'external_policy_identities_policy_provider_number_uidx')
    ) {
      const raced = await findExternalPolicyIdentityByFallbackKey(
        input.policyId,
        input.provider,
        externalPolicyNumberNormalized,
      )
      if (raced) return { status: 'already_linked', identity: raced }
    }
    throw new Error(`createExternalPolicyIdentity: ${error.message}`)
  }
  return { status: 'created', identity: objectToCamel(data) as unknown as ExternalPolicyIdentity }
}

// ── Import decisions (staging record only — never touches CRM data) ─

const UNRESOLVED_CARRIER_MATCH_STATUSES: readonly CarrierMatchStatus[] = ['unmatched', 'probable', 'ambiguous', 'new']

export interface UpdateCarrierImportDecisionInput {
  decisionStatus: CarrierDecisionStatus
  decisionNote?: string
}

/**
 * Atualiza SÓ os campos de decisão do carrier_import_record — nunca cria,
 * atualiza ou apaga um individual_client/company/policy, nunca faz merge,
 * nunca sobrepõe campos do CRM (ver requisito '"Accept" at this stage does
 * NOT create a client/company/policy, does not merge anything, does not
 * overwrite CRM fields — it only records that an Admin accepted the
 * reconciliation decision').
 *
 *   accepted -> decision_status='accepted', decided_at=now()
 *   rejected -> decision_status='rejected' (decided_at fica por preencher —
 *     rejeitar não é uma decisão "tomada" sobre o registo no mesmo sentido)
 *   ignored  -> decision_status='ignored'; customer_match_status/
 *     policy_match_status também passam a 'ignored', mas SÓ se ainda
 *     estavam por resolver (unmatched/probable/ambiguous/new) — nunca
 *     apaga um 'exact'/'linked' já confirmado só porque a decisão de
 *     revisão foi ignorada.
 */
export async function updateCarrierImportDecision(
  recordId: string,
  input: UpdateCarrierImportDecisionInput,
): Promise<void> {
  const sb = getSupabaseAdmin()
  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {
    decision_status: input.decisionStatus,
    updated_at: now,
  }
  if (input.decisionNote !== undefined) updates.decision_note = input.decisionNote
  if (input.decisionStatus === 'accepted') updates.decided_at = now

  if (input.decisionStatus === 'ignored') {
    const record = await getCarrierImportRecord(recordId)
    if (record) {
      if (UNRESOLVED_CARRIER_MATCH_STATUSES.includes(record.customerMatchStatus)) updates.customer_match_status = 'ignored'
      if (UNRESOLVED_CARRIER_MATCH_STATUSES.includes(record.policyMatchStatus)) updates.policy_match_status = 'ignored'
    }
  }

  const { error } = await (sb.from('carrier_import_records') as any).update(updates).eq('id', recordId)
  if (error) throw new Error(`updateCarrierImportDecision: ${error.message}`)
}

// ============================================================
// CRM3 Block 3 — Manual Portfolio Import
//
// Reuses the existing carrier_sync_runs/carrier_import_records tables
// exactly as they are — no redesign. Every write here is either a new
// carrier_sync_runs row (mode='dry_run', never anything else) or new
// carrier_import_records rows. NEVER touches individual_clients/
// companies/policies — matching only ever reads them (via
// listCandidateClients/listCandidatePolicies below) to feed
// matchPortfolioRows (src/lib/carrier-import-matching.ts), which itself
// never writes anywhere.
// ============================================================

/** Full individual_clients + companies lists, once per import run, for
 * src/lib/carrier-import-matching.ts's candidate pool — never a per-row
 * fetch. Read-only, plain SELECTs; matches the same "load everything
 * once" pattern already used by fetchAdminAll for the admin dashboard. */
export async function listCandidateClients(): Promise<{
  individualClients: IndividualClient[]
  companies: Company[]
}> {
  const [individualClients, companies] = await Promise.all([getIndividualClients(), getCompanies()])
  return { individualClients, companies }
}

export async function listCandidatePolicies(): Promise<Policy[]> {
  return getPolicies()
}

export async function listExternalClientIdentities(): Promise<ExternalClientIdentity[]> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('external_client_identities').select('*')
  if (error) { console.error('listExternalClientIdentities error:', error); return [] }
  return rowsToCamel<ExternalClientIdentity>(data ?? [])
}

export async function listExternalPolicyIdentities(): Promise<ExternalPolicyIdentity[]> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('external_policy_identities').select('*')
  if (error) { console.error('listExternalPolicyIdentities error:', error); return [] }
  return rowsToCamel<ExternalPolicyIdentity>(data ?? [])
}

/** Requires migrations/20260831_carrier_sync_runs_import_fingerprint.sql
 * (a NEW, additive, NOT-YET-APPLIED migration — see that file) for the
 * import_fingerprint column/index this queries. */
export async function findCarrierSyncRunByFingerprint(fingerprint: string): Promise<CarrierSyncRun | undefined> {
  const sb = getSupabaseAdmin()
  const { data, error } = await (sb.from('carrier_sync_runs') as any)
    .select('*')
    .eq('import_fingerprint', fingerprint)
    .maybeSingle()
  if (error || !data) return undefined
  return objectToCamel(data) as unknown as CarrierSyncRun
}

export interface CreateCarrierSyncRunForImportInput {
  provider: CarrierProviderId
  importFingerprint: string
  recordsReceived: number
}

export type CreateCarrierSyncRunForImportResult =
  // Repeated upload of the exact same sanitized portfolio content —
  // never silently creates a second run (ver requisito "Do not silently
  // create duplicate runs/import records if avoidable").
  | { status: 'duplicate'; run: CarrierSyncRun }
  | { status: 'created'; run: CarrierSyncRun }

/**
 * Creates the carrier_sync_runs row for a manual import — ALWAYS
 * mode='dry_run' (this Block never does a real "import" mode write).
 * Checks the fingerprint first, and again on an INSERT race against the
 * new partial unique index, exactly like the existing external-identity
 * link functions above (check, then re-query on conflict, never assume).
 */
export async function createCarrierSyncRunForImport(
  input: CreateCarrierSyncRunForImportInput,
): Promise<CreateCarrierSyncRunForImportResult> {
  const existing = await findCarrierSyncRunByFingerprint(input.importFingerprint)
  if (existing) return { status: 'duplicate', run: existing }

  const sb = getSupabaseAdmin()
  const now = new Date().toISOString()
  const payload = {
    id: crypto.randomUUID(),
    provider: input.provider,
    mode: 'dry_run',
    status: 'processing',
    importFingerprint: input.importFingerprint,
    recordsReceived: input.recordsReceived,
    recordsExactMatch: 0,
    recordsReview: 0,
    recordsNew: 0,
    recordsError: 0,
    summary: {},
    startedAt: now,
    createdAt: now,
  }
  const { data, error } = await sb
    .from('carrier_sync_runs')
    .insert(objectToSnake(payload as unknown as Record<string, unknown>) as any)
    .select('*')
    .single()

  if (error) {
    if (isUniqueViolationOn(error, 'carrier_sync_runs_import_fingerprint_uidx')) {
      const raced = await findCarrierSyncRunByFingerprint(input.importFingerprint)
      if (raced) return { status: 'duplicate', run: raced }
    }
    throw new Error(`createCarrierSyncRunForImport: ${error.message}`)
  }
  return { status: 'created', run: objectToCamel(data) as unknown as CarrierSyncRun }
}

/**
 * Stages every already-matched row as a carrier_import_records row.
 * raw_payload is ALWAYS row.sanitizedRaw — the already-redacted value
 * produced by the provider mapper (NIB/IBAN stripped, medical keys
 * redacted) — never the original unsanitized row. Never touches
 * individual_clients/companies/policies.
 */
export async function stageCarrierImportRecords(
  runId: string,
  provider: CarrierProviderId,
  matches: StagedRowMatch[],
): Promise<void> {
  if (matches.length === 0) return
  const sb = getSupabaseAdmin()
  const now = new Date().toISOString()
  const payloads = matches.map((m) => ({
    id: crypto.randomUUID(),
    syncRunId: runId,
    provider,
    externalClientId: m.row.externalClientId,
    externalPolicyNumber: m.row.externalPolicyNumber,
    rawPayload: m.row.sanitizedRaw,
    customerMatchStatus: m.customerMatchStatus,
    policyMatchStatus: m.policyMatchStatus,
    matchedIndividualClientId: m.matchedIndividualClientId,
    matchedCompanyId: m.matchedCompanyId,
    matchedPolicyId: m.matchedPolicyId,
    customerMatchReason: m.customerMatchReason,
    policyMatchReason: m.policyMatchReason,
    decisionStatus: 'pending',
    createdAt: now,
    updatedAt: now,
  }))
  const { error } = await sb
    .from('carrier_import_records')
    .insert(payloads.map((p) => objectToSnake(p as unknown as Record<string, unknown>)) as any)
  if (error) throw new Error(`stageCarrierImportRecords: ${error.message}`)
}

export interface CarrierSyncRunCounts {
  recordsExactMatch: number
  recordsReview: number
  recordsNew: number
  recordsError: number
}

/** Marks the run completed (still mode='dry_run' — completed only means
 * "finished computing matches", never "imported into the CRM"). */
export async function finalizeCarrierSyncRunCounts(runId: string, counts: CarrierSyncRunCounts): Promise<void> {
  const sb = getSupabaseAdmin()
  const updates = {
    status: 'completed',
    records_exact_match: counts.recordsExactMatch,
    records_review: counts.recordsReview,
    records_new: counts.recordsNew,
    records_error: counts.recordsError,
    completed_at: new Date().toISOString(),
  }
  const { error } = await (sb.from('carrier_sync_runs') as any).update(updates).eq('id', runId)
  if (error) throw new Error(`finalizeCarrierSyncRunCounts: ${error.message}`)
}

/**
 * "Cancel import" (wrong insurer selected, etc.) — deletes the staging
 * run; carrier_import_records rows cascade automatically (ON DELETE
 * CASCADE on sync_run_id, already in the original CRM3 migration). Never
 * touches individual_clients/companies/policies — there was never
 * anything to undo there, since preview never writes to them.
 *
 * CRM3 Block 4: once ANY record in this run has apply_status='applied',
 * the run is an audit trail and must never be deleted (see requirement
 * "Cancel run blocked once any row applied"). Checked here in TypeScript
 * for a clear, friendly error AND enforced again at the database level
 * by the carrier_sync_runs_block_delete_if_applied trigger (see
 * migrations/20260831_crm3_apply_portfolio_import.sql) — belt and
 * suspenders, so this can never be bypassed by a future code path that
 * forgets this check.
 */
export async function deleteCarrierSyncRun(runId: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { count, error: countError } = await sb
    .from('carrier_import_records')
    .select('id', { count: 'exact', head: true })
    .eq('sync_run_id', runId)
    .eq('apply_status', 'applied')
  if (countError) throw new Error(`deleteCarrierSyncRun: ${countError.message}`)
  if ((count ?? 0) > 0) {
    throw new Error('deleteCarrierSyncRun: cannot cancel a run that already has applied records — the import run is now an audit trail')
  }

  const { error } = await sb.from('carrier_sync_runs').delete().eq('id', runId)
  if (error) throw new Error(`deleteCarrierSyncRun: ${error.message}`)
}

// ============================================================
// CRM3 Block 4 — Confirm & Apply Portfolio Import
//
// "Accepted" (decision_status) never implies any of this — every
// function below either resolves EXPLICIT apply actions onto a record
// (setCarrierImportRecordApplyActions) or applies a single already-
// resolved, already-accepted record via the atomic
// apply_carrier_import_record RPC (applyCarrierImportRecord). Nothing
// here ever infers a create/link/update from a match status alone. See
// migrations/20260831_crm3_apply_portfolio_import.sql for the full
// design rationale.
// ============================================================

export interface SetCarrierImportRecordApplyActionsInput {
  customerApplyAction: CustomerApplyAction
  policyApplyAction: PolicyApplyAction
  selectedIndividualClientId?: string | null
  selectedCompanyId?: string | null
  selectedPolicyId?: string | null
  approvedPolicyChanges?: Record<string, Json> | null
}

/**
 * Persists an Admin's explicit, resolved apply action for one record —
 * a separate step from Accept/Reject/Ignore (updateCarrierImportDecision
 * above), never triggered automatically by it. Validates the action
 * enum values server-side (never trusts a browser-supplied string
 * blindly — see isValidCustomerApplyAction/isValidPolicyApplyAction),
 * and pre-checks owner consistency for a selected existing policy
 * against a selected customer so a mismatch is rejected immediately
 * here rather than only surfacing later when the run is applied (the
 * apply RPC re-checks this again anyway, as the ultimate,
 * race-safe authority).
 */
export async function setCarrierImportRecordApplyActions(
  recordId: string,
  input: SetCarrierImportRecordApplyActionsInput,
): Promise<void> {
  if (!isValidCustomerApplyAction(input.customerApplyAction)) {
    throw new Error(`setCarrierImportRecordApplyActions: invalid customerApplyAction "${input.customerApplyAction}"`)
  }
  if (!isValidPolicyApplyAction(input.policyApplyAction)) {
    throw new Error(`setCarrierImportRecordApplyActions: invalid policyApplyAction "${input.policyApplyAction}"`)
  }
  if (input.selectedIndividualClientId && input.selectedCompanyId) {
    throw new Error('setCarrierImportRecordApplyActions: cannot select both an individual and a company for the same record')
  }

  const record = await getCarrierImportRecord(recordId)
  if (!record) throw new Error('setCarrierImportRecordApplyActions: record not found')
  if (record.decisionStatus !== 'accepted') {
    throw new Error('setCarrierImportRecordApplyActions: apply actions can only be resolved on an accepted record')
  }
  if (record.applyStatus === 'applied') {
    throw new Error('setCarrierImportRecordApplyActions: this record has already been applied and can no longer be changed')
  }

  if (
    (input.policyApplyAction === 'link_existing_policy' || input.policyApplyAction === 'update_existing_policy') &&
    input.selectedPolicyId
  ) {
    const policy = await getPolicy(input.selectedPolicyId)
    if (!policy) throw new Error('setCarrierImportRecordApplyActions: selected policy does not exist')
    const check = checkOwnerConsistency({
      policyApplyAction: input.policyApplyAction,
      selectedIndividualClientId: input.selectedIndividualClientId ?? null,
      selectedCompanyId: input.selectedCompanyId ?? null,
      policyOwnerIndividualClientId: policy.individualClientId,
      policyOwnerCompanyId: policy.companyId,
    })
    if (!check.consistent) throw new Error(`setCarrierImportRecordApplyActions: ${check.reason}`)
  }

  const sb = getSupabaseAdmin()
  const updates = objectToSnake({
    customerApplyAction: input.customerApplyAction,
    policyApplyAction: input.policyApplyAction,
    selectedIndividualClientId: input.selectedIndividualClientId ?? null,
    selectedCompanyId: input.selectedCompanyId ?? null,
    selectedPolicyId: input.selectedPolicyId ?? null,
    approvedPolicyChanges: input.approvedPolicyChanges ?? null,
    updatedAt: new Date().toISOString(),
  })
  const { error } = await (sb.from('carrier_import_records') as any).update(updates).eq('id', recordId)
  if (error) throw new Error(`setCarrierImportRecordApplyActions: ${error.message}`)
}

async function markCarrierImportRecordApplyFailed(recordId: string, message: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await (sb.from('carrier_import_records') as any)
    .update({ apply_status: 'failed', apply_error: message, updated_at: new Date().toISOString() })
    .eq('id', recordId)
  if (error) console.error('markCarrierImportRecordApplyFailed error:', error)
}

export interface ApplyCarrierImportRecordResult {
  recordId: string
  status: 'applied' | 'already_applied' | 'failed'
  individualClientId?: string
  companyId?: string
  policyId?: string
  externalClientIdentityCreated: boolean
  externalPolicyIdentityCreated: boolean
  error?: string
}

/**
 * Applies exactly one accepted, fully-resolved carrier_import_record via
 * the atomic apply_carrier_import_record RPC — one row, one Postgres
 * transaction (see the migration for the full rationale). Never called
 * for a row that isn't ready: isRowReadyToApply is checked again here as
 * a final guard (the same check the run-level readiness summary and
 * adminApplyCarrierSyncRun already use), so this function can never
 * silently apply an under-resolved row even if called directly.
 *
 * Re-derives the semantic ParsedImportRow fields needed for a *create*
 * action by re-running mapPortfolioRows against the record's own
 * already-persisted, already-sanitized raw_payload — see
 * carrier-apply-field-mapping.ts for why this is safe and preferred over
 * a second persisted semantic column.
 */
export async function applyCarrierImportRecord(recordId: string): Promise<ApplyCarrierImportRecordResult> {
  const record = await getCarrierImportRecord(recordId)
  if (!record) {
    return { recordId, status: 'failed', externalClientIdentityCreated: false, externalPolicyIdentityCreated: false, error: 'Record not found' }
  }

  if (record.applyStatus === 'applied') {
    return {
      recordId,
      status: 'already_applied',
      individualClientId: record.selectedIndividualClientId,
      companyId: record.selectedCompanyId,
      policyId: record.selectedPolicyId,
      externalClientIdentityCreated: false,
      externalPolicyIdentityCreated: false,
    }
  }

  const rowState: ApplyActionRowState = {
    decisionStatus: record.decisionStatus,
    customerApplyAction: record.customerApplyAction ?? null,
    policyApplyAction: record.policyApplyAction ?? null,
    selectedIndividualClientId: record.selectedIndividualClientId ?? null,
    selectedCompanyId: record.selectedCompanyId ?? null,
    selectedPolicyId: record.selectedPolicyId ?? null,
    approvedPolicyChanges: (record.approvedPolicyChanges as Record<string, unknown> | undefined) ?? null,
  }
  if (!isRowReadyToApply(rowState)) {
    const message = 'This record does not have a fully resolved apply action.'
    await markCarrierImportRecordApplyFailed(recordId, message)
    return { recordId, status: 'failed', externalClientIdentityCreated: false, externalPolicyIdentityCreated: false, error: message }
  }

  const needsMapping =
    record.customerApplyAction === 'create_individual' ||
    record.customerApplyAction === 'create_company' ||
    record.policyApplyAction === 'create_policy'

  let mappedRow: ParsedImportRow | undefined
  if (needsMapping) {
    const mapped = mapPortfolioRows(record.provider as CarrierProviderId, [record.rawPayload as Record<string, unknown>])
    mappedRow = mapped.recognized ? mapped.rows[0] : undefined
    if (!mappedRow) {
      const message = 'Could not re-derive the imported fields needed to create this record.'
      await markCarrierImportRecordApplyFailed(recordId, message)
      return { recordId, status: 'failed', externalClientIdentityCreated: false, externalPolicyIdentityCreated: false, error: message }
    }
  }

  let newIndividual: Record<string, unknown> | undefined
  let newCompany: Record<string, unknown> | undefined
  let newPolicy: Record<string, unknown> | undefined

  if (record.customerApplyAction === 'create_individual') {
    const result = mapParsedRowToNewIndividualFields(mappedRow!)
    if (!result.ok) {
      await markCarrierImportRecordApplyFailed(recordId, result.error)
      return { recordId, status: 'failed', externalClientIdentityCreated: false, externalPolicyIdentityCreated: false, error: result.error }
    }
    newIndividual = result.fields as unknown as Record<string, unknown>
  }
  if (record.customerApplyAction === 'create_company') {
    const result = mapParsedRowToNewCompanyFields(mappedRow!)
    if (!result.ok) {
      await markCarrierImportRecordApplyFailed(recordId, result.error)
      return { recordId, status: 'failed', externalClientIdentityCreated: false, externalPolicyIdentityCreated: false, error: result.error }
    }
    newCompany = result.fields as unknown as Record<string, unknown>
  }
  if (record.policyApplyAction === 'create_policy') {
    const insurer = CARRIER_PROVIDER_LABELS[record.provider as CarrierProviderId] ?? record.provider
    const result = mapParsedRowToNewPolicyFields(mappedRow!, insurer)
    if (!result.ok) {
      await markCarrierImportRecordApplyFailed(recordId, result.error)
      return { recordId, status: 'failed', externalClientIdentityCreated: false, externalPolicyIdentityCreated: false, error: result.error }
    }
    newPolicy = result.fields as unknown as Record<string, unknown>
  }

  // Precomputed here (never re-implemented in SQL) so the fallback
  // external-policy-identity matching key can never drift from the one
  // createExternalPolicyIdentity already uses — see the migration.
  const externalPolicyNumberNormalized = record.externalPolicyNumber
    ? normalizePolicyNumber(record.externalPolicyNumber, record.provider)
    : null

  const sb = getSupabaseAdmin()
  const { data, error } = await (sb.rpc as any)('apply_carrier_import_record', {
    p_record_id: recordId,
    p_new_individual: newIndividual ?? null,
    p_new_company: newCompany ?? null,
    p_new_policy: newPolicy ?? null,
    p_external_policy_number_normalized: externalPolicyNumberNormalized,
  }).single()

  if (error) {
    await markCarrierImportRecordApplyFailed(recordId, error.message)
    return { recordId, status: 'failed', externalClientIdentityCreated: false, externalPolicyIdentityCreated: false, error: error.message }
  }
  if (!data) {
    const message = 'apply_carrier_import_record returned no result'
    await markCarrierImportRecordApplyFailed(recordId, message)
    return { recordId, status: 'failed', externalClientIdentityCreated: false, externalPolicyIdentityCreated: false, error: message }
  }

  const row = data as {
    result_status: 'applied' | 'already_applied'
    individual_client_id: string | null
    company_id: string | null
    policy_id: string | null
    external_client_identity_created: boolean
    external_policy_identity_created: boolean
  }

  return {
    recordId,
    status: row.result_status,
    individualClientId: row.individual_client_id ?? undefined,
    companyId: row.company_id ?? undefined,
    policyId: row.policy_id ?? undefined,
    externalClientIdentityCreated: row.external_client_identity_created,
    externalPolicyIdentityCreated: row.external_policy_identity_created,
  }
}

export interface CarrierSyncRunApplyStateUpdate {
  applyStatus: CarrierRunApplyStatus
  applyStartedAt?: string
  appliedAt?: string
  appliedBy?: string
}

/** Run-level apply bookkeeping only — never touches provider/mode/status
 * or any of the existing dry-run counters (see PROVIDER IMMUTABLE tests
 * in carrier-portfolio-import-admin.test.ts, which this deliberately
 * does not violate). */
export async function updateCarrierSyncRunApplyState(runId: string, update: CarrierSyncRunApplyStateUpdate): Promise<void> {
  const sb = getSupabaseAdmin()
  const updates: Record<string, unknown> = { apply_status: update.applyStatus }
  if (update.applyStartedAt !== undefined) updates.apply_started_at = update.applyStartedAt
  if (update.appliedAt !== undefined) updates.applied_at = update.appliedAt
  if (update.appliedBy !== undefined) updates.applied_by = update.appliedBy
  const { error } = await (sb.from('carrier_sync_runs') as any).update(updates).eq('id', runId)
  if (error) throw new Error(`updateCarrierSyncRunApplyState: ${error.message}`)
}
