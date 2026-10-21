import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchPortalProfile } from '@/lib/server-fns'
import { GOOGLE_SIGNIN_ENABLED, GoogleIcon } from '@/components/portal/SignInMethods'
import { BRAND, C, GLOBAL_CSS, Wordmark, button, font, input, label, ErrorNote, Spinner } from '@/components/portal/portal-ui'
import { InstallPrompt } from '@/components/portal/InstallPrompt'

export const Route = createFileRoute('/portal/login')({
  component: PortalLogin,
  ssr: false,
  head: () => ({ meta: [{ title: 'Sign in — MillionGuard' }] }),
})

function PortalLogin() {
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    // Coming from "Sign out": never bounce back into the portal.
    const params = new URLSearchParams(window.location.search)
    if (params.has('signedout')) { setChecking(false); return }
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { setChecking(false); return }
      // Back from Google: only a Google account the client connected in their
      // Profile reaches a client record. Any other Google account is signed out.
      if (params.get('oauth') === 'google') {
        const profile = await fetchPortalProfile().catch(() => null)
        if (!profile || profile.type === 'none') {
          await supabase.auth.signOut()
          window.history.replaceState(null, '', window.location.pathname)
          setError('This Google account is not connected to MillionGuard. Sign in with your email, then connect Google in your Profile.')
          setChecking(false)
          return
        }
      }
      window.location.replace('/portal')
    })
  }, [])

  async function signInWithGoogle() {
    setError('')
    setBusy(true)
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/portal/login?oauth=google` },
    })
    // On success the browser leaves for Google, so we only get here on failure.
    if (err) {
      setBusy(false)
      setError('Google sign-in is not available right now. Please use your email and password.')
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    setBusy(true)
    try {
      if (mode === 'forgot') {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/portal/reset-password`,
        })
        if (err) setError('We could not send the reset email. Please check the address and try again.')
        else setInfo('If this email has an account, you will receive a link to choose a new password.')
        return
      }
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (err) {
        setError(err.message === 'Invalid login credentials' ? 'The email or password is not correct.' : err.message)
        return
      }
      window.location.replace('/portal')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: font, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 16px' }}>
      <style>{GLOBAL_CSS}</style>
      {checking ? <Spinner /> : (
        <>
          <div style={{ marginBottom: 28, textAlign: 'center' }}><Wordmark size={30} /></div>
          <div style={{ width: '100%', maxWidth: 400, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 16, padding: 28, boxShadow: '0 16px 40px rgba(30,30,30,.06)' }}>
            <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: C.ink }}>
              {mode === 'signin' ? 'Sign in' : 'Reset your password'}
            </h1>
            <p style={{ margin: '0 0 22px', color: C.body, fontSize: 14, lineHeight: 1.5 }}>
              {mode === 'signin'
                ? 'Your policies, claims and documents, for your business and your family, in one place.'
                : 'Enter the email of your account and we will send you a link.'}
            </p>
            {error && <ErrorNote>{error}</ErrorNote>}
            {info && (
              <div role="status" style={{ padding: '10px 14px', background: '#E7F4EC', border: '1px solid #BFE3CD', borderRadius: 10, color: C.good, fontSize: 13, marginBottom: 16 }}>{info}</div>
            )}
            <form onSubmit={submit}>
              <label style={label} htmlFor="mg-email">Email</label>
              <input id="mg-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...input, marginBottom: 14 }} />
              {mode === 'signin' && (
                <>
                  <label style={label} htmlFor="mg-pass">Password</label>
                  <input id="mg-pass" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...input, marginBottom: 8 }} />
                  <div style={{ textAlign: 'right', marginBottom: 18 }}>
                    <button type="button" onClick={() => { setMode('forgot'); setError(''); setInfo('') }} style={{ background: 'none', border: 0, color: C.body, fontSize: 13, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', fontFamily: font }}>
                      Forgot your password?
                    </button>
                  </div>
                </>
              )}
              <button type="submit" disabled={busy} style={{ ...button(), width: '100%', opacity: busy ? 0.6 : 1, marginTop: mode === 'forgot' ? 6 : 0 }}>
                {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Send reset link'}
              </button>
              {mode === 'forgot' && (
                <button type="button" onClick={() => { setMode('signin'); setError(''); setInfo('') }} style={{ ...button('ghost'), width: '100%', marginTop: 10 }}>
                  Back to sign in
                </button>
              )}
            </form>
            {GOOGLE_SIGNIN_ENABLED && mode === 'signin' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0', color: C.muted, fontSize: 12 }}>
                  <span style={{ flex: 1, height: 1, background: C.line }} />or<span style={{ flex: 1, height: 1, background: C.line }} />
                </div>
                <button type="button" disabled={busy} onClick={signInWithGoogle} style={{ ...button('ghost'), width: '100%', opacity: busy ? 0.6 : 1 }}>
                  <GoogleIcon /> Continue with Google
                </button>
              </>
            )}
          </div>
          <InstallPrompt />
          <p style={{ maxWidth: 400, textAlign: 'center', color: C.muted, fontSize: 12, lineHeight: 1.6, marginTop: 22 }}>
            Access is set up by Adler &amp; Rochefort for its clients. Need access? Write to{' '}
            <a href={`mailto:${BRAND.contactEmail}`} style={{ color: C.ink }}>{BRAND.contactEmail}</a>.
          </p>
          <p style={{ maxWidth: 420, textAlign: 'center', color: C.muted, fontSize: 11, lineHeight: 1.6, marginTop: 8 }}>{BRAND.regulatory}</p>
        </>
      )}
    </div>
  )
}
