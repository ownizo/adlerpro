import { supabaseAdmin } from './supabase-admin'

interface IdentitySignupPayload {
  email: string
  password: string
  fullName?: string
  companyId?: string
  companyUserId?: string
  companyRole?: string
}

interface IdentitySignupResult {
  created: boolean
  reason?: string
}

export async function createIdentityUserWithConfirmation(
  payload: IdentitySignupPayload
): Promise<IdentitySignupResult> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: payload.email.toLowerCase(),
    password: payload.password,
    email_confirm: true,
    user_metadata: {
      full_name: payload.fullName,
      company_id: payload.companyId,
      company_user_id: payload.companyUserId,
      company_role: payload.companyRole,
    },
  })

  if (data?.user) {
    return { created: true }
  }

  if (error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      return { created: false, reason: 'already_exists' }
    }
    if (error.status === 422 || msg.includes('weak') || msg.includes('invalid')) {
      throw new Error('Não foi possível criar o utilizador: dados inválidos ou password fraca.')
    }
    throw new Error(`Falha ao criar utilizador (${error.status ?? 'unknown'}).`)
  }

  return { created: true }
}

export async function updateIdentityUserPasswordByEmail(email: string, password: string): Promise<void> {
  const normalizedEmail = email.toLowerCase()

  const { data, error: listError } = await supabaseAdmin.auth.admin.listUsers()
  if (listError) throw new Error('Falha ao listar utilizadores.')

  const user = data.users.find((u) => u.email?.toLowerCase() === normalizedEmail)
  if (!user) throw new Error('Utilizador não encontrado para atualização de password.')

  const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password })
  if (error) throw new Error('Falha ao atualizar password: ' + error.message)
}
