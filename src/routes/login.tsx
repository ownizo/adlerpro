import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { useIdentity } from '@/lib/identity-context'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '@/lib/i18n'
import { resolvePostLogin } from '@/lib/post-login-destination'

const TERMS_VERSION = '2025-01'

type AuthMode = 'login' | 'signup' | 'forgot' | 'recovery'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const { t } = useTranslation()
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
  const [lang, setLang] = useState(i18n.language)
  const handleLang = (l: string) => { i18n.changeLanguage(l); setLang(l) }
  // Estado "conta por configurar" (segmento 'unknown' e não-admin).
  const [unconfigured, setUnconfigured] = useState(false)
  // Estado "não foi possível carregar o perfil" (falha persistente a resolver
  // o segmento) — distinto de unconfigured e de qualquer destino de portal.
  const [loadError, setLoadError] = useState(false)
  // Bump para re-correr a decisão de destino (botão "tentar novamente").
  const [retryNonce, setRetryNonce] = useState(0)
  // Garante que a decisão de destino corre uma só vez por sessão estabelecida.
  const redirectStartedRef = useRef(false)

  const font = "'Montserrat', sans-serif"
  const langPill = (
    <div style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 50, display: 'flex', alignItems: 'center', border: '1px solid #dddddd', borderRadius: '4px', overflow: 'hidden', fontFamily: font }}>
      {(['pt', 'en'] as const).map((l) => (
        <button
          key={l}
          onClick={() => handleLang(l)}
          style={{
            background: lang === l ? '#111111' : 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '0.25rem 0.6rem',
            fontFamily: font,
            fontSize: '0.7rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: lang === l ? '#ffffff' : '#888888',
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    if (params.get('recovery') === '1') {
      setMode('recovery')
      setError('')
      setRecoveryMessage(t('auth.recoveryTitle'))
    } else if (params.get('forgot') === '1') {
      setMode('forgot')
      setError('')
    }

    if (params.get('email_confirmed') === '1') {
      setConfirmationMessage(t('auth.emailValidated'))
      params.delete('email_confirmed')
      const query = params.toString()
      const cleaned = `${window.location.pathname}${query ? `?${query}` : ''}`
      window.history.replaceState(null, '', cleaned)
    }
  }, [])

  const isPasswordSetupMode = mode === 'recovery'

  // Decisão de destino pós-login centralizada (única fonte: resolvePostLogin).
  // Corre uma só vez quando há sessão e não estamos a definir palavra-passe;
  // não acontece em cada navegação — apenas nesta página de entrada.
  useEffect(() => {
    if (!ready || !user || isPasswordSetupMode) return
    if (redirectStartedRef.current) return
    redirectStartedRef.current = true
    let cancelled = false
    void (async () => {
      const isAdmin = Boolean(user.roles?.includes('admin'))
      const decision = await resolvePostLogin(isAdmin)
      if (cancelled) return
      if (decision.status === 'redirect') navigate({ to: decision.to })
      else if (decision.status === 'unconfigured') setUnconfigured(true)
      else setLoadError(true)
    })()
    return () => { cancelled = true }
  }, [ready, user, isPasswordSetupMode, retryNonce])

  if (!ready) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        {langPill}
        <div style={{ color: '#666666', fontFamily: "'Montserrat', sans-serif" }}>{t('common.loading')}</div>
      </div>
    )
  }

  if (user && !isPasswordSetupMode) {
    // Conta autenticada mas sem perfil de cliente associado: estado explícito,
    // sem redirect (logo, sem loop) e sem ecrã em branco.
    if (unconfigured) {
      return (
        <div className="min-h-screen bg-white flex items-center justify-center px-4">
          {langPill}
          <div className="w-full max-w-md p-8 text-center" style={{ border: '1px solid #eeeeee', borderRadius: '4px' }}>
            <div className="w-16 h-16 flex items-center justify-center mx-auto mb-4" style={{ background: '#FAEEDA', borderRadius: '50%' }}>
              <svg className="w-8 h-8" style={{ color: '#854F0B' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <h2 style={{ fontFamily: font, fontWeight: 700, fontSize: '1.4rem', color: '#111111', marginBottom: '0.75rem' }}>
              {t('auth.accountPendingTitle')}
            </h2>
            <p style={{ fontFamily: font, fontWeight: 300, fontSize: '0.85rem', color: '#555555', lineHeight: 1.6, marginBottom: '1.5rem' }}>
              {t('auth.accountPendingBody')}
            </p>
            <button
              onClick={async () => {
                await logout().catch(() => undefined)
                setUnconfigured(false)
                redirectStartedRef.current = false
              }}
              style={{ fontFamily: font, fontWeight: 600, fontSize: '0.85rem', padding: '0.6rem 1.5rem', background: '#111111', color: '#ffffff', borderRadius: '2px', border: 'none', cursor: 'pointer' }}
            >
              {t('common.logout')}
            </button>
          </div>
        </div>
      )
    }
    // Falha persistente a resolver o segmento: estado explícito com retry.
    // Não há redirect para portal (evita mandar um B2C para o portal B2B).
    if (loadError) {
      return (
        <div className="min-h-screen bg-white flex items-center justify-center px-4">
          {langPill}
          <div className="w-full max-w-md p-8 text-center" style={{ border: '1px solid #eeeeee', borderRadius: '4px' }}>
            <div className="w-16 h-16 flex items-center justify-center mx-auto mb-4" style={{ background: '#FEE2E2', borderRadius: '50%' }}>
              <svg className="w-8 h-8" style={{ color: '#991B1B' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 style={{ fontFamily: font, fontWeight: 700, fontSize: '1.4rem', color: '#111111', marginBottom: '0.75rem' }}>
              {t('auth.profileLoadErrorTitle')}
            </h2>
            <p style={{ fontFamily: font, fontWeight: 300, fontSize: '0.85rem', color: '#555555', lineHeight: 1.6, marginBottom: '1.5rem' }}>
              {t('auth.profileLoadErrorBody')}
            </p>
            <button
              onClick={() => {
                setLoadError(false)
                redirectStartedRef.current = false
                setRetryNonce((n) => n + 1)
              }}
              style={{ fontFamily: font, fontWeight: 600, fontSize: '0.85rem', padding: '0.6rem 1.5rem', background: '#111111', color: '#ffffff', borderRadius: '2px', border: 'none', cursor: 'pointer' }}
            >
              {t('common.retry')}
            </button>
          </div>
        </div>
      )
    }
    // Destino a ser resolvido pelo segmento — ecrã de transição.
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        {langPill}
        <div style={{ color: '#666666', fontFamily: font }}>{t('common.redirecting')}</div>
      </div>
    )
  }

  const resetLocalAuthForm = () => {
    setPassword('')
    setPasswordConfirmation('')
    setError('')
  }

  const formatLoginError = (err: any) => {
    const message = typeof err?.message === 'string' ? err.message : ''
    if (/invalid.*credentials/i.test(message) || /invalid login/i.test(message)) {
      return t('auth.errors.invalidCredentials')
    }
    if (/email not confirmed/i.test(message)) {
      return t('auth.errors.emailNotConfirmed')
    }
    return message || t('auth.errors.signInError')
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      // Destino decidido centralmente pelo effect de routing assim que a sessão
      // fica disponível (onAuthStateChange) — ver resolvePostLogin.
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
      setError(t('auth.errors.termsRequired'))
      return
    }
    setLoading(true)
    try {
      const termsAcceptedAt = new Date().toISOString()
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
            terms_accepted_at: termsAcceptedAt,
            terms_version: TERMS_VERSION,
          },
        },
      })
      if (error) throw error

      if (data.user?.id) {
        try {
          await fetch('/api/record-terms-acceptance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: data.user.id, terms_version: TERMS_VERSION }),
          })
        } catch {
          // Falha silenciosa
        }
      }

      setSignupSuccess(true)
    } catch (err: any) {
      setError(err?.message || t('auth.errors.signUpError'))
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordRecovery = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email) {
      setError(t('auth.errors.emailRequired'))
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
      setRecoveryMessage(t('auth.linkSent'))
    } catch (err: any) {
      setError(err?.message || t('auth.errors.sendLinkFailed'))
    } finally {
      setRecoveryLoading(false)
    }
  }

  const handlePasswordSetup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError(t('auth.errors.passwordTooShort'))
      return
    }

    if (password !== passwordConfirmation) {
      setError(t('auth.errors.passwordMismatch'))
      return
    }

    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error

      await logout().catch(() => undefined)
      setMode('login')
      setRecoveryMessage(t('auth.passwordReset'))
      resetLocalAuthForm()
    } catch (err: any) {
      setError(err?.message || t('auth.errors.passwordChangeFailed'))
    } finally {
      setLoading(false)
    }
  }

  if (signupSuccess) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        {langPill}
        <div className="w-full max-w-md p-8 text-center" style={{ border: '1px solid #eeeeee', borderRadius: '4px' }}>
          <div className="w-16 h-16 flex items-center justify-center mx-auto mb-4" style={{ background: '#EAF3DE', borderRadius: '50%' }}>
            <svg className="w-8 h-8" style={{ color: '#3B6D11' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '1.75rem', color: '#111111', marginBottom: '0.5rem' }}>
            {t('auth.accountCreated')}
          </h2>
          <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, color: '#555555', marginBottom: '1.5rem' }}>
            {t('auth.confirmationSent', { email })}
          </p>
          <button
            onClick={() => { setSignupSuccess(false); setMode('login') }}
            style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, color: '#C8961A', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {t('auth.backToSignIn')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      {langPill}
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
            Os Meus Seguros
          </h1>
          <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.7rem', color: '#C8961A', marginTop: '0.4rem', letterSpacing: '0.08em' }}>
            by Adler &amp; Rochefort
          </p>
          <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.85rem', color: '#999999', marginTop: '0.5rem' }}>
            {t('common.portal')}
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
                {t('auth.signIn')}
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
                {t('auth.createAccount')}
              </button>
            </div>
          )}

          {(mode === 'login' || mode === 'signup') && (
            <form onSubmit={mode === 'login' ? handleLogin : handleSignup} className="space-y-4">
              {mode === 'signup' && (
                <div>
                  <label style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.75rem', color: '#999999', display: 'block', marginBottom: '0.25rem' }}>
                    {t('auth.fullName')}
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-2.5 text-sm"
                    style={{ border: '1px solid #eeeeee', borderRadius: '2px', fontFamily: "'Montserrat', sans-serif", outline: 'none' }}
                    placeholder={t('auth.namePlaceholder')}
                    required
                  />
                </div>
              )}
              <div>
                <label style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.75rem', color: '#999999', display: 'block', marginBottom: '0.25rem' }}>
                  {t('auth.email')}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm"
                  style={{ border: '1px solid #eeeeee', borderRadius: '2px', fontFamily: "'Montserrat', sans-serif", outline: 'none' }}
                  placeholder={t('auth.emailPlaceholder')}
                  required
                />
              </div>
              <div>
                <label style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.75rem', color: '#999999', display: 'block', marginBottom: '0.25rem' }}>
                  {t('auth.password')}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm"
                  style={{ border: '1px solid #eeeeee', borderRadius: '2px', fontFamily: "'Montserrat', sans-serif", outline: 'none' }}
                  placeholder={t('auth.passwordPlaceholder')}
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
                    {t('auth.forgotPassword')}
                  </button>
                  <Link
                    to="/"
                    style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, color: '#666666', textDecoration: 'none' }}
                  >
                    {t('auth.backToHome')}
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
                      {t('auth.termsAccept')}{' '}
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); setTermsExpanded(!termsExpanded) }}
                        style={{ fontWeight: 600, color: '#C8961A', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', textDecoration: 'underline' }}
                      >
                        {t('auth.termsLink')}
                      </button>
                      {' '}{t('auth.and')}{' '}
                      <Link
                        to="/privacy-policy"
                        target="_blank"
                        style={{ fontWeight: 600, color: '#C8961A', textDecoration: 'underline', fontSize: '0.75rem' }}
                      >
                        {t('auth.privacyLink')}
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
                      <p style={{ fontWeight: 700, marginBottom: '0.5rem', color: '#111111', fontSize: '0.75rem' }}>Termos e Condições de Utilização — Os Meus Seguros</p>
                      <p style={{ marginBottom: '0.5rem' }}><strong>1. Objecto.</strong> O Adler Pro é uma plataforma digital de gestão de seguros empresariais desenvolvida pela Ownizo Unipessoal, Lda., e operada sob a marca comercial Adler & Rochefort, dedicada à mediação de seguros e registada na ASF. A utilização da plataforma está sujeita à aceitação integral destes termos.</p>
                      <p style={{ marginBottom: '0.5rem' }}><strong>2. Registo e Acesso.</strong> O utilizador compromete-se a fornecer informações verdadeiras e actualizadas. As credenciais de acesso são pessoais e intransmissíveis. O utilizador é responsável por toda a actividade realizada com as suas credenciais.</p>
                      <p style={{ marginBottom: '0.5rem' }}><strong>3. Serviços Disponibilizados.</strong> A plataforma disponibiliza funcionalidades de gestão de apólices, análise comparativa por IA, gestão de sinistros, alertas de renovação e análise de risco. Os resultados gerados por IA têm carácter informativo e não substituem aconselhamento profissional.</p>
                      <p style={{ marginBottom: '0.5rem' }}><strong>4. Protecção de Dados.</strong> Os dados pessoais são tratados em conformidade com o RGPD (Regulamento UE 2016/679). Os dados são armazenados em servidores seguros e utilizados exclusivamente para a prestação dos serviços contratados. O utilizador pode exercer os seus direitos de acesso, rectificação e eliminação contactando insurance@adlerrochefort.com.</p>
                      <p style={{ marginBottom: '0.5rem' }}><strong>5. Condições de Acesso e Preços.</strong> A utilização do Adler Pro é gratuita e sem custos para clientes com apólices de seguro contratadas através da Adler & Rochefort. Para utilizadores que não sejam clientes da Adler & Rochefort, o acesso à plataforma está sujeito ao pagamento de uma mensalidade fixa, cujo valor será comunicado no momento do registo ou mediante consulta.</p>
                      <p style={{ marginBottom: '0.5rem' }}><strong>6. Propriedade Intelectual.</strong> Todo o conteúdo, design, código e funcionalidades da plataforma são propriedade exclusiva da Ownizo Unipessoal, Lda. É proibida a reprodução, distribuição ou utilização não autorizada.</p>
                      <p style={{ marginBottom: '0.5rem' }}><strong>7. Limitação de Responsabilidade.</strong> A Ownizo Unipessoal, Lda. e a marca Adler & Rochefort não se responsabilizam por decisões tomadas com base nas análises geradas pela plataforma. A informação apresentada não constitui aconselhamento jurídico, financeiro ou de seguros.</p>
                      <p style={{ marginBottom: '0.5rem' }}><strong>8. Disponibilidade.</strong> A plataforma é disponibilizada "as is". A Ownizo Unipessoal, Lda. reserva-se o direito de suspender ou descontinuar funcionalidades mediante aviso prévio de 30 dias.</p>
                      <p style={{ marginBottom: '0' }}><strong>9. Lei Aplicável.</strong> Estes termos são regidos pela lei portuguesa. Para resolução de litígios é competente o foro da comarca de Lisboa.</p>
                    </div>
                  )}

                  {termsExpanded && (
                    <button
                      type="button"
                      onClick={() => setTermsExpanded(false)}
                      style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.7rem', color: '#999999', background: 'none', border: 'none', cursor: 'pointer', marginTop: '0.25rem' }}
                    >
                      {t('auth.closeTerms')}
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
                  ? t('common.processing')
                  : mode === 'login'
                    ? t('auth.signIn')
                    : t('auth.createAccount')}
              </button>
            </form>
          )}

          {mode === 'forgot' && (
            <form onSubmit={handlePasswordRecovery} className="space-y-4">
              <p className="text-sm" style={{ color: '#666666', fontFamily: "'Montserrat', sans-serif" }}>
                {t('auth.forgotTitle')}
              </p>
              <div>
                <label style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.75rem', color: '#999999', display: 'block', marginBottom: '0.25rem' }}>
                  {t('auth.email')}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm"
                  style={{ border: '1px solid #eeeeee', borderRadius: '2px', fontFamily: "'Montserrat', sans-serif", outline: 'none' }}
                  placeholder={t('auth.emailPlaceholder')}
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
                  {t('auth.backToLogin')}
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
                  {recoveryLoading ? t('common.sending') : t('auth.sendLink')}
                </button>
              </div>
            </form>
          )}

          {isPasswordSetupMode && (
            <form onSubmit={handlePasswordSetup} className="space-y-4">
              <p className="text-sm" style={{ color: '#666666', fontFamily: "'Montserrat', sans-serif" }}>
                {t('auth.recoveryTitle')}
              </p>

              <div>
                <label style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.75rem', color: '#999999', display: 'block', marginBottom: '0.25rem' }}>
                  {t('auth.newPassword')}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm"
                  style={{ border: '1px solid #eeeeee', borderRadius: '2px', fontFamily: "'Montserrat', sans-serif", outline: 'none' }}
                  placeholder={t('auth.passwordPlaceholder')}
                  required
                  minLength={6}
                />
              </div>
              <div>
                <label style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.75rem', color: '#999999', display: 'block', marginBottom: '0.25rem' }}>
                  {t('auth.confirmPassword')}
                </label>
                <input
                  type="password"
                  value={passwordConfirmation}
                  onChange={(e) => setPasswordConfirmation(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm"
                  style={{ border: '1px solid #eeeeee', borderRadius: '2px', fontFamily: "'Montserrat', sans-serif", outline: 'none' }}
                  placeholder={t('auth.passwordPlaceholder')}
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
                {loading ? t('common.processing') : t('auth.saveNewPassword')}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
