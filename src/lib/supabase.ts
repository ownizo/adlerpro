import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

function createSafeClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    // Return a placeholder that won't crash during SSR when env vars are missing.
    // Auth-dependent features will simply see no session.
    return createClient('https://placeholder.supabase.co', 'placeholder')
  }
  return createClient(supabaseUrl, supabaseAnonKey)
}

export const supabase = createSafeClient()
