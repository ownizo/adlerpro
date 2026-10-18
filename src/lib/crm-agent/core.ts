// Shared helpers for the Claude ↔ CRM connector (MCP server at /api/mcp).
// Server-only: uses the Supabase service role.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function sb(): SupabaseClient {
  if (client) return client
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !key) throw new Error('Supabase is not configured on the server')
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return client
}

export async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Buffer.from(digest).toString('hex')
}

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function pkceS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(digest)
}

const TZ = 'Europe/Lisbon'

/** YYYY-MM-DD in Lisbon for `d` (default now). */
export function lisbonDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export function addDays(date: string, days: number): string {
  const [y, m, dd] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, dd))
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}

export function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/** Strip characters that would break a PostgREST `or=(...)` filter. */
export function cleanSearch(q: string): string {
  return q.replace(/[,()*%\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function normalizePolicyNumber(n: string): string {
  return n.replace(/\s+/g, '').replace(/^0+(?=\d)/, '').toUpperCase()
}

export async function logActivity(actor: string, action: string, entity: string | null, entityId: string | null, summary: string) {
  try {
    await sb().from('crm_activity').insert({ actor, action, entity, entity_id: entityId, summary: summary.slice(0, 500) })
  } catch {
    // activity log is best-effort
  }
}

export class ToolError extends Error {}
