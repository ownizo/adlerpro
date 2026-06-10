// Capacitor build: implements the same function signatures as the server
// functions but calls Netlify Functions via HTTPS using the Bearer token from
// the Supabase session. The service_role key never enters this bundle.
import { supabase } from '@/lib/supabase'
import { apiUrl } from '@/lib/api-base'
import type { Claim, ClaimOperationalData } from '@/lib/types'

async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

async function apiFetch<T = unknown>(path: string, body: object = {}): Promise<T> {
  const token = await getAuthToken()
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>
    throw new Error((err['error'] as string | undefined) ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ── Server-function equivalents ───────────────────────────────────────────────

export async function fetchIndividualClaims(): Promise<Claim[]> {
  return apiFetch<Claim[]>('/api/one/claims')
}

export async function submitIndividualClaim(args: {
  data: { policyId: string; title: string; description: string; incidentDate: string; estimatedValue?: number }
}): Promise<{ id: string; reused: boolean }> {
  return apiFetch('/api/one/submit-claim', args.data)
}

export async function fetchClaimWorkspace(args: {
  data: { claimId: string }
}): Promise<{ operations: ClaimOperationalData }> {
  return apiFetch('/api/one/claim-workspace', { claimId: args.data.claimId })
}

export async function addClaimMessage(args: {
  data: { claimId: string; body: string }
}): Promise<{ success: boolean }> {
  return apiFetch('/api/one/add-message', args.data)
}

export async function registerClaimDocument(args: {
  data: { claimId: string; name: string; contentType?: string; mimeType?: string; storagePath: string; size: number }
}): Promise<{ success: boolean }> {
  return apiFetch('/api/one/register-document', args.data)
}

export async function getClaimDocumentUrl(args: {
  data: { claimId?: string; documentId: string }
}): Promise<{ url: string; name: string }> {
  return apiFetch('/api/one/document-url', args.data)
}

export async function getStorageUploadUrl(args: {
  data: { storagePath: string }
}): Promise<{ token: string; path: string }> {
  return apiFetch('/api/one/upload-url', { storagePath: args.data.storagePath })
}

export async function clientClearMustChangePassword(): Promise<{ success: true }> {
  return apiFetch('/api/one/clear-password')
}
