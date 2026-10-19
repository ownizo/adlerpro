// Background function (up to 15 min): runs every active "Visibilidade em IA"
// prompt on Claude with web search. Started by the weekly schedule
// (ai-visibility-weekly) or by the "Testar agora" button in the backoffice.
// Internal only: requires the derived internal secret header.

import { runActivePromptsOnClaude, runClaudeForPrompt, internalSecret, getPrompt } from '../../src/lib/ai-visibility.server.ts'

export default async (req: Request) => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || req.headers.get('x-internal-secret') !== (await internalSecret())) return new Response('unauthorized', { status: 401 })
  try {
    // {"prompt_id": "..."} runs just that prompt (used right after adding one)
    let promptId: string | undefined
    try { promptId = ((await req.json()) as { prompt_id?: string }).prompt_id } catch { /* no body */ }
    if (promptId) {
      const p = await getPrompt(promptId)
      if (p) await runClaudeForPrompt(p)
      return new Response(null, { status: 202 })
    }
    const r = await runActivePromptsOnClaude()
    console.log(`[ai-visibility] ${r.ok}/${r.total} ok, ${r.mentioned} mention Adler & Rochefort`)
  } catch (err) {
    console.error('[ai-visibility] run failed', err)
  }
  return new Response(null, { status: 202 })
}
