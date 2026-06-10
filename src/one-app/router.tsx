// Manual TanStack Router setup for the Capacitor SPA.
// Only includes the /one/* routes — no SSR, no Netlify plugin, no server functions.
import { createRouter, createRootRoute, Outlet, redirect } from '@tanstack/react-router'
import { IdentityProvider } from '@/lib/identity-context'
import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import '@/styles.css'
import '@/lib/i18n'

// Import all /one/* route definitions (reused from the main app)
import { Route as OneIndexRouteImport } from '@/routes/one/index'
import { Route as OneLoginRouteImport } from '@/routes/one/login'
import { Route as OneDashboardRouteImport } from '@/routes/one/dashboard'
import { Route as OnePoliciesRouteImport } from '@/routes/one/policies'
import { Route as OneClaimsRouteImport } from '@/routes/one/claims'
import { Route as OneDocumentsRouteImport } from '@/routes/one/documents'
import { Route as OneProfileRouteImport } from '@/routes/one/profile'

// Root component — handles Supabase auth URL callbacks (email confirm, recovery)
// and wraps the app in the identity context.
function RootComponent() {
  useEffect(() => {
    const hash = window.location.hash
    if (!hash) return
    const params = new URLSearchParams(hash.replace('#', ''))
    const type = params.get('type')
    if (!type) return

    if (type === 'recovery' || type === 'invite') {
      window.location.replace('/one/login?recovery=1')
      return
    }
    if (type === 'signup' || type === 'email') {
      supabase.auth.getSession().then(() => {
        window.history.replaceState(null, '', `${window.location.pathname}?email_confirmed=1`)
      })
      return
    }
    // Any other token in hash: just clean it up
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])

  return (
    <IdentityProvider>
      <Outlet />
    </IdentityProvider>
  )
}

const rootRoute = createRootRoute({ component: RootComponent })

// Redirect from / to /one/ inside the Capacitor app
const indexRedirectRoute = rootRoute.createRoute({
  path: '/',
  loader: () => { throw redirect({ to: '/one/' }) },
})

// Wire each /one/* route to the SPA root (overrides the SSR root from __root.tsx)
const OneIndexRoute = OneIndexRouteImport.update({
  id: '/one/', path: '/one/', getParentRoute: () => rootRoute,
} as never)
const OneLoginRoute = OneLoginRouteImport.update({
  id: '/one/login', path: '/one/login', getParentRoute: () => rootRoute,
} as never)
const OneDashboardRoute = OneDashboardRouteImport.update({
  id: '/one/dashboard', path: '/one/dashboard', getParentRoute: () => rootRoute,
} as never)
const OnePoliciesRoute = OnePoliciesRouteImport.update({
  id: '/one/policies', path: '/one/policies', getParentRoute: () => rootRoute,
} as never)
const OneClaimsRoute = OneClaimsRouteImport.update({
  id: '/one/claims', path: '/one/claims', getParentRoute: () => rootRoute,
} as never)
const OneDocumentsRoute = OneDocumentsRouteImport.update({
  id: '/one/documents', path: '/one/documents', getParentRoute: () => rootRoute,
} as never)
const OneProfileRoute = OneProfileRouteImport.update({
  id: '/one/profile', path: '/one/profile', getParentRoute: () => rootRoute,
} as never)

const routeTree = rootRoute.addChildren([
  indexRedirectRoute,
  OneIndexRoute,
  OneLoginRoute,
  OneDashboardRoute,
  OnePoliciesRoute,
  OneClaimsRoute,
  OneDocumentsRoute,
  OneProfileRoute,
])

export function createCapacitorRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  })
}
