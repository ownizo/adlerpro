import type { Config } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json({ error: 'Configuração do servidor em falta.' }, { status: 500 })
  }

  let body: { user_id?: string; terms_version?: string } = {}
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Payload inválido.' }, { status: 400 })
  }

  const { user_id, terms_version } = body
  if (!user_id || !terms_version) {
    return Response.json({ error: 'user_id e terms_version são obrigatórios.' }, { status: 400 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Verificar que o utilizador existe no Supabase Auth antes de inserir
  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(user_id)
  if (userError || !userData?.user) {
    return Response.json({ error: 'Utilizador não encontrado.' }, { status: 404 })
  }

  const ip_address = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const user_agent = req.headers.get('user-agent') ?? null

  const { error: insertError } = await supabase.from('user_terms_acceptance').insert({
    user_id,
    terms_version,
    accepted_at: new Date().toISOString(),
    ip_address,
    user_agent,
  })

  if (insertError) {
    console.error('record-terms-acceptance insert error:', insertError)
    return Response.json({ error: 'Erro ao guardar aceitação dos termos.' }, { status: 500 })
  }

  return Response.json({ success: true })
}

export const config: Config = {
  path: '/api/record-terms-acceptance',
}
