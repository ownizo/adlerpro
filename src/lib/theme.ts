// Runtime UI personalisation (theming) engine.
//
// The whole app chrome reads a small set of CSS custom properties (`--ui-*`).
// This module is the single source of truth for those tokens: it holds the
// default look, applies a theme to the live DOM, persists the active choice and
// keeps a short history so the user can step backwards ("retroceder").

export interface UITheme {
  /** CSS font-family stack applied to the whole document. */
  fontFamily: string
  /** Base font size in px, set on <html> so every rem-based size scales. */
  baseFontSize: number
  /** Main content area background. */
  pageBg: string
  /** Sidebar / header / card surfaces. */
  surfaceBg: string
  /** Primary text + strong dividers. */
  textPrimary: string
  /** Secondary / body text. */
  textSecondary: string
  /** Muted labels and hints. */
  textMuted: string
  /** Accent / brand colour (the gold). */
  accent: string
  /** Hairline borders. */
  border: string
  /** Menu (navigation) link text. */
  menuText: string
  /** Active menu item background. */
  menuActiveBg: string
  /** Active menu item text. */
  menuActiveText: string
}

/** The current production look — also the "reposição de origem" target. */
export const DEFAULT_THEME: UITheme = {
  fontFamily: "'Montserrat', sans-serif",
  baseFontSize: 16,
  pageBg: '#fafafa',
  surfaceBg: '#ffffff',
  textPrimary: '#111111',
  textSecondary: '#666666',
  textMuted: '#888888',
  accent: '#C8961A',
  border: '#eeeeee',
  menuText: '#666666',
  menuActiveBg: '#f8f8f8',
  menuActiveText: '#111111',
}

export const THEME_STORAGE_KEY = 'adlerpro-ui-theme'
const HISTORY_STORAGE_KEY = 'adlerpro-ui-theme-history'
const HISTORY_LIMIT = 25

/** Curated font stacks offered in the customiser. */
export const FONT_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'Montserrat', value: "'Montserrat', sans-serif" },
  { label: 'Sistema', value: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { label: 'Inter', value: "'Inter', system-ui, sans-serif" },
  { label: 'Georgia (serifa)', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Monoespaçada', value: '"Courier New", ui-monospace, monospace' },
]

/**
 * Push the theme onto the document as CSS variables. Also overrides the
 * Tailwind `@theme` colour tokens so utility classes (text-primary, text-gold,
 * border-border, …) follow the same choices.
 */
export function applyTheme(theme: UITheme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const set = (name: string, value: string) => root.style.setProperty(name, value)

  // Base typography.
  root.style.fontSize = `${theme.baseFontSize}px`
  set('--ui-font-family', theme.fontFamily)

  // Semantic surface / text tokens consumed by the app chrome.
  set('--ui-page-bg', theme.pageBg)
  set('--ui-surface-bg', theme.surfaceBg)
  set('--ui-text-primary', theme.textPrimary)
  set('--ui-text-secondary', theme.textSecondary)
  set('--ui-text-muted', theme.textMuted)
  set('--ui-accent', theme.accent)
  set('--ui-border', theme.border)
  set('--ui-menu-text', theme.menuText)
  set('--ui-menu-active-bg', theme.menuActiveBg)
  set('--ui-menu-active-text', theme.menuActiveText)

  // Keep Tailwind utility tokens in sync.
  set('--color-primary', theme.textPrimary)
  set('--color-body', theme.textSecondary)
  set('--color-muted', theme.textSecondary)
  set('--color-label', theme.textMuted)
  set('--color-label-light', theme.textMuted)
  set('--color-border', theme.border)
  set('--color-gold', theme.accent)
  set('--color-gold-400', theme.accent)
}

/** Merge a possibly-partial stored object onto the defaults. */
function normalise(value: unknown): UITheme {
  if (!value || typeof value !== 'object') return { ...DEFAULT_THEME }
  return { ...DEFAULT_THEME, ...(value as Partial<UITheme>) }
}

export function loadTheme(): UITheme {
  if (typeof window === 'undefined') return { ...DEFAULT_THEME }
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_THEME }
    return normalise(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_THEME }
  }
}

export function saveTheme(theme: UITheme): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme))
  } catch {
    /* storage unavailable — apply still works for the session */
  }
}

export function loadHistory(): UITheme[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(normalise) : []
  } catch {
    return []
  }
}

function writeHistory(history: UITheme[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history))
  } catch {
    /* ignore */
  }
}

/** Record the theme that was active *before* a new one is applied. */
export function pushHistory(previous: UITheme): UITheme[] {
  const history = [...loadHistory(), previous].slice(-HISTORY_LIMIT)
  writeHistory(history)
  return history
}

/** Remove and return the most recent history entry, or null if empty. */
export function popHistory(): UITheme | null {
  const history = loadHistory()
  const last = history.pop()
  writeHistory(history)
  return last ?? null
}

export function clearHistory(): void {
  writeHistory([])
}
