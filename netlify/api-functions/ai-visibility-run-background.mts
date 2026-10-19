// Background function (up to 15 min): runs the "Visibilidade em IA" prompts
// on one AI engine (Claude, ChatGPT, Gemini or Perplexity) via its own API.
// Body: { engine, prompt_id? } — prompt_id runs just that prompt.
// Started by the weekly schedule, the "Testar agora" button or when a prompt
// is added. Internal only: requires the derived internal secret header.

import { runActivePrompts, runEngineForPrompt, internalSecret, getPrompt, configuredEngines, reanalyseStored } from '../../src/lib/ai-visibility.server.ts'
import type { Engine } from '../../src/lib/ai-visibility.ts'

export default async (req: Request) => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || req.headers.get('x-internal-secret') !== (await internalSecret())) return new Response('unauthorized', { status: 401 })
  let body: { engine?: Engine; prompt_id?: string; reanalyse?: boolean } = {}
  try { body = (await req.json()) as typeof body } catch { /* no body */ }
  if (body.reanalyse) {
    console.log(`[ai-visibility] reanalysed ${await reanalyseStored()} answers`)
    return new Response(null, { status: 202 })
  }
  const engines = body.engine ? [body.engine] : configuredEngines()
  for (const engine of engines) {
    if (!configuredEngines().includes(engine)) continue
    try {
      if (body.prompt_id) {
        const p = await getPrompt(body.prompt_id)
        if (p) await runEngineForPrompt(engine, p)
      } else {
        const r = await runActivePrompts(engine)
        console.log(`[ai-visibility] ${engine}: ${r.ok}/${r.total} ok, ${r.mentioned} mention Adler & Rochefort`)
      }
    } catch (err) {
      console.error(`[ai-visibility] ${engine} run failed`, err)
    }
  }
  return new Response(null, { status: 202 })
}
