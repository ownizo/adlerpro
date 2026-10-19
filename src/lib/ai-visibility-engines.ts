// Direct connections to the AI assistants used by "Visibilidade em IA" —
// no HubSpot in between. Each engine is called through its public API with
// web search on, the way the consumer apps answer, and the answer is reduced
// to { text, citations, sources } for analyseAnswer().
//
// Keys (Netlify environment variables, adlerpro-admin):
//   ANTHROPIC_API_KEY  → Claude      (model: AI_VISIBILITY_MODEL, default claude-sonnet-5-5)
//   OPENAI_API_KEY     → ChatGPT     (model: OPENAI_VISIBILITY_MODEL, default gpt-5.5)
//   GEMINI_API_KEY     → Gemini      (model: GEMINI_VISIBILITY_MODEL, default gemini-3.8-flash)
//   PERPLEXITY_API_KEY → Perplexity  (preset: PERPLEXITY_VISIBILITY_PRESET, default fast)
// An engine without a key is simply skipped. Changing a key needs a new
// deploy before functions see it (Netlify reads env vars at deploy time).
//
// The providers' response formats change; extractAnswer() walks any JSON
// shape and picks up answer text and URLs, so a new format degrades
// gracefully instead of breaking.

import type { Engine } from './ai-visibility.ts'

export type Answer = { text: string; citations: string[]; sources: string[]; model: string }

export const ENGINE_ENV: Partial<Record<Engine, string>> = {
  CLAUDE: 'ANTHROPIC_API_KEY',
  CHATGPT: 'OPENAI_API_KEY',
  GEMINI: 'GEMINI_API_KEY',
  PERPLEXITY: 'PERPLEXITY_API_KEY',
}

export function configuredEngines(env: Record<string, string | undefined> = process.env): Engine[] {
  return (Object.entries(ENGINE_ENV) as Array<[Engine, string]>).filter(([, k]) => !!env[k]).map(([e]) => e)
}

const SKIP_TYPES = new Set(['thought', 'reasoning', 'thinking', 'redacted_thinking', 'server_tool_use', 'google_search_call', 'search_suggestions'])
const CITATION_KEYS = new Set(['annotations', 'citations', 'groundingChunks', 'grounding_chunks', 'groundingSupports'])
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i

/** Pull answer text, cited URLs and consulted URLs out of any provider response. */
export function extractAnswer(body: unknown): { text: string; citations: string[]; sources: string[] } {
  const texts: string[] = []
  const citations = new Set<string>()
  const sources = new Set<string>()

  const addUrl = (u: string, cited: boolean) => {
    if (!/^https?:\/\//i.test(u)) return
    ;(cited ? citations : sources).add(u)
    sources.add(u)
  }

  const walk = (node: unknown, inCitations: boolean, parentKey: string) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        if (typeof item === 'string' && (inCitations || parentKey === 'citations')) addUrl(item, true)
        else walk(item, inCitations, parentKey)
      }
      return
    }
    if (!node || typeof node !== 'object') return
    const o = node as Record<string, unknown>
    const type = typeof o.type === 'string' ? o.type : ''
    if (SKIP_TYPES.has(type)) return

    // answer text: typed text blocks, Gemini generateContent parts, chat message content
    if (!inCitations && typeof o.text === 'string' && (type === 'text' || type === 'output_text' || (!type && parentKey === 'parts'))) texts.push(o.text)
    if (!inCitations && parentKey === 'message' && typeof o.content === 'string' && (o.role === 'assistant' || !o.role)) texts.push(o.content)

    for (const key of ['url', 'uri']) if (typeof o[key] === 'string') addUrl(o[key] as string, inCitations)
    // Gemini grounding chunks expose the real site only as the title (the URI is a redirect)
    if (inCitations && typeof o.title === 'string' && DOMAIN.test(o.title.trim())) addUrl(`https://${o.title.trim()}/`, true)

    for (const [k, v] of Object.entries(o)) {
      if (k === 'text' || k === 'url' || k === 'uri' || k === 'encrypted_content' || k === 'signature') continue
      if (k === 'content' && typeof v === 'string') continue
      walk(v, inCitations || CITATION_KEYS.has(k), k)
    }
  }
  walk(body, false, '')
  return { text: texts.join('').trim() || texts.join('\n').trim(), citations: [...citations], sources: [...sources] }
}

function location(market: string | null) {
  return market === 'ES'
    ? { country: 'ES', city: 'Madrid', timezone: 'Europe/Madrid' }
    : { country: 'PT', city: 'Lisbon', timezone: 'Europe/Lisbon' }
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504, 529])
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** POST with retries on rate limits / overload (honours Retry-After, max ~2 min of waiting). */
async function post(url: string, headers: Record<string, string>, body: unknown, attempts = 4): Promise<{ ok: boolean; status: number; json: any }> {
  let last: { ok: boolean; status: number; json: any } = { ok: false, status: 0, json: null }
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 150_000)
    let retryAfter = 0
    try {
      const res = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
      let json: any = null
      try { json = await res.json() } catch { /* empty */ }
      last = { ok: res.ok, status: res.status, json }
      retryAfter = Number(res.headers.get('retry-after')) || 0
    } catch (err) {
      last = { ok: false, status: 0, json: { error: { message: err instanceof Error ? err.message : String(err) } } }
    } finally {
      clearTimeout(timer)
    }
    if (last.ok || !(last.status === 0 || RETRY_STATUS.has(last.status))) return last
    // a quota that is simply exhausted will not recover in seconds
    if (last.status === 429 && /quota|billing|credit/i.test(JSON.stringify(last.json ?? ''))) return last
    if (i < attempts - 1) await sleep(Math.min(60_000, retryAfter ? retryAfter * 1000 : 5_000 * 3 ** i))
  }
  return last
}

/** How many prompts each engine runs in parallel (rate limits differ a lot). */
export const ENGINE_CONCURRENCY: Partial<Record<Engine, number>> = { CLAUDE: 3, CHATGPT: 3, GEMINI: 1, PERPLEXITY: 1 }

function errorOf(r: { status: number; json: any }) {
  const m = r.json?.error?.message ?? r.json?.error ?? r.json?.message ?? r.json?.detail
  return `HTTP ${r.status}${m ? `: ${typeof m === 'string' ? m : JSON.stringify(m)}` : ''}`.slice(0, 300)
}

function done(json: any, model: string): Answer {
  const a = extractAnswer(json)
  if (!a.text) throw new Error('Resposta vazia do assistente')
  return { ...a, model: json?.model ?? model }
}

async function askClaude(prompt: string, market: string | null): Promise<Answer> {
  const key = process.env.ANTHROPIC_API_KEY!
  const model = process.env.AI_VISIBILITY_MODEL || 'claude-sonnet-5-5'
  const loc = location(market)
  let last = ''
  for (const toolType of ['web_search_20260318', 'web_search_20250305']) {
    const r = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, {
      model, max_tokens: 1600, messages: [{ role: 'user', content: prompt }],
      tools: [{ type: toolType, name: 'web_search', max_uses: 5, user_location: { type: 'approximate', ...loc } }],
    })
    if (r.ok) return done(r.json, model)
    last = errorOf(r)
    if (!(r.status === 400 && /tool|web_search/i.test(last))) break
  }
  throw new Error(last)
}

async function askChatGPT(prompt: string, market: string | null): Promise<Answer> {
  const key = process.env.OPENAI_API_KEY!
  const model = process.env.OPENAI_VISIBILITY_MODEL || 'gpt-5.5'
  const loc = location(market)
  let last = ''
  for (const toolType of ['web_search', 'web_search_preview']) {
    const r = await post('https://api.openai.com/v1/responses', { authorization: `Bearer ${key}` }, {
      model, input: prompt,
      tools: [{ type: toolType, user_location: { type: 'approximate', ...loc } }],
      include: toolType === 'web_search' ? ['web_search_call.action.sources'] : undefined,
    })
    if (r.ok) return done(r.json, model)
    last = errorOf(r)
    if (!(r.status === 400 && /tool|web_search|include/i.test(last))) break
  }
  throw new Error(last)
}

async function askGemini(prompt: string): Promise<Answer> {
  const key = process.env.GEMINI_API_KEY!
  const model = process.env.GEMINI_VISIBILITY_MODEL || 'gemini-3.8-flash'
  const r = await post('https://generativelanguage.googleapis.com/v1beta/interactions', { 'x-goog-api-key': key }, {
    model, input: prompt, tools: [{ type: 'google_search' }],
  })
  if (r.ok) return done(r.json, model)
  // older API shape
  const g = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }],
  })
  if (g.ok) return done(g.json, model)
  throw new Error(`${errorOf(r)} / ${errorOf(g)}`.slice(0, 300))
}

async function askPerplexity(prompt: string): Promise<Answer> {
  const key = process.env.PERPLEXITY_API_KEY!
  const preset = process.env.PERPLEXITY_VISIBILITY_PRESET || 'fast'
  const r = await post('https://api.perplexity.ai/v1/agent', { authorization: `Bearer ${key}` }, { preset, input: prompt })
  if (!r.ok) throw new Error(errorOf(r))
  const a = done(r.json, `perplexity:${preset}`)
  // Perplexity numbers its sources [1][2]… in the text: the search results are the citations
  return { ...a, citations: [...new Set([...a.citations, ...a.sources])] }
}

export async function askEngine(engine: Engine, prompt: string, market: string | null): Promise<Answer> {
  const env = ENGINE_ENV[engine]
  if (!env || !process.env[env]) throw new Error(`${env ?? engine} não configurada`)
  switch (engine) {
    case 'CLAUDE': return askClaude(prompt, market)
    case 'CHATGPT': return askChatGPT(prompt, market)
    case 'GEMINI': return askGemini(prompt)
    case 'PERPLEXITY': return askPerplexity(prompt)
    default: throw new Error(`Motor não suportado: ${engine}`)
  }
}
