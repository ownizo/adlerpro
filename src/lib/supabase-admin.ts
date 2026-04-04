import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy initialization — garante que process.env está disponível quando o cliente é criado,
// evitando o problema de singleton criado antes das variáveis de ambiente estarem disponíveis.
let _supabaseAdmin: SupabaseClient | null = null

function createAdminClient(): SupabaseClient {
  // Usar process.env directamente (sem import.meta.env que é substituído por {} no SSR bundle)
  const url = process.env['VITE_SUPABASE_URL'] ?? ''
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? ''

  if (!url || !key) {
    return createClient('https://placeholder.supabase.co', 'placeholder', {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

// Proxy lazy para garantir que as env vars estão disponíveis no momento da primeira chamada
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!_supabaseAdmin) {
      _supabaseAdmin = createAdminClient()
    }
    return (_supabaseAdmin as any)[prop]
  },
})
