import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { authorizeAdminRequest } from '../lib/policy-auth.mts'

// Legacy file store (Netlify Blobs "portal-files"). Keys carry no owner, so
// only agency staff may read from it.

export default async (req: Request) => {
  try {
    await authorizeAdminRequest(req)
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }

  const url = new URL(req.url)
  const key = url.searchParams.get('key')

  if (!key) {
    return new Response('Missing key', { status: 400 })
  }

  const store = getStore('portal-files')
  const blob = await store.getWithMetadata(key, { type: 'arrayBuffer' })

  if (!blob || !blob.data) {
    return new Response('Document not found', { status: 404 })
  }

  const metadata = blob.metadata || {}
  const contentType = (metadata.contentType as string) || 'application/octet-stream'
  const fileName = (metadata.fileName as string) || key

  return new Response(blob.data, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${fileName.replace(/["\r\n]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
    }
  })
}

export const config: Config = {
  path: '/api/download-document',
}
