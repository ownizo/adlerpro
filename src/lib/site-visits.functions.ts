import { createServerFn } from '@tanstack/react-start'
import { requireRoleMiddleware } from '@/middleware/identity'

const ALLOWED_DAYS = new Set([7, 14, 30, 90])

export const fetchSiteVisits = createServerFn({ method: 'GET' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((data: { days?: number }) => {
    const days = Number(data?.days ?? 30)
    if (!ALLOWED_DAYS.has(days)) throw new Error('Período inválido.')
    return { days }
  })
  .handler(async ({ data }) => {
    const { getSiteVisitsSummary } = await import('./site-visits.server')
    return getSiteVisitsSummary(data.days)
  })
