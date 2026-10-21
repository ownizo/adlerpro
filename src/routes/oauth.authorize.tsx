import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useIdentity } from '@/lib/identity-context'
import { approveCrmAuthorization, checkCrmAuthorization } from '@/lib/crm-agent/oauth.functions'

// Consent screen for connecting Claude to the CRM (OAuth authorization
// endpoint). Only a signed-in admin can approve.

export const Route = createFileRoute('/oauth/authorize')({
  component: AuthorizePage,
  head: () => ({ meta: [{ title: 'Ligar o Claude ao CRM · Adler & Rochefort' }, { name: 'robots', content: 'noindex' }] }),
})

const RETURN_KEY = 'ar-post-login-return'

function AuthorizePage() {
  const { user, ready } = useIdentity()
  const params = useMemo(() => {
    if (typeof window === 'undefined') return {} as Record<string, string>
    return Object.fromEntries(new URLSearchParams(window.location.search).entries())
  }, [])
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error' | 'working'; clientName?: string; error?: string }>({ status: 'loading' })
  const isAdmin = !!user?.roles?.includes('admin')

  useEffect(() => {
    if (!ready || !user) return
    if (!isAdmin) { setState({ status: 'error', error: 'Only a backoffice administrator can authorise this connection.' }); return }
    checkCrmAuthorization({ data: params })
      .then((r) => setState(r.ok ? { status: 'ready', clientName: r.clientName } : { status: 'error', error: `Invalid request (${r.error}).` }))
      .catch(() => setState({ status: 'error', error: 'The request could not be validated.' }))
  }, [ready, user, isAdmin, params])

  const deny = () => {
    if (!params.redirect_uri) return
    try {
      const url = new URL(params.redirect_uri)
      if (!/^(claude\.ai|claude\.com|localhost|127\.0\.0\.1)$/.test(url.hostname)) return
      url.searchParams.set('error', 'access_denied')
      if (params.state) url.searchParams.set('state', params.state)
      window.location.assign(url.toString())
    } catch { /* ignore */ }
  }

  const approve = async () => {
    setState((s) => ({ ...s, status: 'working' }))
    try {
      const r = await approveCrmAuthorization({ data: params })
      window.location.assign(r.redirect)
    } catch {
      setState({ status: 'error', error: 'The authorisation could not be completed. Please try again from Claude.' })
    }
  }

  const goLogin = () => {
    try { window.sessionStorage.setItem(RETURN_KEY, window.location.pathname + window.location.search) } catch { /* private mode */ }
    window.location.assign('/login')
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4" style={{ background: '#F6F7F9', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
      <div className="w-full max-w-[420px] rounded-2xl bg-white p-7 shadow-[0_12px_40px_rgba(17,25,39,0.10)] border border-[#E3E7EC]">
        <img src="/logo-ar.png" alt="Adler & Rochefort" className="mx-auto mb-5 h-[72px] w-auto" />
        <h1 className="text-center text-[19px] font-bold text-[#172033]">Connect Claude to the CRM</h1>

        {!ready || (user && state.status === 'loading') ? (
          <p className="mt-6 text-center text-sm text-[#667085]">Checking…</p>
        ) : !user ? (
          <>
            <p className="mt-3 text-center text-sm text-[#667085]">Sign in to the backoffice to authorise the connection.</p>
            <button type="button" onClick={goLogin} className="mt-6 w-full rounded-xl bg-[#17243D] py-3 text-sm font-semibold text-white">Sign in</button>
          </>
        ) : state.status === 'error' ? (
          <p className="mt-6 rounded-xl bg-[#FDF1F2] p-4 text-sm text-[#872733]">{state.error}</p>
        ) : (
          <>
            <p className="mt-3 text-center text-sm text-[#667085]"><strong className="text-[#172033]">{state.clientName}</strong> is asking for access to the Adler &amp; Rochefort CRM on behalf of {user.name || user.email}.</p>
            <ul className="mt-5 space-y-2 text-sm text-[#172033]">
              <li className="flex gap-2"><span aria-hidden>✓</span>Read clients, policies, pipeline, tasks, expenses and commissions</li>
              <li className="flex gap-2"><span aria-hidden>✓</span>Create and update clients, leads, opportunities, notes, tasks and policies</li>
              <li className="flex gap-2"><span aria-hidden>✓</span>Log emails in the client history</li>
              <li className="flex gap-2 text-[#667085]"><span aria-hidden>✕</span>Cannot delete anything</li>
            </ul>
            <div className="mt-7 flex gap-3">
              <button type="button" onClick={deny} className="flex-1 rounded-xl border border-[#E3E7EC] py-3 text-sm font-semibold text-[#172033]">Decline</button>
              <button type="button" onClick={approve} disabled={state.status === 'working'} className="flex-1 rounded-xl bg-[#17243D] py-3 text-sm font-semibold text-white disabled:opacity-60">
                {state.status === 'working' ? 'Authorising…' : 'Authorise'}
              </button>
            </div>
            <p className="mt-4 text-center text-xs text-[#667085]">You can disconnect at any time in the backoffice.</p>
          </>
        )}
      </div>
    </div>
  )
}
