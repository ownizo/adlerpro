import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? ''
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
