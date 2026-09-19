import { createServerFn } from '@tanstack/react-start'
import { getRequestUrl } from '@tanstack/react-start/server'
import { requireRoleMiddleware } from '@/middleware/identity'
import { validatePaymentLinkInput } from './payment-link-validation'

export const createPremiumPaymentLink = createServerFn({ method: 'POST' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator(validatePaymentLinkInput)
  .handler(async ({ data, context }) => {
    const { createStripePremiumLink } = await import('./payment-links.server')
    return createStripePremiumLink(data, context.user.id, getRequestUrl().origin)
  })

export const fetchPremiumPaymentStatus = createServerFn({ method: 'GET' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((data: { sessionId: string }) => {
    if (!data || typeof data.sessionId !== 'string' || !/^cs_[a-zA-Z0-9_]{1,250}$/.test(data.sessionId)) throw new Error('Invalid Checkout Session.')
    return data
  })
  .handler(async ({ data }) => {
    const { getPremiumPaymentStatus } = await import('./payment-links.server')
    return getPremiumPaymentStatus(data.sessionId)
  })
