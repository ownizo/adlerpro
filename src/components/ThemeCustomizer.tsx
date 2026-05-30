import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_THEME,
  FONT_OPTIONS,
  applyTheme,
  clearHistory,
  loadHistory,
  loadTheme,
  popHistory,
  pushHistory,
  saveTheme,
  type UITheme,
} from '@/lib/theme'

const FONT = 'var(--ui-font-family)'

/** Colour fields surfaced in the panel, in display order. */
const COLOR_FIELDS: Array<{ key: keyof UITheme; labelKey: string }> = [
  { key: 'pageBg', labelKey: 'customizer.pageBg' },
  { key: 'surfaceBg', labelKey: 'customizer.surfaceBg' },
  { key: 'textPrimary', labelKey: 'customizer.textPrimary' },
  { key: 'textSecondary', labelKey: 'customizer.textSecondary' },
  { key: 'textMuted', labelKey: 'customizer.textMuted' },
  { key: 'accent', labelKey: 'customizer.accent' },
  { key: 'border', labelKey: 'customizer.border' },
  { key: 'menuText', labelKey: 'customizer.menuText' },
  { key: 'menuActiveBg', labelKey: 'customizer.menuActiveBg' },
  { key: 'menuActiveText', labelKey: 'customizer.menuActiveText' },
]

export function ThemeCustomizer() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // `draft` is the live preview; it is applied to the DOM immediately on change.
  const [draft, setDraft] = useState<UITheme>(DEFAULT_THEME)
  const [canUndo, setCanUndo] = useState(false)
  // Snapshot of the persisted theme when the panel was opened, so closing
  // without "Aplicar" reverts the preview.
  const committedRef = useRef<UITheme>(DEFAULT_THEME)

  // Load + apply the persisted theme once on mount.
  useEffect(() => {
    const stored = loadTheme()
    committedRef.current = stored
    setDraft(stored)
    applyTheme(stored)
    setCanUndo(loadHistory().length > 0)
  }, [])

  const previewClose = () => {
    // Revert any unapplied preview back to what is persisted.
    applyTheme(committedRef.current)
    setDraft(committedRef.current)
    setOpen(false)
  }

  const update = (key: keyof UITheme, value: string | number) => {
    setDraft((prev) => {
      const next = { ...prev, [key]: value }
      applyTheme(next) // live preview
      return next
    })
  }

  const handleApply = () => {
    // Record the previously committed theme so it can be undone.
    pushHistory(committedRef.current)
    saveTheme(draft)
    committedRef.current = draft
    applyTheme(draft)
    setCanUndo(true)
  }

  const handleUndo = () => {
    const previous = popHistory()
    if (!previous) {
      setCanUndo(false)
      return
    }
    saveTheme(previous)
    committedRef.current = previous
    setDraft(previous)
    applyTheme(previous)
    setCanUndo(loadHistory().length > 0)
  }

  const handleReset = () => {
    // Snapshot the current look into history first, so reset is also undoable.
    pushHistory(committedRef.current)
    saveTheme(DEFAULT_THEME)
    committedRef.current = DEFAULT_THEME
    setDraft(DEFAULT_THEME)
    applyTheme(DEFAULT_THEME)
    setCanUndo(true)
  }

  const handleClearHistory = () => {
    clearHistory()
    setCanUndo(false)
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(committedRef.current)

  return (
    <>
      {/* Floating launcher button */}
      <button
        type="button"
        onClick={() => (open ? previewClose() : setOpen(true))}
        title={t('customizer.title')}
        aria-label={t('customizer.title')}
        style={{
          position: 'fixed',
          right: '1.25rem',
          bottom: '5rem',
          zIndex: 60,
          width: '3rem',
          height: '3rem',
          borderRadius: '9999px',
          border: 'none',
          cursor: 'pointer',
          background: 'var(--ui-text-primary)',
          color: 'var(--ui-surface-bg)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 110-18c4.97 0 9 3.582 9 8 0 2.5-2 4-4.5 4H15a2 2 0 00-1.5 3.3A1.5 1.5 0 0112 21z" />
          <circle cx="7.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="16.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            onClick={previewClose}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 70 }}
          />

          {/* Slide-over panel */}
          <aside
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              zIndex: 71,
              width: 'min(360px, 90vw)',
              background: '#ffffff',
              boxShadow: '-8px 0 30px rgba(0,0,0,0.18)',
              display: 'flex',
              flexDirection: 'column',
              fontFamily: FONT,
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: '1rem 1.25rem',
                borderBottom: '1px solid #eeeeee',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <p style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#111111' }}>
                  {t('customizer.title')}
                </p>
                <p style={{ margin: 0, fontSize: '0.7rem', color: '#888888' }}>
                  {t('customizer.subtitle')}
                </p>
              </div>
              <button
                type="button"
                onClick={previewClose}
                aria-label={t('common.close')}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#888888', fontSize: '1.4rem', lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            {/* Scrollable controls */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>
              {/* Typography */}
              <Section title={t('customizer.typography')}>
                <Field label={t('customizer.font')}>
                  <select
                    value={draft.fontFamily}
                    onChange={(e) => update('fontFamily', e.target.value)}
                    style={selectStyle}
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label={`${t('customizer.fontSize')} — ${draft.baseFontSize}px`}>
                  <input
                    type="range"
                    min={12}
                    max={22}
                    step={1}
                    value={draft.baseFontSize}
                    onChange={(e) => update('baseFontSize', Number(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--ui-accent)' }}
                  />
                </Field>
              </Section>

              {/* Colours */}
              <Section title={t('customizer.colors')}>
                {COLOR_FIELDS.map((f) => (
                  <ColorRow
                    key={f.key}
                    label={t(f.labelKey)}
                    value={draft[f.key] as string}
                    onChange={(v) => update(f.key, v)}
                  />
                ))}
              </Section>
            </div>

            {/* Action bar */}
            <div style={{ borderTop: '1px solid #eeeeee', padding: '0.9rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={handleApply}
                disabled={!dirty}
                style={{
                  ...primaryBtn,
                  opacity: dirty ? 1 : 0.5,
                  cursor: dirty ? 'pointer' : 'default',
                }}
              >
                {t('customizer.apply')}
              </button>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={!canUndo}
                  style={{ ...secondaryBtn, flex: 1, opacity: canUndo ? 1 : 0.5, cursor: canUndo ? 'pointer' : 'default' }}
                >
                  {t('customizer.undo')}
                </button>
                <button type="button" onClick={handleReset} style={{ ...secondaryBtn, flex: 1 }}>
                  {t('customizer.reset')}
                </button>
              </div>
              {canUndo && (
                <button
                  type="button"
                  onClick={handleClearHistory}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#aaaaaa', fontSize: '0.7rem', fontFamily: FONT }}
                >
                  {t('customizer.clearHistory')}
                </button>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  )
}

/* ---------- small presentational helpers ---------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ui-accent)' }}>
        {title}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.75rem', fontWeight: 600, color: '#444444' }}>{label}</span>
      {children}
    </label>
  )
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#444444' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          style={{
            width: '5.5rem',
            border: '1px solid #dddddd',
            borderRadius: '4px',
            padding: '0.25rem 0.4rem',
            fontSize: '0.72rem',
            fontFamily: 'monospace',
            color: '#333333',
            textAlign: 'right',
          }}
        />
        <input
          type="color"
          value={toHex(value)}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: '2rem', height: '2rem', border: '1px solid #dddddd', borderRadius: '4px', padding: 0, background: 'transparent', cursor: 'pointer' }}
        />
      </div>
    </div>
  )
}

/** `<input type=color>` only accepts #rrggbb — coerce anything else. */
function toHex(value: string): string {
  const v = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    return '#' + v.slice(1).split('').map((c) => c + c).join('')
  }
  return '#000000'
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid #dddddd',
  borderRadius: '4px',
  padding: '0.45rem 0.5rem',
  fontSize: '0.8rem',
  fontFamily: FONT,
  color: '#333333',
  background: '#ffffff',
}

const primaryBtn: React.CSSProperties = {
  width: '100%',
  padding: '0.65rem',
  border: 'none',
  borderRadius: '4px',
  background: 'var(--ui-text-primary)',
  color: 'var(--ui-surface-bg)',
  fontSize: '0.82rem',
  fontWeight: 700,
  fontFamily: FONT,
}

const secondaryBtn: React.CSSProperties = {
  padding: '0.6rem',
  border: '1px solid #dddddd',
  borderRadius: '4px',
  background: '#ffffff',
  color: '#444444',
  fontSize: '0.8rem',
  fontWeight: 600,
  fontFamily: FONT,
  cursor: 'pointer',
}
