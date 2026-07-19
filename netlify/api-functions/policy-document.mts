import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { and, eq } from 'drizzle-orm'
import { netlifyDb } from '../../db/index.ts'
import { policyDocuments } from '../../db/schema.ts'
import { authorizePolicyRequest } from '../lib/policy-auth.mts'

const MAX_FILE_SIZE = 15 * 1024 * 1024
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-180) || 'documento'
}

export default async (req: Request) => {
  try {
    const store = getStore({ name: 'policy-documents', consistency: 'strong' })

    if (req.method === 'POST') {
      const formData = await req.formData()
      const policyId = String(formData.get('policyId') || '')
      const file = formData.get('file')
      if (!policyId || !(file instanceof File)) {
        return Response.json({ error: 'Apólice e documento são obrigatórios.' }, { status: 400 })
      }
      if (!ALLOWED_TYPES.has(file.type) || file.size > MAX_FILE_SIZE) {
        return Response.json({ error: 'Use PDF, JPG, PNG ou WEBP até 15 MB.' }, { status: 400 })
      }

      const { user, policy } = await authorizePolicyRequest(req, policyId)
      const id = crypto.randomUUID()
      const blobKey = `policies/${policyId}/${id}/${safeFileName(file.name)}`
      await store.set(blobKey, await file.arrayBuffer(), {
        metadata: { fileName: file.name, contentType: file.type },
      })

      try {
        await netlifyDb.insert(policyDocuments).values({
          id,
          policyId,
          companyId: policy.company_id,
          individualClientId: policy.individual_client_id,
          uploadedByUserId: user.id,
          blobKey,
          fileName: file.name,
          contentType: file.type,
          size: file.size,
        })
      } catch (error) {
        await store.delete(blobKey)
        throw error
      }

      return Response.json({ id, name: file.name }, { status: 201 })
    }

    const url = new URL(req.url)
    const documentId = url.searchParams.get('documentId') || ''
    if (!documentId) return new Response('Documento em falta', { status: 400 })

    const [document] = await netlifyDb
      .select()
      .from(policyDocuments)
      .where(eq(policyDocuments.id, documentId))
      .limit(1)
    if (!document) return new Response('Documento não encontrado', { status: 404 })

    await authorizePolicyRequest(req, document.policyId)

    if (req.method === 'DELETE') {
      await store.delete(document.blobKey)
      await netlifyDb
        .delete(policyDocuments)
        .where(and(eq(policyDocuments.id, document.id), eq(policyDocuments.policyId, document.policyId)))
      return Response.json({ success: true })
    }

    if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })

    const blob = await store.get(document.blobKey, { type: 'arrayBuffer' })
    if (!blob) return new Response('Documento não encontrado', { status: 404 })
    const dispositionName = document.fileName.replace(/["\r\n]/g, '_')
    return new Response(blob, {
      headers: {
        'Content-Type': document.contentType,
        'Content-Length': String(document.size),
        'Content-Disposition': `inline; filename="${dispositionName}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    if (error instanceof Response) return error
    console.error('[policy-document]', error)
    return Response.json({ error: 'Não foi possível processar o documento.' }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/policy-document',
}
