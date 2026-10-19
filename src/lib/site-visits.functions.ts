import { createServerFn } from '@tanstack/react-start'
import { requireRoleMiddleware } from '@/middleware/identity'

const ALLOWED_DAYS = new Set([7, 14, 30, 90])

export const fetchSiteVisits = createServerFn({ method: 'GET' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((data: { days?: number; day?: string }) => {
    const days = Number(data?.days ?? 30)
    if (!ALLOWED_DAYS.has(days)) throw new Error('Período inválido.')
    const day = typeof data?.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.day) ? data.day : undefined
    return { days, day }
  })
  .handler(async ({ data }) => {
    const { getSiteVisitsSummary } = await import('./site-visits.server')
    return getSiteVisitsSummary(data.days, data.day)
  })
