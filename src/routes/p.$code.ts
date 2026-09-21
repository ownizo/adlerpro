import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/p/$code')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { resolvePremiumShortLink } = await import('@/lib/premium-shortlink.server')
        return resolvePremiumShortLink(params.code)
      },
    },
  },
})
