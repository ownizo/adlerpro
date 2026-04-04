import { Link } from '@tanstack/react-router'
import { useIdentity } from '@/lib/identity-context'
import { cn } from '@/lib/utils'
import { useState } from 'react'

const NAV_ITEMS = [
  { to: '/dashboard' as const, label: 'Painel de Controlo', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { to: '/profile' as const, label: 'Perfil', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
  { to: '/policies' as const, label: 'Apólices', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { to: '/weather-alerts' as const, label: 'Alertas de Tempo', icon: 'M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z' },
  { to: '/alerts' as const, label: 'Alertas', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
  { to: '/partner-risk' as const, label: 'Risco Parceiros', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  { to: '/license-plates' as const, label: 'Matrículas', icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' },
  { to: '/quotes-comparison' as const, label: 'Comparativo IA', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
]

const ADMIN_NAV_ITEMS = [
  { to: '/admin' as const, label: 'Administração', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
]

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ready, logout } = useIdentity()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const isAdmin = user?.roles?.includes('admin')
  const primaryItems = isAdmin
    ? NAV_ITEMS.filter((item) => item.to === '/dashboard' || item.to === '/profile')
    : NAV_ITEMS

  const handleLogout = async () => {
    try {
      await logout()
    } catch {
      // Proceed with navigation even if logout API fails
    }
    window.location.href = '/'
  }

  return (
    <div className="min-h-screen flex bg-white">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white flex flex-col transition-transform duration-200 lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        style={{ borderRight: '1.5px solid #111111' }}
      >
        <div className="p-6" style={{ borderBottom: '1px solid #eeeeee' }}>
          <Link to="/dashboard" className="flex items-center gap-2">
            <img src="/logo.png" alt="Adler & Rochefort" style={{ height: '52px', width: 'auto' }} />
            <div>
              <h1 style={{
                fontFamily: "'Montserrat', sans-serif",
                fontSize: '0.95rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase' as const,
                color: '#111111',
              }}>
                Adler<span style={{ color: '#C8961A' }}>.</span>Pro
              </h1>
              <p style={{
                fontFamily: "'Montserrat', sans-serif",
                fontSize: '0.65rem',
                fontWeight: 300,
                color: '#999999',
                letterSpacing: '0.12em',
                textTransform: 'uppercase' as const,
                marginTop: '2px',
              }}>
                Portal do Cliente
              </p>
            </div>
          </Link>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {primaryItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors',
                '[&.active]:text-primary [&.active]:bg-[#f8f8f8]'
              )}
              style={{
                fontFamily: "'Montserrat', sans-serif",
                color: '#666666',
                borderRadius: '2px',
              }}
              activeProps={{ className: 'active' }}
              onClick={() => setSidebarOpen(false)}
            >
              <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              {item.label}
            </Link>
          ))}

          {isAdmin && (
            <>
              <div className="pt-4 pb-2">
                <p style={{
                  fontFamily: "'Montserrat', sans-serif",
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.14em',
                  color: '#C8961A',
                  padding: '0 0.75rem',
                }}>
                  Administração
                </p>
              </div>
              {ADMIN_NAV_ITEMS.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors',
                    '[&.active]:text-primary [&.active]:bg-[#f8f8f8]'
                  )}
                  style={{
                    fontFamily: "'Montserrat', sans-serif",
                    color: '#666666',
                    borderRadius: '2px',
                  }}
                  activeProps={{ className: 'active' }}
                  onClick={() => setSidebarOpen(false)}
                >
                  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                  {item.label}
                </Link>
              ))}
            </>
          )}
        </nav>

        {ready && user && (
          <div className="p-4 mt-auto" style={{ borderTop: '1px solid #eeeeee' }}>
            <button
              onClick={handleLogout}
              className="w-full flex justify-center items-center py-2.5 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 font-semibold rounded transition-colors text-sm"
            >
              Terminar Sessão
            </button>
          </div>
        )}
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="px-4 lg:px-8 h-16 flex items-center justify-between shrink-0" style={{
          background: '#ffffff',
          borderBottom: '1px solid #eeeeee',
        }}>
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 -ml-2"
            style={{ color: '#111111' }}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            {ready && user && (
              <span className="hidden sm:inline text-sm" style={{ color: '#666666', fontFamily: "'Montserrat', sans-serif" }}>
                {user.name || user.email}
              </span>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-8" style={{ background: '#ffffff' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
