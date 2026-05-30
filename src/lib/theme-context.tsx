import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

async function syncThemeToProfile(theme: Theme) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('profiles').update({ theme }).eq('id', user.id)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light'
    return (localStorage.getItem('adler-theme') as Theme) ?? 'light'
  })

  const setTheme = (t: Theme) => {
    setThemeState(t)
    localStorage.setItem('adler-theme', t)
    document.documentElement.setAttribute('data-theme', t)
    void syncThemeToProfile(t)
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
