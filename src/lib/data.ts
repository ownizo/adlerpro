/**
 * data.ts — Camada de acesso a dados via Supabase
 * Substitui o Netlify Blobs por Supabase PostgreSQL.
 * Converte automaticamente entre camelCase (TypeScript) e snake_case (Supabase).
 */
import type {
  Company,
  CompanyUser,
  Policy,
  Claim,
  Document,
  Alert,
  RiskReport,
  ApiConnection,
  UserMetricEvent,
  IndividualClient,
  SocialPost,
} from './types'
import { supabaseAdmin } from './supabase-admin'

// ============================================================
// Cliente Supabase (server-side — usa service_role key)
// Reutiliza o cliente admin partilhado
// ============================================================
type JsonObject = Record<string, unknown>

function getSupabaseAdmin() {
  return supabaseAdmin
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

function objectToSnake(obj: JsonObject): JsonObject {
  const result: JsonObject = {}
  for (const [k, v] of Object.entries(obj)) {
    result[toSnake(k)] = v
  }
  return result
}

function objectToCamel(obj: JsonObject): JsonObject {
  const result: JsonObject = {}
  for (const [k, v] of Object.entries(obj)) {
    result[toCamel(k)] = v
  }
  return result
}

function toDbPayload(value: unknown): JsonObject {
  return objectToSnake(value as JsonObject)
}

function rowToCamel<T>(row: unknown): T {
  return objectToCamel(row as JsonObject) as unknown as T
}

function rowsToCamel<T>(rows: unknown[]): T[] {
  return rows.map((row) => rowToCamel<T>(row))
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
  if (error || !data) return undefined
  return rowToCamel<Company>(data)
}

export async function createCompany(company: Company): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('companies').insert(toDbPayload(company))
  if (error) console.error('createCompany error:', error)
}

export async function updateCompany(id: string, updates: Partial<Company>): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('companies').update(toDbPayload(updates)).eq('id', id)
  if (error) console.error('updateCompany error:', error)
}

export async function deleteCompany(id: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('companies').delete().eq('id', id)
  if (error) console.error('deleteCompany error:', error)
}

export async function deleteCompanyRelations(companyId: string): Promise<void> {
  const sb = getSupabaseAdmin()
  await Promise.all([
    sb.from('policies').delete().eq('company_id', companyId),
    sb.from('claims').delete().eq('company_id', companyId),
    sb.from('documents').delete().eq('company_id', companyId),
    sb.from('alerts').delete().eq('company_id', companyId),
    sb.from('risk_reports').delete().eq('company_id', companyId),
    sb.from('company_users').delete().eq('company_id', companyId),
    sb.from('user_metric_events').delete().eq('company_id', companyId),
  ])
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
  if (error || !data) return undefined
  return rowToCamel<CompanyUser>(data)
}

export async function createCompanyUser(user: CompanyUser): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('company_users').insert(toDbPayload(user))
  if (error) console.error('createCompanyUser error:', error)
}

export async function updateCompanyUser(id: string, updates: Partial<CompanyUser>): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('company_users').update(toDbPayload(updates)).eq('id', id)
  if (error) console.error('updateCompanyUser error:', error)
}

export async function deleteCompanyUser(id: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('company_users').delete().eq('id', id)
  if (error) console.error('deleteCompanyUser error:', error)
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
  if (error || !data) return undefined
  return rowToCamel<Policy>(data)
}

export async function createPolicy(policy: Policy): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('policies').insert(toDbPayload(policy))
  if (error) console.error('createPolicy error:', error)
}

export async function updatePolicy(id: string, updates: Partial<Policy>): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('policies').update(toDbPayload(updates)).eq('id', id)
  if (error) console.error('updatePolicy error:', error)
}

export async function deletePolicy(id: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('policies').delete().eq('id', id)
  if (error) console.error('deletePolicy error:', error)
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

export async function getClaim(id: string): Promise<Claim | undefined> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('claims').select('*').eq('id', id).single()
  if (error || !data) return undefined
  return rowToCamel<Claim>(data)
}

export async function createClaim(claim: Claim): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('claims').insert(toDbPayload(claim))
  if (error) console.error('createClaim error:', error)
}

export async function updateClaim(id: string, updates: Partial<Claim>): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('claims').update(toDbPayload(updates)).eq('id', id)
  if (error) console.error('updateClaim error:', error)
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
  const { error } = await sb.from('documents').insert(toDbPayload(doc))
  if (error) console.error('createDocument error:', error)
}

export async function updateDocument(id: string, updates: Partial<Document>): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('documents').update(toDbPayload(updates)).eq('id', id)
  if (error) console.error('updateDocument error:', error)
}

export async function deleteDocument(id: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('documents').delete().eq('id', id)
  if (error) console.error('deleteDocument error:', error)
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
  const { error } = await sb.from('risk_reports').insert(toDbPayload(report))
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
  const { error } = await sb.from('api_connections').update(toDbPayload(updates)).eq('id', id)
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
  const { error } = await sb.from('user_metric_events').insert(toDbPayload(event))
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

export async function createIndividualClient(client: Omit<IndividualClient, 'id' | 'createdAt'>): Promise<{ id: string }> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('individual_clients')
    .insert(toDbPayload(client))
    .select('id')
    .single()
  if (error) throw error
  const idValue = data && typeof data === 'object' && 'id' in data ? (data as { id?: unknown }).id : undefined
  if (typeof idValue !== 'string') throw new Error('Invalid individual_clients insert response')
  return { id: idValue }
}

export async function updateIndividualClient(id: string, updates: Partial<IndividualClient>): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb
    .from('individual_clients')
    .update(toDbPayload(updates))
    .eq('id', id)
  if (error) console.error('updateIndividualClient error:', error)
}

export async function deleteIndividualClient(id: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('individual_clients').delete().eq('id', id)
  if (error) console.error('deleteIndividualClient error:', error)
}

// ============================================================
// Social Posts
// ============================================================
export async function getSocialPosts(): Promise<SocialPost[]> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('social_posts').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return rowsToCamel<SocialPost>(data ?? [])
}

export async function createSocialPost(post: SocialPost): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('social_posts').insert(toDbPayload(post))
  if (error) console.error('createSocialPost error:', error)
}

export async function updateSocialPost(id: string, updates: Partial<SocialPost>): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('social_posts').update(toDbPayload(updates)).eq('id', id)
  if (error) console.error('updateSocialPost error:', error)
}

export async function deleteSocialPost(id: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('social_posts').delete().eq('id', id)
  if (error) console.error('deleteSocialPost error:', error)
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
