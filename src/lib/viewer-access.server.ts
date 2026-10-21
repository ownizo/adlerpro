/**
 * Resolves which client record a signed-in user belongs to, and checks access
 * to files in the private `documents` bucket. Shared by the server functions
 * and the Netlify functions so both apply the same rule.
 *
 * Link order: the internal id set by the agency invitation (`auth_user_id`)
 * first; the account email only as a fallback, matched exactly (no wildcards),
 * only for a confirmed email and only for a record not already linked to
 * another account.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { classifyStoragePath, escapeLikePattern, ownsRecord, type ViewerLinks } from './storage-access.ts'

export type { ViewerLinks }

export function isAdminUser(user: Pick<User, 'app_metadata'>): boolean {
  const roles = user.app_metadata?.roles
  return Array.isArray(roles) && roles.includes('admin')
}

async function linkedId(
  sb: SupabaseClient,
  table: 'company_users' | 'individual_clients',
  column: 'company_id' | 'id',
  user: Pick<User, 'id' | 'email' | 'email_confirmed_at'>,
): Promise<string | null> {
  const byId = await sb.from(table).select(column).eq('auth_user_id', user.id).limit(1).maybeSingle()
  const idRow = byId.data as Record<string, string> | null
  if (idRow?.[column]) return idRow[column]

  if (!user.email || !user.email_confirmed_at) return null
  const byEmail = await sb
    .from(table)
    .select(column === 'id' ? 'id' : 'id, company_id')
    .ilike('email', escapeLikePattern(user.email.trim()))
    .is('auth_user_id', null)
    .limit(2)
  const rows = (byEmail.data ?? []) as unknown as Record<string, string>[]
  // Two records with the same email: ambiguous, never guess.
  if (rows.length !== 1) return null

  // First sign-in by email: store the internal id so later sign-ins no
  // longer depend on the email. The `is null` guard keeps a concurrent
  // link by another account from being overwritten.
  const { error } = await sb.from(table).update({ auth_user_id: user.id }).eq('id', rows[0].id).is('auth_user_id', null)
  if (error) console.error(`link ${table}.auth_user_id:`, error.message)
  return rows[0][column] ?? null
}

export async function resolveViewerLinks(
  sb: SupabaseClient,
  user: Pick<User, 'id' | 'email' | 'email_confirmed_at' | 'app_metadata'>,
): Promise<ViewerLinks> {
  if (isAdminUser(user)) return { isAdmin: true, companyId: null, individualClientId: null }
  const [companyId, individualClientId] = await Promise.all([
    linkedId(sb, 'company_users', 'company_id', user),
    linkedId(sb, 'individual_clients', 'id', user),
  ])
  return { isAdmin: false, companyId, individualClientId }
}

/** True when the viewer may read (or write to) this path of the `documents` bucket. */
export async function canAccessStoragePath(sb: SupabaseClient, links: ViewerLinks, path: unknown): Promise<boolean> {
  const target = classifyStoragePath(path)
  if (!target) return false
  if (links.isAdmin) return true

  switch (target.kind) {
    case 'policy': {
      const { data } = await sb.from('policies').select('company_id, individual_client_id').eq('id', target.policyId).maybeSingle()
      return ownsRecord(links, data)
    }
    case 'claim': {
      const { data } = await sb.from('claims').select('company_id, individual_client_id').eq('id', target.claimId).maybeSingle()
      return ownsRecord(links, data)
    }
    case 'individual':
      return Boolean(links.individualClientId && target.individualClientId === links.individualClientId)
    case 'other': {
      const { data } = await sb.from('documents').select('company_id, individual_client_id').eq('storage_path', path as string).limit(1).maybeSingle()
      return ownsRecord(links, data)
    }
  }
}
