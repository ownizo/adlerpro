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
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [termsExpanded, setTermsExpanded] = useState(false)

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
    if (!termsAccepted) {
      setError('Deve aceitar os Termos e Condições para criar conta.')
      return
    }
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
          <img src="/logo.png" alt="Adler & Rochefort" style={{ height: '72px', width: 'auto', margin: '0 auto 1rem' }} />
          <h1 style={{
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 700,
            fontSize: '1.1rem',
            letterSpacing: '0.04em',
            textTransform: 'uppercase' as const,
            color: '#111111',
          }}>
            Adler<span style={{ color: '#C8961A' }}>.</span>Pro
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

              {mode === 'signup' && (
                <div style={{ marginTop: '0.5rem' }}>
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id="terms-checkbox"
                      checked={termsAccepted}
                      onChange={(e) => setTermsAccepted(e.target.checked)}
                      style={{ marginTop: '3px', accentColor: '#C8961A', cursor: 'pointer', minWidth: '16px' }}
                    />
                    <label htmlFor="terms-checkbox" style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.75rem', color: '#666666', cursor: 'pointer', lineHeight: '1.4' }}>
                      Li e aceito os{' '}
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); setTermsExpanded(!termsExpanded) }}
                        style={{ fontWeight: 600, color: '#C8961A', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', textDecoration: 'underline' }}
                      >
                        Termos e Condi\u00e7\u00f5es
                      </button>
                      {' '}e a{' '}
                      <Link
                        to="/privacy-policy"
                        target="_blank"
                        style={{ fontWeight: 600, color: '#C8961A', textDecoration: 'underline', fontSize: '0.75rem' }}
                      >
                        Pol\u00edtica de Privacidade
                      </Link>
                    </label>
                  </div>

                  {termsExpanded && (
                    <div style={{
                      marginTop: '0.75rem',
                      padding: '1rem',
                      background: '#f9f9f9',
                      border: '1px solid #eeeeee',
                      borderRadius: '4px',
                      maxHeight: '200px',
                      overflowY: 'auto' as const,
                      fontSize: '0.7rem',
                      fontFamily: "'Montserrat', sans-serif",
                      color: '#555555',
                      lineHeight: '1.6',
                    }}>
                      <p style={{ fontWeight: 700, marginBottom: '0.5rem', color: '#111111', fontSize: '0.75rem' }}>Termos e Condi\u00e7\u00f5es de Utiliza\u00e7\u00e3o \u2014 Adler Pro</p>
                      <p style={{ marginBottom: '0.5rem' }}><strong>1. Objecto.</strong> O Adler Pro \u00e9 uma plataforma digital de gest\u00e3o de seguros empresariais operada pela Adler & Rochefort, Lda., mediador de seguros registado na ASF. A utiliza\u00e7\u00e3o da plataforma est\u00e1 sujeita \u00e0 aceita\u00e7\u00e3o integral destes termos.</p>
                      <p style={{ marginBottom: '0.5rem' }}><strong>2. Registo e Acesso.</strong> O utilizador compromete-se a fornecer informa\u00e7\u00f5es verdadeiras e actualizadas. As credenciais de acesso s\u00e3o pessoais e intransmiss\u00edveis. O utilizador \u00e9 respons\u00e1vel por toda a actividade realizada com as suas credenciais.</p>
                      <p style={{ marginBottom: '0.5rem' }}><strong>3. Servi\u00e7os Disponibilizados.</strong> A plataforma disponibiliza funcionalidades de gest\u00e3o de ap\u00f3lices, an\u00e1lise comparativa por IA, gest\u00e3o de sinistros, alertas de renova\u00e7\u00e3o e an\u00e1lise de risco. Os resultados gerados por IA t\u00eam car\u00e1cter informativo e n\u00e3o substituem aconselhamento profissional.</p>
                      <p style={{ marginBottom: '0.5rem' }}><strong>4. Protec\u00e7\u00e3o de Dados.</strong> Os dados pessoais s\u00e3o tratados em conformidade com o RGPD (Regulamento UE 2016/679). Os dados s\u00e3o armazenados em servidores seguros e utilizados exclusivamente para a presta\u00e7\u00e3o dos servi\u00e7os contratados. O utilizador pode exercer os seus direitos de acesso, rectifica\u00e7\u00e3o e elimina\u00e7\u00e3o contactando insurance@adlerrochefort.com.</p>
                      <p style={{ marginBottom: '0.5rem' }}><strong>5. Propriedade Intelectual.</strong> Todo o conte\u00fado, design, c\u00f3digo e funcionalidades da plataforma s\u00e3o propriedade exclusiva da Adler & Rochefort, Lda. \u00c9 proibida a reprodu\u00e7\u00e3o, distribui\u00e7\u00e3o ou utiliza\u00e7\u00e3o n\u00e3o autorizada.</p>
                      <p style={{ marginBottom: '0.5rem' }}><strong>6. Limita\u00e7\u00e3o de Responsabilidade.</strong> A Adler & Rochefort n\u00e3o se responsabiliza por decis\u00f5es tomadas com base nas an\u00e1lises geradas pela plataforma. A informa\u00e7\u00e3o apresentada n\u00e3o constitui aconselhamento jur\u00eddico, financeiro ou de seguros.</p>
                      <p style={{ marginBottom: '0.5rem' }}><strong>7. Disponibilidade.</strong> A plataforma \u00e9 disponibilizada \u201cas is\u201d. A Adler & Rochefort reserva-se o direito de suspender ou descontinuar funcionalidades mediante aviso pr\u00e9vio de 30 dias.</p>
                      <p style={{ marginBottom: '0' }}><strong>8. Lei Aplic\u00e1vel.</strong> Estes termos s\u00e3o regidos pela lei portuguesa. Para resolu\u00e7\u00e3o de lit\u00edgios \u00e9 competente o foro da comarca de Lisboa.</p>
                    </div>
                  )}

                  {termsExpanded && (
                    <button
                      type="button"
                      onClick={() => setTermsExpanded(false)}
                      style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.7rem', color: '#999999', background: 'none', border: 'none', cursor: 'pointer', marginTop: '0.25rem' }}
                    >
                      Fechar termos
                    </button>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || (mode === 'signup' && !termsAccepted)}
                className="w-full disabled:opacity-50"
                style={{
                  fontFamily: "'Montserrat', sans-serif",
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  padding: '0.7rem 1.75rem',
                  background: (mode === 'signup' && !termsAccepted) ? '#cccccc' : '#111111',
                  color: '#ffffff',
                  borderRadius: '2px',
                  border: 'none',
                  cursor: (mode === 'signup' && !termsAccepted) ? 'not-allowed' : 'pointer',
                }}
              >
                {loading
                  ? 'A processar...'
                  : mode === 'login'
                    ? 'Iniciar Sess\u00e3o'
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
