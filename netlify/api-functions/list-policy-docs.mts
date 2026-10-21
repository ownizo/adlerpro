import type { Config } from '@netlify/functions'
import { authorizePolicyRequest, supabase } from '../lib/policy-auth.mts'

// Files kept in the `documents` bucket for one policy. The folder is derived
// from the policy itself, never from the request, and only its owner (or
// agency staff) may list it.
export default async (req: Request) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { policyId } = body as { policyId?: unknown }
    if (!policyId || typeof policyId !== 'string') {
      return Response.json({ files: [] })
    }

    const { policy } = await authorizePolicyRequest(req, policyId)
    const prefix = `${policy.company_id || 'general'}/policies/${policy.id}`
    const { data: files, error } = await supabase.storage
      .from('documents')
      .list(prefix, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })

    if (error) {
      return Response.json({ files: [] })
    }

    const result = (files ?? [])
      .filter((f) => f.name !== '.emptyFolderPlaceholder')
      .map((f) => ({
        id: f.id ?? f.name,
        name: f.name,
        storagePath: `${prefix}/${f.name}`,
        size: (f.metadata as any)?.size ?? 0,
        mimeType: (f.metadata as any)?.mimetype ?? '',
        uploadedAt: f.created_at ?? '',
      }))

    return Response.json({ files: result })
  } catch (error: any) {
    if (error instanceof Response) return Response.json({ error: await error.text(), files: [] }, { status: error.status })
    console.error('list-policy-docs error:', error)
    return Response.json({ files: [] })
  }
}

export const config: Config = {
  path: '/api/list-policy-docs',
}
