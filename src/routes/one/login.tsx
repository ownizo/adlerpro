import { createFileRoute } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { useState, useEffect } from 'react'
import { isMyCoverVault, oneT, oneBrand } from '@/lib/one-brand'

export const Route = createFileRoute('/one/login')({
  component: OneLoginRoute,
  ssr: false,
  head: () => ({ meta: [{ title: oneBrand().docTitle }] }),
})

const navy = '#0A1628'
const gold  = '#C9A84C'

/** Pick the branded English login for My Cover Vault, or the Portuguese
 *  "Os Meus Seguros" login (unchanged) for every other deploy. */
function OneLoginRoute() {
  return isMyCoverVault() ? <MyCoverVaultLogin /> : <OnLoginPage />
}

function OnLoginPage() {
  const [tab,          setTab]        = useState<'login' | 'register'>('login')
  const [email,        setEmail]      = useState('')
  const [password,     setPassword]   = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [loading,      setLoading]    = useState(false)
  const [error,        setError]      = useState('')
  const [info,         setInfo]       = useState('')
  const [checking,     setChecking]   = useState(true)

  // Already authenticated → go straight to dashboard
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) window.location.replace('/one/dashboard')
      else setChecking(false)
    })
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setInfo('')
    setLoading(true)

    if (tab === 'login') {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) {
        setError(err.message === 'Invalid login credentials'
          ? 'Email ou password incorretos.'
          : err.message)
      } else {
        window.location.replace('/one/dashboard')
        return
      }
    } else {
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { terms_accepted_at: new Date().toISOString() } },
      })
      if (err) {
        setError(err.message)
      } else {
        setInfo('Conta criada! Verifique o seu email para confirmar o registo antes de entrar.')
        setEmail(''); setPassword(''); setTermsAccepted(false)
      }
    }

    setLoading(false)
  }

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F4F6FA' }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: `3px solid ${gold}`, borderTopColor: 'transparent', animation: 'one-spin 0.75s linear infinite' }} />
        <style>{`@keyframes one-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(160deg, ${navy} 0%, #112240 100%)`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
      fontFamily: "'Montserrat', sans-serif",
    }}>

      {/* Logo */}
      <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6 }}>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: '1.6rem', letterSpacing: '0.04em' }}>Os Meus Seguros</span>
        </div>
        <p style={{ color: gold, fontSize: '0.7rem', marginTop: '0.3rem', letterSpacing: '0.08em' }}>
          by Adler &amp; Rochefort
        </p>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', marginTop: '0.4rem', letterSpacing: '0.08em' }}>
          Portal de Clientes Individuais
        </p>
      </div>

      {/* Card */}
      <div style={{
        background: '#fff',
        borderRadius: 8,
        width: '100%',
        maxWidth: 400,
        overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
      }}>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #eee' }}>
          {(['login', 'register'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(''); setInfo('') }}
              style={{
                flex: 1,
                padding: '0.9rem',
                fontSize: '0.82rem',
                fontWeight: tab === t ? 700 : 400,
                fontFamily: "'Montserrat', sans-serif",
                color: tab === t ? navy : '#999',
                background: 'none',
                border: 'none',
                borderBottom: tab === t ? `2px solid ${gold}` : '2px solid transparent',
                cursor: 'pointer',
                letterSpacing: '0.04em',
                transition: 'all 0.15s',
              }}
            >
              {t === 'login' ? 'Entrar' : 'Criar Conta'}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '1.75rem' }}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="o.seu@email.com"
              required
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={tab === 'register' ? 'Mínimo 6 caracteres' : '••••••••'}
              required
              minLength={6}
              style={inputStyle}
            />
          </div>

          {error && (
            <div style={{ marginBottom: '1rem', padding: '0.65rem 0.85rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 4, color: '#B91C1C', fontSize: '0.78rem' }}>
              {error}
            </div>
          )}

          {info && (
            <div style={{ marginBottom: '1rem', padding: '0.65rem 0.85rem', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 4, color: '#166534', fontSize: '0.78rem' }}>
              {info}
            </div>
          )}

          {tab === 'register' && (
            <div style={{ marginBottom: '1.25rem', display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                id="terms"
                required
                checked={termsAccepted}
                onChange={e => setTermsAccepted(e.target.checked)}
                style={{ marginTop: 3, flexShrink: 0, accentColor: navy, width: 14, height: 14, cursor: 'pointer' }}
              />
              <label htmlFor="terms" style={{ fontSize: '0.68rem', color: '#555', lineHeight: 1.55, cursor: 'pointer' }}>
                Li e aceito os{' '}
                <a href="https://adlerrochefort.com/termos-e-condicoes" target="_blank" rel="noopener noreferrer" style={{ color: navy, fontWeight: 600, textDecoration: 'underline' }}>
                  Termos de Serviço
                </a>{' '}
                do Adler One. Autorizo a Adler &amp; Rochefort, marca comercial da Ownizo Unipessoal LDA (registada na ASF com o n.º 425591790/3), a aceder e tratar os dados das minhas apólices, documentos, contactos, moradas, idades, prémios e datas de renovação, no âmbito da actividade de mediação de seguros. Aceito receber propostas de renovação e cotações relativas às apólices registadas na plataforma.
              </label>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || (tab === 'register' && !termsAccepted)}
            style={{
              width: '100%',
              padding: '0.75rem',
              background: loading || (tab === 'register' && !termsAccepted) ? '#e5c97a' : gold,
              color: navy,
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 700,
              fontSize: '0.85rem',
              letterSpacing: '0.06em',
              border: 'none',
              borderRadius: 4,
              cursor: loading || (tab === 'register' && !termsAccepted) ? 'not-allowed' : 'pointer',
              opacity: tab === 'register' && !termsAccepted ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              transition: 'background 0.15s, opacity 0.15s',
            }}
          >
            {loading && (
              <span style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${navy}`, borderTopColor: 'transparent', display: 'inline-block', animation: 'one-spin 0.75s linear infinite' }} />
            )}
            {tab === 'login' ? 'Entrar' : 'Criar Conta'}
          </button>

          {tab === 'login' && (
            <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.72rem', color: '#aaa' }}>
              Não tem conta?{' '}
              <button
                type="button"
                onClick={() => { setTab('register'); setError(''); setInfo('') }}
                style={{ color: gold, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', fontFamily: "'Montserrat', sans-serif" }}
              >
                Criar Conta
              </button>
            </p>
          )}
        </form>
      </div>

      <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.65rem', marginTop: '2rem', letterSpacing: '0.05em' }}>
        © {new Date().getFullYear()} Adler Rochefort · Portal Privado
      </p>

      <style>{`@keyframes one-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.68rem',
  fontWeight: 600,
  color: '#555',
  marginBottom: '0.35rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.6rem 0.75rem',
  fontSize: '0.85rem',
  fontFamily: "'Montserrat', sans-serif",
  border: '1px solid #ddd',
  borderRadius: 4,
  outline: 'none',
  color: '#111',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s',
}

/* ══════════════════════════════════════════════════════════════════════════
 * My Cover Vault — English, light-themed client login.
 * The root of mycovervault.com IS this screen. Same Supabase auth, same
 * terms_accepted_at mechanism; only the language and branding differ.
 * ════════════════════════════════════════════════════════════════════════ */

const mcvInk    = '#0A1628'  // primary text / buttons (the single restrained accent)
const mcvBody   = '#5B6472'
const mcvLine   = '#E6E8EC'
const mcvBg     = '#FFFFFF'

function MyCoverVaultLogin() {
  const t     = oneT()
  const brand = oneBrand()
  const [mode,          setMode]          = useState<'signin' | 'register' | 'forgot'>('signin')
  const [email,         setEmail]         = useState('')
  const [password,      setPassword]      = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState('')
  const [info,          setInfo]          = useState('')
  const [checking,      setChecking]      = useState(true)

  // Already authenticated → straight to the dashboard.
  useEffect(() => {
    document.title = brand.docTitle
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) window.location.replace('/one/dashboard')
      else setChecking(false)
    })
  }, [brand.docTitle])

  const resetMessages = () => { setError(''); setInfo('') }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    resetMessages()
    setLoading(true)
    try {
      if (mode === 'forgot') {
        if (!email) { setError(t.login.emailRequired); return }
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/one/reset-password`,
        })
        if (err) { setError(t.login.resetError); return }
        setInfo(t.login.resetSent)
        return
      }

      if (mode === 'signin') {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password })
        if (err) {
          setError(err.message === 'Invalid login credentials' ? t.login.invalidCredentials : err.message)
        } else {
          window.location.replace('/one/dashboard')
        }
        return
      }

      // register
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { terms_accepted_at: new Date().toISOString() } },
      })
      if (err) {
        setError(err.message)
      } else {
        setInfo(t.login.registerSuccess)
        setEmail(''); setPassword(''); setTermsAccepted(false)
      }
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: mcvBg }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: `3px solid ${mcvInk}`, borderTopColor: 'transparent', animation: 'one-spin 0.75s linear infinite' }} />
        <style>{`@keyframes one-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  const submitLabel =
    mode === 'signin' ? t.login.signIn : mode === 'register' ? t.login.register : t.login.forgot
  const disableSubmit = loading || (mode === 'register' && !termsAccepted)

  return (
    <div style={{
      minHeight: '100vh',
      background: mcvBg,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
      fontFamily: "'Montserrat', sans-serif",
    }}>
      {/* Logo */}
      <img
        src="/adler-rochefort-logo.png"
        alt="Adler & Rochefort"
        style={{ height: 64, width: 'auto', marginBottom: '1.5rem' }}
      />

      {/* Headings */}
      <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
        <h1 style={{ color: mcvInk, fontWeight: 700, fontSize: '1.5rem', letterSpacing: '-0.01em', margin: 0 }}>
          {t.login.welcome}
        </h1>
        <p style={{ color: mcvBody, fontSize: '0.8rem', marginTop: '0.35rem', letterSpacing: '0.06em' }}>
          {brand.tagline}
        </p>
      </div>

      {/* Card */}
      <div style={{
        background: '#fff',
        borderRadius: 10,
        width: '100%',
        maxWidth: 400,
        border: `1px solid ${mcvLine}`,
        boxShadow: '0 12px 40px rgba(10,22,40,0.08)',
        overflow: 'hidden',
      }}>
        <form onSubmit={handleSubmit} style={{ padding: '1.75rem' }}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={mcvLabel}>{t.login.email}</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={t.login.emailPlaceholder}
              required
              style={mcvInput}
            />
          </div>

          {mode !== 'forgot' && (
            <div style={{ marginBottom: mode === 'signin' ? '0.5rem' : '1.25rem' }}>
              <label style={mcvLabel}>{t.login.password}</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={mode === 'register' ? t.login.passwordPlaceholderRegister : t.login.passwordPlaceholderLogin}
                required
                minLength={6}
                style={mcvInput}
              />
            </div>
          )}

          {mode === 'signin' && (
            <div style={{ textAlign: 'right', marginBottom: '1.25rem' }}>
              <button
                type="button"
                onClick={() => { setMode('forgot'); resetMessages() }}
                style={{ background: 'none', border: 'none', color: mcvBody, fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: "'Montserrat', sans-serif", textDecoration: 'underline' }}
              >
                {t.login.forgot}
              </button>
            </div>
          )}

          {error && (
            <div style={{ marginBottom: '1rem', padding: '0.65rem 0.85rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, color: '#B91C1C', fontSize: '0.78rem' }}>
              {error}
            </div>
          )}
          {info && (
            <div style={{ marginBottom: '1rem', padding: '0.65rem 0.85rem', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 6, color: '#166534', fontSize: '0.78rem' }}>
              {info}
            </div>
          )}

          {mode === 'register' && (
            <div style={{ marginBottom: '1.25rem', display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                id="mcv-terms"
                required
                checked={termsAccepted}
                onChange={e => setTermsAccepted(e.target.checked)}
                style={{ marginTop: 3, flexShrink: 0, accentColor: mcvInk, width: 14, height: 14, cursor: 'pointer' }}
              />
              <label htmlFor="mcv-terms" style={{ fontSize: '0.68rem', color: mcvBody, lineHeight: 1.55, cursor: 'pointer' }}>
                {t.login.termsPrefix}
                <a href="/one/terms" target="_blank" rel="noopener noreferrer" style={{ color: mcvInk, fontWeight: 600, textDecoration: 'underline' }}>
                  {t.login.termsLink}
                </a>
                {t.login.termsSuffix}
              </label>
            </div>
          )}

          <button
            type="submit"
            disabled={disableSubmit}
            style={{
              width: '100%',
              padding: '0.8rem',
              background: mcvInk,
              color: '#fff',
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 700,
              fontSize: '0.85rem',
              letterSpacing: '0.04em',
              border: 'none',
              borderRadius: 6,
              cursor: disableSubmit ? 'not-allowed' : 'pointer',
              opacity: disableSubmit ? 0.55 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              transition: 'opacity 0.15s',
            }}
          >
            {loading && (
              <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #fff', borderTopColor: 'transparent', display: 'inline-block', animation: 'one-spin 0.75s linear infinite' }} />
            )}
            {submitLabel}
          </button>

          {/* Mode switches */}
          <p style={{ textAlign: 'center', marginTop: '1.1rem', fontSize: '0.72rem', color: mcvBody }}>
            {mode === 'signin' && (
              <>
                {t.login.noAccount}{' '}
                <button type="button" onClick={() => { setMode('register'); resetMessages() }} style={mcvLinkBtn}>
                  {t.login.registerTab}
                </button>
              </>
            )}
            {(mode === 'register' || mode === 'forgot') && (
              <button type="button" onClick={() => { setMode('signin'); resetMessages() }} style={mcvLinkBtn}>
                ← {t.login.signInTab}
              </button>
            )}
          </p>
        </form>
      </div>

      {/* Regulatory footer */}
      <p style={{ color: mcvBody, opacity: 0.85, fontSize: '0.65rem', marginTop: '2rem', letterSpacing: '0.03em', textAlign: 'center', maxWidth: 420, lineHeight: 1.6 }}>
        {brand.regulatoryFooter}
      </p>

      <style>{`@keyframes one-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

const mcvLabel: React.CSSProperties = {
  display: 'block',
  fontSize: '0.68rem',
  fontWeight: 600,
  color: '#4A5361',
  marginBottom: '0.35rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

const mcvInput: React.CSSProperties = {
  width: '100%',
  padding: '0.65rem 0.75rem',
  fontSize: '0.85rem',
  fontFamily: "'Montserrat', sans-serif",
  border: `1px solid ${mcvLine}`,
  borderRadius: 6,
  outline: 'none',
  color: '#111',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s',
}

const mcvLinkBtn: React.CSSProperties = {
  color: mcvInk,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: '0.72rem',
  fontFamily: "'Montserrat', sans-serif",
}
