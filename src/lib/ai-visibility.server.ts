// Server side of "Visibilidade em IA": runs the tracked prompts on Claude
// (with web search, like a person asking on claude.ai), stores the analysis,
// and aggregates results for the backoffice page. ChatGPT / Gemini /
// Perplexity results are imported from HubSpot AEO through the CRM connector
// (recordExternalResult).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { analyseAnswer, summariseVisibility, type Engine, type PromptRow, type ResultRow, type VisibilitySummary } from './ai-visibility.ts'

let client: SupabaseClient | null = null
function sb(): SupabaseClient {
  if (client) return client
  client = createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '', {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return client
}

/** Shared secret between the server fn, the schedule and the background run (derived, nothing to configure). */
export async function internalSecret(): Promise<string> {
  const base = `${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''}:ai-visibility`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base))
  return Buffer.from(digest).toString('hex')
}

const MODEL = () => process.env.AI_VISIBILITY_MODEL || 'claude-sonnet-5-5'
const TOOL_VERSIONS = ['web_search_20260318', 'web_search_20250305']

function lisbonDay(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(d)
}

function location(market: string | null) {
  if (market === 'ES') return { type: 'approximate', country: 'ES', city: 'Madrid', timezone: 'Europe/Madrid' }
  return { type: 'approximate', country: 'PT', city: 'Lisbon', timezone: 'Europe/Lisbon' }
}

type Block = { type: string; text?: string; citations?: Array<{ url?: string }>; content?: Array<{ url?: string }> | { error_code?: string } }

async function askClaude(prompt: string, market: string | null): Promise<{ text: string; citations: string[]; sources: string[]; model: string }> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY em falta')
  let lastErr = ''
  for (const toolType of TOOL_VERSIONS) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 120_000)
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL(),
          max_tokens: 1600,
          messages: [{ role: 'user', content: prompt }],
          tools: [{ type: toolType, name: 'web_search', max_uses: 5, user_location: location(market) }],
        }),
      })
      const body = await res.json() as { content?: Block[]; model?: string; error?: { message?: string } }
      if (!res.ok) {
        lastErr = body.error?.message ?? `HTTP ${res.status}`
        if (res.status === 400 && /tool|web_search/i.test(lastErr)) continue // try the older tool version
        throw new Error(lastErr)
      }
      let text = ''
      const citations: string[] = []
      const sources: string[] = []
      for (const b of body.content ?? []) {
        if (b.type === 'text' && b.text) {
          text += b.text
          for (const c of b.citations ?? []) if (c.url) citations.push(c.url)
        } else if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
          for (const r of b.content) if (r.url) sources.push(r.url)
        }
      }
      return { text, citations, sources, model: body.model ?? MODEL() }
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(lastErr || 'web search indisponível')
}

export async function runClaudeForPrompt(p: { id: string; prompt: string; market: string | null }, day = lisbonDay()) {
  const base = { prompt_id: p.id, engine: 'CLAUDE' as Engine, run_day: day, run_at: new Date().toISOString(), source: 'native' }
  try {
    const { text, citations, sources, model } = await askClaude(p.prompt, p.market)
    const a = analyseAnswer(text, citations, sources)
    await sb().from('ai_vis_results').upsert({
      ...base, model, error: null,
      mentioned: a.mentioned, cited: a.cited, in_sources: a.inSources, position: a.position,
      competitors: a.competitors, cited_urls: a.citedUrls, answer_excerpt: text.slice(0, 3000),
    }, { onConflict: 'prompt_id,engine,run_day' })
    return { ok: true, mentioned: a.mentioned }
  } catch (err) {
    await sb().from('ai_vis_results').upsert({ ...base, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) }, { onConflict: 'prompt_id,engine,run_day' })
    return { ok: false }
  }
}

/** Runs every active prompt on Claude, a few at a time. */
export async function runActivePromptsOnClaude(): Promise<{ total: number; ok: number; mentioned: number }> {
  const { data, error } = await sb().from('ai_vis_prompts').select('id, prompt, market').eq('active', true).order('created_at')
  if (error) throw new Error(error.message)
  const prompts = (data ?? []) as Array<{ id: string; prompt: string; market: string | null }>
  const day = lisbonDay()
  let ok = 0
  let mentioned = 0
  const queue = [...prompts]
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const r = await runClaudeForPrompt(p, day)
      if (r.ok) ok++
      if (r.mentioned) mentioned++
    }
  }
  await Promise.all([worker(), worker(), worker()])
  await sb().from('crm_activity').insert({ actor: 'system', action: 'ai_visibility_run', entity: 'ai_vis', summary: `Teste de visibilidade no Claude: ${mentioned}/${prompts.length} respostas mencionam a Adler & Rochefort` })
  return { total: prompts.length, ok, mentioned }
}

export async function getVisibilitySummary(days: number): Promise<VisibilitySummary & { since: string }> {
  const since = lisbonDay(new Date(Date.now() - days * 86400000))
  const [{ data: prompts, error: e1 }, { data: results, error: e2 }] = await Promise.all([
    sb().from('ai_vis_prompts').select('id, prompt, language, market, topic, active, source').order('created_at'),
    sb().from('ai_vis_results').select('prompt_id, engine, run_day, source, mentioned, cited, in_sources, position, competitors, cited_urls, answer_excerpt, error').gte('run_day', since).limit(10000),
  ])
  if (e1 || e2) throw new Error('Não foi possível ler os testes de visibilidade.')
  return { ...summariseVisibility((prompts ?? []) as PromptRow[], (results ?? []) as ResultRow[]), since }
}

export async function getPrompt(id: string) {
  const { data } = await sb().from('ai_vis_prompts').select('id, prompt, market').eq('id', id).maybeSingle()
  return data as { id: string; prompt: string; market: string | null } | null
}

export async function addPrompt(input: { prompt: string; language?: string; market?: string; topic?: string }) {
  const { data, error } = await sb().from('ai_vis_prompts').insert({
    prompt: input.prompt, language: input.language ?? null, market: input.market ?? 'PT', topic: input.topic ?? null, source: 'manual',
  }).select('id, prompt, market').single()
  if (error) throw new Error(error.code === '23505' ? 'Essa pergunta já existe.' : error.message)
  return data as { id: string; prompt: string; market: string | null }
}

export async function setPromptActive(id: string, active: boolean) {
  const { error } = await sb().from('ai_vis_prompts').update({ active }).eq('id', id)
  if (error) throw new Error(error.message)
}

/** Import one result measured elsewhere (HubSpot AEO: ChatGPT, Gemini, Perplexity…). */
export async function recordExternalResult(input: {
  prompt: string; hubspot_prompt_id?: number; language?: string; market?: string
  engine: Engine; run_day: string; mentioned: boolean; cited?: boolean; position?: number | null
  competitors?: string[]; cited_urls?: string[]; excerpt?: string
}) {
  let promptId: string | undefined
  if (input.hubspot_prompt_id) {
    const { data } = await sb().from('ai_vis_prompts').select('id').eq('hubspot_prompt_id', input.hubspot_prompt_id).maybeSingle()
    promptId = data?.id
  }
  if (!promptId) {
    const { data } = await sb().from('ai_vis_prompts').select('id').eq('prompt', input.prompt).maybeSingle()
    promptId = data?.id
  }
  if (!promptId) {
    const { data, error } = await sb().from('ai_vis_prompts').insert({
      prompt: input.prompt, language: input.language ?? null, market: input.market ?? 'PT', source: 'hubspot', hubspot_prompt_id: input.hubspot_prompt_id ?? null,
    }).select('id').single()
    if (error) throw new Error(error.message)
    promptId = data.id
  }
  const { error } = await sb().from('ai_vis_results').upsert({
    prompt_id: promptId, engine: input.engine, run_day: input.run_day, source: 'hubspot',
    mentioned: input.mentioned, cited: !!input.cited, in_sources: !!input.cited, position: input.position ?? null,
    competitors: (input.competitors ?? []).slice(0, 20), cited_urls: (input.cited_urls ?? []).slice(0, 10),
    answer_excerpt: input.excerpt ? input.excerpt.slice(0, 3000) : null, error: null,
  }, { onConflict: 'prompt_id,engine,run_day' })
  if (error) throw new Error(error.message)
  return { prompt_id: promptId }
}
