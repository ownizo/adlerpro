import { createFileRoute, Navigate } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { fetchDashboardStats, fetchAlerts, fetchPolicies } from '@/lib/server-fns'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { DashboardStats, Alert, Policy } from '@/lib/types'
import { POLICY_TYPE_LABELS } from '@/lib/types'
import { useState, useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { useIdentity } from '@/lib/identity-context'

export const Route = createFileRoute('/dashboard')({
  component: DashboardPage,
})

function DashboardPage() {
  const { user, ready } = useIdentity()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ready || !user) return
    Promise.all([fetchDashboardStats(), fetchAlerts(), fetchPolicies()])
      .then(([s, a, p]) => {
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

  if (!ready) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" />

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-navy-700" style={{ fontFamily: "'Montserrat', sans-serif", letterSpacing: '-0.02em' }}>Painel de Controlo</h1>
          <p className="mt-1" style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, color: '#666666' }}>Visão geral do seu programa de seguros</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              <KPICard
                label="Apólices Ativas"
                value={String(stats?.activePolicies ?? 0)}
                icon="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                color="blue"
              />
              <KPICard
                label="Prémios Anuais"
                value={formatCurrency(stats?.annualPremiums ?? 0)}
                icon="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                color="green"
              />
              <KPICard
                label="Renovações em 90 Dias"
                value={String(stats?.renewalsIn90Days ?? 0)}
                icon="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                color="amber"
              />
            </div>

            <div className="grid lg:grid-cols-3 gap-8">
              {/* Recent Policies */}
              <div className="lg:col-span-2 bg-white rounded-[4px] border border-navy-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-navy-100 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-navy-700">Apólices Recentes</h2>
                  <Link to="/policies" className="text-sm text-gold-600 hover:text-gold-700 font-medium">
                    Ver todas
                  </Link>
                </div>
                <div className="divide-y divide-navy-100">
                  {policies.slice(0, 5).map((policy) => (
                    <Link
                      key={policy.id}
                      to="/policies"
                      className="flex items-center justify-between px-6 py-3 hover:bg-navy-50 transition-colors"
                    >
                      <div>
                        <p className="text-sm font-medium text-navy-700">
                          {POLICY_TYPE_LABELS[policy.type]}
                        </p>
                        <p className="text-xs text-navy-400">
                          {policy.insurer} — {policy.policyNumber}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-navy-700">
                          {formatCurrency(policy.annualPremium)}
                        </p>
                        <StatusBadge status={policy.status} />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              {/* Alerts */}
              <div className="bg-white rounded-[4px] border border-navy-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-navy-100 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-navy-700">Alertas</h2>
                  {alerts.length > 0 && (
                    <button 
                      onClick={async () => {
                        if (confirm('Tem a certeza que deseja limpar os alertas?')) {
                          const { clearAlerts } = await import('@/lib/server-fns');
                          await clearAlerts();
                          setAlerts([]);
                        }
                      }} 
                      className="text-xs text-red-600 hover:text-red-700 font-medium"
                    >
                      Limpar Histórico
                    </button>
                  )}
                </div>
                <div className="divide-y divide-navy-100 max-h-96 overflow-y-auto">
                  {alerts.length === 0 ? (
                    <div className="p-6 text-center text-sm text-navy-400">Sem alertas no momento.</div>
                  ) : alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`px-6 py-3 ${!alert.read ? 'bg-gold-50/50' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <AlertIcon type={alert.type} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-navy-700">{alert.title}</p>
                          <p className="text-xs text-navy-400 mt-0.5 line-clamp-2">
                            {alert.message}
                          </p>
                          <p className="text-xs text-navy-300 mt-1">
                            {formatDate(alert.createdAt)}
                          </p>
                        </div>
                        {!alert.read && (
                          <span className="w-2 h-2 rounded-full bg-gold-400 shrink-0 mt-1.5" />
                        )}
                      </div>
                    </div>
                  ))}
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
  color,
}: {
  label: string
  value: string
  icon: string
  color: 'blue' | 'green' | 'amber' | 'red'
}) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
  }

  return (
    <div className="bg-white border border-navy-200 p-6" style={{ borderRadius: '4px', border: '1px solid #eeeeee' }}>
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-[2px] flex items-center justify-center ${colorClasses[color]}`}>
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
          </svg>
        </div>
        <div>
          <p className="text-sm text-navy-400">{label}</p>
          <p className="text-2xl font-bold text-navy-700">{value}</p>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-[#EAF3DE] text-[#3B6D11]',
    expiring: 'bg-[#FAEEDA] text-[#854F0B]',
    expired: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-700',
  }
  const labels: Record<string, string> = {
    active: 'Ativa',
    expiring: 'A Expirar',
    expired: 'Expirada',
    cancelled: 'Cancelada',
  }
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${styles[status] || 'bg-gray-100 text-gray-600'}`}>
      {labels[status] || status}
    </span>
  )
}

function AlertIcon({ type }: { type: string }) {
  const icons: Record<string, { color: string; path: string }> = {
    renewal: {
      color: 'text-amber-500',
      path: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    },
    claim_update: {
      color: 'text-blue-500',
      path: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    },
    payment: {
      color: 'text-green-500',
      path: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    },
    document: {
      color: 'text-navy-500',
      path: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    },
    general: {
      color: 'text-navy-400',
      path: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
    },
  }
  const { color, path } = icons[type] || icons.general
  return (
    <svg className={`w-5 h-5 ${color} shrink-0 mt-0.5`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  )
}
