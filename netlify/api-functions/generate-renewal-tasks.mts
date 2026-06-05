import type { Config } from '@netlify/functions'
import { generateRenewalTasks } from '../../src/lib/data'

export const config: Config = {
  schedule: '0 7 * * *', // 7h UTC diariamente (8h Portugal inverno, 9h verão)
}

export default async function handler(req: Request) {
  // Aceita o scheduler do Netlify (x-netlify-scheduled) ou bearer ADMIN_SECRET para testes manuais
  // Padrão de auth idêntico a send-renewal-alerts.mts
  const authHeader = req.headers.get('authorization')
  const isScheduled = req.headers.get('x-netlify-scheduled') === 'true'
  const isAdmin = authHeader === `Bearer ${process.env.ADMIN_SECRET || 'adler-admin-2025'}`

  if (!isScheduled && !isAdmin) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Falha rápida se as env vars estiverem em falta — evita erros silenciosos de auth do Supabase
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({ error: 'VITE_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  try {
    const result = await generateRenewalTasks()
    console.log(`[generate-renewal-tasks] criadas: ${result.created}, ignoradas: ${result.skipped}`)
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[generate-renewal-tasks] erro:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
