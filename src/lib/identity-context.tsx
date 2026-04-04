import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from './supabase'
import type { User as SupabaseUser } from '@supabase/supabase-js'

export interface User {
  id: string
  email?: string
  name?: string
  roles?: string[]
  metadata?: Record<string, any>
  user_metadata?: Record<string, any>
}

function mapSupabaseUser(su: SupabaseUser | null): User | null {
  if (!su) return null
  const meta = su.user_metadata ?? {}
  const appMeta = su.app_metadata ?? {}
  return {
    id: su.id,
    email: su.email,
    name: meta.full_name ?? meta.name ?? su.email,
    roles: appMeta.roles ?? [],
    metadata: meta,
    user_metadata: meta,
  }
}

interface IdentityContextValue {
  user: User | null
  ready: boolean
  logout: () => Promise<void>
}

const IdentityContext = createContext<IdentityContextValue | null>(null)

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(mapSupabaseUser(session?.user ?? null))
      setReady(true)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(mapSupabaseUser(session?.user ?? null))
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut()
    } catch {
      // Clear local state even if the API call fails
    } finally {
      setUser(null)
    }
  }

  return (
    <IdentityContext.Provider value={{ user, ready, logout: handleLogout }}>
      {children}
    </IdentityContext.Provider>
  )
}

export function useIdentity() {
  const ctx = useContext(IdentityContext)
  if (!ctx) throw new Error('useIdentity must be used within an IdentityProvider')
  return ctx
}
