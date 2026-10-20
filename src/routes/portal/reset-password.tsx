import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { clientClearMustChangePassword } from '@/lib/server-fns'
import { C, GLOBAL_CSS, Wordmark, button, font, input, label, ErrorNote, Spinner } from '@/components/portal/portal-ui'

export const Route = createFileRoute('/portal/reset-password')({
  component: PortalResetPassword,
  ssr: false,
  head: () => ({ meta: [{ title: 'Choose a new password — MillionGuard' }] }),
})

function PortalResetPassword() {
  const [ready, setReady] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    // The Supabase client turns the recovery link in the URL into a session.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) { setHasSession(true); setReady(true) }
    })
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setHasSession(true)
      setReady(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) { setError('Use at least 8 characters.'); return }
    if (password !== confirm) { setError('The two passwords do not match.'); return }
    setBusy(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    if (err) { setError(err.message); setBusy(false); return }
    await clientClearMustChangePassword().catch(() => undefined)
    setDone(true)
    setBusy(false)
    setTimeout(() => window.location.replace('/portal'), 1500)
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: font, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 16px' }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ marginBottom: 28 }}><Wordmark size={30} /></div>
      <div style={{ width: '100%', maxWidth: 400, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 16, padding: 28 }}>
        {!ready ? <Spinner /> : !hasSession ? (
          <>
            <h1 style={{ margin: '0 0 8px', fontSize: 20 }}>This link has expired</h1>
            <p style={{ color: C.body, fontSize: 14 }}>Request a new link from the sign-in screen.</p>
            <a href="/portal/login" style={{ ...button(), display: 'inline-block', textDecoration: 'none', marginTop: 8 }}>Go to sign in</a>
          </>
        ) : done ? (
          <p style={{ margin: 0, color: C.good, fontWeight: 600 }}>Password updated. Taking you to your account…</p>
        ) : (
          <form onSubmit={submit}>
            <h1 style={{ margin: '0 0 18px', fontSize: 20 }}>Choose a new password</h1>
            {error && <ErrorNote>{error}</ErrorNote>}
            <label style={label} htmlFor="mg-new">New password</label>
            <input id="mg-new" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...input, marginBottom: 14 }} />
            <label style={label} htmlFor="mg-confirm">Repeat the password</label>
            <input id="mg-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={{ ...input, marginBottom: 18 }} />
            <button type="submit" disabled={busy} style={{ ...button(), width: '100%', opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Save password'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
