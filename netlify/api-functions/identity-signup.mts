import type { Handler, HandlerEvent } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function getSupabaseAdmin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

const handler: Handler = async (event: HandlerEvent) => {
  const user = JSON.parse(event.body || '{}')
  const email = String(user.email || '').toLowerCase()

  const isAdmin = email.endsWith('@adlerrochefort.com')
  const supabase = getSupabaseAdmin()
  const { data: companyUser } = await supabase
    .from('company_users')
    .select('id, email, company_id, role')
    .ilike('email', email)
    .maybeSingle()

  const companyRole = companyUser?.role ?? 'employee'

  return {
    statusCode: 200,
    body: JSON.stringify({
      app_metadata: {
        roles: isAdmin ? ['admin', 'client'] : ['client', 'company-user', `company:${companyRole}`],
      },
      user_metadata: {
        ...user?.user_metadata,
        signed_up_at: new Date().toISOString(),
        company_id: companyUser?.company_id,
        company_user_id: companyUser?.id,
        company_role: companyRole,
      },
    }),
  }
}

export { handler }
