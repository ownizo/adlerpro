import type { Config } from '@netlify/functions'
import { internalSecret } from '../../src/lib/ai-visibility.server.ts'

// Every Monday 05:30 UTC: start the Claude visibility run in the background.
export const config: Config = { schedule: '30 5 * * 1' }

export default async () => {
  const base = process.env.URL
  const secret = await internalSecret()
  if (!base || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[ai-visibility-weekly] URL or Supabase key missing')
    return new Response(null, { status: 500 })
  }
  const res = await fetch(`${base}/.netlify/functions/ai-visibility-run-background`, { method: 'POST', headers: { 'x-internal-secret': secret } })
  console.log(`[ai-visibility-weekly] started: ${res.status}`)
  return new Response(null, { status: 200 })
}
