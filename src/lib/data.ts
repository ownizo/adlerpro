import { getStore } from '@netlify/blobs'
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
} from './types'
import {
  getSeedCompanies,
  getSeedCompanyUsers,
  getSeedPolicies,
  getSeedClaims,
  getSeedDocuments,
  getSeedAlerts,
  getSeedRiskReports,
  getSeedApiConnections,
  getSeedUserMetricEvents,
} from './seed-data'

function store() {
  return getStore({ name: 'portal-data', consistency: 'strong' })
}

const COLLECTION_SEEDS: Array<{ key: string; seed: () => unknown[] }> = [
  { key: 'companies', seed: getSeedCompanies },
  { key: 'company-users', seed: getSeedCompanyUsers },
  { key: 'policies', seed: getSeedPolicies },
  { key: 'claims', seed: getSeedClaims },
  { key: 'documents', seed: getSeedDocuments },
  { key: 'alerts', seed: getSeedAlerts },
  { key: 'risk-reports', seed: getSeedRiskReports },
  { key: 'api-connections', seed: getSeedApiConnections },
  { key: 'user-metric-events', seed: getSeedUserMetricEvents },
]

async function ensureSeeded() {
  const s = store()
  const marker = await s.get('_seeded', { type: 'text' })
  if (marker) {
    const existing = await Promise.all(
      COLLECTION_SEEDS.map((entry) => s.get(entry.key, { type: 'json' }))
    )

    const missingWrites = existing.flatMap((value, index) => {
      if (value !== null) return []
      const { key, seed } = COLLECTION_SEEDS[index]
      return [s.setJSON(key, seed())]
    })

    if (missingWrites.length) {
      await Promise.all(missingWrites)
    }
    return
  }

  const companies = getSeedCompanies()
  const policies = getSeedPolicies()
  const claims = getSeedClaims()
  const documents = getSeedDocuments()
  const alerts = getSeedAlerts()
  const reports = getSeedRiskReports()
  const companyUsers = getSeedCompanyUsers()
  const apiConnections = getSeedApiConnections()
  const userMetricEvents = getSeedUserMetricEvents()

  await s.setJSON('companies', companies)
  await s.setJSON('company-users', companyUsers)
  await s.setJSON('policies', policies)
  await s.setJSON('claims', claims)
  await s.setJSON('documents', documents)
  await s.setJSON('alerts', alerts)
  await s.setJSON('risk-reports', reports)
  await s.setJSON('api-connections', apiConnections)
  await s.setJSON('user-metric-events', userMetricEvents)
  await s.set('_seeded', 'true')
}

async function getCollection<T>(key: string): Promise<T[]> {
  await ensureSeeded()
  const data = await store().get(key, { type: 'json' })
  return (data as T[]) ?? []
}

async function setCollection<T>(key: string, data: T[]): Promise<void> {
  await store().setJSON(key, data)
}

// Companies
export async function getCompanies(): Promise<Company[]> {
  return getCollection<Company>('companies')
}

export async function getCompany(id: string): Promise<Company | undefined> {
  const companies = await getCompanies()
  return companies.find((c) => c.id === id)
}

export async function createCompany(company: Company): Promise<void> {
  const companies = await getCompanies()
  companies.push(company)
  await setCollection('companies', companies)
}

export async function updateCompany(id: string, updates: Partial<Company>): Promise<void> {
  const companies = await getCompanies()
  const idx = companies.findIndex((c) => c.id === id)
  if (idx >= 0) {
    companies[idx] = { ...companies[idx], ...updates }
    await setCollection('companies', companies)
  }
}

export async function deleteCompany(id: string): Promise<void> {
  const companies = await getCompanies()
  await setCollection(
    'companies',
    companies.filter((company) => company.id !== id)
  )
}

export async function deleteCompanyRelations(companyId: string): Promise<void> {
  const [policies, claims, documents, alerts, reports, users, events] = await Promise.all([
    getCollection<Policy>('policies'),
    getCollection<Claim>('claims'),
    getCollection<Document>('documents'),
    getCollection<Alert>('alerts'),
    getCollection<RiskReport>('risk-reports'),
    getCollection<CompanyUser>('company-users'),
    getCollection<UserMetricEvent>('user-metric-events'),
  ])

  await Promise.all([
    setCollection(
      'policies',
      policies.filter((item) => item.companyId !== companyId)
    ),
    setCollection(
      'claims',
      claims.filter((item) => item.companyId !== companyId)
    ),
    setCollection(
      'documents',
      documents.filter((item) => item.companyId !== companyId)
    ),
    setCollection(
      'alerts',
      alerts.filter((item) => item.companyId !== companyId)
    ),
    setCollection(
      'risk-reports',
      reports.filter((item) => item.companyId !== companyId)
    ),
    setCollection(
      'company-users',
      users.filter((item) => item.companyId !== companyId)
    ),
    setCollection(
      'user-metric-events',
      events.filter((item) => item.companyId !== companyId)
    ),
  ])
}

// Company users
export async function getCompanyUsers(companyId?: string): Promise<CompanyUser[]> {
  const users = await getCollection<CompanyUser>('company-users')
  if (companyId) return users.filter((u) => u.companyId === companyId)
  return users
}

export async function getCompanyUserByEmail(email: string): Promise<CompanyUser | undefined> {
  const users = await getCompanyUsers()
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase())
}

export async function createCompanyUser(user: CompanyUser): Promise<void> {
  const users = await getCompanyUsers()
  users.push(user)
  await setCollection('company-users', users)
}

export async function updateCompanyUser(id: string, updates: Partial<CompanyUser>): Promise<void> {
  const users = await getCompanyUsers()
  const idx = users.findIndex((u) => u.id === id)
  if (idx >= 0) {
    users[idx] = { ...users[idx], ...updates }
    await setCollection('company-users', users)
  }
}

export async function deleteCompanyUser(id: string): Promise<void> {
  const users = await getCompanyUsers()
  await setCollection(
    'company-users',
    users.filter((user) => user.id !== id)
  )
}

// Policies
export async function getPolicies(companyId?: string): Promise<Policy[]> {
  const policies = await getCollection<Policy>('policies')
  if (companyId) return policies.filter((p) => p.companyId === companyId)
  return policies
}

export async function getPolicy(id: string): Promise<Policy | undefined> {
  const policies = await getCollection<Policy>('policies')
  return policies.find((p) => p.id === id)
}

export async function createPolicy(policy: Policy): Promise<void> {
  const policies = await getCollection<Policy>('policies')
  policies.push(policy)
  await setCollection('policies', policies)
}

export async function updatePolicy(id: string, updates: Partial<Policy>): Promise<void> {
  const policies = await getCollection<Policy>('policies')
  const idx = policies.findIndex((p) => p.id === id)
  if (idx >= 0) {
    policies[idx] = { ...policies[idx], ...updates }
    await setCollection('policies', policies)
  }
}

// Claims
export async function getClaims(companyId?: string): Promise<Claim[]> {
  const claims = await getCollection<Claim>('claims')
  if (companyId) return claims.filter((c) => c.companyId === companyId)
  return claims
}

export async function getClaim(id: string): Promise<Claim | undefined> {
  const claims = await getCollection<Claim>('claims')
  return claims.find((c) => c.id === id)
}

export async function createClaim(claim: Claim): Promise<void> {
  const claims = await getCollection<Claim>('claims')
  claims.push(claim)
  await setCollection('claims', claims)
}

export async function updateClaim(id: string, updates: Partial<Claim>): Promise<void> {
  const claims = await getCollection<Claim>('claims')
  const idx = claims.findIndex((c) => c.id === id)
  if (idx >= 0) {
    claims[idx] = { ...claims[idx], ...updates }
    await setCollection('claims', claims)
  }
}

// Documents
export async function getDocuments(companyId?: string): Promise<Document[]> {
  const documents = await getCollection<Document>('documents')
  if (companyId) return documents.filter((d) => d.companyId === companyId)
  return documents
}

export async function createDocument(doc: Document): Promise<void> {
  const documents = await getCollection<Document>('documents')
  documents.push(doc)
  await setCollection('documents', documents)
}

export async function deleteDocument(id: string): Promise<void> {
  const documents = await getCollection<Document>('documents')
  await setCollection(
    'documents',
    documents.filter((d) => d.id !== id)
  )
}

// Alerts
export async function getAlerts(companyId?: string): Promise<Alert[]> {
  const alerts = await getCollection<Alert>('alerts')
  if (companyId) return alerts.filter((a) => a.companyId === companyId)
  return alerts
}

export async function markAlertRead(id: string): Promise<void> {
  const alerts = await getCollection<Alert>('alerts')
  const idx = alerts.findIndex((a) => a.id === id)
  if (idx >= 0) {
    alerts[idx].read = true
    await setCollection('alerts', alerts)
  }
}

export async function clearAlerts(): Promise<void> {
  await setCollection('alerts', [])
}

export async function clearAlertsForCompany(companyId: string): Promise<void> {
  const alerts = await getCollection<Alert>('alerts')
  await setCollection(
    'alerts',
    alerts.filter((alert) => alert.companyId !== companyId)
  )
}

// Risk Reports
export async function getRiskReports(companyId?: string): Promise<RiskReport[]> {
  const reports = await getCollection<RiskReport>('risk-reports')
  if (companyId) return reports.filter((r) => r.companyId === companyId)
  return reports
}

export async function createRiskReport(report: RiskReport): Promise<void> {
  const reports = await getCollection<RiskReport>('risk-reports')
  reports.push(report)
  await setCollection('risk-reports', reports)
}

// File storage
export function fileStore() {
  return getStore('portal-files')
}

export async function deletePolicy(id: string): Promise<void> {
  const policies = await getCollection<Policy>('policies')
  const index = policies.findIndex((p) => p.id === id)
  if (index !== -1) {
    policies.splice(index, 1)
    await setCollection('policies', policies)
  }
}

// User metrics and history
export async function getUserMetricEvents(companyId?: string): Promise<UserMetricEvent[]> {
  const events = await getCollection<UserMetricEvent>('user-metric-events')
  if (companyId) return events.filter((e) => e.companyId === companyId)
  return events
}

export async function createUserMetricEvent(event: UserMetricEvent): Promise<void> {
  const events = await getUserMetricEvents()
  events.push(event)
  await setCollection('user-metric-events', events)
}

// API connections
export async function getApiConnections(): Promise<ApiConnection[]> {
  return getCollection<ApiConnection>('api-connections')
}

export async function updateApiConnection(id: string, updates: Partial<ApiConnection>): Promise<void> {
  const connections = await getApiConnections()
  const idx = connections.findIndex((conn) => conn.id === id)
  if (idx >= 0) {
    connections[idx] = { ...connections[idx], ...updates }
    await setCollection('api-connections', connections)
  }
}
