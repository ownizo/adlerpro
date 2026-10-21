import { useEffect, useState } from 'react'
import { C, button, font } from './portal-ui'

// Invitation to install MillionGuard on the phone home screen.
// Android (Chrome): the native install dialog, from the beforeinstallprompt
// event captured early in __root.tsx. iPhone/iPad: iOS has no install API, so
// we show the two Safari steps instead. Hidden when already installed.

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface Window { __mgInstallPrompt?: InstallPromptEvent }
}

const DISMISS_KEY = 'mg-install-dismissed-at'
const DISMISS_DAYS = 30

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function isIos(): boolean {
  const ua = navigator.userAgent
  // iPadOS reports itself as a Mac; touch support gives it away.
  return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0)
    return Date.now() - at < DISMISS_DAYS * 86_400_000
  } catch {
    return false
  }
}

function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Share" style={{ display: 'inline-block', verticalAlign: '-3px' }}>
      <path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  )
}

export function InstallPrompt() {
  const [mode, setMode] = useState<'hidden' | 'android' | 'ios'>('hidden')

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return
    if (isIos()) { setMode('ios'); return }
    if (window.__mgInstallPrompt) setMode('android')
    const onInstallable = () => setMode('android')
    const onInstalled = () => setMode('hidden')
    window.addEventListener('mg-installable', onInstallable)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('mg-installable', onInstallable)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* private mode */ }
    setMode('hidden')
  }

  async function install() {
    const evt = window.__mgInstallPrompt
    if (!evt) return
    await evt.prompt()
    const { outcome } = await evt.userChoice
    window.__mgInstallPrompt = undefined
    if (outcome === 'accepted') setMode('hidden')
  }

  if (mode === 'hidden') return null

  return (
    <div role="region" aria-label="Install the MillionGuard app" style={{ width: '100%', maxWidth: 400, marginTop: 16, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 16, padding: '16px 18px', fontFamily: font }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <img src="/pwa-192.png" alt="" width={40} height={40} style={{ borderRadius: 10, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>Get the MillionGuard app</div>
          <div style={{ fontSize: 13, color: C.body, lineHeight: 1.5, marginTop: 2 }}>
            Open your policies and documents straight from your home screen.
          </div>
        </div>
        <button type="button" onClick={dismiss} aria-label="Not now" style={{ background: 'none', border: 0, color: C.muted, fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 2 }}>×</button>
      </div>
      {mode === 'android' ? (
        <button type="button" onClick={install} style={{ ...button(), width: '100%', marginTop: 14 }}>Install app</button>
      ) : (
        <ol style={{ margin: '12px 0 0', paddingLeft: 20, listStyle: 'decimal', fontSize: 13, color: C.body, lineHeight: 1.7 }}>
          <li>Tap <span style={{ color: C.ink }}><ShareIcon /></span> <strong style={{ color: C.ink }}>Share</strong> in Safari.</li>
          <li>Choose <strong style={{ color: C.ink }}>Add to Home Screen</strong>.</li>
        </ol>
      )}
    </div>
  )
}
