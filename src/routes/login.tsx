import { createFileRoute, useNavigate, Navigate, Link } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { useIdentity } from '@/lib/identity-context'
import { useEffect, useState } from 'react'

type AuthMode = 'login' | 'signup' | 'forgot' | 'recovery'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const { user, ready, logout } = useIdentity()
  const navigate = useNavigate()
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [confirmationMessage, setConfirmationMessage] = useState('')
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [signupSuccess, setSignupSuccess] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    if (params.get('recovery') === '1') {
      setMode('recovery')
      setError('')
      setRecoveryMessage('Defina uma nova palavra-passe para concluir a recuperação.')
    } else if (params.get('forgot') === '1') {
      setMode('forgot')
      setError('')
    }

    if (params.get('email_confirmed') === '1') {
      setConfirmationMessage('Email validado com sucesso. Inicie sessão para continuar.')
      params.delete('email_confirmed')
      const query = params.toString()
      const cleaned = `${window.location.pathname}${query ? `?${query}` : ''}`
      window.history.replaceState(null, '', cleaned)
    }
  }, [])

  const isPasswordSetupMode = mode === 'recovery'

  if (!ready) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div style={{ color: '#666666', fontFamily: "'Montserrat', sans-serif" }}>A carregar...</div>
      </div>
    )
  }

  if (user && !isPasswordSetupMode) {
    const isAdmin = user.roles?.includes('admin')
    return <Navigate to={isAdmin ? '/admin' : '/dashboard'} />
  }

  const resetLocalAuthForm = () => {
    setPassword('')
    setPasswordConfirmation('')
    setError('')
  }

  const formatLoginError = (err: any) => {
    const message = typeof err?.message === 'string' ? err.message : ''
    if (/invalid.*credentials/i.test(message) || /invalid login/i.test(message)) {
      return 'Email ou palavra-passe inválidos.'
    }
    if (/email not confirmed/i.test(message)) {
      return 'O email ainda não foi confirmado. Abra o link de confirmação enviado para o seu email.'
    }
    return message || 'Erro ao iniciar sessão.'
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      // Redirecionar com base no role (app_metadata.roles)
      const roles: string[] = (data.user?.app_metadata?.roles as string[]) ?? []
      const isAdmin = roles.includes('admin')
      navigate({ to: isAdmin ? '/admin' : '/dashboard' })
    } catch (err: any) {
      setError(formatLoginError(err))
    } finally {
      setLoading(false)
    }
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name },
        },
      })
      if (error) throw error
      setSignupSuccess(true)
    } catch (err: any) {
      setError(err?.message || 'Erro ao criar conta.')
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordRecovery = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email) {
      setError('Introduza o email para recuperar a palavra-passe.')
      return
    }

    setError('')
    setRecoveryMessage('')
    setRecoveryLoading(true)

    try {
      const siteUrl = window.location.origin
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl}/login?recovery=1`,
      })
      if (error) throw error
      setRecoveryMessage('Foi enviado um email com instruções para redefinir a palavra-passe.')
    } catch (err: any) {
      setError(err?.message || 'Não foi possível enviar o email de recuperação.')
    } finally {
      setRecoveryLoading(false)
    }
  }

  const handlePasswordSetup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('A palavra-passe deve ter pelo menos 6 caracteres.')
      return
    }

    if (password !== passwordConfirmation) {
      setError('A confirmação da palavra-passe não coincide.')
      return
    }

    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error

      await logout().catch(() => undefined)
      setMode('login')
      setRecoveryMessage('Palavra-passe redefinida com sucesso. Inicie sessão com a nova credencial.')
      resetLocalAuthForm()
    } catch (err: any) {
      setError(err?.message || 'Não foi possível definir a palavra-passe.')
    } finally {
      setLoading(false)
    }
  }

  if (signupSuccess) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="w-full max-w-md p-8 text-center" style={{ border: '1px solid #eeeeee', borderRadius: '4px' }}>
          <div className="w-16 h-16 flex items-center justify-center mx-auto mb-4" style={{ background: '#EAF3DE', borderRadius: '50%' }}>
            <svg className="w-8 h-8" style={{ color: '#3B6D11' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '1.75rem', color: '#111111', marginBottom: '0.5rem' }}>
            Conta Criada
          </h2>
          <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, color: '#555555', marginBottom: '1.5rem' }}>
            Foi enviado um email de confirmação para <strong>{email}</strong>.
            Clique no link no email para ativar a sua conta.
          </p>
          <button
            onClick={() => { setSignupSuccess(false); setMode('login') }}
            style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, color: '#C8961A', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Voltar ao início de sessão
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Adler & Rochefort" className="h-16 w-auto mx-auto mb-4" />
          <h1 style={{
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 700,
            fontSize: '1.1rem',
            letterSpacing: '0.04em',
            textTransform: 'uppercase' as const,
            color: '#111111',
          }}>
            VAULT<span style={{ color: '#C8961A' }}>.</span>SUITE
          </h1>
          <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.85rem', color: '#999999', marginTop: '0.5rem' }}>
            Portal do Cliente Empresarial
          </p>
        </div>

        <div style={{ border: '1px solid #eeeeee', borderRadius: '4px', padding: '2rem' }}>
          {!isPasswordSetupMode && mode !== 'forgot' && (
            <div className="flex mb-6" style={{ background: '#f8f8f8', borderRadius: '2px', padding: '3px' }}>
              <button
                onClick={() => { setMode('login'); setError('') }}
                className="flex-1 py-2 text-sm transition-colors"
                style={{
                  fontFamily: "'Montserrat', sans-serif",
                  fontWeight: 600,
                  borderRadius: '2px',
                  ...(mode === 'login'
                    ? { background: '#111111', color: '#ffffff' }
                    : { background: 'transparent', color: '#666666' }),
                }}
              >
                Iniciar Sessão
              </button>
              <button
                onClick={() => { setMode('signup'); setError('') }}
                className="flex-1 py-2 text-sm transition-colors"
                style={{
                  fontFamily: "'Montserrat', sans-serif",
                  fontWeight: 600,
                  borderRadius: '2px',
                  ...(mode === 'signup'
                    ? { background: '#111111', color: '#ffffff' }
                    : { background: 'transparent', color: '#666666' }),
                }}
              >
                Criar Conta
              </button>
            </div>
          )}

          {(mode === 'login' || mode === 'signup') && (
            <form onSubmit={mode === 'login' ? handleLogin : handleSignup} className="space-y-4">
              {mode === 'signup' && (
                <div>
                  <label style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.75rem', color: '#999999', display: 'block', marginBottom: '0.25rem' }}>
                    Nome completo
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-2.5 text-sm"
                    style={{ border: '1px solid #eeeeee', borderRadius: '2px', fontFamily: "'Montserrat', sans-serif", outline: 'none' }}
                    placeholder="Ana Ferreira"
                    required
                  />
                </div>
              )}
              <div>
                <label style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.75rem', color: '#999999', display: 'block', marginBottom: '0.25rem' }}>
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm"
                  style={{ border: '1px solid #eeeeee', borderRadius: '2px', fontFamily: "'Montserrat', sans-serif", outline: 'none' }}
                  placeholder="nome@empresa.pt"
                  required
                />
              </div>
              <div>
                <label style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.75rem', color: '#999999', display: 'block', marginBottom: '0.25rem' }}>
                  Palavra-passe
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm"
                  style={{ border: '1px solid #eeeeee', borderRadius: '2px', fontFamily: "'Montserrat', sans-serif", outline: 'none' }}
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
              </div>

              {error && (
                <div className="text-sm p-3" style={{ background: '#FAEEDA', color: '#854F0B', borderRadius: '2px' }}>
                  {error}
                </div>
              )}
              {recoveryMessage && (
                <div className="text-sm p-3" style={{ background: '#EAF3DE', color: '#3B6D11', borderRadius: '2px' }}>
                  {recoveryMessage}
                </div>
              )}
              {confirmationMessage && (
                <div className="text-sm p-3" style={{ background: '#EAF3DE', color: '#3B6D11', borderRadius: '2px' }}>
                  {confirmationMessage}
                </div>
              )}

              {mode === 'login' && (
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot')
                      setError('')
                      setRecoveryMessage('')
                    }}
                    style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, color: '#C8961A', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    Esqueceu-se da palavra-passe?
                  </button>
                  <Link
                    to="/"
                    style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, color: '#666666', textDecoration: 'none' }}
                  >
                    Voltar à página inicial
                  </Link>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full disabled:opacity-50"
                style={{
                  fontFamily: "'Montserrat', sans-serif",
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  padding: '0.7rem 1.75rem',
                  background: '#111111',
                  color: '#ffffff',
                  borderRadius: '2px',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {loading
                  ? 'A processar...'
                  : mode === 'login'
                    ? 'Iniciar Sessão'
                    : 'Criar Conta'}
              </button>
            </form>
          )}

          {mode === 'forgot' && (
            <form onSubmit={handlePasswordRecovery} className="space-y-4">
              <p className="text-sm" style={{ color: '#666666', fontFamily: "'Montserrat', sans-serif" }}>
                Introduza o email da conta para receber o link de redefinição.
              </p>
              <div>
                <label style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.75rem', color: '#999999', display: 'block', marginBottom: '0.25rem' }}>
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm"
                  style={{ border: '1px solid #eeeeee', borderRadius: '2px', fontFamily: "'Montserrat', sans-serif", outline: 'none' }}
                  placeholder="nome@empresa.pt"
                  required
                />
              </div>

              {error && (
                <div className="text-sm p-3" style={{ background: '#FAEEDA', color: '#854F0B', borderRadius: '2px' }}>
                  {error}
                </div>
              )}
              {recoveryMessage && (
                <div className="text-sm p-3" style={{ background: '#EAF3DE', color: '#3B6D11', borderRadius: '2px' }}>
                  {recoveryMessage}
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login')
                    setError('')
                    setRecoveryMessage('')
                  }}
                  style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, color: '#666666', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Voltar ao login
                </button>
                <button
                  type="submit"
                  disabled={recoveryLoading}
                  className="disabled:opacity-50"
                  style={{
                    fontFamily: "'Montserrat', sans-serif",
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    padding: '0.7rem 1.75rem',
                    background: '#111111',
                    color: '#ffffff',
                    borderRadius: '2px',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {recoveryLoading ? 'A enviar...' : 'Enviar link'}
                </button>
              </div>
            </form>
          )}

          {isPasswordSetupMode && (
            <form onSubmit={handlePasswordSetup} className="space-y-4">
              <p className="text-sm" style={{ color: '#666666', fontFamily: "'Montserrat', sans-serif" }}>
                Defina a nova palavra-passe para concluir a recuperação.
              </p>

              <div>
                <label style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.75rem', color: '#999999', display: 'block', marginBottom: '0.25rem' }}>
                  Nova palavra-passe
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm"
                  style={{ border: '1px solid #eeeeee', borderRadius: '2px', fontFamily: "'Montserrat', sans-serif", outline: 'none' }}
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
              </div>
              <div>
                <label style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.75rem', color: '#999999', display: 'block', marginBottom: '0.25rem' }}>
                  Confirmar palavra-passe
                </label>
                <input
                  type="password"
                  value={passwordConfirmation}
                  onChange={(e) => setPasswordConfirmation(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm"
                  style={{ border: '1px solid #eeeeee', borderRadius: '2px', fontFamily: "'Montserrat', sans-serif", outline: 'none' }}
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
              </div>

              {error && (
                <div className="text-sm p-3" style={{ background: '#FAEEDA', color: '#854F0B', borderRadius: '2px' }}>
                  {error}
                </div>
              )}
              {recoveryMessage && (
                <div className="text-sm p-3" style={{ background: '#EAF3DE', color: '#3B6D11', borderRadius: '2px' }}>
                  {recoveryMessage}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full disabled:opacity-50"
                style={{
                  fontFamily: "'Montserrat', sans-serif",
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  padding: '0.7rem 1.75rem',
                  background: '#111111',
                  color: '#ffffff',
                  borderRadius: '2px',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {loading ? 'A processar...' : 'Guardar nova palavra-passe'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
