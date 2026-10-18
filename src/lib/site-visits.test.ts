import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayRange, lisbonDate, sourceLabel, summarise, type SiteVisitRow } from './site-visits.ts'

const now = new Date('2026-10-18T17:00:00Z')
const row = (p: Partial<SiteVisitRow>): SiteVisitRow => ({
  created_at: '2026-10-18T10:00:00Z', visit_id: Math.random().toString(), session_id: 's1', path: '/en/', lang: 'en',
  is_landing: false, source: null, medium: null, country: 'PT', device: 'mobile', duration_seconds: null, ...p,
})

test('days are Lisbon calendar days', () => {
  assert.equal(lisbonDate('2026-10-17T23:30:00Z'), '2026-10-18')
  assert.deepEqual(dayRange(3, now), ['2026-10-16', '2026-10-17', '2026-10-18'])
})

test('summary counts page views, sessions, sources and leads per day', () => {
  const rows = [
    row({ is_landing: true, source: 'google', medium: 'organic' }),
    row({ path: '/en/international-health-insurance/' }),
    row({ session_id: 's2', is_landing: true, source: 'chatgpt.com', medium: 'ai-assistant', country: 'DE', created_at: '2026-10-17T09:00:00Z' }),
  ]
  const s = summarise(rows, ['2026-10-18T08:00:00Z'], 3, now)
  const today = s.days.at(-1)!
  assert.equal(today.pageViews, 2)
  assert.equal(today.visits, 1)
  assert.equal(today.fromGoogle, 1)
  assert.equal(today.leads, 1)
  assert.equal(s.days[1].fromAi, 1)
  assert.equal(s.totals.visits, 2)
  assert.equal(s.pages[0].path, '/en/')
  assert.equal(sourceLabel('google', 'organic'), 'Pesquisa · Google')
})
