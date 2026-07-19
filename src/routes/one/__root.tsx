/**
 * OneLayout — layout shell for all /one/* My Cover Vault routes.
 * Not a TanStack Router route file; used as a wrapper component by each
 * /one/* route, similar to how AppLayout works for the main portal.
 *
 * Checks Supabase session on mount. If no session, redirects to /one/login.
 */
import { Link } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { useState, useEffect } from 'react'
import { oneT, oneBrand } from '@/lib/one-brand'

const navy = '#0A1628'
const gold  = '#C9A84C'

const NAV_ITEMS = [
  { to: '/one/dashboard',  key: 'dashboard' as const },
  { to: '/one/policies',   key: 'policies'  as const },
  { to: '/one/claims',     key: 'claims'    as const },
  { to: '/one/documents',  key: 'documents' as const },
  { to: '/one/profile',    key: 'profile'   as const },
]

export function OneLayout({ children }: { children: React.ReactNode }) {
  const t     = oneT()
  const brand = oneBrand()
  const [checking,           setChecking]           = useState(true)
  const [menuOpen,           setMenuOpen]           = useState(false)
  const [mustChangePassword, setMustChangePassword] = useState(false)

  const NAV_LINKS = NAV_ITEMS.map(i => ({ to: i.to, label: t.nav[i.key] }))

  useEffect(() => {
    document.title = brand.docTitle
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        window.location.replace('/one/login')
      } else {
        setMustChangePassword(user.app_metadata?.must_change_password === true)
        setChecking(false)
      }
    })
  }, [brand.docTitle])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.replace('/one/login')
  }

  if (checking) {
    return (
      <div style={styles.loader}>
        <div style={styles.spinner} />
        <style>{spinKeyframes}</style>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#ffffff', fontFamily: "'Montserrat', sans-serif" }}>

      {/* ── Top nav ── */}
      <nav style={styles.nav}>
        {/* Left zone — My Cover Vault wordmark from the approved reference */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <a href="/one/dashboard" style={styles.logo}>
            <img src="/my-cover-vault-logo.svg" alt={`${brand.name} ${brand.tagline}`} style={{ width: 285, maxWidth: '100%', height: 34, display: 'block' }} />
          </a>
        </div>

        {/* Centre zone — Adler & Rochefort mark */}
        <img src="/logo.png" alt="Adler & Rochefort" style={{ height: 32, width: 'auto', display: 'block', flexShrink: 0 }} />

        {/* Right zone — links de navegação + sair */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: 0 }}>
          <div style={styles.navLinks}>
            {NAV_LINKS.map(l => (
              <Link
                key={l.to}
                to={l.to as any}
                style={styles.navLink}
                activeProps={{ style: styles.navLinkActive }}
              >
                {l.label}
              </Link>
            ))}
            <button onClick={handleSignOut} style={styles.signOutBtn}>
              {t.nav.signOut}
            </button>
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMenuOpen(o => !o)}
            style={styles.hamburger}
            aria-label="Menu"
          >
            <span style={styles.bar} />
            <span style={styles.bar} />
            <span style={styles.bar} />
          </button>
        </div>
      </nav>

      {/* Mobile drawer */}
      {menuOpen && (
        <div style={styles.drawer}>
          {NAV_LINKS.map(l => (
            <a
              key={l.to}
              href={l.to}
              style={styles.drawerLink}
              onClick={() => setMenuOpen(false)}
            >
              {l.label}
            </a>
          ))}
          <button onClick={handleSignOut} style={styles.drawerSignOut}>
            {t.nav.signOut}
          </button>
        </div>
      )}

      {/* Banner: trocar password definida pelo mediador */}
      {mustChangePassword && (
        <div style={{
          background: '#FFFBEB',
          borderBottom: `1px solid ${gold}`,
          padding: '0.75rem 1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap' as const,
          gap: '0.5rem',
          fontFamily: "'Montserrat', sans-serif",
        }}>
          <p style={{ fontSize: '0.82rem', color: '#92400E', margin: 0, fontWeight: 500 }}>
            {t.mustChange.text}
          </p>
          <a
            href="/one/profile#alterar-password"
            style={{
              fontSize: '0.78rem',
              fontWeight: 700,
              color: '#92400E',
              background: '#FDE68A',
              border: '1px solid #F59E0B',
              borderRadius: 4,
              padding: '0.35rem 0.85rem',
              textDecoration: 'none',
              whiteSpace: 'nowrap' as const,
            }}
          >
            {t.mustChange.cta}
          </a>
        </div>
      )}

      {/* Page content */}
      <main style={styles.main}>
        {children}
      </main>

      <style>{spinKeyframes}</style>
    </div>
  )
}

/* ─────────── Styles ─────────── */

const styles: Record<string, React.CSSProperties> = {
  loader: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#ffffff',
  },
  spinner: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: `3px solid ${gold}`,
    borderTopColor: 'transparent',
    animation: 'one-spin 0.75s linear infinite',
  },
  nav: {
    background: navy,
    height: 56,
    padding: '0 1.5rem',
    display: 'flex',
    alignItems: 'center',
    position: 'sticky' as const,
    top: 0,
    zIndex: 50,
    boxShadow: '0 1px 8px rgba(0,0,0,0.25)',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    fontSize: '1rem',
    textDecoration: 'none',
    letterSpacing: '0.02em',
  },
  navLinks: {
    display: 'flex',
    alignItems: 'center',
    gap: '1.5rem',
    // hidden on mobile via JS menu instead of CSS to avoid SSR flash
  },
  navLink: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: '0.78rem',
    fontWeight: 500,
    textDecoration: 'none',
    letterSpacing: '0.03em',
    transition: 'color 0.15s',
  },
  navLinkActive: {
    color: gold,
    fontWeight: 600,
  },
  signOutBtn: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: '0.75rem',
    fontWeight: 500,
    background: 'none',
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: 4,
    padding: '0.3rem 0.85rem',
    cursor: 'pointer',
    letterSpacing: '0.03em',
  },
  hamburger: {
    display: 'none',
    flexDirection: 'column' as const,
    gap: 5,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 4,
  },
  bar: {
    display: 'block',
    width: 22,
    height: 2,
    background: 'rgba(255,255,255,0.7)',
    borderRadius: 2,
  },
  drawer: {
    position: 'fixed' as const,
    top: 56,
    left: 0,
    right: 0,
    background: navy,
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '0.75rem 1.5rem 1.25rem',
    zIndex: 49,
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
    borderTop: '1px solid rgba(255,255,255,0.08)',
  },
  drawerLink: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: '0.9rem',
    fontWeight: 500,
    textDecoration: 'none',
    padding: '0.65rem 0',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    letterSpacing: '0.03em',
  },
  drawerSignOut: {
    marginTop: '0.75rem',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '0.85rem',
    background: 'none',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 4,
    padding: '0.5rem',
    cursor: 'pointer',
    textAlign: 'left' as const,
    letterSpacing: '0.03em',
  },
  main: {
    maxWidth: 1100,
    margin: '0 auto',
    padding: '2rem 1.25rem',
    background: '#ffffff',
  },
}

const spinKeyframes = `
  @keyframes one-spin { to { transform: rotate(360deg); } }
  @media (max-width: 640px) {
    [data-one-nav-links] { display: none !important; }
    [data-one-hamburger]  { display: flex !important; }
  }
`
