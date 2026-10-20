import type { Config } from '@netlify/functions'

// The backoffice is used by one person, so the SSR function that serves every
// page and server function is usually cold when Hugo opens it, and a cold
// start was costing several seconds before the first byte. Touching a light
// page every five minutes keeps one instance warm during the working day.
// Only the admin site does this; the other sites built from this repo skip it.
export const config: Config = { schedule: '*/5 6-22 * * *' }

export default async () => {
  const base = process.env.URL || ''
  if (!base.includes('admin.')) return new Response(null, { status: 204 })
  const started = Date.now()
  try {
    const res = await fetch(`${base}/login`, { headers: { 'user-agent': 'adler-keep-warm' } })
    await res.arrayBuffer()
    console.log(`[keep-admin-warm] ${res.status} in ${Date.now() - started} ms`)
  } catch (err) {
    console.error('[keep-admin-warm] failed:', err instanceof Error ? err.message : String(err))
  }
  return new Response(null, { status: 204 })
}
