import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export function CallbackHandler({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const hash = window.location.hash
    if (!hash) return

    // Supabase puts auth tokens in the URL hash after email confirmation, recovery, etc.
    const params = new URLSearchParams(hash.replace('#', ''))
    const type = params.get('type')
    const accessToken = params.get('access_token')

    if (!accessToken) return

    let cancelled = false

    const processCallback = async () => {
      try {
        if (type === 'signup' || type === 'email') {
          // Email confirmation callback
          const cleanUrl = `${window.location.pathname}?email_confirmed=1`
          window.location.replace(cleanUrl)
          return
        }

        if (type === 'recovery') {
          // Password recovery - Supabase sets the session automatically
          window.location.replace('/login?recovery=1')
          return
        }

        if (type === 'invite') {
          window.location.replace('/login?recovery=1')
          return
        }

        // Default: clean URL
        if (!cancelled) {
          const cleanUrl = `${window.location.pathname}${window.location.search}`
          window.history.replaceState(null, '', cleanUrl)
        }
      } catch {
        const cleanUrl = `${window.location.pathname}${window.location.search}`
        window.history.replaceState(null, '', cleanUrl)
      }
    }

    processCallback()
    return () => {
      cancelled = true
    }
  }, [])

  return <>{children}</>
}
