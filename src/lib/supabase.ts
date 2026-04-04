import { createBrowserClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

function createSafeClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    // Return a placeholder that won't crash during SSR when env vars are missing.
    // Auth-dependent features will simply see no session.
    return createClient('https://placeholder.supabase.co', 'placeholder')
  }
  // Use createBrowserClient from @supabase/ssr to store session in cookies
  // This allows the server-side functions to read the auth token from cookies
  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}

export const supabase = createSafeClient()
