import { useEffect, useState } from 'react'
import type { UserIdentity } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { C, ErrorNote, button } from './portal-ui'

// Lets a signed-in client connect a Google account to the account the agency
// invited, so later they can sign in with Google. Linking always happens from
// an existing session, never by matching emails, so a Google account can only
// ever reach the client record it was linked from.

// Off until the Google provider and manual linking are enabled in Supabase
// (Authentication → Providers / Manual linking); set VITE_GOOGLE_SIGNIN=true then.
export const GOOGLE_SIGNIN_ENABLED = import.meta.env.VITE_GOOGLE_SIGNIN === 'true'

const PROVIDER_LABELS: Record<string, string> = { email: 'Email and password', google: 'Google' }

export function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: '-4px' }}>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

export function SignInMethods() {
  const [identities, setIdentities] = useState<UserIdentity[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  async function load() {
    const { data, error: err } = await supabase.auth.getUserIdentities()
    if (err) setError('We could not load your sign-in methods. Please refresh the page.')
    else setIdentities(data.identities)
  }

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('linked') === 'google') {
      setInfo('Your Google account is connected. Next time you can sign in with Google.')
      window.history.replaceState(null, '', window.location.pathname)
    }
    load()
  }, [])

  async function connectGoogle() {
    setError('')
    setBusy(true)
    const { error: err } = await supabase.auth.linkIdentity({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/portal/profile?linked=google` },
    })
    // On success the browser leaves for Google, so we only get here on failure.
    if (err) {
      setBusy(false)
      setError(/already/i.test(err.message)
        ? 'This Google account is already connected to another MillionGuard account.'
        : 'Connecting Google is not available right now. Please try again later.')
    }
  }

  async function disconnect(identity: UserIdentity) {
    setError('')
    setInfo('')
    setBusy(true)
    const { error: err } = await supabase.auth.unlinkIdentity(identity)
    setBusy(false)
    if (err) setError('We could not disconnect this account. Please try again.')
    else await load()
  }

  if (!identities) return error ? <ErrorNote>{error}</ErrorNote> : null

  const google = identities.find((i) => i.provider === 'google')

  return (
    <div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {info && (
        <div role="status" style={{ padding: '10px 14px', background: '#E7F4EC', border: '1px solid #BFE3CD', borderRadius: 10, color: C.good, fontSize: 13, marginBottom: 14 }}>{info}</div>
      )}
      {identities.map((i) => (
        <div key={i.identity_id} className="mg-row">
          <span style={{ fontSize: 14 }}>
            {i.provider === 'google' && <><GoogleIcon />{' '}</>}
            {PROVIDER_LABELS[i.provider] ?? i.provider}
            {i.provider === 'google' && typeof i.identity_data?.email === 'string' && (
              <span style={{ color: C.muted, fontSize: 13 }}> · {i.identity_data.email}</span>
            )}
          </span>
          {i.provider !== 'email' && identities.length > 1 && (
            <button type="button" disabled={busy} onClick={() => disconnect(i)} style={{ background: 'none', border: 0, color: C.bad, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
              Disconnect
            </button>
          )}
        </div>
      ))}
      {GOOGLE_SIGNIN_ENABLED && !google && (
        <button type="button" disabled={busy} onClick={connectGoogle} style={{ ...button('ghost'), width: '100%', marginTop: 14, opacity: busy ? 0.6 : 1 }}>
          <GoogleIcon /> Connect Google
        </button>
      )}
      <p style={{ margin: '14px 0 0', fontSize: 13, color: C.body, lineHeight: 1.6 }}>
        On iPhone and Android, save your password when asked: next time Face ID or your fingerprint fills it in for you.
      </p>
    </div>
  )
}
