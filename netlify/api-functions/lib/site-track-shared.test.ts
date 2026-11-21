import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTrackedVisit, classify } from './site-track-shared.ts'

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'

test('viagemgarantida.com page view becomes a row tagged with the site', () => {
  const v = buildTrackedVisit({ action: 'visit-start', visitId: 'v1', sessionId: 's1', path: '/blog/x', url: 'https://viagemgarantida.com/blog/x?utm_source=chatgpt.com', referrer: '' }, { userAgent: UA, country: 'PT' })
  assert.equal(v?.kind, 'start')
  if (v?.kind !== 'start') return
  assert.equal(v.row.site, 'viagemgarantida.com')
  assert.equal(v.row.source, 'chatgpt.com')
  assert.equal(v.row.medium, 'ai-assistant')
  assert.equal(v.row.device, 'mobile')
  assert.equal(v.row.country, 'PT')
})

test('other hosts, previews and bots are ignored', () => {
  const base = { action: 'visit-start', visitId: 'v1', path: '/', referrer: '' }
  assert.equal(buildTrackedVisit({ ...base, url: 'https://adlerrochefort.com/' }, { userAgent: UA }), null)
  assert.equal(buildTrackedVisit({ ...base, url: 'https://deploy-preview-4--viagemgarantidaseguros.netlify.app/' }, { userAgent: UA }), null)
  assert.equal(buildTrackedVisit({ ...base, url: 'https://viagemgarantida.com/' }, { userAgent: 'Googlebot/2.1 (+http://www.google.com/bot.html)' }), null)
})

test('internal navigation is not a landing; google is organic', () => {
  assert.equal(classify('https://viagemgarantida.com/a', 'https://viagemgarantida.com/', 'viagemgarantida.com').is_landing, false)
  assert.deepEqual(
    { s: classify('https://viagemgarantida.com/', 'https://www.google.pt/', 'viagemgarantida.com').source, m: classify('https://viagemgarantida.com/', 'https://www.google.pt/', 'viagemgarantida.com').medium },
    { s: 'google', m: 'organic' }
  )
})

test('visit-end carries the duration', () => {
  const v = buildTrackedVisit({ action: 'visit-end', visitId: 'v1', durationSeconds: 42.4, url: 'https://viagemgarantida.com/' }, { userAgent: UA })
  assert.deepEqual(v, { kind: 'end', site: 'viagemgarantida.com', visitId: 'v1', duration: 42 })
})
