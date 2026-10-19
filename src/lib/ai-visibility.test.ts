import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyseAnswer, summariseVisibility, type ResultRow } from './ai-visibility.ts'

test('detects mention, citation, sources and position', () => {
  const text = 'For a high-value home in the Algarve, consider Howden or Adler & Rochefort, who work with Allianz and Zurich.'
  const a = analyseAnswer(text, ['https://adlerrochefort.com/en/home-insurance-quote/', 'https://howdengroup.com'], ['https://www.adlerrochefort.com/x'])
  assert.equal(a.mentioned, true)
  assert.equal(a.cited, true)
  assert.equal(a.inSources, true)
  assert.equal(a.position, 2)
  assert.deepEqual(a.competitors, ['Howden', 'Allianz', 'Zurich'])
  assert.deepEqual(a.citedUrls, ['https://adlerrochefort.com/en/home-insurance-quote/'])
})

test('brand variants in other languages', () => {
  assert.equal(analyseAnswer('Makler wie Adler und Rochefort').mentioned, true)
  assert.equal(analyseAnswer('a mediadora Adler e Rochefort').mentioned, true)
  assert.equal(analyseAnswer('see adlerrochefort.com').mentioned, true)
  const none = analyseAnswer('Try Medal Insurance or Pacific Prime.', [], ['https://adlerrochefort.com/'])
  assert.equal(none.mentioned, false)
  assert.equal(none.position, null)
  assert.equal(none.inSources, true)
  assert.equal(none.cited, false)
})

test('summary by engine, prompt, competitor and week', () => {
  const base = { source: 'native', in_sources: false, cited_urls: [], answer_excerpt: 'x', error: null }
  const results: ResultRow[] = [
    { ...base, prompt_id: 'p1', engine: 'CLAUDE', run_day: '2026-10-19', mentioned: true, cited: true, position: 1, competitors: ['Allianz'] },
    { ...base, prompt_id: 'p1', engine: 'CHATGPT', run_day: '2026-10-19', mentioned: false, cited: false, position: null, competitors: ['Howden'] },
    { ...base, prompt_id: 'p2', engine: 'CLAUDE', run_day: '2026-10-12', mentioned: false, cited: false, position: null, competitors: [] },
    { ...base, prompt_id: 'p2', engine: 'CLAUDE', run_day: '2026-10-19', mentioned: false, cited: false, position: null, competitors: [], error: 'timeout' },
  ]
  const s = summariseVisibility([
    { id: 'p1', prompt: 'a', language: 'en', market: 'PT', topic: null, active: true, source: 'manual' },
    { id: 'p2', prompt: 'b', language: 'pt', market: 'PT', topic: null, active: true, source: 'manual' },
  ], results)
  assert.equal(s.totals.runs, 3)
  assert.equal(s.totals.visibility, 33)
  assert.equal(s.engines.find((e) => e.engine === 'CLAUDE')!.visibility, 50)
  assert.equal(s.prompts[0].id, 'p1')
  assert.equal(s.prompts[1].latest.CLAUDE!.error, 'timeout')
  assert.equal(s.competitors[0].name, 'Adler & Rochefort')
  assert.deepEqual(s.weeks.map((w) => w.week), ['2026-10-12', '2026-10-19'])
})

test('extracts answers from every provider format', async () => {
  const { extractAnswer, configuredEngines } = await import('./ai-visibility-engines.ts')
  // Claude
  const claude = extractAnswer({ content: [
    { type: 'server_tool_use', input: { query: 'x' } },
    { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://www.howdengroup.com/pt', title: 'Howden' }] },
    { type: 'text', text: 'Adler & Rochefort is ', citations: [{ type: 'web_search_result_location', url: 'https://adlerrochefort.com/en/', cited_text: 'x' }] },
    { type: 'text', text: 'a good option.' },
  ] })
  assert.equal(claude.text, 'Adler & Rochefort is a good option.')
  assert.deepEqual(claude.citations, ['https://adlerrochefort.com/en/'])
  assert.ok(claude.sources.includes('https://www.howdengroup.com/pt'))
  // OpenAI Responses
  const openai = extractAnswer({ output: [
    { type: 'web_search_call', action: { type: 'search', sources: [{ type: 'url', url: 'https://adlerrochefort.com/de/' }] } },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Try Howden.', annotations: [{ type: 'url_citation', url: 'https://howdengroup.com', title: 'Howden' }] }] },
  ] })
  assert.equal(openai.text, 'Try Howden.')
  assert.deepEqual(openai.citations, ['https://howdengroup.com'])
  assert.ok(openai.sources.includes('https://adlerrochefort.com/de/'))
  // Gemini Interactions + generateContent
  const gi = extractAnswer({ steps: [{ type: 'thought', summary: [{ type: 'text', text: 'thinking' }] }, { type: 'model_output', content: [{ type: 'text', text: 'Answer', annotations: [{ type: 'url_citation', url: 'https://adlerrochefort.com/x', title: 'A&R' }] }] }] })
  assert.equal(gi.text, 'Answer')
  assert.deepEqual(gi.citations, ['https://adlerrochefort.com/x'])
  const gc = extractAnswer({ candidates: [{ content: { parts: [{ text: 'Hello' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'adlerrochefort.com' } }] } }] })
  assert.equal(gc.text, 'Hello')
  assert.ok(gc.citations.includes('https://adlerrochefort.com/'))
  // Perplexity Agent + legacy chat
  const pa = extractAnswer({ output: [{ type: 'search_results', results: [{ url: 'https://adlerrochefort.com/', title: 'A&R' }] }, { type: 'message', content: [{ type: 'output_text', text: 'Use a broker.' }] }] })
  assert.equal(pa.text, 'Use a broker.')
  assert.ok(pa.sources.includes('https://adlerrochefort.com/'))
  const pc = extractAnswer({ choices: [{ message: { role: 'assistant', content: 'Sonar answer' } }], citations: ['https://adlerrochefort.com/en/'] })
  assert.equal(pc.text, 'Sonar answer')
  assert.deepEqual(pc.citations, ['https://adlerrochefort.com/en/'])
  assert.deepEqual(configuredEngines({ ANTHROPIC_API_KEY: 'x', PERPLEXITY_API_KEY: 'y' }), ['CLAUDE', 'PERPLEXITY'])
})
