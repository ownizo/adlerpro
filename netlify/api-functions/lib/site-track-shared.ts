// Turns a beacon from viagemgarantida.com (src/components/VisitTracker.astro in
// ownizo/viagem-garantida) into a public.site_visits row with site = the host.
//
// Same rules as the adlerrochefort.com counter (ownizo/adlerrochefort,
// netlify/functions/lib/site-visit.mjs): nothing personal is kept — no IP, no
// user-agent string. The user agent is only read to drop bots and classify the
// device; the country comes from Netlify's geolocation.

export const TRACKED_SITES = ['viagemgarantida.com'] as const
export type TrackedSite = (typeof TRACKED_SITES)[number]

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|python|curl|wget|httpclient|okhttp|java\/|go-http|axios|node-fetch|undici|phantom|puppeteer|playwright|selenium|preview|facebookexternalhit|whatsapp|telegram|semrush|ahrefs|mj12|petal|bytespider|yandex|baidu|gpt|claude|anthropic|perplexity|cohere|ccbot|scrapy|dataprovider|screenshot/i

const SEARCH = ['google.', 'bing.', 'duckduckgo.', 'yahoo.', 'ecosia.', 'qwant.', 'yandex.', 'baidu.', 'search.brave.']
const AI: Record<string, string> = {
  'chatgpt.com': 'chatgpt.com', 'chat.openai.com': 'chatgpt.com', 'openai.com': 'chatgpt.com', chatgpt: 'chatgpt.com',
  'perplexity.ai': 'perplexity', perplexity: 'perplexity',
  'gemini.google.com': 'gemini', gemini: 'gemini',
  'claude.ai': 'claude', claude: 'claude',
  'copilot.microsoft.com': 'copilot', 'copilot.com': 'copilot', copilot: 'copilot',
  'chat.deepseek.com': 'deepseek', 'chat.mistral.ai': 'mistral', 'grok.com': 'grok', 'meta.ai': 'meta-ai',
}
const SOCIAL = ['facebook.', 'instagram.', 'linkedin.', 'lnkd.in', 't.co', 'x.com', 'twitter.', 'pinterest.', 'youtube.', 'reddit.', 'whatsapp.']

export function isBot(userAgent: string) {
  if (!userAgent || userAgent.length < 20) return true
  return BOT_UA.test(userAgent)
}

export function deviceOf(userAgent = '') {
  if (/ipad|tablet/i.test(userAgent)) return 'tablet'
  if (/mobi|iphone|android/i.test(userAgent)) return 'mobile'
  return 'desktop'
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '').replace(/^(m|l|lm)\./, '')
  } catch {
    return ''
  }
}

const has = (list: string[], host: string) => list.some((p) => host === p || host.startsWith(p) || host.includes('.' + p))

export function classify(pageUrl: string, referrer: string, site: string) {
  let params: URLSearchParams
  try {
    params = new URL(pageUrl).searchParams
  } catch {
    params = new URLSearchParams()
  }
  const refHost = hostOf(referrer)
  const internal = refHost === site
  const out = { referrer_host: internal ? null : refHost || null, is_landing: !internal, source: null as string | null, medium: null as string | null, campaign: null as string | null }
  if (internal) return out
  const utm = params.get('utm_source')
  if (utm) {
    out.source = utm.slice(0, 80)
    out.medium = (params.get('utm_medium') || '').slice(0, 80) || null
    const ai = AI[out.source.toLowerCase().replace(/^www\./, '')]
    if (ai && (!out.medium || out.medium === 'referral')) {
      out.source = ai
      out.medium = 'ai-assistant'
    }
    out.campaign = (params.get('utm_campaign') || '').slice(0, 120) || null
    return out
  }
  if (params.get('gclid') || params.get('gbraid') || params.get('wbraid')) return { ...out, source: 'google', medium: 'cpc' }
  if (!refHost) return { ...out, source: '(direct)', medium: '(none)' }
  if (AI[refHost]) return { ...out, source: AI[refHost], medium: 'ai-assistant' }
  if (has(SEARCH, refHost)) return { ...out, source: refHost.startsWith('search.') ? 'brave' : refHost.split('.')[0], medium: 'organic' }
  if (has(SOCIAL, refHost)) return { ...out, source: refHost, medium: 'social' }
  return { ...out, source: refHost, medium: 'referral' }
}

const clean = (v: unknown, n: number) => (typeof v === 'string' && v ? v.slice(0, n) : null)

export type TrackResult =
  | { kind: 'start'; row: Record<string, unknown> }
  | { kind: 'end'; site: TrackedSite; visitId: string; duration: number }
  | null

export function buildTrackedVisit(body: unknown, { userAgent, country }: { userAgent: string; country?: string }): TrackResult {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (isBot(userAgent)) return null
  // Only the production hosts: deploy previews and copies of the site are not visits.
  const site = hostOf(String(b.url ?? '')) as TrackedSite
  if (!TRACKED_SITES.includes(site)) return null

  if (b.action === 'visit-end') {
    const visitId = clean(b.visitId, 80)
    const d = Number(b.durationSeconds)
    if (!visitId || !Number.isFinite(d) || d < 0) return null
    return { kind: 'end', site, visitId, duration: Math.min(Math.round(d), 7200) }
  }
  if (b.action !== 'visit-start') return null
  const visitId = clean(b.visitId, 80)
  const path = clean(b.path, 300)
  if (!visitId || !path || !path.startsWith('/')) return null
  const c = classify(String(b.url), typeof b.referrer === 'string' ? b.referrer : '', site)
  return {
    kind: 'start',
    row: {
      site,
      visit_id: visitId,
      session_id: clean(b.sessionId, 80),
      path,
      lang: 'pt',
      is_landing: c.is_landing,
      referrer_host: c.referrer_host,
      source: c.source,
      medium: c.medium,
      campaign: c.campaign,
      country: /^[A-Z]{2}$/.test(country || '') ? country : null,
      device: deviceOf(userAgent),
    },
  }
}
