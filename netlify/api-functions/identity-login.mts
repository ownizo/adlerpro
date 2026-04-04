import type { Handler, HandlerEvent } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const handler: Handler = async (event: HandlerEvent) => {
  const payload = JSON.parse(event.body || '{}')
  const email = String(payload?.user?.email || '').toLowerCase()
  const previousRoles = Array.isArray(payload?.app_metadata?.roles) ? payload.app_metadata.roles : []

  let companyMetadata: { company_id?: string; company_user_id?: string; company_role?: string } = {}
  let mergedRoles = previousRoles
  if (email) {
    const store = getStore({ name: 'portal-data', consistency: 'strong' })
    const users = (await store.get('company-users', { type: 'json' })) as any[] || []
    const userIndex = users.findIndex((user) => user.email?.toLowerCase() === email)

    if (userIndex >= 0) {
      const now = new Date().toISOString()
      users[userIndex] = {
        ...users[userIndex],
        lastLoginAt: now,
        identityStatus: 'confirmed',
        updatedAt: now,
      }
      await store.setJSON('company-users', users)
      companyMetadata = {
        company_id: users[userIndex].companyId,
        company_user_id: users[userIndex].id,
        company_role: users[userIndex].role ?? 'employee',
      }

      const roleSet = new Set([
        ...previousRoles,
        'client',
        'company-user',
        `company:${companyMetadata.company_role}`,
      ])
      mergedRoles = Array.from(roleSet)

      const events = (await store.get('user-metric-events', { type: 'json' })) as any[] || []
      events.push({
        id: `evt_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
        companyId: users[userIndex].companyId,
        userId: users[userIndex].id,
        timestamp: now,
        type: 'login',
        description: 'Início de sessão no painel de cliente',
      })
      await store.setJSON('user-metric-events', events)
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
