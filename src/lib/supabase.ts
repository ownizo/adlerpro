import { createBrowserClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { parse, serialize } from 'cookie'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

function createSafeClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    // Return a placeholder that won't crash during SSR when env vars are missing.
    // Auth-dependent features will simply see no session.
    return createClient('https://placeholder.supabase.co', 'placeholder')
  }
  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        if (typeof document === 'undefined') return []
        const parsed = parse(document.cookie)
        return Object.keys(parsed).map((name) => ({ name, value: parsed[name] ?? '' }))
      },
      setAll(cookiesToSet) {
        if (typeof document === 'undefined') return
        cookiesToSet.forEach(({ name, value, options }) => {
          if (value) {
            // Non-empty value → session cookie: strip maxAge and expires so the browser
            // discards the cookie when it closes, instead of persisting it for 400 days.
            // All other attributes (path, sameSite, httpOnly, secure…) are preserved.
            const { maxAge: _maxAge, expires: _expires, ...sessionOptions } = options
            document.cookie = serialize(name, value, sessionOptions)
          } else {
            // Empty value = cookie removal. Keep maxAge: 0 so the browser deletes it
            // immediately (required for logout and token rotation cleanup).
            document.cookie = serialize(name, value, { ...options, maxAge: 0 })
          }
        })
      },
    },
  })
}

export const supabase = createSafeClient()
