import { createServerFn } from '@tanstack/react-start'
import { requireRoleMiddleware } from '@/middleware/identity'
import { isSiteKey } from './site-visits'

const ALLOWED_DAYS = new Set([7, 14, 30, 90])

export const fetchSiteVisits = createServerFn({ method: 'GET' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((data: { days?: number; day?: string; site?: string }) => {
    const days = Number(data?.days ?? 30)
    if (!ALLOWED_DAYS.has(days)) throw new Error('Invalid period.')
    const day = typeof data?.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.day) ? data.day : undefined
    const site = data?.site === undefined ? 'adlerrochefort.com' : data.site
    if (!isSiteKey(site)) throw new Error('Invalid site.')
    return { days, day, site }
  })
  .handler(async ({ data }) => {
    const { getSiteVisitsSummary } = await import('./site-visits.server')
    return getSiteVisitsSummary(data.days, data.day, data.site)
  })
