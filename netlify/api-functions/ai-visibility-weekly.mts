import type { Config } from '@netlify/functions'
import { startBackgroundRuns } from '../../src/lib/ai-visibility.server.ts'

// Every Monday 05:30 UTC: run the tracked prompts on every configured AI
// engine (one background run per engine).
export const config: Config = { schedule: '30 5 * * 1' }

export default async () => {
  // Several Netlify sites are built from this repo; only the backoffice runs the job.
  if (!(process.env.URL || '').includes('admin.')) return new Response(null, { status: 204 })
  const r = await startBackgroundRuns()
  console.log(`[ai-visibility-weekly] started: ${r.started.join(', ') || 'none'}`)
  return new Response(null, { status: 200 })
}
