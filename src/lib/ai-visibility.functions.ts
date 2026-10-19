import { createServerFn } from '@tanstack/react-start'
import { requireRoleMiddleware } from '@/middleware/identity'
import type { VisibilitySummary } from './ai-visibility'

const ALLOWED_DAYS = new Set([7, 30, 90])

export const fetchAiVisibility = createServerFn({ method: 'GET' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((d: { days?: number }) => {
    const days = Number(d?.days ?? 30)
    if (!ALLOWED_DAYS.has(days)) throw new Error('Período inválido.')
    return { days }
  })
  .handler(async ({ data }) => {
    const { getVisibilitySummary } = await import('./ai-visibility.server')
    return (await getVisibilitySummary(data.days)) as VisibilitySummary & { since: string }
  })

export const addAiPrompt = createServerFn({ method: 'POST' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((d: { prompt: string; market?: string }) => {
    const prompt = typeof d?.prompt === 'string' ? d.prompt.trim() : ''
    if (prompt.length < 10 || prompt.length > 500) throw new Error('Escreva a pergunta como um cliente a faria (10 a 500 caracteres).')
    return { prompt, market: d.market === 'ES' ? 'ES' : 'PT' }
  })
  .handler(async ({ data }) => {
    const { addPrompt, internalSecret } = await import('./ai-visibility.server')
    const p = await addPrompt(data)
    // test it straight away on Claude, in the background (web search takes a while)
    const base = process.env.URL || 'https://admin.adlerrochefort.com'
    await fetch(`${base}/.netlify/functions/ai-visibility-run-background`, {
      method: 'POST', headers: { 'x-internal-secret': await internalSecret(), 'content-type': 'application/json' }, body: JSON.stringify({ prompt_id: p.id }),
    }).catch(() => undefined)
    return { id: p.id }
  })

export const setAiPromptActive = createServerFn({ method: 'POST' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string; active: boolean }) => {
    if (typeof d?.id !== 'string' || d.id.length > 64) throw new Error('id inválido')
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
    const { internalSecret } = await import('./ai-visibility.server')
    const base = process.env.URL || 'https://admin.adlerrochefort.com'
    const res = await fetch(`${base}/.netlify/functions/ai-visibility-run-background`, { method: 'POST', headers: { 'x-internal-secret': await internalSecret() } })
    if (res.status !== 202 && res.status !== 200) throw new Error(`Não foi possível iniciar o teste (${res.status}).`)
    return { started: true }
  })
