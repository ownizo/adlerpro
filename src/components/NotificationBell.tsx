import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { fetchAlerts, markAlertAsRead } from '@/lib/server-fns'
import type { Alert } from '@/lib/types'
import { formatDate } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

const REFRESH_INTERVAL_MS = 30_000

function resolveTarget(alert: Alert): '/policies' | '/claims' | '/alerts' {
  if (alert.type === 'claim_update') return '/claims'
  if (alert.type === 'renewal' || alert.type === 'document') return '/policies'
  return '/alerts'
}

function typeLabel(type: Alert['type'], t: (key: string) => string): string {
  const labels: Record<Alert['type'], string> = {
    renewal: t('notifications.types.renewal'),
    claim_update: t('notifications.types.claim'),
    payment: t('notifications.types.payment'),
    document: t('notifications.types.document'),
    general: t('notifications.types.general'),
  }
  return labels[type] ?? labels.general
}

export function NotificationBell({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [alerts, setAlerts] = useState<Alert[]>([])

  useEffect(() => {
    if (!enabled) {
      setAlerts([])
      return
    }

    let cancelled = false

    const loadAlerts = async () => {
      try {
        const data = await fetchAlerts()
        if (!cancelled) setAlerts(data)
      } catch {
        if (!cancelled) setAlerts([])
      }
    }

    loadAlerts()
    const interval = window.setInterval(loadAlerts, REFRESH_INTERVAL_MS)

    const onVisibilityChange = () => {
      if (!document.hidden) loadAlerts()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled])

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  const unreadCount = useMemo(() => alerts.filter((a) => !a.read).length, [alerts])

  const handleAlertClick = async (alert: Alert) => {
    if (!alert.read) {
      setAlerts((current) => current.map((item) => (item.id === alert.id ? { ...item, read: true } : item)))
      try {
        await markAlertAsRead({ data: alert.id })
      } catch {
        // Keep optimistic state to avoid blocking navigation.
      }
    }

    setOpen(false)
    navigate({ to: resolveTarget(alert) })
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        title={t('notifications.title')}
        aria-label={t('notifications.title')}
        style={{
          border: '1px solid #dddddd',
          background: '#ffffff',
          color: '#666666',
          width: '34px',
          height: '34px',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          cursor: 'pointer',
        }}
      >
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '-5px',
              right: '-5px',
              minWidth: '18px',
              height: '18px',
              borderRadius: '999px',
              background: '#EF4444',
              color: '#ffffff',
              fontSize: '0.65rem',
              fontWeight: 700,
              lineHeight: '18px',
              textAlign: 'center',
              padding: '0 4px',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: '340px',
            maxWidth: 'calc(100vw - 24px)',
            background: '#ffffff',
            border: '1px solid #e5e5e5',
            borderRadius: '6px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
            zIndex: 70,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '0.75rem 0.9rem', borderBottom: '1px solid #f0f0f0' }}>
            <p style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.82rem', color: '#111111' }}>
              {t('notifications.title')}
            </p>
          </div>

          <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
            {alerts.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  padding: '1.2rem 1rem',
                  fontFamily: "'Montserrat', sans-serif",
                  fontSize: '0.78rem',
                  color: '#999999',
                  textAlign: 'center',
                }}
              >
                {t('notifications.empty')}
              </p>
            ) : (
              alerts.slice(0, 8).map((alert) => (
                <button
                  key={alert.id}
                  type="button"
                  onClick={() => handleAlertClick(alert)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    border: 'none',
                    background: alert.read ? '#ffffff' : '#fffdf5',
                    borderBottom: '1px solid #f5f5f5',
                    padding: '0.7rem 0.9rem',
                    cursor: 'pointer',
                    display: 'flex',
                    gap: '0.55rem',
                    alignItems: 'flex-start',
                  }}
                >
                  <span
                    style={{
                      marginTop: '0.35rem',
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      background: alert.read ? '#d1d5db' : '#C8961A',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        fontFamily: "'Montserrat', sans-serif",
                        fontSize: '0.77rem',
                        fontWeight: 600,
                        color: '#222222',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {alert.title}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        fontFamily: "'Montserrat', sans-serif",
                        fontSize: '0.7rem',
                        color: '#777777',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        marginTop: '0.15rem',
                      }}
                    >
                      {alert.message}
                    </span>
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        marginTop: '0.3rem',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'Montserrat', sans-serif",
                          fontSize: '0.62rem',
                          color: '#8a8a8a',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        {typeLabel(alert.type, t)}
                      </span>
                      <span style={{ fontSize: '0.62rem', color: '#c1c1c1' }}>•</span>
                      <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.62rem', color: '#8a8a8a' }}>
                        {formatDate(alert.createdAt)}
                      </span>
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
