// "Visibilidade em IA" — how often AI assistants recommend Adler & Rochefort
// for the prompts we track. Pure helpers (analysis + aggregation), testable
// without the network or the database.

export type Engine = 'CLAUDE' | 'CHATGPT' | 'GEMINI' | 'PERPLEXITY' | 'GOOGLE_AI_MODE' | 'GOOGLE_AI_OVERVIEWS'
export const ENGINE_LABEL: Record<Engine, string> = {
  CLAUDE: 'Claude', CHATGPT: 'ChatGPT', GEMINI: 'Gemini', PERPLEXITY: 'Perplexity',
  GOOGLE_AI_MODE: 'Google AI Mode', GOOGLE_AI_OVERVIEWS: 'Google AI Overviews',
}
export const ENGINES = Object.keys(ENGINE_LABEL) as Engine[]

const BRAND = /adler\s*(?:&amp;|&|and|e|und|et|y|en)?\s*rochefort|adlerrochefort/i
const OWN_DOMAIN = /(^|\.)adlerrochefort\.com$/i

/** Brokers and insurers that show up in answers about our market. */
export const COMPETITORS: Array<{ name: string; re: RegExp }> = [
  ['Aon', /\baon\b/i], ['Howden', /\bhowden\b/i], ['Marsh', /\bmarsh\b/i], ['WTW', /\bwtw\b|willis towers watson/i],
  ['Lockton', /\blockton\b/i], ['Gallagher', /\bgallagher\b/i], ['MDS', /\bmds\b(?! *-)/], ['Kennedy', /\bkennedy (insurance|group)\b/i],
  ['Medal Insurance', /\bmedal insurance\b/i], ['Pacific Prime', /\bpacific prime\b/i], ['William Russell', /\bwilliam russell\b/i],
  ['Expat Financial', /\bexpat financial\b/i], ['Now Health', /\bnow health\b/i], ['Anglo Portuguese', /\banglo[- ]portuguese\b/i],
  ['Allianz', /\ballianz\b/i], ['Zurich', /\bzurich\b/i], ['AXA', /\baxa\b/i], ['MAPFRE', /\bmapfre\b/i], ['Fidelidade', /\bfidelidade\b/i],
  ['Bupa', /\bbupa\b/i], ['Cigna', /\bcigna\b/i], ['April', /\bapril (international|portugal|seguros)\b/i], ['MGEN', /\bmgen\b/i],
  ['Médis', /\bm[ée]dis\b/i], ['Generali', /\bgenerali\b/i], ['Tranquilidade', /\btranquilidade\b/i], ['Ageas', /\bageas\b/i],
  ['Hiscox', /\bhiscox\b/i], ['Chubb', /\bchubb\b/i], ['Lusitania', /\blusit[aâ]nia\b/i], ['Liberty Seguros', /\bliberty seguros\b/i],
  ['Caravela', /\bcaravela\b/i], ['Victoria', /\bvict[oó]ria seguros\b/i],
].map(([name, re]) => ({ name: name as string, re: re as RegExp }))

function host(url: string): string {
  try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}

export type Analysis = {
  mentioned: boolean
  cited: boolean
  inSources: boolean
  position: number | null
  competitors: string[]
  citedUrls: string[]
}

/**
 * mentioned  — the answer names Adler & Rochefort (or the domain)
 * cited      — the answer cites a page on adlerrochefort.com
 * inSources  — a page on adlerrochefort.com was among the pages consulted
 * position   — our rank among all brands named in the answer, by first appearance (1 = first)
 */
export function analyseAnswer(text: string, citationUrls: string[] = [], sourceUrls: string[] = []): Analysis {
  const ownCited = [...new Set(citationUrls.filter((u) => OWN_DOMAIN.test(host(u))))]
  const firsts: Array<{ name: string; at: number }> = []
  const m = BRAND.exec(text)
  if (m) firsts.push({ name: 'Adler & Rochefort', at: m.index })
  for (const c of COMPETITORS) {
    const hit = c.re.exec(text)
    if (hit) firsts.push({ name: c.name, at: hit.index })
  }
  firsts.sort((a, b) => a.at - b.at)
  const idx = firsts.findIndex((f) => f.name === 'Adler & Rochefort')
  return {
    mentioned: !!m,
    cited: ownCited.length > 0,
    inSources: ownCited.length > 0 || sourceUrls.some((u) => OWN_DOMAIN.test(host(u))),
    position: idx >= 0 ? idx + 1 : null,
    competitors: firsts.filter((f) => f.name !== 'Adler & Rochefort').map((f) => f.name),
    citedUrls: ownCited.slice(0, 10),
  }
}

export type PromptRow = { id: string; prompt: string; language: string | null; market: string | null; topic: string | null; active: boolean; source: string }
export type ResultRow = {
  prompt_id: string; engine: Engine; run_day: string; source: string
  mentioned: boolean; cited: boolean; in_sources: boolean; position: number | null
  competitors: string[]; cited_urls: string[]; answer_excerpt: string | null; error: string | null
}

export type EngineStat = { engine: Engine; runs: number; mentioned: number; cited: number; visibility: number; avgPosition: number | null; lastDay: string | null; errors: number; lastError: string | null }
export type PromptStat = {
  id: string; prompt: string; language: string | null; topic: string | null; active: boolean; source: string
  runs: number; visibility: number
  latest: Partial<Record<Engine, { day: string; mentioned: boolean; cited: boolean; position: number | null; excerpt: string | null; competitors: string[]; error: string | null }>>
}
export type VisibilitySummary = {
  totals: { runs: number; mentioned: number; cited: number; visibility: number; avgPosition: number | null; lastDay: string | null }
  engines: EngineStat[]
  prompts: PromptStat[]
  competitors: Array<{ name: string; mentions: number; share: number }>
  weeks: Array<{ week: string; visibility: number; runs: number }>
}

/** Turn provider error messages into something actionable. */
export function explainError(err: string): string {
  if (/credit balance is too low|purchase credits/i.test(err)) return 'Conta da API sem crédito — carregue saldo no painel de faturação do fornecedor.'
  if (/exceeded your current quota|check your plan and billing/i.test(err)) return 'Chave sem quota — ative a faturação (billing) na conta do fornecedor.'
  if (/rate limit/i.test(err) || /HTTP 429/.test(err)) return 'Limite de pedidos atingido — o próximo teste volta a tentar.'
  if (/overloaded|HTTP 5\d\d/i.test(err)) return 'Serviço sobrecarregado no momento — o próximo teste volta a tentar.'
  if (/invalid.*(api key|x-api-key)|unauthori[sz]ed|HTTP 401/i.test(err)) return 'Chave da API inválida — confirme a variável no Netlify.'
  if (/não configurada/i.test(err)) return 'Chave da API não configurada.'
  return err.slice(0, 160)
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null)

function weekStart(day: string): string {
  const d = new Date(`${day}T12:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

export function summariseVisibility(prompts: PromptRow[], results: ResultRow[]): VisibilitySummary {
  const ok = results.filter((r) => !r.error)
  const positions = (rs: ResultRow[]) => rs.filter((r) => r.mentioned && r.position).map((r) => r.position as number)
  const lastDay = (rs: ResultRow[]) => rs.reduce<string | null>((m, r) => (!m || r.run_day > m ? r.run_day : m), null)

  const engines: EngineStat[] = ENGINES.map((engine) => {
    const rs = ok.filter((r) => r.engine === engine)
    const all = results.filter((r) => r.engine === engine)
    const latestDay = lastDay(all)
    const errs = all.filter((r) => r.error && r.run_day === latestDay)
    const mentioned = rs.filter((r) => r.mentioned).length
    return {
      engine, runs: rs.length, mentioned, cited: rs.filter((r) => r.cited).length, visibility: pct(mentioned, rs.length), avgPosition: avg(positions(rs)),
      lastDay: lastDay(rs), errors: errs.length, lastError: errs.length ? explainError(errs[errs.length - 1].error as string) : null,
    }
  }).filter((e) => e.runs > 0 || e.errors > 0)

  const promptStats: PromptStat[] = prompts.map((p) => {
    const rs = ok.filter((r) => r.prompt_id === p.id)
    const all = results.filter((r) => r.prompt_id === p.id)
    const latest: PromptStat['latest'] = {}
    for (const r of [...all].sort((a, b) => a.run_day.localeCompare(b.run_day))) {
      latest[r.engine] = { day: r.run_day, mentioned: r.mentioned, cited: r.cited, position: r.position, excerpt: r.answer_excerpt, competitors: r.competitors, error: r.error }
    }
    return { id: p.id, prompt: p.prompt, language: p.language, topic: p.topic, active: p.active, source: p.source, runs: rs.length, visibility: pct(rs.filter((r) => r.mentioned).length, rs.length), latest }
  }).sort((a, b) => Number(b.active) - Number(a.active) || b.visibility - a.visibility)

  const counts = new Map<string, number>()
  let ours = 0
  for (const r of ok) {
    if (r.mentioned) ours++
    for (const c of r.competitors) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  const totalMentions = ours + [...counts.values()].reduce((s, n) => s + n, 0)
  const competitors = [{ name: 'Adler & Rochefort', mentions: ours }, ...[...counts.entries()].map(([name, mentions]) => ({ name, mentions }))]
    .sort((a, b) => b.mentions - a.mentions).slice(0, 12)
    .map((c) => ({ ...c, share: pct(c.mentions, totalMentions) }))

  const byWeek = new Map<string, { runs: number; mentioned: number }>()
  for (const r of ok) {
    const w = weekStart(r.run_day)
    const e = byWeek.get(w) ?? { runs: 0, mentioned: 0 }
    e.runs++; if (r.mentioned) e.mentioned++
    byWeek.set(w, e)
  }
  const weeks = [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, e]) => ({ week, runs: e.runs, visibility: pct(e.mentioned, e.runs) }))

  const mentioned = ok.filter((r) => r.mentioned).length
  return {
    totals: { runs: ok.length, mentioned, cited: ok.filter((r) => r.cited).length, visibility: pct(mentioned, ok.length), avgPosition: avg(positions(ok)), lastDay: lastDay(results) },
    engines, prompts: promptStats, competitors, weeks,
  }
}
