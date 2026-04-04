import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// No TanStack Start (Vite SSR), as variáveis VITE_ estão disponíveis via import.meta.env
// As variáveis sem prefixo VITE_ (server-only) estão disponíveis via process.env
const supabaseUrl =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL as string) ||
  process.env.VITE_SUPABASE_URL ||
  ''
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

function createSafeAdminClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return createClient('https://placeholder.supabase.co', 'placeholder', {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export const supabaseAdmin = createSafeAdminClient()
