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

export interface PromoteIndividualClientToCompanyRelationsResult {
  policies: number
  claims: number
  documents: number
  clientNotes: number
  clientTasks: number
  salesOpportunities: number
  websiteLeads: number
}

/**
 * Re-parenta TUDO o que pertence a um individual_client para uma company e
 * só depois apaga o individual_client — atomicamente, dentro da mesma
 * transação implícita de uma única chamada RPC (ver
 * promote_individual_client_to_company_relations em
 * migrations/20260830_fix_promote_client_to_company.sql). Se qualquer passo
 * falhar, o Postgres reverte tudo — nunca fica uma promoção parcial.
 *
 * NÃO usar deleteIndividualClientRelations aqui: essa função apaga
 * definitivamente claims/policies (e as suas dependências), o que é o
 * comportamento certo para "apagar cliente" mas destruiria o histórico de
 * CRM (claims, notas, tarefas, oportunidades, website leads) numa promoção,
 * que é uma operação de re-parenting, não de delete — ver bug corrigido
 * nesta migration.
 */
export async function promoteIndividualClientToCompanyRelations(
  clientId: string,
  companyId: string,
): Promise<PromoteIndividualClientToCompanyRelationsResult> {
  const sb = getSupabaseAdmin()
  const { data, error } = await (sb.rpc as any)('promote_individual_client_to_company_relations', {
    p_client_id: clientId,
    p_company_id: companyId,
  }).single()
  if (error) throw new Error(`promoteIndividualClientToCompanyRelations: ${error.message}`)
  if (!data) throw new Error('promoteIndividualClientToCompanyRelations: sem resultado da RPC')
  const row = data as {
    policies: number
    claims: number
    documents: number
    client_notes: number
    client_tasks: number
    sales_opportunities: number
    website_leads: number
  }
  return {
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
