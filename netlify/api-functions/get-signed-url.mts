import type { Config } from '@netlify/functions'
import { authorizeStoragePath, supabase } from '../lib/policy-auth.mts'

// Short-lived link to one file of the private `documents` bucket. Only the
// client the file belongs to (or agency staff) gets a link.
export default async (req: Request) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { path } = body as { path?: unknown }

    if (!path || typeof path !== 'string') {
      return Response.json({ error: 'path é obrigatório' }, { status: 400 })
    }

    await authorizeStoragePath(req, path)

    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(path, 600)

    if (error) {
      console.error('get-signed-url error:', error.message)
      return Response.json({ error: 'Erro ao gerar URL' }, { status: 500 })
    }

    return Response.json({ url: data.signedUrl })
  } catch (error: any) {
    if (error instanceof Response) return Response.json({ error: await error.text() }, { status: error.status })
    console.error('get-signed-url error:', error)
    return Response.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/get-signed-url',
}
