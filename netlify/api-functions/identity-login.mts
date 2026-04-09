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
  const payload = JSON.parse(event.body || '{}')
  const email = String(payload?.user?.email || '').toLowerCase()
  const previousRoles = Array.isArray(payload?.app_metadata?.roles) ? payload.app_metadata.roles : []

  let companyMetadata: { company_id?: string; company_user_id?: string; company_role?: string } = {}
  let mergedRoles = previousRoles
  if (email) {
    const supabase = getSupabaseAdmin()
    const { data: userRow } = await supabase
      .from('company_users')
      .select('id, company_id, role')
      .ilike('email', email)
      .maybeSingle()

    if (userRow) {
      const now = new Date().toISOString()
      await supabase
        .from('company_users')
        .update({
          last_login_at: now,
          identity_status: 'confirmed',
          updated_at: now,
        })
        .eq('id', userRow.id)

      companyMetadata = {
        company_id: userRow.company_id,
        company_user_id: userRow.id,
        company_role: userRow.role ?? 'employee',
      }

      const roleSet = new Set([
        ...previousRoles,
        'client',
        'company-user',
        `company:${companyMetadata.company_role}`,
      ])
      mergedRoles = Array.from(roleSet)

      await supabase.from('user_metric_events').insert({
        id: `evt_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
        company_id: userRow.company_id,
        user_id: userRow.id,
        timestamp: now,
        type: 'login',
        description: 'Início de sessão no painel de cliente',
      })
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      app_metadata: {
        ...payload?.app_metadata,
        roles: mergedRoles,
      },
      user_metadata: {
        ...payload?.user_metadata,
        ...companyMetadata,
        last_login_tracked_at: new Date().toISOString(),
      },
    }),
  }
}

export { handler }
