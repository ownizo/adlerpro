/**
 * /one/reset-password — completes the Supabase Auth password-recovery flow.
 *
 * The "Forgot your password?" link on the My Cover Vault login sends a reset
 * email whose link redirects back here. The Supabase browser client detects the
 * recovery token in the URL and establishes a short-lived session; this page
 * then lets the user set a new password via `updateUser`. Additive route — the
 * Portuguese portal does not link to it, so its behaviour is unchanged.
 */
import { createFileRoute } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { useState, useEffect } from 'react'
import { oneT, oneBrand } from '@/lib/one-brand'

export const Route = createFileRoute('/one/reset-password')({
  component: ResetPasswordPage,
  ssr: false,
  head: () => ({ meta: [{ title: oneBrand().docTitle }] }),
})

const ink  = '#0A1628'
const body = '#5B6472'
const line = '#E6E8EC'
const bg   = '#F6F7F9'

function ResetPasswordPage() {
  const t     = oneT()
  const brand = oneBrand()
  const [ready,    setReady]    = useState(false)
  const [hasToken, setHasToken] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')
  const [done,     setDone]     = useState(false)

  useEffect(() => {
    document.title = brand.docTitle
    // The recovery session is established from the URL hash by the Supabase
    // client. Listen for it, and fall back to the current session if the event
    // has already fired before this component mounted.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) {
        setHasToken(true)
        setReady(true)
      }
    })
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setHasToken(true)
      setReady(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [brand.docTitle])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError(t.reset.tooShort); return }
    if (password !== confirm) { setError(t.reset.mismatch); return }
    setSaving(true)
    try {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) throw err
      setDone(true)
      setTimeout(() => window.location.replace('/one/login'), 1800)
    } catch (err: any) {
      setError(err?.message ?? t.reset.invalidLink)
      setSaving(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: bg,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
      fontFamily: "'Montserrat', sans-serif",
    }}>
      <img src="/adler-rochefort-logo.png" alt="Adler & Rochefort" style={{ height: 56, width: 'auto', marginBottom: '1.5rem' }} />

      <div style={{
        background: '#fff',
        borderRadius: 10,
        width: '100%',
        maxWidth: 400,
        border: `1px solid ${line}`,
        boxShadow: '0 12px 40px rgba(10,22,40,0.08)',
        padding: '1.75rem',
      }}>
        <h1 style={{ color: ink, fontWeight: 700, fontSize: '1.15rem', margin: '0 0 0.35rem' }}>{t.reset.title}</h1>
        <p style={{ color: body, fontSize: '0.8rem', margin: '0 0 1.25rem', lineHeight: 1.5 }}>{t.reset.subtitle}</p>

        {done ? (
          <div style={{ padding: '0.75rem 0.9rem', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 6, color: '#166534', fontSize: '0.82rem' }}>
            {t.reset.success}
          </div>
        ) : !ready ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem' }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', border: `3px solid ${ink}`, borderTopColor: 'transparent', animation: 'one-spin 0.75s linear infinite' }} />
          </div>
        ) : !hasToken ? (
          <>
            <div style={{ padding: '0.75rem 0.9rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, color: '#B91C1C', fontSize: '0.82rem', marginBottom: '1rem' }}>
              {t.reset.invalidLink}
            </div>
            <a href="/one/login" style={{ color: ink, fontWeight: 700, fontSize: '0.8rem', textDecoration: 'underline' }}>{t.reset.backToLogin}</a>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={label}>{t.reset.newPassword}</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required style={input} />
            </div>
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={label}>{t.reset.confirmPassword}</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} minLength={6} required style={input} />
            </div>
            {error && (
              <div style={{ marginBottom: '1rem', padding: '0.65rem 0.85rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, color: '#B91C1C', fontSize: '0.78rem' }}>
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={saving}
              style={{ width: '100%', padding: '0.8rem', background: ink, color: '#fff', fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.85rem', letterSpacing: '0.04em', border: 'none', borderRadius: 6, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
            >
              {saving ? t.reset.saving : t.reset.submit}
            </button>
          </form>
        )}
      </div>

      <p style={{ color: body, opacity: 0.85, fontSize: '0.65rem', marginTop: '2rem', textAlign: 'center', maxWidth: 420, lineHeight: 1.6 }}>
        {brand.regulatoryFooter}
      </p>

      <style>{`@keyframes one-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

const label: React.CSSProperties = {
  display: 'block',
  fontSize: '0.68rem',
  fontWeight: 600,
  color: '#4A5361',
  marginBottom: '0.35rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

const input: React.CSSProperties = {
  width: '100%',
  padding: '0.65rem 0.75rem',
  fontSize: '0.85rem',
  fontFamily: "'Montserrat', sans-serif",
  border: `1px solid ${line}`,
  borderRadius: 6,
  outline: 'none',
  color: '#111',
  boxSizing: 'border-box',
}
