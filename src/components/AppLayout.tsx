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
  individual_clients: NAV_ITEMS[6].icon, // person outline reused for "Clients"
  companies: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 10h.01M9 14h.01M15 10h.01M15 14h.01',
  policies: NAV_ITEMS[1].icon,
  alerts: NAV_ITEMS[5].icon, // bell reused for "Renewals"
  claims: NAV_ITEMS[4].icon, // warning triangle reused for "Claims"
  marketing: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13.5l3 4.5m-3-4.5l3-4.5M18 13.5H9.605c-.896 0-1.759-.34-2.409-.951L3.51 9.464C2.804 8.8 2.804 7.699 3.51 7.035l3.686-3.085c.65-.611 1.513-.951 2.409-.951H18',
  billing: 'M2.25 8.25h19.5M2.25 8.25v9a2.25 2.25 0 002.25 2.25h15a2.25 2.25 0 002.25-2.25v-9M2.25 8.25V6.75A2.25 2.25 0 014.5 4.5h15a2.25 2.25 0 012.25 2.25v1.5M6 15h3',
  api: 'M13.5 10.5l6-6m0 0h-4.5m4.5 0v4.5M10.5 13.5l-6 6m0 0h4.5m-4.5 0v-4.5',
  profiles: 'M3 3v18h18M8 17V9m4 8V5m4 12v-6',
}

// Same outline-SVG convention, for the one `to`-based (non-tab) nav item —
// a simple link/chain glyph for "external system connection".
// Receipt glyph for the Expenses (Despesas) route.
const EXPENSES_ICON = 'M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0c1.1.128 1.907 1.077 1.907 2.185zM9.75 9h.008v.008H9.75V9zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 4.5h.008v.008h-.008V13.5zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z'

const SITE_VISITS_ICON = 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z'
function adminNavIcon(item: AdminNavItem): string {
  if ('tab' in item) return ADMIN_ICONS[item.tab]
  if (item.to === '/admin/expenses') return EXPENSES_ICON
  if (item.to === '/admin/site-visits') return SITE_VISITS_ICON
  if (item.to === '/admin/today') return TODAY_ICON
  if (item.to === '/admin/claude') return CLAUDE_ICON
  if (item.to === '/admin/ai-visibility') return AI_VISIBILITY_ICON
  return CARRIER_INTEGRATIONS_ICON
}

const TODAY_ICON = 'M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z'
const CLAUDE_ICON = 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z'

const AI_VISIBILITY_ICON = 'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178zM15 12a3 3 0 11-6 0 3 3 0 016 0z'

const SIDEBAR_COLLAPSED_KEY = 'ar-admin-sidebar-collapsed'

const CARRIER_INTEGRATIONS_ICON = 'M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244'

// A nav item is either one of the existing /admin?tab=X tabs, or (CRM3
// Block 2) a genuinely separate route — `to` is a real path, never a tab.
// Kept as a union rather than folding carrier-integrations into AdminTab:
// that page is its own route/component, not another case inside the giant
// /admin tab switch — see admin.tsx's AdminPage/AdminDashboardContent split.
type AdminRoutePath = '/admin/carrier-integrations' | '/admin/payment-links' | '/admin/expenses' | '/admin/site-visits' | '/admin/today' | '/admin/claude' | '/admin/ai-visibility'
type AdminNavItem = { label: string; tab: AdminTab } | { label: string; to: AdminRoutePath }

// Backoffice information architecture — flat groups, no collapsible parent
// level (that extra "Administration" toggle added a click for no benefit
// once /admin has its own dedicated shell). Same underlying tabs/search
// values as before, plus one real route (Carrier Integrations) — this is
// still additive navigation, no reordering of unrelated groups/items.
const ADMIN_NAV_GROUPS: Array<{ label: string; items: AdminNavItem[] }> = [
  { label: 'Overview', items: [{ label: 'Hoje', to: '/admin/today' }, { label: 'Dashboard', tab: 'dashboard' }] },
  { label: 'Sales', items: [
    { label: 'Pipeline', tab: 'sales' },
    { label: 'Tasks', tab: 'tasks' },
  ] },
  { label: 'Clients', items: [
    { label: 'Clients', tab: 'individual_clients' },
  ] },
  { label: 'Insurance', items: [
    { label: 'Policies', tab: 'policies' },
    { label: 'Renewals', tab: 'alerts' },
    { label: 'Claims', tab: 'claims' },
  ] },
  { label: 'Finance', items: [
    { label: 'Payment Link', to: '/admin/payment-links' },
    { label: 'Despesas', to: '/admin/expenses' },
  ] },
  { label: 'Growth', items: [
    { label: 'Marketing', tab: 'marketing' },
    { label: 'Visitas do site', to: '/admin/site-visits' },
    { label: 'Visibilidade em IA', to: '/admin/ai-visibility' },
  ] },
  { label: 'System', items: [
    { label: 'Billing', tab: 'billing' },
    { label: 'Integrations', tab: 'api' },
    { label: 'Carrier Integrations', to: '/admin/carrier-integrations' },
    { label: 'Users & Metrics', tab: 'profiles' },
    { label: 'Claude', to: '/admin/claude' },
  ] },
]

// Breadcrumb shown in the admin topbar, derived from the current ?tab —
// no backend/routing change, just a label lookup for the same AdminTab.
const ROUTE_CRUMBS: Record<string, [string, string]> = {
  '/admin/today': ['Overview', 'Hoje'],
  '/admin/payment-links': ['Finance', 'Payment Link'],
  '/admin/expenses': ['Finance', 'Despesas'],
  '/admin/site-visits': ['Growth', 'Visitas do site'],
  '/admin/ai-visibility': ['Growth', 'Visibilidade em IA'],
  '/admin/carrier-integrations': ['System', 'Carrier Integrations'],
  '/admin/claude': ['System', 'Claude'],
}

const ADMIN_BREADCRUMBS: Record<AdminTab, [string, string]> = {
  dashboard: ['Overview', 'Dashboard'],
  sales: ['Sales', 'Pipeline'],
  tasks: ['Sales', 'Tasks'],
  individual_clients: ['Clients', 'All clients'],
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
  { label: 'Client', tab: 'individual_clients' },
  { label: 'Policy', tab: 'policies' },
]

/** Fired by the claims screen after a claim is opened, so the counters update at once. */
export const ADMIN_BADGES_REFRESH = 'admin-badges-refresh'

function navBadgeFor(tab: AdminTab, badges: { tasks: number; alerts: number; claims: number }) {
  if (tab === 'tasks') return badges.tasks
  if (tab === 'alerts') return badges.alerts
  if (tab === 'claims') return badges.claims
  return 0
}

function isAdminTabValue(value: unknown): value is AdminTab {
  return typeof value === 'string' && value in ADMIN_BREADCRUMBS
}

// Phone-sized backoffice navigation: the four screens used most on the go,
// plus a button that opens the full sidebar for everything else.
const ADMIN_BOTTOM_NAV: Array<{ label: string; tab: AdminTab; icon: string }> = [
  { label: 'Dashboard', tab: 'dashboard', icon: 'M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25' },
  { label: 'Pipeline', tab: 'sales', icon: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z' },
  { label: 'Clients', tab: 'individual_clients', icon: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z' },
  { label: 'Policies', tab: 'policies', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z' },
]

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
  const [navBadges, setNavBadges] = useState({ tasks: 0, alerts: 0, claims: 0 })
  const [quickCreateOpen, setQuickCreateOpen] = useState(false)
  const quickCreateRef = useRef<HTMLDivElement>(null)
  // App-style shell (admin): bottom sheet with every section on phones,
  // collapsible icon rail on desktop, account menu on the avatar.
  const [moreOpen, setMoreOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const mainRef = useRef<HTMLElement>(null)

  const adminTabParam = new URLSearchParams(location.searchStr).get('tab')
  const activeAdminTab: AdminTab = isAdminTabValue(adminTabParam) ? adminTabParam : 'dashboard'

  // The backoffice is English-only, but a handful of admin components
  // (BillingTab) still read copy through the shared i18next instance rather
  // than hardcoded strings. i18n is a singleton shared with the customer
  // portal, so if an admin had switched the customer-facing language to PT
  // earlier in the same session, those components would render in
  // Portuguese. Force English for the duration of /admin, and restore the
  // customer's chosen language the moment they navigate back out — this
  // never touches localStorage/setLang, so the customer portal's own
  // language preference is untouched.
  useEffect(() => {
    i18n.changeLanguage(isAdminRoute ? 'en' : lang)
  }, [isAdminRoute, lang, i18n])

  // Phones: tables (marked `ar-stack`, automatically for the work area) render as one card per row (CSS in
  // styles.css). Each cell needs its column name to show as a label, so copy
  // the header text into data-label whenever rows appear or change.
  useEffect(() => {
    if (!isAdminRoute || typeof window === 'undefined') return
    const label = () => {
      // every table in the work area with a header stacks on phones (opt out with .no-stack)
      document.querySelectorAll<HTMLTableElement>('.admin-backoffice-main table:not(.no-stack):not(.ar-stack)').forEach((t) => {
        if (t.tHead && t.tHead.rows.length) t.classList.add('ar-stack')
      })
      document.querySelectorAll<HTMLTableElement>('table.ar-stack').forEach((table) => {
        const heads = Array.from(table.querySelectorAll('thead th')).map((th) => (th.textContent || '').trim())
        table.querySelectorAll('tbody tr').forEach((tr) => {
          const cells = Array.from(tr.children) as HTMLElement[]
          if (cells.length !== heads.length) return
          cells.forEach((td, i) => { if (td.dataset.label !== heads[i]) td.dataset.label = heads[i] })
        })
      })
    }
    label()
    // React re-renders fire many mutations in a burst (every keystroke in a
    // form, every row of a long table). Re-scan at most once per frame instead
    // of once per mutation, which kept the main thread busy on large lists.
    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => { frame = 0; label() })
    }
    const obs = new MutationObserver(schedule)
    obs.observe(document.body, { childList: true, subtree: true })
    return () => { obs.disconnect(); if (frame) window.cancelAnimationFrame(frame) }
  }, [isAdminRoute])

  // Claims with unread client activity are re-checked every minute, when the
  // window regains focus, and when a claim is opened (ADMIN_BADGES_REFRESH).
  useEffect(() => {
    if (!isAdmin || !ready) return
    const load = () => {
      getAdminNavBadgeCounts()
        .then(({ tasksCount, alertsCount, claimsCount }) => setNavBadges({ tasks: tasksCount, alerts: alertsCount, claims: claimsCount }))
        .catch(console.error)
    }
    load()
    const timer = window.setInterval(load, 60_000)
    window.addEventListener('focus', load)
    window.addEventListener(ADMIN_BADGES_REFRESH, load)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', load)
      window.removeEventListener(ADMIN_BADGES_REFRESH, load)
    }
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

  useEffect(() => {
    try { setRailCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1') } catch { /* private mode */ }
  }, [])

  const toggleRail = () => {
    setRailCollapsed((v) => {
      try { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, v ? '0' : '1') } catch { /* private mode */ }
      return !v
    })
  }

  // Changing screen behaves like an app: close any open sheet/menu, start
  // the new screen at the top and fade it in.
  useEffect(() => {
    if (!isAdminRoute) return
    setMoreOpen(false)
    setAccountOpen(false)
    setQuickCreateOpen(false)
    const main = mainRef.current
    if (!main) return
    main.scrollTo({ top: 0 })
    main.classList.remove('admin-screen-enter')
    void main.offsetWidth
    main.classList.add('admin-screen-enter')
  }, [isAdminRoute, location.pathname, location.searchStr])

  useEffect(() => {
    if (!moreOpen && !accountOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMoreOpen(false); setAccountOpen(false) } }
    const onDown = (e: MouseEvent) => {
      if (accountOpen && accountRef.current && !accountRef.current.contains(e.target as Node)) setAccountOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
  }, [moreOpen, accountOpen])

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
      className={cn('min-h-screen flex', isAdminRoute && 'admin-backoffice-shell admin-app', isAdminRoute && railCollapsed && 'admin-app--rail')}
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
        aria-label={isAdminRoute ? 'Backoffice navigation' : undefined}
        style={isAdminRoute ? undefined : { background: 'var(--ui-surface-bg)', borderRight: '1.5px solid var(--ui-text-primary)' }}
      >
        {isAdminRoute ? (
          <Link to="/admin/today" className="admin-brand" onClick={() => setSidebarOpen(false)}>
            <img src="/logo-ar-horizontal-white.png" alt="Adler & Rochefort" className="admin-brand-logo" />
            <img src="/lion-white.png" alt="Adler & Rochefort" className="admin-brand-lion" />
            <span className="admin-brand-tag">BACKOFFICE</span>
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
                    // CRM3 Block 2: Carrier Integrations is a real route, not
                    // another /admin?tab= value — see AdminNavItem above.
                    if ('to' in item) {
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          className="admin-nav-item"
                          activeProps={{ className: 'admin-nav-item admin-nav-item-active' }}
                          onClick={() => setSidebarOpen(false)}
                          title={railCollapsed ? item.label : undefined}
                        >
                          <svg className="w-[18px] h-[18px] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d={adminNavIcon(item)} />
                          </svg>
                          <span className="admin-nav-item-label">{item.label}</span>
                        </Link>
                      )
                    }
                    const badge = navBadgeFor(item.tab, navBadges)
                    return (
                      <Link
                        key={item.tab}
                        to="/admin"
                        search={{ tab: item.tab }}
                        className="admin-nav-item"
                        activeProps={{ className: 'admin-nav-item admin-nav-item-active' }}
                        activeOptions={{ includeSearch: true }}
                        onClick={() => setSidebarOpen(false)}
                        title={railCollapsed ? item.label : undefined}
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

        {isAdminRoute && (
          <button type="button" className="admin-rail-toggle" onClick={toggleRail} aria-label={railCollapsed ? 'Expand menu' : 'Collapse menu'} title={railCollapsed ? 'Expand menu' : 'Collapse menu'}>
            <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d={railCollapsed ? 'M13.5 4.5L21 12l-7.5 7.5M3 4.5L10.5 12 3 19.5' : 'M10.5 19.5L3 12l7.5-7.5m10.5 15L13.5 12 21 4.5'} />
            </svg>
            <span className="admin-nav-item-label">Collapse</span>
          </button>
        )}

        {ready && user && !isAdminRoute && (
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
            <div className="admin-breadcrumb">
              <span className="admin-breadcrumb-section">{ROUTE_CRUMBS[location.pathname]?.[0] ?? ADMIN_BREADCRUMBS[activeAdminTab][0]}</span>
              <span className="admin-breadcrumb-sep">/</span>
              <span className="admin-breadcrumb-page">{ROUTE_CRUMBS[location.pathname]?.[1] ?? ADMIN_BREADCRUMBS[activeAdminTab][1]}</span>
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
                <button type="button" className="admin-create-button" aria-label="New" onClick={() => setQuickCreateOpen((v) => !v)}>
                  <span aria-hidden="true">+</span><span className="admin-create-button-label"> New</span>
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

              <Link
                to="/admin"
                search={{ tab: navBadges.claims > 0 ? 'claims' : 'alerts' }}
                className="admin-header-icon-btn"
                title={navBadges.claims > 0 ? `${navBadges.claims} claim${navBadges.claims === 1 ? '' : 's'} with new client activity` : 'Renewals'}
                aria-label={navBadges.claims > 0 ? `${navBadges.claims} claim${navBadges.claims === 1 ? '' : 's'} with new client activity` : 'Renewals'}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {navBadges.claims > 0
                  ? <span className="admin-header-icon-count">{navBadges.claims > 9 ? '9+' : navBadges.claims}</span>
                  : navBadges.alerts > 0 && <span className="admin-header-icon-badge" />}
              </Link>

              {ready && user && (
                <div className="admin-account" ref={accountRef}>
                  <button type="button" className="admin-user-avatar" aria-label="Account" aria-expanded={accountOpen} onClick={() => setAccountOpen((v) => !v)}>
                    {initialsFor(user.name, user.email)}
                  </button>
                  {accountOpen && (
                    <div className="admin-account-menu" role="menu">
                      <div className="admin-account-id">
                        <p className="admin-account-name">{user.name || user.email}</p>
                        <p className="admin-account-email">{user.email}</p>
                      </div>
                      <button type="button" role="menuitem" className="admin-account-signout" onClick={handleLogout}>Sign out</button>
                    </div>
                  )}
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
          ref={mainRef}
          className={cn(
            'flex-1 overflow-y-auto p-4 lg:p-8 pb-20 lg:pb-8',
            isAdminRoute && 'admin-backoffice-main'
          )}
          style={{ background: isAdminRoute ? undefined : 'var(--ui-page-bg)' }}
        >
          {children}
        </main>
      </div>

      {isAdminRoute && (
        <nav className="admin-bottom-nav lg:hidden" aria-label="Backoffice">
          <Link to="/admin/today" className={cn('admin-bottom-nav-item', location.pathname === '/admin/today' && 'is-active')}>
            <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d={TODAY_ICON} />
            </svg>
            <span>Hoje</span>
          </Link>
          {ADMIN_BOTTOM_NAV.filter((item) => item.tab !== 'dashboard').map((item) => {
            const active = location.pathname === '/admin' && activeAdminTab === item.tab
            return (
              <Link key={item.tab} to="/admin" search={{ tab: item.tab }} className={cn('admin-bottom-nav-item', active && 'is-active')}>
                <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                <span>{item.label}</span>
              </Link>
            )
          })}
          <button type="button" className={cn('admin-bottom-nav-item', moreOpen && 'is-active')} aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
            <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
            <span>Menu</span>
          </button>
        </nav>
      )}

      {isAdminRoute && (
        <div className={cn('admin-sheet-layer lg:hidden', moreOpen && 'is-open')} aria-hidden={!moreOpen}>
          <div className="admin-sheet-backdrop" onClick={() => setMoreOpen(false)} />
          <div className="admin-sheet" role="dialog" aria-modal="true" aria-label="All sections">
            <div className="admin-sheet-handle" aria-hidden="true" />
            <div className="admin-sheet-body">
              {isAdmin && ADMIN_NAV_GROUPS.map((group) => (
                <section key={group.label} className="admin-sheet-group">
                  <p className="admin-sheet-group-label">{group.label}</p>
                  <div className="admin-sheet-grid">
                    {group.items.map((item) => {
                      const active = 'tab' in item ? location.pathname === '/admin' && activeAdminTab === item.tab : location.pathname === item.to
                      const badge = 'tab' in item ? navBadgeFor(item.tab, navBadges) : 0
                      const inner = <>
                        <span className="admin-sheet-tile-icon">
                          <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d={adminNavIcon(item)} />
                          </svg>
                          {badge > 0 && <span className="admin-sheet-tile-badge">{badge > 99 ? '99+' : badge}</span>}
                        </span>
                        <span className="admin-sheet-tile-label">{item.label}</span>
                      </>
                      return 'tab' in item
                        ? <Link key={item.tab} to="/admin" search={{ tab: item.tab }} className={cn('admin-sheet-tile', active && 'is-active')} tabIndex={moreOpen ? 0 : -1}>{inner}</Link>
                        : <Link key={item.to} to={item.to} className={cn('admin-sheet-tile', active && 'is-active')} tabIndex={moreOpen ? 0 : -1}>{inner}</Link>
                    })}
                  </div>
                </section>
              ))}
              {ready && user && (
                <div className="admin-sheet-account">
                  <span className="admin-user-avatar" aria-hidden="true">{initialsFor(user.name, user.email)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="admin-account-name">{user.name || user.email}</p>
                    <p className="admin-account-email">{user.email}</p>
                  </div>
                  <button type="button" className="admin-sheet-signout" onClick={handleLogout} tabIndex={moreOpen ? 0 : -1}>Sign out</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!isAdminRoute && <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 flex" style={{ background: 'var(--ui-surface-bg)', borderTop: '1.5px solid var(--ui-text-primary)', height: '60px' }}>
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
      </nav>}

      {!isAdminRoute && <ThemeCustomizer />}
    </div>
  )
}
