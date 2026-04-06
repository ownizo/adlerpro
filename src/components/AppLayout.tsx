import { Link } from '@tanstack/react-router'
import { useIdentity } from '@/lib/identity-context'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { setLang, type LangCode } from '@/lib/i18n'

const NAV_ITEMS = [
  { to: '/dashboard' as const, key: 'nav.dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { to: '/policies' as const, key: 'nav.policies', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { to: '/quotes-comparison' as const, key: 'nav.quotesComparison', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { to: '/partner-risk' as const, key: 'nav.partnerRisk', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  { to: '/license-plates' as const, key: 'nav.licensePlates', icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' },
  { to: '/weather-alerts' as const, key: 'nav.weatherAlerts', icon: 'M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z' },
  { to: '/claims' as const, key: 'nav.claims', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  { to: '/alerts' as const, key: 'nav.alerts', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
  { to: '/profile' as const, key: 'nav.profile', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
]

const ADMIN_NAV_ITEMS = [
  { to: '/admin' as const, key: 'nav.admin', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
]

const BOTTOM_NAV_ITEMS = [
  { to: '/dashboard' as const, key: 'nav.dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { to: '/policies' as const, key: 'nav.policies', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { to: '/claims' as const, key: 'nav.claims', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  { to: '/profile' as const, key: 'nav.profile', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
]

const font = "'Montserrat', sans-serif"

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ready, logout } = useIdentity()
  const { t, i18n } = useTranslation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [lang, setLangState] = useState<LangCode>((i18n.language as LangCode) ?? 'pt')
  const isAdmin = user?.roles?.includes('admin')

  const primaryItems = isAdmin
    ? NAV_ITEMS.filter((item) => item.to === '/dashboard' || item.to === '/profile')
    : NAV_ITEMS

  const handleLogout = async () => {
    try { await logout() } catch { /* proceed */ }
    window.location.href = '/'
  }

  const handleLang = (l: LangCode) => {
    setLang(l)
    setLangState(l)
  }

  return (
    <div className="min-h-screen flex bg-white">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={cn(
          'fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white flex flex-col transition-transform duration-200 lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        style={{ borderRight: '1.5px solid #111111' }}
      >
        <div style={{ padding: '1.25rem 1rem 1rem', borderBottom: '1px solid #eeeeee' }}>
          <Link to="/dashboard" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}>
            <div style={{ width: '100%', display: 'flex', alignItems: 'baseline', gap: '0.2rem' }}>
              <span style={{ fontFamily: font, fontSize: '1rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#111111' }}>
                Adler<span style={{ color: '#C8961A' }}>.</span>Pro
              </span>
              <span style={{ fontFamily: font, fontSize: '0.6rem', fontWeight: 300, color: '#aaaaaa', letterSpacing: '0.1em', textTransform: 'uppercase', marginLeft: '0.3rem' }}>
                {t('common.portal')}
              </span>
            </div>
            <img src="/logo.png" alt="Adler & Rochefort" style={{ height: '72px', width: 'auto', display: 'block' }} />
          </Link>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {primaryItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn('flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors', '[&.active]:text-primary [&.active]:bg-[#f8f8f8]')}
              style={{ fontFamily: font, color: '#666666', borderRadius: '2px' }}
              activeProps={{ className: 'active' }}
              onClick={() => setSidebarOpen(false)}
            >
              <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              {t(item.key)}
            </Link>
          ))}

          {isAdmin && (
            <>
              <div className="pt-4 pb-2">
                <p style={{ fontFamily: font, fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: '#C8961A', padding: '0 0.75rem' }}>
                  {t('nav.admin')}
                </p>
              </div>
              {ADMIN_NAV_ITEMS.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn('flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors', '[&.active]:text-primary [&.active]:bg-[#f8f8f8]')}
                  style={{ fontFamily: font, color: '#666666', borderRadius: '2px' }}
                  activeProps={{ className: 'active' }}
                  onClick={() => setSidebarOpen(false)}
                >
                  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                  {t(item.key)}
                </Link>
              ))}
            </>
          )}
        </nav>

        {ready && user && (
          <div className="p-4 mt-auto" style={{ borderTop: '1px solid #eeeeee' }}>
            <div style={{ marginBottom: '0.5rem', padding: '0 0.25rem' }}>
              <p style={{ fontFamily: font, fontSize: '0.75rem', fontWeight: 600, color: '#333333', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.name || user.email}
              </p>
              <p style={{ fontFamily: font, fontSize: '0.65rem', color: '#999999', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.email}
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex justify-center items-center py-2.5 text-sm font-semibold rounded transition-colors"
              style={{ background: '#f8f8f8', color: '#666666', border: '1px solid #eeeeee', fontFamily: font }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#fee2e2'; e.currentTarget.style.color = '#dc2626' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#f8f8f8'; e.currentTarget.style.color = '#666666' }}
            >
              {t('common.logout')}
            </button>
          </div>
        )}
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="px-4 lg:px-8 h-14 flex items-center justify-between shrink-0" style={{ background: '#ffffff', borderBottom: '1px solid #eeeeee' }}>
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 -ml-2"
            style={{ color: '#111111' }}
            aria-label={t('nav.openMenu')}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>

          <div className="flex-1" />

          <div className="flex items-center gap-3">
            {/* Language switcher */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0', fontFamily: font }}>
              {(['pt', 'en'] as LangCode[]).map((l, i) => (
                <span key={l} style={{ display: 'flex', alignItems: 'center' }}>
                  {i > 0 && <span style={{ color: '#dddddd', padding: '0 0.15rem', fontSize: '0.7rem' }}>|</span>}
                  <button
                    onClick={() => handleLang(l)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: '0.15rem 0.3rem',
                      fontFamily: font, fontSize: '0.7rem', fontWeight: lang === l ? 700 : 400,
                      color: lang === l ? '#111111' : '#aaaaaa', letterSpacing: '0.06em',
                    }}
                  >
                    {l.toUpperCase()}
                  </button>
                </span>
              ))}
            </div>

            {ready && user && (
              <>
                <span className="hidden sm:inline text-sm" style={{ color: '#666666', fontFamily: font, fontWeight: 300 }}>
                  {user.name || user.email}
                </span>
                <Link to="/alerts" style={{ color: '#666666', display: 'flex', alignItems: 'center' }} title={t('nav.alerts')}>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </Link>
              </>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-8 pb-20 lg:pb-8" style={{ background: '#fafafa' }}>
          {children}
        </main>
      </div>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 flex" style={{ background: '#ffffff', borderTop: '1.5px solid #111111', height: '60px' }}>
        {BOTTOM_NAV_ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 [&.active]:text-[#C8961A]"
            style={{ color: '#888888', textDecoration: 'none' }}
            activeProps={{ style: { color: '#C8961A' } }}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
            </svg>
            <span style={{ fontFamily: font, fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.04em' }}>
              {t(item.key)}
            </span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
