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
} from './types'

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
