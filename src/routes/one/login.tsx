import { createFileRoute } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { useState, useEffect } from 'react'

export const Route = createFileRoute('/one/login')({
  component: OnLoginPage,
  ssr: false,
})

const navy = '#0A1628'
const gold  = '#C9A84C'

function OnLoginPage() {
  const [tab,        setTab]        = useState<'login' | 'register'>('login')
  const [email,      setEmail]      = useState('')
  const [password,   setPassword]   = useState('')
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const [info,       setInfo]       = useState('')
  const [checking,   setChecking]   = useState(true)

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
      const { error: err } = await supabase.auth.signUp({ email, password })
      if (err) {
        setError(err.message)
      } else {
        setInfo('Conta criada! Verifique o seu email para confirmar o registo antes de entrar.')
        setEmail(''); setPassword('')
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
          <span style={{ color: gold, fontWeight: 700, fontSize: '1.6rem', letterSpacing: '0.06em' }}>ADLER</span>
          <span style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 300, fontSize: '1.6rem', letterSpacing: '0.14em' }}>ONE</span>
        </div>
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

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '0.75rem',
              background: loading ? '#e5c97a' : gold,
              color: navy,
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 700,
              fontSize: '0.85rem',
              letterSpacing: '0.06em',
              border: 'none',
              borderRadius: 4,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              transition: 'background 0.15s',
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
