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

export type AdminSubTab = {
  key: string
  label: string
  icon?: string
}

type AppLayoutProps = {
  children: React.ReactNode
  adminTabs?: AdminSubTab[]
  activeAdminTab?: string
  onAdminTabChange?: (key: string) => void
}

const ADMIN_TAB_ICONS: Record<string, string> = {
  dashboard_analytics: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
  companies: 'M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21',
  individual_clients: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z',
  policies: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
  claims: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z',
  social: 'M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0-12.814a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0 12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z',
  api: 'M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244',
  profiles: 'M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z',
  alerts: 'M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0',
  billing: 'M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z',
}

export function AppLayout({ children, adminTabs, activeAdminTab, onAdminTabChange }: AppLayoutProps) {
  const { user, ready, logout } = useIdentity()
  const { t, i18n } = useTranslation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [adminExpanded, setAdminExpanded] = useState(!!adminTabs)
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
                <button
                  onClick={() => {
                    setAdminExpanded(!adminExpanded)
                    if (!adminExpanded && !adminTabs) {
                      // Navigate to admin if not already there
                      window.location.href = '/admin'
                    }
                  }}
                  className="w-full flex items-center justify-between"
                  style={{ fontFamily: font, fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: '#C8961A', padding: '0 0.75rem', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  <span>{t('nav.admin')}</span>
                  <svg
                    className={cn('w-3.5 h-3.5 transition-transform duration-200', adminExpanded ? 'rotate-180' : '')}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>
              </div>

              {!adminTabs && (
                <Link
                  to="/admin"
                  className={cn('flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors', '[&.active]:text-primary [&.active]:bg-[#f8f8f8]')}
                  style={{ fontFamily: font, color: '#666666', borderRadius: '2px' }}
                  activeProps={{ className: 'active' }}
                  onClick={() => setSidebarOpen(false)}
                >
                  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={ADMIN_NAV_ITEMS[0].icon} />
                  </svg>
                  {t('nav.admin')}
                </Link>
              )}

              {adminExpanded && adminTabs && (
                <div className="space-y-0.5">
                  {adminTabs.map((tab) => {
                    const iconPath = ADMIN_TAB_ICONS[tab.key] || ADMIN_NAV_ITEMS[0].icon
                    const isActive = activeAdminTab === tab.key
                    return (
                      <button
                        key={tab.key}
                        onClick={() => {
                          onAdminTabChange?.(tab.key)
                          setSidebarOpen(false)
                        }}
                        className={cn(
                          'w-full flex items-center gap-2.5 px-3 py-2 text-[0.8rem] font-medium transition-colors text-left',
                          isActive ? 'bg-[#f8f8f8]' : 'hover:bg-[#fafafa]'
                        )}
                        style={{
                          fontFamily: font,
                          color: isActive ? '#C8961A' : '#666666',
                          borderRadius: '2px',
                          borderLeft: isActive ? '2px solid #C8961A' : '2px solid transparent',
                        }}
                      >
                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
                        </svg>
                        {tab.label}
                      </button>
                    )
                  })}
                </div>
              )}
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
            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #dddddd', borderRadius: '4px', overflow: 'hidden', fontFamily: font }}>
              {(['pt', 'en'] as LangCode[]).map((l) => (
                <button
                  key={l}
                  onClick={() => handleLang(l)}
                  style={{
                    background: lang === l ? '#111111' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '0.25rem 0.6rem',
                    fontFamily: font,
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    color: lang === l ? '#ffffff' : '#888888',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                >
                  {l.toUpperCase()}
                </button>
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
