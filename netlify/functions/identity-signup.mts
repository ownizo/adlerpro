import type { Handler, HandlerEvent } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const handler: Handler = async (event: HandlerEvent) => {
  const user = JSON.parse(event.body || '{}')
  const email = String(user.email || '').toLowerCase()

  const isAdmin = email.endsWith('@adlerrochefort.com')
  const store = getStore({ name: 'portal-data', consistency: 'strong' })
  const companyUsers = (await store.get('company-users', { type: 'json' })) as Array<{
    id: string
    email: string
    companyId: string
    role?: string
  }> | null
  const companyUser = companyUsers?.find((item) => item.email.toLowerCase() === email)
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
        company_id: companyUser?.companyId,
        company_user_id: companyUser?.id,
        company_role: companyRole,
      },
    }),
  }
}

export { handler }
