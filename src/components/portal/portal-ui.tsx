/**
 * MillionGuard — the single client portal of Adler & Rochefort.
 *
 * One interface, in English, for business clients (company users) and
 * personal clients (individual clients). The account type only changes a few
 * labels; every screen is shared. Brand, formatting and the layout shell live
 * here so the route files stay small.
 */
import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { LayoutDashboard, FileText, LifeBuoy, FolderOpen, UserRound, LogOut } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { clientClearMustChangePassword } from '@/lib/server-fns'
import { POLICY_TYPE_LABELS_EN, CLAIM_STATUS_LABELS_EN, type PolicyType, type ClaimStatus } from '@/lib/types'

export const BRAND = {
  name: 'MillionGuard',
  tagline: 'by Adler & Rochefort',
  regulatory: 'Adler & Rochefort is a trading name of Ownizo, Unipessoal Lda., insurance agent registered with the ASF (Portugal) under no. 425591790/3.',
  contactEmail: 'insurance@adlerrochefort.com',
  contactPhone: '+351 928 226 570',
}

export const C = {
  ink: '#1E1E1E',
  body: '#55575C',
  muted: '#8A8C91',
  line: '#E7E5E2',
  bg: '#F7F6F4',
  card: '#FFFFFF',
  accent: '#FF6300',
  accentInk: '#B84700',
  good: '#1F7A4D',
  warn: '#B45309',
  bad: '#B42318',
}

export const font = "'Montserrat', system-ui, -apple-system, 'Segoe UI', sans-serif"

const eur = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
export const money = (n: number) => eur.format(Number(n || 0))
export const date = (s?: string) =>
  s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
export const dateTime = (s?: string) =>
  s ? new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
export const fileSize = (b: number) =>
  !b ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`
export const policyType = (t: string) => POLICY_TYPE_LABELS_EN[t as PolicyType] ?? 'Other'
export const claimStatus = (s: string) => CLAIM_STATUS_LABELS_EN[s as ClaimStatus] ?? s
export const daysUntil = (s: string) => Math.ceil((new Date(s).getTime() - Date.now()) / 86_400_000)

/** Pill for policy and claim states. */
export function Pill({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'neutral'; children: ReactNode }) {
  const colors = {
    good: { c: C.good, b: '#E7F4EC' },
    warn: { c: C.warn, b: '#FDF1E3' },
    bad: { c: C.bad, b: '#FDECEA' },
    neutral: { c: C.body, b: '#EFEEEC' },
  }[tone]
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, background: colors.b, color: colors.c, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

export function policyTone(status: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (status === 'active') return 'good'
  if (status === 'expiring') return 'warn'
  if (status === 'expired' || status === 'cancelled') return 'bad'
  return 'neutral'
}

export function claimTone(status: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (status === 'approved' || status === 'paid') return 'good'
  if (status === 'denied') return 'bad'
  return 'warn'
}

export const POLICY_STATUS_EN: Record<string, string> = {
  active: 'Active',
  expiring: 'Renewal due',
  expired: 'Expired',
  cancelled: 'Cancelled',
}

export function Wordmark({ size = 20, light = false }: { size?: number; light?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.05 }}>
      <span style={{ fontFamily: font, fontWeight: 800, fontSize: size, letterSpacing: '-0.02em', color: light ? '#fff' : C.ink }}>
        Million<span style={{ color: C.accent }}>Guard</span>
      </span>
      <span style={{ fontFamily: font, fontWeight: 500, fontSize: Math.max(9, size * 0.45), letterSpacing: '0.08em', color: light ? 'rgba(255,255,255,.7)' : C.muted, marginTop: 2 }}>
        {BRAND.tagline}
      </span>
    </span>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 20, ...style }}>
      {children}
    </div>
  )
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
      <div>
        <h1 style={{ fontFamily: font, fontSize: 26, fontWeight: 700, color: C.ink, margin: 0, letterSpacing: '-0.01em' }}>{title}</h1>
        {subtitle && <p style={{ margin: '6px 0 0', color: C.body, fontSize: 14 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p style={{ margin: 0, padding: '28px 8px', textAlign: 'center', color: C.muted, fontSize: 14 }}>{children}</p>
}

export function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
      <div style={{ width: 26, height: 26, borderRadius: '50%', border: `3px solid ${C.accent}`, borderTopColor: 'transparent', animation: 'mg-spin .75s linear infinite' }} />
    </div>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div role="alert" style={{ padding: '10px 14px', background: '#FDECEA', border: '1px solid #F5C2BC', borderRadius: 10, color: C.bad, fontSize: 13, marginBottom: 16 }}>
      {children}
    </div>
  )
}

export const button = (variant: 'primary' | 'ghost' = 'primary'): CSSProperties => ({
  fontFamily: font,
  fontWeight: 700,
  fontSize: 14,
  padding: '11px 18px',
  borderRadius: 10,
  cursor: 'pointer',
  border: variant === 'primary' ? 'none' : `1px solid ${C.line}`,
  background: variant === 'primary' ? C.ink : '#fff',
  color: variant === 'primary' ? '#fff' : C.ink,
  minHeight: 44,
})

export const input: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '11px 12px',
  border: `1px solid ${C.line}`,
  borderRadius: 10,
  fontFamily: font,
  fontSize: 15,
  color: C.ink,
  background: '#fff',
  outline: 'none',
}

export const label: CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: C.body,
  marginBottom: 6,
  letterSpacing: '0.02em',
}

const NAV = [
  { to: '/portal', label: 'Overview', icon: LayoutDashboard, exact: true },
  { to: '/portal/policies', label: 'Policies', icon: FileText },
  { to: '/portal/claims', label: 'Claims', icon: LifeBuoy },
  { to: '/portal/documents', label: 'Documents', icon: FolderOpen },
  { to: '/portal/profile', label: 'Profile', icon: UserRound },
] as const

export const GLOBAL_CSS = `
@keyframes mg-spin { to { transform: rotate(360deg) } }
.mg-shell { min-height: 100vh; background: ${C.bg}; font-family: ${font}; color: ${C.ink}; }
.mg-top { position: sticky; top: 0; z-index: 30; background: #fff; border-bottom: 1px solid ${C.line}; }
.mg-top-inner { max-width: 1120px; margin: 0 auto; padding: 12px 20px; display: flex; align-items: center; gap: 24px; }
.mg-nav { display: flex; gap: 4px; flex: 1; }
.mg-nav a { display: inline-flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: 10px; color: ${C.body}; text-decoration: none; font-size: 14px; font-weight: 600; }
.mg-nav a:hover { background: ${C.bg}; color: ${C.ink}; }
.mg-nav a.active { background: ${C.ink}; color: #fff; }
.mg-out { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; background: none; border: 0; color: ${C.body}; font: 600 13px ${font}; cursor: pointer; padding: 9px 10px; border-radius: 10px; }
.mg-out:hover { background: ${C.bg}; }
.mg-main { max-width: 1120px; margin: 0 auto; padding: 28px 20px 110px; }
.mg-grid { display: grid; gap: 16px; }
.mg-stats { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; }
.mg-two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.mg-bottom { display: none; }
.mg-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 0; border-top: 1px solid ${C.line}; }
.mg-row:first-child { border-top: 0; }
.mg-list-btn { width: 100%; text-align: left; background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; }
input:focus, textarea:focus, select:focus { border-color: ${C.ink} !important; }
@media (max-width: 860px) {
  .mg-stats { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .mg-two { grid-template-columns: 1fr; }
}
@media (max-width: 720px) {
  .mg-nav, .mg-out-label { display: none; }
  .mg-top-inner { padding: 10px 16px; }
  .mg-main { padding: 20px 16px 110px; }
  .mg-bottom { display: grid; grid-template-columns: repeat(5, 1fr); position: fixed; left: 0; right: 0; bottom: 0; z-index: 40; background: #fff; border-top: 1px solid ${C.line}; padding: 6px 4px calc(6px + env(safe-area-inset-bottom)); }
  .mg-bottom a { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 6px 2px; color: ${C.muted}; text-decoration: none; font-size: 11px; font-weight: 600; border-radius: 10px; }
  .mg-bottom a.active { color: ${C.ink}; }
  .mg-bottom a.active svg { color: ${C.accent}; }
}
`

/**
 * Shell for every signed-in screen. Checks the Supabase session on mount and
 * sends anyone without one to the login screen.
 */
export function PortalLayout({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [mustChange, setMustChange] = useState(false)
  const path = useRouterState({ select: (s) => s.location.pathname })

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { window.location.replace('/portal/login'); return }
      // Accounts created by the agency start with a temporary password.
      setMustChange(user.app_metadata?.must_change_password === true)
      setReady(true)
    })
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    window.location.replace('/portal/login')
  }

  const isActive = (to: string, exact?: boolean) =>
    exact ? path === to || path === `${to}/` : path === to || path.startsWith(`${to}/`)

  return (
    <div className="mg-shell">
      <style>{GLOBAL_CSS}</style>
      <header className="mg-top">
        <div className="mg-top-inner">
          <a href="/portal" style={{ textDecoration: 'none' }} aria-label={`${BRAND.name} home`}>
            <Wordmark size={19} />
          </a>
          <nav className="mg-nav" aria-label="Main">
            {NAV.map(({ to, label, icon: Icon, ...rest }) => (
              <Link key={to} to={to as any} className={isActive(to, 'exact' in rest) ? 'active' : ''}>
                <Icon size={16} aria-hidden="true" /> {label}
              </Link>
            ))}
          </nav>
          <button className="mg-out" onClick={signOut}>
            <LogOut size={16} aria-hidden="true" /> <span className="mg-out-label">Sign out</span>
          </button>
        </div>
      </header>
      <main className="mg-main">
        {!ready ? <Spinner /> : mustChange ? (
          <div style={{ maxWidth: 460, margin: '24px auto' }}>
            <PageTitle title="Choose your password" subtitle="Your account was created with a temporary password. Choose your own to continue." />
            <Card><ChangePasswordForm onDone={() => setMustChange(false)} /></Card>
          </div>
        ) : children}
      </main>
      <nav className="mg-bottom" aria-label="Main">
        {NAV.map(({ to, label, icon: Icon, ...rest }) => (
          <Link key={to} to={to as any} className={isActive(to, 'exact' in rest) ? 'active' : ''}>
            <Icon size={20} aria-hidden="true" /> {label}
          </Link>
        ))}
      </nav>
    </div>
  )
}

/** Change the signed-in user's password; also clears the "temporary password" flag. */
export function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaved(false)
    if (password.length < 8) { setError('Use at least 8 characters.'); return }
    if (password !== confirm) { setError('The two passwords do not match.'); return }
    setBusy(true)
    try {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) { setError(err.message); return }
      await clientClearMustChangePassword().catch(() => undefined)
      await supabase.auth.refreshSession().catch(() => undefined)
      setPassword('')
      setConfirm('')
      setSaved(true)
      onDone?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {saved && <p role="status" style={{ color: C.good, fontWeight: 600, fontSize: 14, margin: '0 0 12px' }}>Password updated.</p>}
      <label style={label} htmlFor="mg-pw1">New password</label>
      <input id="mg-pw1" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...input, marginBottom: 12 }} />
      <label style={label} htmlFor="mg-pw2">Repeat the password</label>
      <input id="mg-pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={{ ...input, marginBottom: 16 }} />
      <button type="submit" disabled={busy} style={{ ...button(), opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Save password'}</button>
    </form>
  )
}
