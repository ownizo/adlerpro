import { createServerFn } from '@tanstack/react-start'
import { requireRoleMiddleware } from '@/middleware/identity'
import type { Engine, VisibilitySummary } from './ai-visibility'

const ALLOWED_DAYS = new Set([7, 30, 90])

export const fetchAiVisibility = createServerFn({ method: 'GET' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((d: { days?: number }) => {
    const days = Number(d?.days ?? 30)
    if (!ALLOWED_DAYS.has(days)) throw new Error('Invalid period.')
    return { days }
  })
  .handler(async ({ data }) => {
    const { getVisibilitySummary } = await import('./ai-visibility.server')
    return (await getVisibilitySummary(data.days)) as VisibilitySummary & { since: string; configured: Engine[] }
  })

export const addAiPrompt = createServerFn({ method: 'POST' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((d: { prompt: string; market?: string }) => {
    const prompt = typeof d?.prompt === 'string' ? d.prompt.trim() : ''
    if (prompt.length < 10 || prompt.length > 500) throw new Error('Write the question as a client would ask it (10 to 500 characters).')
    return { prompt, market: d.market === 'ES' ? 'ES' : 'PT' }
  })
  .handler(async ({ data }) => {
    const { addPrompt, startBackgroundRuns } = await import('./ai-visibility.server')
    const p = await addPrompt(data)
    // test it straight away on every configured engine, in the background
    await startBackgroundRuns({ promptId: p.id }).catch(() => undefined)
    return { id: p.id }
  })

export const setAiPromptActive = createServerFn({ method: 'POST' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string; active: boolean }) => {
    if (typeof d?.id !== 'string' || d.id.length > 64) throw new Error('Invalid id')
    return { id: d.id, active: !!d.active }
  })
  .handler(async ({ data }) => {
    const { setPromptActive } = await import('./ai-visibility.server')
    await setPromptActive(data.id, data.active)
    return { ok: true }
  })

export const startAiVisibilityRun = createServerFn({ method: 'POST' })
  .middleware([requireRoleMiddleware('admin')])
  .handler(async () => {
    const { startBackgroundRuns } = await import('./ai-visibility.server')
    const r = await startBackgroundRuns()
    if (!r.started.length) throw new Error('Could not start the test.')
    return { started: r.started }
  })
