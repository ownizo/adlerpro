import { createServerFn } from '@tanstack/react-start'
import { requireRoleMiddleware } from '@/middleware/identity'
import { validatePaymentLinkInput } from './payment-link-validation'

export const createPremiumPaymentLink = createServerFn({ method: 'POST' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator(validatePaymentLinkInput)
  .handler(async ({ data, context }) => {
    const { createStripePremiumLink } = await import('./payment-links.server')
    return createStripePremiumLink(data, context.user.id)
  })
