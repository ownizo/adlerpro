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

interface IdentityUserSummary {
  id: string
  email?: string | null
}

function findIdentityUserByEmail(users: IdentityUserSummary[], email: string): IdentityUserSummary | undefined {
  const normalizedEmail = email.toLowerCase()
  return users.find((user) => user.email?.toLowerCase() === normalizedEmail)
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
  const { data, error: listError } = await supabaseAdmin.auth.admin.listUsers()
  if (listError) throw new Error('Falha ao listar utilizadores.')

  const users: IdentityUserSummary[] = (data?.users ?? []) as IdentityUserSummary[]
  const user = findIdentityUserByEmail(users, email)
  if (!user) {
    // Se o utilizador não existe no Auth, criar com a nova password
    const { error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: email.toLowerCase(),
      password,
      email_confirm: true,
    })
    if (createError) throw new Error('Falha ao criar utilizador no Auth: ' + createError.message)
    return
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password })
  if (error) throw new Error('Falha ao atualizar password: ' + error.message)
}

export async function deleteIdentityUserByEmail(email: string): Promise<void> {
  const { data, error: listError } = await supabaseAdmin.auth.admin.listUsers()
  if (listError) throw new Error('Falha ao listar utilizadores.')

  const users: IdentityUserSummary[] = (data?.users ?? []) as IdentityUserSummary[]
  const user = findIdentityUserByEmail(users, email)
  if (!user) return // Utilizador não existe no Auth, nada a fazer

  const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id)
  if (error) throw new Error('Falha ao eliminar utilizador do Auth: ' + error.message)
}
