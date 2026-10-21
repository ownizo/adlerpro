// Server side of "Visibilidade em IA": runs the tracked prompts directly on
// Claude, ChatGPT, Gemini and Perplexity (their own APIs, web search on —
// see ai-visibility-engines.ts), stores the analysis and aggregates results
// for the backoffice page. No third-party AEO tool involved.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { analyseAnswer, summariseVisibility, ENGINE_LABEL, type Engine, type PromptRow, type ResultRow, type VisibilitySummary } from './ai-visibility.ts'
import { askEngine, ENGINE_CONCURRENCY } from './ai-visibility-engines.ts'

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

export { configuredEngines } from './ai-visibility-engines.ts'

function lisbonDay(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(d)
}

/** Ask one engine one prompt and store the analysed answer (one row per prompt × engine × day). */
export async function runEngineForPrompt(engine: Engine, p: { id: string; prompt: string; market: string | null }, day = lisbonDay()) {
  const base = { prompt_id: p.id, engine, run_day: day, run_at: new Date().toISOString(), source: 'native' }
  try {
    const { text, citations, sources, model } = await askEngine(engine, p.prompt, p.market)
    const a = analyseAnswer(text, citations, sources)
    const { error } = await sb().from('ai_vis_results').upsert({
      ...base, model, error: null,
      mentioned: a.mentioned, cited: a.cited, in_sources: a.inSources, position: a.position,
      competitors: a.competitors, cited_urls: a.citedUrls, answer_excerpt: text.slice(0, 3000),
    }, { onConflict: 'prompt_id,engine,run_day' })
    if (error) throw new Error(error.message)
    return { ok: true, mentioned: a.mentioned }
  } catch (err) {
    await sb().from('ai_vis_results').upsert({ ...base, mentioned: false, cited: false, in_sources: false, position: null, competitors: [], cited_urls: [], answer_excerpt: null, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) }, { onConflict: 'prompt_id,engine,run_day' })
    return { ok: false, mentioned: false }
  }
}

/** Runs every active prompt on one engine, a few at a time. Prompts already answered successfully today are skipped. */
export async function runActivePrompts(engine: Engine): Promise<{ total: number; ok: number; mentioned: number }> {
  const { data, error } = await sb().from('ai_vis_prompts').select('id, prompt, market').eq('active', true).order('created_at')
  if (error) throw new Error(error.message)
  const day = lisbonDay()
  const { data: doneRows } = await sb().from('ai_vis_results').select('prompt_id').eq('engine', engine).eq('run_day', day).is('error', null)
  const done = new Set((doneRows ?? []).map((r: { prompt_id: string }) => r.prompt_id))
  const prompts = ((data ?? []) as Array<{ id: string; prompt: string; market: string | null }>).filter((p) => !done.has(p.id))
  let ok = 0
  let mentioned = 0
  const queue = [...prompts]
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const r = await runEngineForPrompt(engine, p, day)
      if (r.ok) ok++
      if (r.mentioned) mentioned++
    }
  }
  await Promise.all(Array.from({ length: ENGINE_CONCURRENCY[engine] ?? 2 }, () => worker()))
  await sb().from('crm_activity').insert({ actor: 'system', action: 'ai_visibility_run', entity: 'ai_vis', summary: `Visibilidade em IA (${ENGINE_LABEL[engine]}): ${mentioned}/${prompts.length} respostas mencionam a Adler & Rochefort${ok < prompts.length ? ` · ${prompts.length - ok} com erro` : ''}` })
  return { total: prompts.length, ok, mentioned }
}

/** Re-run the text analysis on stored answers (after the competitor list changes). Keeps link/citation flags. */
export async function reanalyseStored(sinceDays = 90): Promise<number> {
  const since = lisbonDay(new Date(Date.now() - sinceDays * 86400000))
  const { data, error } = await sb().from('ai_vis_results').select('id, answer_excerpt, cited_urls').gte('run_day', since).is('error', null).not('answer_excerpt', 'is', null)
  if (error) throw new Error(error.message)
  let n = 0
  for (const r of (data ?? []) as Array<{ id: string; answer_excerpt: string; cited_urls: string[] }>) {
    const a = analyseAnswer(r.answer_excerpt, r.cited_urls, [])
    await sb().from('ai_vis_results').update({ mentioned: a.mentioned || false, position: a.position, competitors: a.competitors }).eq('id', r.id)
    n++
  }
  return n
}

/** Starts background runs (one per engine, so each fits the 15-minute limit). */
export async function startBackgroundRuns(opts: { engines?: Engine[]; promptId?: string } = {}) {
  const { configuredEngines } = await import('./ai-visibility-engines.ts')
  const engines = (opts.engines ?? configuredEngines()).filter((e) => configuredEngines().includes(e))
  const base = process.env.URL || 'https://admin.adlerrochefort.com'
  const secret = await internalSecret()
  const started: Engine[] = []
  await Promise.all(engines.map(async (engine) => {
    const res = await fetch(`${base}/.netlify/functions/ai-visibility-run-background`, {
      method: 'POST', headers: { 'x-internal-secret': secret, 'content-type': 'application/json' },
      body: JSON.stringify({ engine, prompt_id: opts.promptId }),
    }).catch(() => null)
    if (res && (res.status === 202 || res.status === 200)) started.push(engine)
  }))
  return { started }
}

export async function getVisibilitySummary(days: number): Promise<VisibilitySummary & { since: string; configured: Engine[] }> {
  const since = lisbonDay(new Date(Date.now() - days * 86400000))
  const [{ data: prompts, error: e1 }, { data: results, error: e2 }] = await Promise.all([
    sb().from('ai_vis_prompts').select('id, prompt, language, market, topic, active, source').order('created_at'),
    sb().from('ai_vis_results').select('prompt_id, engine, run_day, source, mentioned, cited, in_sources, position, competitors, cited_urls, answer_excerpt, error').gte('run_day', since).limit(10000),
  ])
  if (e1 || e2) throw new Error('Could not read the visibility tests.')
  const { configuredEngines } = await import('./ai-visibility-engines.ts')
  return { ...summariseVisibility((prompts ?? []) as PromptRow[], (results ?? []) as ResultRow[]), since, configured: configuredEngines() }
}

export async function getPrompt(id: string) {
  const { data } = await sb().from('ai_vis_prompts').select('id, prompt, market').eq('id', id).maybeSingle()
  return data as { id: string; prompt: string; market: string | null } | null
}

export async function addPrompt(input: { prompt: string; language?: string; market?: string; topic?: string }) {
  const { data, error } = await sb().from('ai_vis_prompts').insert({
    prompt: input.prompt, language: input.language ?? null, market: input.market ?? 'PT', topic: input.topic ?? null, source: 'manual',
  }).select('id, prompt, market').single()
  if (error) throw new Error(error.code === '23505' ? 'That question already exists.' : error.message)
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
