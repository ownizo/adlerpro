/**
 * Who may read or write a file in the private `documents` bucket.
 *
 * Every endpoint that hands out a signed URL, lists a folder or accepts an
 * upload path classifies the path here first and then checks that the file
 * belongs to the signed-in client. A path that cannot be tied to a policy,
 * claim or client the viewer owns is refused (agency staff excepted).
 *
 * Pure functions only, so they can be unit tested without Supabase.
 */

export type StorageTarget =
  | { kind: 'policy'; policyId: string }
  | { kind: 'claim'; claimId: string }
  | { kind: 'individual'; individualClientId: string }
  | { kind: 'other' }

/**
 * Classifies a storage path by the record it belongs to. Returns null for a
 * path that must never be served (empty, absolute, traversal, empty segment).
 *
 * Known layouts:
 *   {companyId|general}/policies/{policyId}/{file}
 *   {companyId|general}/claims/{claimId}/{file}   and   claims/{claimId}/{file}
 *   individual/{individualClientId}/{file}
 */
export function classifyStoragePath(path: unknown): StorageTarget | null {
  if (typeof path !== 'string' || !path || path.length > 1024) return null
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) return null
  const parts = path.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null

  for (const i of [0, 1]) {
    if (parts.length < i + 3) continue
    if (parts[i] === 'policies') return { kind: 'policy', policyId: parts[i + 1] }
    if (parts[i] === 'claims') return { kind: 'claim', claimId: parts[i + 1] }
  }
  if (parts[0] === 'individual' && parts.length >= 3) return { kind: 'individual', individualClientId: parts[1] }
  return { kind: 'other' }
}

/** Escapes `%`, `_` and `\` so a value can be used in ILIKE as an exact, case-insensitive match. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export interface ViewerLinks {
  isAdmin: boolean
  companyId: string | null
  individualClientId: string | null
}

export interface OwnedRecord {
  company_id?: string | null
  individual_client_id?: string | null
}

/** True when the record belongs to the viewer's company or to the viewer as a personal client. */
export function ownsRecord(links: ViewerLinks, record: OwnedRecord | null | undefined): boolean {
  if (!record) return false
  if (links.companyId && record.company_id && record.company_id === links.companyId) return true
  if (links.individualClientId && record.individual_client_id && record.individual_client_id === links.individualClientId) return true
  return false
}
