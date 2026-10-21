import { createFileRoute, redirect } from '@tanstack/react-router'
import { getServerHostname } from '@/lib/auth'
import { isMyCoverVault } from '@/lib/one-brand'

// No landing page: the root goes straight to a sign-in screen.
//   • MillionGuard (and the old My Cover Vault address) → the client login
//   • the backoffice and any other deploy → the backoffice login
export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const hostname = typeof window !== 'undefined'
      ? window.location.hostname
      : await getServerHostname()

    if (isMyCoverVault() || /(millionguard|mycovervault)\.com$/i.test(hostname ?? '')) {
      throw redirect({ to: '/portal/login' })
    }
    throw redirect({ to: '/login' })
  },
})
