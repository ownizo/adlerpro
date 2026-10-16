import type { Config } from '@netlify/functions'
import { authenticateRequest } from '../lib/policy-auth.mts'
import { expenseAdminClient, extractExpense } from '../lib/expense-ai.mts'

// Reads an uploaded expense invoice (photo or PDF) with Claude and stores the
// extracted fields on the expense row for review. Admin only.

export default async (req: Request) => {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })

  let user
  try {
    user = await authenticateRequest(req)
  } catch (res) {
    if (res instanceof Response) return res
    return Response.json({ error: 'Não autenticado' }, { status: 401 })
  }
  const roles = Array.isArray(user.app_metadata?.roles) ? user.app_metadata.roles : []
  if (!roles.includes('admin')) return Response.json({ error: 'Sem permissão' }, { status: 403 })

  let id = ''
  try {
    const body = await req.json() as { id?: unknown }
    id = typeof body.id === 'string' ? body.id : ''
  } catch { /* handled below */ }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: 'Despesa inválida' }, { status: 400 })

  const result = await extractExpense(expenseAdminClient(), id)
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status })
  return Response.json({ expense: result.expense })
}

export const config: Config = {
  path: '/api/expense-extract',
}
