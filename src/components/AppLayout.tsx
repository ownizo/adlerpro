import { Link, useRouterState } from '@tanstack/react-router'
import { useIdentity } from '@/lib/identity-context'
import { cn } from '@/lib/utils'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { setLang, type LangCode } from '@/lib/i18n'
import { ThemeCustomizer } from './ThemeCustomizer'
import { getAdminNavBadgeCounts, markAdminNavSeen } from '@/lib/server-fns'

const NAV_ITEMS = [
  { to: '/dashboard' as const, key: 'nav.dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { to: '/policies' as const, key: 'nav.policies', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { to: '/quotes-comparison' as const, key: 'nav.quotesComparison', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { to: '/partner-risk' as const, key: 'nav.partnerRisk', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  { to: '/claims' as const, key: 'nav.claims', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  { to: '/alerts' as const, key: 'nav.alerts', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
  { to: '/profile' as const, key: 'nav.profile', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
]

type AdminTab = 'dashboard' | 'companies' | 'individual_clients' | 'policies' | 'claims' | 'billing' | 'api' | 'profiles' | 'tasks' | 'alerts' | 'marketing' | 'sales'

// Icon set for the admin backoffice nav — same outline-SVG convention as
// NAV_ITEMS above (24x24, stroke=currentColor, strokeWidth 1.5), no new
// icon library installed. Reused verbatim where the concept already exists
// in the project (dashboard/policies/claims/renewals/people/tasks); the
// remaining concepts (companies, marketing, billing, integrations, pipeline,
// users & metrics) get a small hand-authored path in the same visual family.
const ADMIN_ICONS: Record<AdminTab, string> = {
  dashboard: NAV_ITEMS[0].icon,
  sales: 'M3 3v18h18M7 14l3-3 3 3 5-6',
  tasks: NAV_ITEMS[3].icon, // shield-check (partnerRisk) reused for task verification
  individual_clients: NAV_ITEMS[6].icon, // person outline reused for "People"
  companies: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 10h.01M9 14h.01M15 10h.01M15 14h.01',
  policies: NAV_ITEMS[1].icon,
  alerts: NAV_ITEMS[5].icon, // bell reused for "Renewals"
  claims: NAV_ITEMS[4].icon, // warning triangle reused for "Claims"
  marketing: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13.5l3 4.5m-3-4.5l3-4.5M18 13.5H9.605c-.896 0-1.759-.34-2.409-.951L3.51 9.464C2.804 8.8 2.804 7.699 3.51 7.035l3.686-3.085c.65-.611 1.513-.951 2.409-.951H18',
  billing: 'M2.25 8.25h19.5M2.25 8.25v9a2.25 2.25 0 002.25 2.25h15a2.25 2.25 0 002.25-2.25v-9M2.25 8.25V6.75A2.25 2.25 0 014.5 4.5h15a2.25 2.25 0 012.25 2.25v1.5M6 15h3',
  api: 'M13.5 10.5l6-6m0 0h-4.5m4.5 0v4.5M10.5 13.5l-6 6m0 0h4.5m-4.5 0v-4.5',
  profiles: 'M3 3v18h18M8 17V9m4 8V5m4 12v-6',
}

// Backoffice information architecture — flat groups, no collapsible parent
// level (that extra "Administration" toggle added a click for no benefit
// once /admin has its own dedicated shell). Same underlying tabs/search
// values as before; this is navigation/UI only, no new routes.
const ADMIN_NAV_GROUPS: Array<{ label: string; items: Array<{ label: string; tab: AdminTab }> }> = [
  { label: 'Overview', items: [{ label: 'Dashboard', tab: 'dashboard' }] },
  { label: 'Sales', items: [
    { label: 'Pipeline', tab: 'sales' },
    { label: 'Tasks', tab: 'tasks' },
  ] },
  { label: 'Clients', items: [
    { label: 'People', tab: 'individual_clients' },
    { label: 'Companies', tab: 'companies' },
  ] },
  { label: 'Insurance', items: [
    { label: 'Policies', tab: 'policies' },
    { label: 'Renewals', tab: 'alerts' },
    { label: 'Claims', tab: 'claims' },
  ] },
  { label: 'Growth', items: [{ label: 'Marketing', tab: 'marketing' }] },
  { label: 'System', items: [
    { label: 'Billing', tab: 'billing' },
    { label: 'Integrations', tab: 'api' },
    { label: 'Users & Metrics', tab: 'profiles' },
  ] },
]

// Breadcrumb shown in the admin topbar, derived from the current ?tab —
// no backend/routing change, just a label lookup for the same AdminTab.
const ADMIN_BREADCRUMBS: Record<AdminTab, [string, string]> = {
  dashboard: ['Overview', 'Dashboard'],
  sales: ['Sales', 'Pipeline'],
  tasks: ['Sales', 'Tasks'],
  individual_clients: ['Clients', 'People'],
  companies: ['Clients', 'Companies'],
  policies: ['Insurance', 'Policies'],
  alerts: ['Insurance', 'Renewals'],
  claims: ['Insurance', 'Claims'],
  marketing: ['Growth', 'Marketing'],
  billing: ['System', 'Billing'],
  api: ['System', 'Integrations'],
  profiles: ['System', 'Users & Metrics'],
}

// "+ New" only ever navigates to a tab that already has its own create
// action (companies/policies/individual clients/sales all already have a
// "+" entry point on their own tab) — it does not open any dialog directly,
// since AppLayout has no access to that per-tab local state. See admin
// visual redesign notes for why this is deliberately just navigation.
const ADMIN_QUICK_CREATE_ITEMS: Array<{ label: string; tab: AdminTab }> = [
  { label: 'Opportunity', tab: 'sales' },
  { label: 'Individual client', tab: 'individual_clients' },
  { label: 'Company', tab: 'companies' },
  { label: 'Policy', tab: 'policies' },
]

function isAdminTabValue(value: unknown): value is AdminTab {
  return typeof value === 'string' && value in ADMIN_BREADCRUMBS
}

const BOTTOM_NAV_ITEMS = [
  { to: '/dashboard' as const, key: 'nav.dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { to: '/policies' as const, key: 'nav.policies', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { to: '/claims' as const, key: 'nav.claims', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  { to: '/profile' as const, key: 'nav.profile', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
]

const font = 'var(--ui-font-family)'

function initialsFor(name?: string, email?: string): string {
  const source = (name ?? '').trim()
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return source.slice(0, 2).toUpperCase()
  }
  return (email ?? '?').slice(0, 2).toUpperCase()
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ready, logout } = useIdentity()
  const { t, i18n } = useTranslation()
  const location = useRouterState({ select: (state) => state.location })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [lang, setLangState] = useState<LangCode>((i18n.language as LangCode) ?? 'pt')
  const isAdmin = user?.roles?.includes('admin')
  const isAdminRoute = location.pathname.startsWith('/admin')
  const [navBadges, setNavBadges] = useState({ tasks: 0, alerts: 0 })
  const [quickCreateOpen, setQuickCreateOpen] = useState(false)
  const quickCreateRef = useRef<HTMLDivElement>(null)

  const adminTabParam = new URLSearchParams(location.searchStr).get('tab')
  const activeAdminTab: AdminTab = isAdminTabValue(adminTabParam) ? adminTabParam : 'dashboard'

  useEffect(() => {
    if (!isAdmin || !ready) return
    getAdminNavBadgeCounts()
      .then(({ tasksCount, alertsCount }) => setNavBadges({ tasks: tasksCount, alerts: alertsCount }))
      .catch(console.error)
  }, [isAdmin, ready])

  useEffect(() => {
    if (!isAdmin || !ready) return
    const currentTab = new URLSearchParams(location.searchStr).get('tab')
    if (currentTab === 'tasks' || currentTab === 'alerts') {
      const tab = currentTab
      setNavBadges((prev) => ({ ...prev, [tab]: 0 }))
      markAdminNavSeen({ data: { tab } }).catch(console.error)
    }
  }, [location.searchStr, isAdmin, ready])

  useEffect(() => {
    if (!quickCreateOpen) return
    function onClickOutside(e: MouseEvent) {
      if (quickCreateRef.current && !quickCreateRef.current.contains(e.target as Node)) setQuickCreateOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [quickCreateOpen])

  const handleLogout = async () => {
    try { await logout() } catch { /* proceed */ }
    window.location.href = '/'
  }

  const handleLang = (l: LangCode) => {
    setLang(l)
    setLangState(l)
  }

  return (
    <div
      className={cn('min-h-screen flex', isAdminRoute && 'admin-backoffice-shell')}
      style={{ background: isAdminRoute ? undefined : 'var(--ui-surface-bg)' }}
    >
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={cn(
          'fixed lg:static inset-y-0 left-0 z-50 w-64 flex flex-col transition-transform duration-200 lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          isAdminRoute && 'admin-backoffice-sidebar'
        )}
        style={isAdminRoute ? undefined : { background: 'var(--ui-surface-bg)', borderRight: '1.5px solid var(--ui-text-primary)' }}
      >
        {isAdminRoute ? (
          <Link to="/admin" search={{ tab: 'dashboard' }} className="admin-brand">
            <span className="admin-brand-name">ADLER &amp; ROCHEFORT</span>
            <span className="admin-brand-tag">BACKOFFICE</span>
            <span className="admin-brand-sub">Internal workspace</span>
          </Link>
        ) : (
          <div style={{ padding: '1.25rem 1rem 1rem', borderBottom: '1px solid var(--ui-border)' }}>
            <Link to="/dashboard" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}>
              <div style={{ width: '100%', display: 'flex', alignItems: 'baseline', gap: '0.2rem' }}>
                <span style={{ fontFamily: font, fontSize: '1rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ui-text-primary)' }}>
                  Os Meus Seguros
                </span>
                <span style={{ fontFamily: font, fontSize: '0.6rem', fontWeight: 300, color: 'var(--ui-text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginLeft: '0.3rem' }}>
                  {t('common.portal')}
                </span>
              </div>
              <span style={{ fontFamily: font, fontSize: '0.6rem', fontWeight: 300, color: 'var(--ui-accent)', letterSpacing: '0.08em' }}>
                by Adler &amp; Rochefort
              </span>
            </Link>
          </div>
        )}

        {isAdminRoute ? (
          <nav className="admin-nav">
            {isAdmin && ADMIN_NAV_GROUPS.map((group) => (
              <div key={group.label} className="admin-nav-group">
                <p className="admin-nav-group-label">{group.label}</p>
                <div className="admin-nav-group-items">
                  {group.items.map((item) => {
                    const badge = item.tab === 'tasks' ? navBadges.tasks : item.tab === 'alerts' ? navBadges.alerts : 0
                    return (
                      <Link
                        key={item.tab}
                        to="/admin"
                        search={{ tab: item.tab }}
                        className="admin-nav-item"
                        activeProps={{ className: 'admin-nav-item admin-nav-item-active' }}
                        activeOptions={{ includeSearch: true }}
                        onClick={() => setSidebarOpen(false)}
                      >
                        <svg className="w-[18px] h-[18px] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={ADMIN_ICONS[item.tab]} />
                        </svg>
                        <span className="admin-nav-item-label">{item.label}</span>
                        {badge > 0 && <span className="admin-nav-badge">{badge > 99 ? '99+' : badge}</span>}
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
        ) : (
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors"
                style={{ fontFamily: font, color: 'var(--ui-menu-text)', borderRadius: '2px' }}
                activeProps={{ style: { fontFamily: font, color: 'var(--ui-menu-active-text)', background: 'var(--ui-menu-active-bg)', borderRadius: '2px' } }}
                onClick={() => setSidebarOpen(false)}
              >
                <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                {t(item.key)}
              </Link>
            ))}
          </nav>
        )}

        {ready && user && (
          <div className={isAdminRoute ? 'admin-sidebar-footer' : 'p-4 mt-auto'} style={isAdminRoute ? undefined : { borderTop: '1px solid var(--ui-border)' }}>
            <div style={{ marginBottom: '0.5rem', padding: '0 0.25rem' }}>
              <p style={isAdminRoute ? undefined : { fontFamily: font, fontSize: '0.75rem', fontWeight: 600, color: 'var(--ui-text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.name || user.email}
              </p>
              <p style={isAdminRoute ? undefined : { fontFamily: font, fontSize: '0.65rem', color: 'var(--ui-text-muted)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.email}
              </p>
            </div>
            <button
              onClick={handleLogout}
              className={isAdminRoute ? 'admin-sidebar-logout' : 'w-full flex justify-center items-center py-2.5 text-sm font-semibold rounded transition-colors'}
              style={isAdminRoute ? undefined : { background: 'var(--ui-menu-active-bg)', color: 'var(--ui-menu-text)', border: '1px solid var(--ui-border)', fontFamily: font }}
              onMouseEnter={isAdminRoute ? undefined : (e) => { e.currentTarget.style.background = '#fee2e2'; e.currentTarget.style.color = '#dc2626' }}
              onMouseLeave={isAdminRoute ? undefined : (e) => { e.currentTarget.style.background = 'var(--ui-menu-active-bg)'; e.currentTarget.style.color = 'var(--ui-menu-text)' }}
            >
              {isAdminRoute ? 'Sign out' : t('common.logout')}
            </button>
          </div>
        )}
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {isAdminRoute ? (
          <header className="admin-backoffice-header">
            <button
              onClick={() => setSidebarOpen(true)}
              className="admin-header-menu-btn lg:hidden"
              aria-label={t('nav.openMenu')}
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>

            <div className="admin-breadcrumb">
              <span className="admin-breadcrumb-section">{ADMIN_BREADCRUMBS[activeAdminTab][0]}</span>
              <span className="admin-breadcrumb-sep">/</span>
              <span className="admin-breadcrumb-page">{ADMIN_BREADCRUMBS[activeAdminTab][1]}</span>
            </div>

            <button type="button" className="admin-global-search" aria-label="Search">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
              </svg>
              <span className="admin-global-search-placeholder">Search clients, policies, opportunities…</span>
              <span className="admin-global-search-kbd">⌘K</span>
            </button>

            <div className="admin-header-actions">
              <div className="admin-quick-create" ref={quickCreateRef}>
                <button type="button" className="admin-create-button" onClick={() => setQuickCreateOpen((v) => !v)}>
                  + New
                </button>
                {quickCreateOpen && (
                  <div className="admin-quick-create-menu">
                    {ADMIN_QUICK_CREATE_ITEMS.map((item) => (
                      <Link
                        key={item.tab}
                        to="/admin"
                        search={{ tab: item.tab }}
                        className="admin-quick-create-item"
                        onClick={() => setQuickCreateOpen(false)}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <Link to="/admin" search={{ tab: 'alerts' }} className="admin-header-icon-btn" title="Renewals">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {navBadges.alerts > 0 && <span className="admin-header-icon-badge" />}
              </Link>

              {ready && user && (
                <div className="admin-user-avatar" title={user.name || user.email}>
                  {initialsFor(user.name, user.email)}
                </div>
              )}
            </div>
          </header>
        ) : (
          <header className="px-4 lg:px-8 h-14 flex items-center shrink-0" style={{ background: 'var(--ui-surface-bg)', borderBottom: '1px solid var(--ui-border)' }}>
            {/* Left zone — flex-1, só tem conteúdo em mobile */}
            <div className="flex-1 flex items-center" style={{ minWidth: 0 }}>
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 -ml-2"
                style={{ color: 'var(--ui-text-primary)' }}
                aria-label={t('nav.openMenu')}
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              </button>
            </div>

            {/* Centre zone — logo centrado */}
            <img src="/logo.png" alt="Adler & Rochefort" style={{ height: '32px', width: 'auto', display: 'block', flexShrink: 0 }} />

            {/* Right zone — PT/EN + utilizador + sino */}
            <div className="flex-1 flex items-center justify-end gap-3" style={{ minWidth: 0 }}>
              {/* Language switcher */}
              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--ui-border)', borderRadius: '4px', overflow: 'hidden', fontFamily: font }}>
                {(['pt', 'en'] as LangCode[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => handleLang(l)}
                    style={{
                      background: lang === l ? 'var(--ui-text-primary)' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '0.25rem 0.6rem',
                      fontFamily: font,
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      color: lang === l ? 'var(--ui-surface-bg)' : 'var(--ui-text-muted)',
                      transition: 'background 0.15s, color 0.15s',
                    }}
                  >
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>

              {ready && user && (
                <>
                  <span className="hidden sm:inline text-sm" style={{ color: 'var(--ui-text-secondary)', fontFamily: font, fontWeight: 300 }}>
                    {user.name || user.email}
                  </span>
                  <Link to="/alerts" style={{ color: 'var(--ui-text-secondary)', display: 'flex', alignItems: 'center' }} title={t('nav.alerts')}>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                  </Link>
                </>
              )}
            </div>
          </header>
        )}

        <main
          className={cn(
            'flex-1 overflow-y-auto p-4 lg:p-8 pb-20 lg:pb-8',
            isAdminRoute && 'admin-backoffice-main'
          )}
          style={{ background: isAdminRoute ? undefined : 'var(--ui-page-bg)' }}
        >
          {children}
        </main>
      </div>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 flex" style={{ background: 'var(--ui-surface-bg)', borderTop: '1.5px solid var(--ui-text-primary)', height: '60px' }}>
        {BOTTOM_NAV_ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex-1 flex flex-col items-center justify-center gap-0.5"
            style={{ color: 'var(--ui-menu-text)', textDecoration: 'none' }}
            activeProps={{ style: { color: 'var(--ui-accent)', textDecoration: 'none' } }}
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

      {!isAdminRoute && <ThemeCustomizer />}
    </div>
  )
}
