import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getUser } from '@netlify/identity'

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const identityUser = await getUser()
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const usersStore = getStore({ name: 'portal-data', consistency: 'strong' })
    const companyUsers = (await usersStore.get('company-users', { type: 'json' })) as Array<{ id: string; email: string; companyId: string }> | null
    const companyUser = companyUsers?.find((u) => u.email.toLowerCase() === identityUser?.email?.toLowerCase())

    const companyId = (formData.get('companyId') as string) || companyUser?.companyId || 'comp_001'
    const category = formData.get('category') as string || 'other'

    if (!file) {
      return Response.json({ error: 'Ficheiro não fornecido' }, { status: 400 })
    }

    const fileStore = getStore('portal-files')
    const blobKey = `documents/${companyId}/doc_${Date.now()}_${file.name}`

    const buffer = await file.arrayBuffer()
    await fileStore.set(blobKey, buffer)

    // Add document metadata
    const dataStore = usersStore
    const documents = (await dataStore.get('documents', { type: 'json' })) as any[] || []
    const now = new Date().toISOString()
    const newDoc = {
      id: `doc_${Date.now()}`,
      companyId,
      name: file.name,
      category,
      size: file.size,
      uploadedBy: identityUser?.email || 'Utilizador',
      uploadedAt: now,
      blobKey,
    }
    documents.push(newDoc)
    await dataStore.setJSON('documents', documents)

    if (companyUser) {
      const events = (await dataStore.get('user-metric-events', { type: 'json' })) as any[] || []
      events.push({
        id: `evt_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
        companyId,
        userId: companyUser.id,
        timestamp: now,
        type: 'document_upload',
        description: `Upload do documento ${file.name}`,
      })
      await dataStore.setJSON('user-metric-events', events)
    }

    return Response.json({ document: newDoc })
  } catch (error: any) {
    console.error('Upload error:', error)
    return Response.json({ error: 'Erro ao carregar ficheiro' }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/upload',
}
