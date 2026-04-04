import { createFileRoute, Navigate, Link } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { OnboardingBanner } from '@/components/OnboardingBanner'
import { fetchDashboardAll } from '@/lib/server-fns'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { DashboardStats, Alert, Policy } from '@/lib/types'
import { POLICY_TYPE_LABELS } from '@/lib/types'
import { useState, useEffect, useMemo } from 'react'
import { useIdentity } from '@/lib/identity-context'

export const Route = createFileRoute('/dashboard')({
  component: DashboardPage,
})

// Cores por tipo de apólice
const POLICY_TYPE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  auto:                 { bg: '#EFF6FF', text: '#1D4ED8', dot: '#3B82F6' },
  health:               { bg: '#F0FDF4', text: '#166534', dot: '#22C55E' },
  property:             { bg: '#FFF7ED', text: '#9A3412', dot: '#F97316' },
  liability:            { bg: '#FDF4FF', text: '#7E22CE', dot: '#A855F7' },
  workers_comp:         { bg: '#FFF1F2', text: '#9F1239', dot: '#F43F5E' },
  cyber:                { bg: '#F0F9FF', text: '#0C4A6E', dot: '#0EA5E9' },
  directors_officers:   { bg: '#FAFAF9', text: '#44403C', dot: '#78716C' },
  business_interruption:{ bg: '#FFFBEB', text: '#92400E', dot: '#F59E0B' },
  life:                 { bg: '#F0FDF4', text: '#14532D', dot: '#16A34A' },
  other:                { bg: '#F8F8F8', text: '#444444', dot: '#999999' },
}

function daysUntil(dateStr: string): number {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function DashboardPage() {
  const { user, ready } = useIdentity()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [showOnboarding, setShowOnboarding] = useState(true)

  useEffect(() => {
    if (!ready || !user) return
    fetchDashboardAll()
      .then(({ stats: s, alerts: a, policies: p }) => {
        setStats(s)
        setAlerts(a)
        setPolicies(p)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Erro ao carregar dashboard:', err)
        setLoading(false)
      })
  }, [ready, user])

  // Apólices a renovar nos próximos 90 dias, ordenadas por urgência
  const renewalAlerts = useMemo(() => {
    return policies
      .filter((p) => {
        const days = daysUntil(p.endDate)
        return days >= 0 && days <= 90 && (p.status === 'active' || p.status === 'expiring')
      })
      .sort((a, b) => daysUntil(a.endDate) - daysUntil(b.endDate))
      .slice(0, 5)
  }, [policies])

  // Dados para o mini gráfico de barras (prémios por tipo)
  const premiumByType = useMemo(() => {
    const map: Record<string, number> = {}
    policies.filter((p) => p.status === 'active' || p.status === 'expiring').forEach((p) => {
      map[p.type] = (map[p.type] || 0) + p.annualPremium
    })
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5)
    const max = Math.max(...entries.map((e) => e[1]), 1)
    return entries.map(([type, value]) => ({ type, value, pct: Math.round((value / max) * 100) }))
  }, [policies])

  // Próxima acção recomendada
  const nextAction = useMemo(() => {
    if (renewalAlerts.length > 0) {
      const p = renewalAlerts[0]
      const days = daysUntil(p.endDate)
      return {
        icon: '⏰',
        title: `Renovar ${POLICY_TYPE_LABELS[p.type] || p.type}`,
        description: `A apólice ${p.policyNumber} da ${p.insurer} expira em ${days} dia${days !== 1 ? 's' : ''}. Compare cotações agora.`,
        link: '/quotes-comparison',
        linkLabel: 'Comparar cotações →',
        color: days <= 30 ? '#FFF1F2' : '#FFFBEB',
        borderColor: days <= 30 ? '#FECDD3' : '#FDE68A',
      }
    }
    if (policies.length === 0) {
      return {
        icon: '📋',
        title: 'Adicione a sua primeira apólice',
        description: 'Carregue um PDF ou imagem de uma apólice e a IA extrai os dados automaticamente.',
        link: '/policies',
        linkLabel: 'Adicionar apólice →',
        color: '#F0F9FF',
        borderColor: '#BAE6FD',
      }
    }
    return {
      icon: '✦',
      title: 'Portfólio em dia',
      description: 'Não há renovações urgentes. Use o Comparativo IA para optimizar as suas coberturas.',
      link: '/quotes-comparison',
      linkLabel: 'Analisar cotações →',
      color: '#F0FDF4',
      borderColor: '#BBF7D0',
    }
  }, [renewalAlerts, policies])

  if (!ready) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#C8961A', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" />

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">

        {/* Onboarding Banner */}
        {showOnboarding && !loading && (
          <OnboardingBanner
            hasPolicies={policies.length > 0}
            hasProfile={!!(user.name && user.name !== user.email)}
            onDismiss={() => setShowOnboarding(false)}
          />
        )}

        {/* Page title */}
        <div className="mb-6">
          <h1 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '1.4rem', color: '#111111', margin: 0 }}>
            Painel de Controlo
          </h1>
          <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.85rem', color: '#888888', marginTop: '0.25rem' }}>
            Visão geral do seu programa de seguros
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#eeeeee', borderTopColor: '#C8961A' }} />
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <KPICard
                label="Apólices Activas"
                value={String(stats?.activePolicies ?? 0)}
                icon="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                accent="#3B82F6"
              />
              <KPICard
                label="Prémios Anuais"
                value={formatCurrency(stats?.annualPremiums ?? 0)}
                icon="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                accent="#22C55E"
              />
              <KPICard
                label="Renovações 90d"
                value={String(stats?.renewalsIn90Days ?? 0)}
                icon="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                accent="#F59E0B"
                highlight={(stats?.renewalsIn90Days ?? 0) > 0}
              />
              <KPICard
                label="Sinistros Abertos"
                value={String(stats?.openClaims ?? 0)}
                icon="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                accent="#EF4444"
                highlight={(stats?.openClaims ?? 0) > 0}
              />
            </div>

            {/* Próxima acção recomendada */}
            <div
              style={{
                background: nextAction.color,
                border: `1px solid ${nextAction.borderColor}`,
                borderRadius: '4px',
                padding: '1rem 1.25rem',
                marginBottom: '1.5rem',
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
              }}
            >
              <span style={{ fontSize: '1.5rem', flexShrink: 0 }}>{nextAction.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.85rem', color: '#111111', margin: 0 }}>
                  {nextAction.title}
                </p>
                <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.8rem', color: '#555555', margin: '0.2rem 0 0' }}>
                  {nextAction.description}
                </p>
              </div>
              <Link
                to={nextAction.link as any}
                style={{
                  fontFamily: "'Montserrat', sans-serif",
                  fontWeight: 600,
                  fontSize: '0.78rem',
                  color: '#111111',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {nextAction.linkLabel}
              </Link>
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
              {/* Left column: Renovações + Gráfico */}
              <div className="lg:col-span-2 flex flex-col gap-6">

                {/* Renovações com countdown */}
                {renewalAlerts.length > 0 && (
                  <div style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #eeeeee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.9rem', color: '#111111', margin: 0 }}>
                        ⏰ Renovações Próximas
                      </h2>
                      <Link to="/policies" style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#C8961A', fontWeight: 600, textDecoration: 'none' }}>
                        Ver todas →
                      </Link>
                    </div>
                    <div>
                      {renewalAlerts.map((policy) => {
                        const days = daysUntil(policy.endDate)
                        const colors = POLICY_TYPE_COLORS[policy.type] || POLICY_TYPE_COLORS.other
                        const urgency = days <= 14 ? '#EF4444' : days <= 30 ? '#F59E0B' : '#C8961A'
                        return (
                          <div
                            key={policy.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.75rem',
                              padding: '0.75rem 1.25rem',
                              borderBottom: '1px solid #f5f5f5',
                            }}
                          >
                            <div
                              style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                background: colors.dot,
                                flexShrink: 0,
                              }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.82rem', color: '#111111', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {POLICY_TYPE_LABELS[policy.type] || policy.type} — {policy.insurer}
                              </p>
                              <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.72rem', color: '#888888', margin: 0 }}>
                                {policy.policyNumber} · {formatCurrency(policy.annualPremium)}/ano
                              </p>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '1rem', color: urgency, margin: 0 }}>
                                {days}d
                              </p>
                              <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.65rem', color: '#aaaaaa', margin: 0 }}>
                                {formatDate(policy.endDate)}
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Gráfico de prémios por tipo */}
                {premiumByType.length > 0 && (
                  <div style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', padding: '1.25rem' }}>
                    <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.9rem', color: '#111111', margin: '0 0 1rem' }}>
                      Distribuição de Prémios por Tipo
                    </h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      {premiumByType.map(({ type, value, pct }) => {
                        const colors = POLICY_TYPE_COLORS[type] || POLICY_TYPE_COLORS.other
                        return (
                          <div key={type}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                              <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#555555', fontWeight: 500 }}>
                                {POLICY_TYPE_LABELS[type as keyof typeof POLICY_TYPE_LABELS] || type}
                              </span>
                              <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#111111', fontWeight: 600 }}>
                                {formatCurrency(value)}
                              </span>
                            </div>
                            <div style={{ height: '6px', background: '#f0f0f0', borderRadius: '3px', overflow: 'hidden' }}>
                              <div
                                style={{
                                  height: '100%',
                                  width: `${pct}%`,
                                  background: colors.dot,
                                  borderRadius: '3px',
                                  transition: 'width 0.6s ease',
                                }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Apólices recentes */}
                <div style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #eeeeee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.9rem', color: '#111111', margin: 0 }}>
                      Apólices Recentes
                    </h2>
                    <Link to="/policies" style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#C8961A', fontWeight: 600, textDecoration: 'none' }}>
                      Ver todas →
                    </Link>
                  </div>
                  {policies.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center' }}>
                      <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.85rem', color: '#aaaaaa', margin: '0 0 0.75rem' }}>
                        Ainda não tem apólices registadas.
                      </p>
                      <Link
                        to="/policies"
                        style={{
                          fontFamily: "'Montserrat', sans-serif",
                          fontWeight: 600,
                          fontSize: '0.8rem',
                          color: '#ffffff',
                          background: '#111111',
                          padding: '0.5rem 1rem',
                          borderRadius: '4px',
                          textDecoration: 'none',
                        }}
                      >
                        + Adicionar apólice
                      </Link>
                    </div>
                  ) : (
                    policies.slice(0, 5).map((policy) => {
                      const colors = POLICY_TYPE_COLORS[policy.type] || POLICY_TYPE_COLORS.other
                      return (
                        <Link
                          key={policy.id}
                          to="/policies"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            padding: '0.75rem 1.25rem',
                            borderBottom: '1px solid #f5f5f5',
                            textDecoration: 'none',
                          }}
                        >
                          <div
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '4px',
                              background: colors.bg,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: colors.dot }} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.82rem', color: '#111111', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {POLICY_TYPE_LABELS[policy.type] || policy.type}
                            </p>
                            <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.72rem', color: '#888888', margin: 0 }}>
                              {policy.insurer} · {policy.policyNumber}
                            </p>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.85rem', color: '#111111', margin: 0 }}>
                              {formatCurrency(policy.annualPremium)}
                            </p>
                            <StatusBadge status={policy.status} />
                          </div>
                        </Link>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Right column: Alertas */}
              <div style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', overflow: 'hidden', alignSelf: 'start' }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #eeeeee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.9rem', color: '#111111', margin: 0 }}>
                    Alertas
                  </h2>
                  {alerts.length > 0 && (
                    <button
                      onClick={async () => {
                        if (confirm('Tem a certeza que deseja limpar os alertas?')) {
                          const { clearAlerts } = await import('@/lib/server-fns')
                          await clearAlerts()
                          setAlerts([])
                        }
                      }}
                      style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                    >
                      Limpar
                    </button>
                  )}
                </div>
                <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
                  {alerts.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center' }}>
                      <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.82rem', color: '#aaaaaa', margin: 0 }}>
                        Sem alertas no momento.
                      </p>
                    </div>
                  ) : (
                    alerts.map((alert) => (
                      <div
                        key={alert.id}
                        style={{
                          padding: '0.75rem 1.25rem',
                          borderBottom: '1px solid #f5f5f5',
                          background: !alert.read ? '#fffdf5' : 'transparent',
                        }}
                      >
                        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                          <AlertIcon type={alert.type} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.8rem', color: '#111111', margin: 0 }}>
                              {alert.title}
                            </p>
                            <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.72rem', color: '#888888', margin: '0.2rem 0 0', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                              {alert.message}
                            </p>
                            <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.65rem', color: '#cccccc', margin: '0.2rem 0 0' }}>
                              {formatDate(alert.createdAt)}
                            </p>
                          </div>
                          {!alert.read && (
                            <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#C8961A', flexShrink: 0, marginTop: '4px' }} />
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  )
}

function KPICard({
  label,
  value,
  icon,
  accent,
  highlight = false,
}: {
  label: string
  value: string
  icon: string
  accent: string
  highlight?: boolean
}) {
  return (
    <div
      style={{
        background: '#ffffff',
        border: highlight ? `1.5px solid ${accent}` : '1px solid #eeeeee',
        borderRadius: '4px',
        padding: '1rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '4px',
            background: `${accent}18`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke={accent} strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
          </svg>
        </div>
        <div>
          <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.7rem', color: '#888888', margin: 0, fontWeight: 400 }}>
            {label}
          </p>
          <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '1.25rem', fontWeight: 700, color: '#111111', margin: 0, lineHeight: 1.2 }}>
            {value}
          </p>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    active:    { bg: '#EAF3DE', color: '#3B6D11' },
    expiring:  { bg: '#FAEEDA', color: '#854F0B' },
    expired:   { bg: '#FEE2E2', color: '#991B1B' },
    cancelled: { bg: '#F3F4F6', color: '#6B7280' },
  }
  const labels: Record<string, string> = {
    active: 'Activa', expiring: 'A Expirar', expired: 'Expirada', cancelled: 'Cancelada',
  }
  const s = styles[status] || { bg: '#F3F4F6', color: '#6B7280' }
  return (
    <span style={{
      display: 'inline-block',
      fontFamily: "'Montserrat', sans-serif",
      fontSize: '0.65rem',
      fontWeight: 600,
      padding: '0.15rem 0.5rem',
      borderRadius: '20px',
      background: s.bg,
      color: s.color,
      marginTop: '0.15rem',
    }}>
      {labels[status] || status}
    </span>
  )
}

function AlertIcon({ type }: { type: string }) {
  const icons: Record<string, { color: string; path: string }> = {
    renewal:      { color: '#F59E0B', path: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
    claim_update: { color: '#3B82F6', path: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    payment:      { color: '#22C55E', path: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    document:     { color: '#6B7280', path: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    general:      { color: '#9CA3AF', path: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
  }
  const { color, path } = icons[type] || icons.general
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={1.5} style={{ flexShrink: 0, marginTop: '2px' }}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  )
}
