import { createFileRoute, Navigate, Link } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { fetchDashboardAll } from '@/lib/server-fns'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Alert, Claim, DashboardStats, Document, Policy, RiskReport } from '@/lib/types'
import { useEffect, useMemo, useState } from 'react'
import { useIdentity } from '@/lib/identity-context'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/dashboard')({
  component: DashboardPage,
})

function daysUntil(dateStr: string): number {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

type DashboardPayload = {
  stats: DashboardStats
  alerts: Alert[]
  policies: Policy[]
  claims: Claim[]
  documents: Document[]
  riskReports: RiskReport[]
}

function DashboardPage() {
  const { user, ready } = useIdentity()
  const { t } = useTranslation()
  const [payload, setPayload] = useState<DashboardPayload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ready || !user) return

    fetchDashboardAll()
      .then((data) => setPayload(data as DashboardPayload))
      .catch((err) => {
        console.error('Erro ao carregar cockpit executivo:', err)
      })
      .finally(() => setLoading(false))
  }, [ready, user])

  const policies = payload?.policies ?? []
  const claims = payload?.claims ?? []
  const alerts = payload?.alerts ?? []
  const documents = payload?.documents ?? []
  const riskReports = payload?.riskReports ?? []
  const stats = payload?.stats

  const activePolicies = useMemo(
    () => policies.filter((p) => p.status === 'active' || p.status === 'expiring'),
    [policies],
  )

  const renewalsSoon = useMemo(
    () => activePolicies
      .filter((p) => {
        const days = daysUntil(p.endDate)
        return days >= 0 && days <= 90
      })
      .sort((a, b) => daysUntil(a.endDate) - daysUntil(b.endDate)),
    [activePolicies],
  )

  const openClaims = useMemo(
    () => claims.filter((c) => !['approved', 'denied', 'paid'].includes(c.status)),
    [claims],
  )

  const criticalAlerts = useMemo(
    () => alerts.filter((a) => !a.read && ['renewal', 'claim_update', 'document', 'general'].includes(a.type)),
    [alerts],
  )

  const expiringFleetCoverage = useMemo(
    () => activePolicies.filter((p) => p.type === 'auto' && daysUntil(p.endDate) >= 0 && daysUntil(p.endDate) <= 60).length,
    [activePolicies],
  )

  const totalInsuredValue = useMemo(
    () => activePolicies.reduce((sum, p) => sum + (p.insuredValue || 0), 0),
    [activePolicies],
  )

  const openClaimExposure = useMemo(
    () => openClaims.reduce((sum, claim) => sum + (claim.estimatedValue || 0), 0),
    [openClaims],
  )

  const pendingDocumentAlerts = useMemo(
    () => alerts.filter((a) => !a.read && a.type === 'document').length,
    [alerts],
  )

  const riskTimeline = useMemo(() => {
    const now = new Date()
    const points = Array.from({ length: 6 }).map((_, idx) => {
      const monthDate = new Date(now.getFullYear(), now.getMonth() + idx, 1)
      const month = monthDate.getMonth()
      const year = monthDate.getFullYear()

      const renewalsExposure = activePolicies
        .filter((policy) => {
          const d = new Date(policy.endDate)
          return d.getMonth() === month && d.getFullYear() === year
        })
        .reduce((sum, policy) => sum + (policy.insuredValue || 0), 0)

      const claimsExposure = openClaims
        .filter((claim) => {
          const d = new Date(claim.incidentDate || claim.claimDate || claim.createdAt)
          return d.getMonth() === month && d.getFullYear() === year
        })
        .reduce((sum, claim) => sum + (claim.estimatedValue || 0), 0)

      return {
        key: `${year}-${month}`,
        label: monthDate.toLocaleDateString('pt-PT', { month: 'short' }),
        value: renewalsExposure + claimsExposure,
        renewalsExposure,
        claimsExposure,
      }
    })

    const max = Math.max(...points.map((point) => point.value), 1)
    return points.map((point) => ({ ...point, width: Math.max(8, Math.round((point.value / max) * 100)) }))
  }, [activePolicies, openClaims])

  const latestRiskSummary = riskReports[0]?.summary

  const insights = useMemo(() => {
    const list: string[] = []

    if (renewalsSoon.length > 0) {
      const next = renewalsSoon[0]
      list.push(`Renovação prioritária: ${next.policyNumber} expira em ${daysUntil(next.endDate)} dias.`)
    }

    if (openClaims.length > 0) {
      list.push(`Existem ${openClaims.length} sinistros em aberto com ${formatCurrency(openClaimExposure)} sob acompanhamento.`)
    }

    if (criticalAlerts.length > 0) {
      list.push(`Há ${criticalAlerts.length} alertas críticos por tratar. Rever alertas evita escaladas operacionais.`)
    }

    if (list.length < 3 && expiringFleetCoverage > 0) {
      list.push(`${expiringFleetCoverage} matrículas com cobertura a caducar nos próximos 60 dias.`)
    }

    if (list.length < 3 && latestRiskSummary) {
      list.push(`Parceiros e crédito: ${latestRiskSummary}`)
    }

    if (list.length < 3) {
      list.push('Portfólio estável: manter revisão semanal para antecipar riscos de renovação e sinistros.')
    }

    return list.slice(0, 3)
  }, [renewalsSoon, openClaims, openClaimExposure, criticalAlerts, expiringFleetCoverage, latestRiskSummary])

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
        <div className="mb-6">
          <h1 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '1.4rem', color: '#111111', margin: 0 }}>
            {t('dashboard.executiveTitle')}
          </h1>
          <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.85rem', color: '#888888', marginTop: '0.25rem' }}>
            {t('dashboard.executiveSubtitle')}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#eeeeee', borderTopColor: '#C8961A' }} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
              <KpiCard label={t('dashboard.kpiActivePolicies')} value={String(stats?.activePolicies ?? 0)} accent="#2563EB" />
              <KpiCard label={t('dashboard.kpiRenewalsSoon')} value={String(stats?.renewalsIn90Days ?? 0)} accent="#D97706" />
              <KpiCard label={t('dashboard.kpiOpenClaims')} value={String(stats?.openClaims ?? 0)} accent="#DC2626" />
              <KpiCard label={t('dashboard.kpiCriticalAlerts')} value={String(criticalAlerts.length)} accent="#B91C1C" />
              <KpiCard label={t('dashboard.kpiTotalExposure')} value={formatCurrency(totalInsuredValue + openClaimExposure)} accent="#1D4ED8" />
              <KpiCard label={t('dashboard.kpiFleetExpiring')} value={String(expiringFleetCoverage)} accent="#7C3AED" />
            </div>

            <div className="grid lg:grid-cols-3 gap-6 mb-6">
              <div className="lg:col-span-2" style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #eeeeee' }}>
                  <h2 style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.9rem', color: '#111111' }}>
                    {t('dashboard.attentionTitle')}
                  </h2>
                </div>
                <div className="grid md:grid-cols-3 gap-3" style={{ padding: '1rem 1.25rem' }}>
                  <AttentionCard
                    title={t('dashboard.attentionRenewals')}
                    value={`${renewalsSoon.length} ${t('dashboard.items')}`}
                    detail={renewalsSoon[0] ? t('dashboard.nextRenewalInDays', { days: daysUntil(renewalsSoon[0].endDate) }) : t('dashboard.noPending')}
                    to="/policies"
                    action={t('dashboard.viewRenewals')}
                  />
                  <AttentionCard
                    title={t('dashboard.attentionOperations')}
                    value={`${openClaims.length + criticalAlerts.length + pendingDocumentAlerts} ${t('dashboard.items')}`}
                    detail={t('dashboard.pendingOpsDetail', { claims: openClaims.length, alerts: criticalAlerts.length, docs: pendingDocumentAlerts })}
                    to="/claims"
                    action={t('dashboard.resolveNow')}
                  />
                  <AttentionCard
                    title={t('dashboard.attentionHighRisk')}
                    value={latestRiskSummary ? t('dashboard.riskDetected') : t('dashboard.monitoring')}
                    detail={latestRiskSummary || t('dashboard.noRiskReport')}
                    to="/partner-risk"
                    action={t('dashboard.reviewRisk')}
                  />
                </div>
              </div>

              <div style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #eeeeee' }}>
                  <h2 style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.9rem', color: '#111111' }}>
                    {t('dashboard.insightsTitle')}
                  </h2>
                </div>
                <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  {insights.map((insight) => (
                    <p
                      key={insight}
                      style={{
                        margin: 0,
                        padding: '0.55rem 0.65rem',
                        fontFamily: "'Montserrat', sans-serif",
                        fontSize: '0.75rem',
                        color: '#333333',
                        background: '#f8f8f8',
                        border: '1px solid #efefef',
                        borderRadius: '4px',
                      }}
                    >
                      {insight}
                    </p>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid lg:grid-cols-3 gap-6 mb-6">
              <div className="lg:col-span-2" style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #eeeeee' }}>
                  <h2 style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.9rem', color: '#111111' }}>
                    {t('dashboard.riskChartTitle')}
                  </h2>
                </div>
                <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                  {riskTimeline.map((point) => (
                    <div key={point.key}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                        <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#555555' }}>{point.label}</span>
                        <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#111111', fontWeight: 600 }}>
                          {formatCurrency(point.value)}
                        </span>
                      </div>
                      <div style={{ height: '8px', background: '#f0f0f0', borderRadius: '999px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${point.width}%`, background: 'linear-gradient(90deg, #C8961A 0%, #111111 100%)' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #eeeeee' }}>
                  <h2 style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.9rem', color: '#111111' }}>
                    {t('dashboard.criticalAlertsTitle')}
                  </h2>
                </div>
                <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                  {criticalAlerts.length === 0 ? (
                    <p style={{ margin: 0, padding: '1rem 1.25rem', color: '#888888', fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem' }}>
                      {t('dashboard.noCriticalAlerts')}
                    </p>
                  ) : (
                    criticalAlerts.slice(0, 6).map((alert) => (
                      <div key={alert.id} style={{ padding: '0.8rem 1.25rem', borderBottom: '1px solid #f5f5f5' }}>
                        <p style={{ margin: 0, color: '#111111', fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.78rem' }}>{alert.title}</p>
                        <p style={{ margin: '0.2rem 0 0', color: '#777777', fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem' }}>{alert.message}</p>
                        <p style={{ margin: '0.1rem 0 0', color: '#b4b4b4', fontFamily: "'Montserrat', sans-serif", fontSize: '0.66rem' }}>{formatDate(alert.createdAt)}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #eeeeee' }}>
                <h2 style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.9rem', color: '#111111' }}>
                  {t('dashboard.modulesTitle')}
                </h2>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" style={{ padding: '1rem 1.25rem' }}>
                <ModuleCard title={t('nav.policies')} to="/policies" metric={t('dashboard.modulePoliciesMetric', { count: activePolicies.length })} description={t('dashboard.modulePoliciesDesc')} />
                <ModuleCard title={t('nav.claims')} to="/claims" metric={t('dashboard.moduleClaimsMetric', { count: openClaims.length })} description={t('dashboard.moduleClaimsDesc')} />
                <ModuleCard title={t('nav.weatherAlerts')} to="/weather-alerts" metric={t('dashboard.moduleWeatherMetric', { count: criticalAlerts.length })} description={t('dashboard.moduleWeatherDesc')} />
                <ModuleCard title={t('nav.fleetsAndPlates')} to="/license-plates" metric={t('dashboard.moduleFleetMetric', { count: expiringFleetCoverage })} description={t('dashboard.moduleFleetDesc')} />
                <ModuleCard title={t('nav.partnersAndCredit')} to="/partner-risk" metric={riskReports.length > 0 ? t('dashboard.modulePartnerMetric') : t('dashboard.modulePartnerNoData')} description={t('dashboard.modulePartnerDesc')} />
                <ModuleCard title={t('nav.documents')} to="/documents" metric={t('dashboard.moduleDocumentsMetric', { count: documents.length })} description={t('dashboard.moduleDocumentsDesc')} />
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  )
}

function KpiCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', padding: '0.9rem' }}>
      <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.66rem', color: '#777777', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </p>
      <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '1.2rem', fontWeight: 700, color: accent, margin: '0.2rem 0 0' }}>
        {value}
      </p>
    </div>
  )
}

function AttentionCard({ title, value, detail, to, action }: { title: string; value: string; detail: string; to: string; action: string }) {
  return (
    <div style={{ border: '1px solid #eeeeee', borderRadius: '4px', padding: '0.8rem' }}>
      <p style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontSize: '0.68rem', color: '#777777', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {title}
      </p>
      <p style={{ margin: '0.2rem 0 0', fontFamily: "'Montserrat', sans-serif", fontSize: '1rem', fontWeight: 700, color: '#111111' }}>
        {value}
      </p>
      <p style={{ margin: '0.25rem 0 0.5rem', fontFamily: "'Montserrat', sans-serif", fontSize: '0.74rem', color: '#666666', lineHeight: 1.45 }}>
        {detail}
      </p>
      <Link to={to as any} style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#C8961A', fontWeight: 700, textDecoration: 'none' }}>
        {action}
      </Link>
    </div>
  )
}

function ModuleCard({ title, metric, description, to }: { title: string; metric: string; description: string; to: string }) {
  return (
    <Link to={to as any} style={{ textDecoration: 'none', border: '1px solid #eeeeee', borderRadius: '4px', padding: '0.85rem', background: '#fff' }}>
      <p style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem', fontWeight: 700, color: '#111111' }}>{title}</p>
      <p style={{ margin: '0.2rem 0 0', fontFamily: "'Montserrat', sans-serif", fontSize: '0.74rem', color: '#C8961A', fontWeight: 700 }}>{metric}</p>
      <p style={{ margin: '0.25rem 0 0', fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', color: '#666666', lineHeight: 1.5 }}>{description}</p>
    </Link>
  )
}
