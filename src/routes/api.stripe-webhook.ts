import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/stripe-webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handlePremiumWebhook } = await import('@/lib/premium-payment-webhook.server')
        return handlePremiumWebhook(request)
      },
    },
  },
})
