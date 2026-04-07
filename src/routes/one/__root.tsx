/**
 * OneLayout — layout shell for all /one/* routes (Adler One portal).
 * Not a TanStack Router route file; used as a wrapper component by each
 * /one/* route, similar to how AppLayout works for the main portal.
 *
 * Checks Supabase session on mount. If no session, redirects to /one/login.
 */
import { Link } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { useState, useEffect } from 'react'

const navy = '#0A1628'
const gold  = '#C9A84C'

const NAV_LINKS = [
  { to: '/one/dashboard',  label: 'Dashboard'    },
  { to: '/one/policies',   label: 'Apólices'     },
  { to: '/one/claims',     label: 'Sinistros'    },
  { to: '/one/documents',  label: 'Documentos'   },
  { to: '/one/profile',    label: 'Perfil'       },
]

export function OneLayout({ children }: { children: React.ReactNode }) {
  const [checking,    setChecking]    = useState(true)
  const [menuOpen,    setMenuOpen]    = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        window.location.replace('/one/login')
      } else {
        setChecking(false)
      }
    })
  }, [])

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
    <div style={{ minHeight: '100vh', background: '#F4F6FA', fontFamily: "'Montserrat', sans-serif" }}>

      {/* ── Top nav ── */}
      <nav style={styles.nav}>
        <a href="/one/dashboard" style={styles.logo}>
          <span style={{ color: gold, fontWeight: 700, letterSpacing: '0.04em' }}>ADLER</span>
          <span style={{ color: '#fff', fontWeight: 300, letterSpacing: '0.1em', marginLeft: 4 }}>ONE</span>
        </a>

        {/* Desktop links */}
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
            Sair
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
            Sair
          </button>
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
    background: '#F4F6FA',
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
    justifyContent: 'space-between',
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
  },
}

const spinKeyframes = `
  @keyframes one-spin { to { transform: rotate(360deg); } }
  @media (max-width: 640px) {
    [data-one-nav-links] { display: none !important; }
    [data-one-hamburger]  { display: flex !important; }
  }
`
