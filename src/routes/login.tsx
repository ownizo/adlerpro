import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { useIdentity } from '@/lib/identity-context'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '@/lib/i18n'
import { resolvePostLogin } from '@/lib/post-login-destination'

// The backoffice has a single account (insurance@adlerrochefort.com, role
// 'admin'): no sign-up, no landing page, only sign-in and password recovery.
type AuthMode = 'login' | 'forgot' | 'recovery'

export const Route = createFileRoute('/login')({
  head: () => ({
    links: [{ rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Ubuntu:wght@300;400;500;700&display=swap' }],
  }),
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
  const [error, setError] = useState('')
  const [confirmationMessage, setConfirmationMessage] = useState('')
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  // The backoffice is English only: no language switcher.
  useEffect(() => { if (i18n.language !== 'en') void i18n.changeLanguage('en') }, [])
  // Estado "não foi possível concluir a entrada" (falha persistente).
  const [loadError, setLoadError] = useState(false)
  // Bump para re-correr a decisão de destino (botão "tentar novamente").
  const [retryNonce, setRetryNonce] = useState(0)
  // Garante que a decisão de destino corre uma só vez por sessão estabelecida.
  const redirectStartedRef = useRef(false)

  const font = "'Ubuntu', ui-sans-serif, -apple-system, sans-serif"
  // Brand palette, the same as the backoffice sidebar: charcoal and orange.
  const charcoal = '#292929'
  const orange = '#FF6300'

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
      // Any other account is refused here and signed out again.
      if (!isAdmin) {
        await logout().catch(() => undefined)
        if (cancelled) return
        redirectStartedRef.current = false
        setError(t('auth.errors.adminOnly'))
        return
      }
      const decision = await resolvePostLogin(isAdmin)
      if (cancelled) return
      if (decision.status === 'redirect') {
        // Came from the Claude connector consent screen → go back there.
        let back: string | null = null
        try { back = window.sessionStorage.getItem('ar-post-login-return'); window.sessionStorage.removeItem('ar-post-login-return') } catch { /* private mode */ }
        if (isAdmin && back && back.startsWith('/oauth/authorize')) { window.location.assign(back); return }
        navigate({ to: decision.to })
      }
      else setLoadError(true)
    })()
    return () => { cancelled = true }
  }, [ready, user, isPasswordSetupMode, retryNonce])

  if (!ready) {
    return (
      <div style={{ background: charcoal }} className="admin-backoffice-shell min-h-screen flex items-center justify-center">
        <div style={{ color: 'rgba(255,255,255,0.6)', fontFamily: font }}>{t('common.loading')}</div>
      </div>
    )
  }

  if (user && !isPasswordSetupMode) {
     // Falha persistente a resolver o destino: estado explícito com retry.
    if (loadError) {
      return (
        <div style={{ background: charcoal }} className="admin-backoffice-shell min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-md p-8 text-center" style={{ border: '1px solid #eeeeee', borderRadius: '4px' }}>
            <div className="w-16 h-16 flex items-center justify-center mx-auto mb-4" style={{ background: '#FEE2E2', borderRadius: '50%' }}>
              <svg className="w-8 h-8" style={{ color: '#991B1B' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 style={{ fontFamily: font, fontWeight: 700, fontSize: '1.4rem', color: charcoal, marginBottom: '0.75rem' }}>
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
              style={{ fontFamily: font, fontWeight: 600, fontSize: '0.85rem', padding: '0.6rem 1.5rem', background: orange, color: '#ffffff', borderRadius: '6px', border: 'none', cursor: 'pointer' }}
            >
              {t('common.retry')}
            </button>
          </div>
        </div>
      )
    }
    // Destino a ser resolvido pelo segmento — ecrã de transição.
    return (
      <div style={{ background: charcoal }} className="admin-backoffice-shell min-h-screen flex items-center justify-center">
        <div style={{ color: 'rgba(255,255,255,0.6)', fontFamily: font }}>{t('common.redirecting')}</div>
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

  return (
    <div style={{ background: charcoal }} className="admin-backoffice-shell min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 style={{
            fontFamily: font,
            fontWeight: 700,
            fontSize: '1.6rem',
            letterSpacing: '0.02em',
            color: '#ffffff',
          }}>
            Backoffice
          </h1>
          <p style={{ fontFamily: font, fontWeight: 500, fontSize: '0.68rem', color: '#FF8A3D', marginTop: '0.35rem', letterSpacing: '0.14em', textTransform: 'uppercase' as const }}>
            Adler &amp; Rochefort
          </p>
        </div>

        <div style={{ background: '#ffffff', borderRadius: '10px', padding: '2rem', boxShadow: '0 12px 32px rgba(0,0,0,0.25)' }}>
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label style={{ fontFamily: font, fontWeight: 300, fontSize: '0.75rem', color: '#6E6A67', display: 'block', marginBottom: '0.25rem' }}>
                  {t('auth.email')}
                </label>
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm"
                  style={{ border: '1px solid #E6E3E1', borderRadius: '6px', fontFamily: font, outline: 'none' }}
                  placeholder={t('auth.emailPlaceholder')}
                  required
                />
              </div>
              <div>
                <label style={{ fontFamily: font, fontWeight: 300, fontSize: '0.75rem', color: '#6E6A67', display: 'block', marginBottom: '0.25rem' }}>
                  {t('auth.password')}
                </label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm"
                  style={{ border: '1px solid #E6E3E1', borderRadius: '6px', fontFamily: font, outline: 'none' }}
                  placeholder={t('auth.passwordPlaceholder')}
                  required
                />
              </div>

              {error && (
                <div className="text-sm p-3" style={{ background: '#FAEEDA', color: '#854F0B', borderRadius: '6px' }}>
                  {error}
                </div>
              )}
              {recoveryMessage && (
                <div className="text-sm p-3" style={{ background: '#EAF3DE', color: '#3B6D11', borderRadius: '6px' }}>
                  {recoveryMessage}
                </div>
              )}
              {confirmationMessage && (
                <div className="text-sm p-3" style={{ background: '#EAF3DE', color: '#3B6D11', borderRadius: '6px' }}>
                  {confirmationMessage}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full disabled:opacity-50"
                style={{
                  fontFamily: font,
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  padding: '0.7rem 1.75rem',
                  background: orange,
                  color: '#ffffff',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {loading ? t('common.processing') : t('auth.signIn')}
              </button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setMode('forgot')
                    setError('')
                    setRecoveryMessage('')
                  }}
                  style={{ fontFamily: font, fontWeight: 600, fontSize: '0.8rem', color: orange, background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  {t('auth.forgotPassword')}
                </button>
              </div>
            </form>
          )}

          {mode === 'forgot' && (
            <form onSubmit={handlePasswordRecovery} className="space-y-4">
              <p className="text-sm" style={{ color: '#666666', fontFamily: font }}>
                {t('auth.forgotTitle')}
              </p>
              <div>
                <label style={{ fontFamily: font, fontWeight: 300, fontSize: '0.75rem', color: '#6E6A67', display: 'block', marginBottom: '0.25rem' }}>
                  {t('auth.email')}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm"
                  style={{ border: '1px solid #E6E3E1', borderRadius: '6px', fontFamily: font, outline: 'none' }}
                  placeholder={t('auth.emailPlaceholder')}
                  required
                />
              </div>

              {error && (
                <div className="text-sm p-3" style={{ background: '#FAEEDA', color: '#854F0B', borderRadius: '6px' }}>
                  {error}
                </div>
              )}
              {recoveryMessage && (
                <div className="text-sm p-3" style={{ background: '#EAF3DE', color: '#3B6D11', borderRadius: '6px' }}>
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
                  style={{ fontFamily: font, fontWeight: 600, color: '#666666', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  {t('auth.backToLogin')}
                </button>
                <button
                  type="submit"
                  disabled={recoveryLoading}
                  className="disabled:opacity-50"
                  style={{
                    fontFamily: font,
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    padding: '0.7rem 1.75rem',
                    background: orange,
                    color: '#ffffff',
                    borderRadius: '6px',
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
              <p className="text-sm" style={{ color: '#666666', fontFamily: font }}>
                {t('auth.recoveryTitle')}
              </p>

              <div>
                <label style={{ fontFamily: font, fontWeight: 300, fontSize: '0.75rem', color: '#6E6A67', display: 'block', marginBottom: '0.25rem' }}>
                  {t('auth.newPassword')}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm"
                  style={{ border: '1px solid #E6E3E1', borderRadius: '6px', fontFamily: font, outline: 'none' }}
                  placeholder={t('auth.passwordPlaceholder')}
                  required
                  minLength={6}
                />
              </div>
              <div>
                <label style={{ fontFamily: font, fontWeight: 300, fontSize: '0.75rem', color: '#6E6A67', display: 'block', marginBottom: '0.25rem' }}>
                  {t('auth.confirmPassword')}
                </label>
                <input
                  type="password"
                  value={passwordConfirmation}
                  onChange={(e) => setPasswordConfirmation(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm"
                  style={{ border: '1px solid #E6E3E1', borderRadius: '6px', fontFamily: font, outline: 'none' }}
                  placeholder={t('auth.passwordPlaceholder')}
                  required
                  minLength={6}
                />
              </div>

              {error && (
                <div className="text-sm p-3" style={{ background: '#FAEEDA', color: '#854F0B', borderRadius: '6px' }}>
                  {error}
                </div>
              )}
              {recoveryMessage && (
                <div className="text-sm p-3" style={{ background: '#EAF3DE', color: '#3B6D11', borderRadius: '6px' }}>
                  {recoveryMessage}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full disabled:opacity-50"
                style={{
                  fontFamily: font,
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  padding: '0.7rem 1.75rem',
                  background: orange,
                  color: '#ffffff',
                  borderRadius: '6px',
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
