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

type RiskLevel = 'low' | 'medium' | 'high'

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value))
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

  const totalExposure = totalInsuredValue + openClaimExposure

  const pendingDocumentAlerts = useMemo(
    () => alerts.filter((a) => !a.read && a.type === 'document').length,
    [alerts],
  )

  const renewals30Days = useMemo(
    () => activePolicies
      .filter((p) => {
        const days = daysUntil(p.endDate)
        return days >= 0 && days <= 30
      }),
    [activePolicies],
  )

  const riskScore = useMemo(() => {
    const totalBase = Math.max(totalInsuredValue, 1)
    const claimPressure = clamp((openClaimExposure / totalBase) * 100, 0, 100)
    const urgencyPressure = clamp(
      renewals30Days.length * 10 + criticalAlerts.length * 9 + pendingDocumentAlerts * 6 + openClaims.length * 5,
      0,
      100,
    )
    const riskReportPressure = riskReports[0]?.summary ? 12 : 0
    return clamp(Math.round(claimPressure * 0.5 + urgencyPressure * 0.4 + riskReportPressure), 0, 100)
  }, [
    totalInsuredValue,
    openClaimExposure,
    renewals30Days.length,
    criticalAlerts.length,
    pendingDocumentAlerts,
    openClaims.length,
    riskReports,
  ])

  const riskLevel = useMemo((): RiskLevel => {
    if (riskScore >= 67) return 'high'
    if (riskScore >= 34) return 'medium'
    return 'low'
  }, [riskScore])

  const riskTimeline = useMemo(() => {
    const now = new Date()
    const startMonth = new Date(now.getFullYear(), now.getMonth() - 2, 1)
    const next30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

    const historicalClaimMonths = Array.from({ length: 3 }).map((_, idx) => {
      const d = new Date(now.getFullYear(), now.getMonth() - idx, 1)
      const month = d.getMonth()
      const year = d.getFullYear()
      return claims
        .filter((claim) => {
          const claimDate = new Date(claim.incidentDate || claim.claimDate || claim.createdAt)
          return claimDate.getMonth() === month && claimDate.getFullYear() === year
        })
        .reduce((sum, claim) => sum + (claim.estimatedValue || 0), 0)
    })

    const projectedClaimsPerMonth = historicalClaimMonths.length
      ? historicalClaimMonths.reduce((sum, value) => sum + value, 0) / historicalClaimMonths.length
      : openClaimExposure * 0.35

    const points = Array.from({ length: 8 }).map((_, idx) => {
      const monthDate = new Date(startMonth.getFullYear(), startMonth.getMonth() + idx, 1)
      const month = monthDate.getMonth()
      const year = monthDate.getFullYear()
      const monthEnd = new Date(year, month + 1, 0)
      const isProjected = monthDate > new Date(now.getFullYear(), now.getMonth(), 1)

      const renewalsExposure = activePolicies
        .filter((policy) => {
          const d = new Date(policy.endDate)
          return d.getMonth() === month && d.getFullYear() === year
        })
        .reduce((sum, policy) => sum + (policy.insuredValue || 0), 0)

      const claimsExposure = isProjected
        ? projectedClaimsPerMonth
        : claims
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
        isProjected,
        isNext30Days: monthDate <= next30 && monthEnd >= now,
      }
    })

    const max = Math.max(...points.map((point) => point.value), 1)
    return points.map((point) => ({ ...point, width: Math.max(8, Math.round((point.value / max) * 100)) }))
  }, [activePolicies, claims, openClaimExposure])

  const latestRiskSummary = riskReports[0]?.summary

  const next30DaysExposure = useMemo(() => {
    const renewalsExposure = renewals30Days.reduce((sum, policy) => sum + (policy.insuredValue || 0), 0)
    const projectedClaimExposure = riskTimeline.find((point) => point.isNext30Days)?.claimsExposure ?? 0
    return renewalsExposure + projectedClaimExposure
  }, [renewals30Days, riskTimeline])

  const sectionPriorities = useMemo(() => {
    const sections = [
      {
        id: 'renewals',
        title: t('dashboard.sectionRenewals'),
        detail: renewalsSoon[0] ? t('dashboard.nextRenewalInDays', { days: daysUntil(renewalsSoon[0].endDate) }) : t('dashboard.noPending'),
        value: `${renewalsSoon.length} ${t('dashboard.items')}`,
        action: t('dashboard.viewRenewals'),
        to: '/policies',
        impact: renewalsSoon.reduce((sum, policy) => sum + (policy.insuredValue || 0), 0),
        urgency: renewals30Days.length * 22 + renewalsSoon.length * 4,
      },
      {
        id: 'claims',
        title: t('dashboard.sectionClaims'),
        detail: t('dashboard.pendingClaimsDetail', { count: openClaims.length }),
        value: `${openClaims.length} ${t('dashboard.items')}`,
        action: t('dashboard.resolveNow'),
        to: '/claims',
        impact: openClaimExposure,
        urgency: openClaims.length * 16,
      },
      {
        id: 'alerts',
        title: t('dashboard.sectionAlerts'),
        detail: t('dashboard.pendingAlertsDetail', { count: criticalAlerts.length }),
        value: `${criticalAlerts.length} ${t('dashboard.items')}`,
        action: t('dashboard.reviewAlerts'),
        to: '/alerts',
        impact: criticalAlerts.length * 5000,
        urgency: criticalAlerts.length * 18,
      },
      {
        id: 'documents',
        title: t('dashboard.sectionDocuments'),
        detail: t('dashboard.pendingDocsDetail', { count: pendingDocumentAlerts }),
        value: `${pendingDocumentAlerts} ${t('dashboard.items')}`,
        action: t('dashboard.reviewDocuments'),
        to: '/documents',
        impact: pendingDocumentAlerts * 3500,
        urgency: pendingDocumentAlerts * 14,
      },
      {
        id: 'partners',
        title: t('dashboard.sectionPartners'),
        detail: latestRiskSummary || t('dashboard.noRiskReport'),
        value: latestRiskSummary ? t('dashboard.riskDetected') : t('dashboard.monitoring'),
        action: t('dashboard.reviewRisk'),
        to: '/partner-risk',
        impact: latestRiskSummary ? totalInsuredValue * 0.08 : 0,
        urgency: latestRiskSummary ? 42 : 10,
      },
      {
        id: 'fleet',
        title: t('dashboard.sectionFleet'),
        detail: t('dashboard.fleetPendingDetail', { count: expiringFleetCoverage }),
        value: `${expiringFleetCoverage} ${t('dashboard.items')}`,
        action: t('dashboard.reviewFleet'),
        to: '/license-plates',
        impact: expiringFleetCoverage * 3000,
        urgency: expiringFleetCoverage * 12,
      },
    ]

    const maxImpact = Math.max(...sections.map((section) => section.impact), 1)
    const maxUrgency = Math.max(...sections.map((section) => section.urgency), 1)

    return sections
      .map((section) => {
        const impactScore = (section.impact / maxImpact) * 100
        const urgencyScore = (section.urgency / maxUrgency) * 100
        const priorityScore = Math.round(impactScore * 0.65 + urgencyScore * 0.35)
        return { ...section, priorityScore }
      })
      .sort((a, b) => b.priorityScore - a.priorityScore)
  }, [
    t,
    renewalsSoon,
    renewals30Days.length,
    openClaims.length,
    criticalAlerts.length,
    pendingDocumentAlerts,
    latestRiskSummary,
    totalInsuredValue,
    openClaimExposure,
    expiringFleetCoverage,
  ])

  const summaryInsights = useMemo(() => {
    const list: string[] = []

    list.push(t('dashboard.smartRiskSummary', { level: t(`dashboard.riskLevel.${riskLevel}`), score: riskScore }))
    list.push(t('dashboard.smartNext30Days', { exposure: formatCurrency(next30DaysExposure) }))

    if (sectionPriorities.length > 0) {
      list.push(t('dashboard.smartTopPriority', { section: sectionPriorities[0].title, score: sectionPriorities[0].priorityScore }))
    }

    if (openClaims.length > 0) {
      list.push(t('dashboard.smartClaimsContext', { count: openClaims.length, value: formatCurrency(openClaimExposure) }))
    } else if (latestRiskSummary) {
      list.push(t('dashboard.smartPartnerContext', { summary: latestRiskSummary }))
    } else {
      list.push(t('dashboard.smartStableContext'))
    }

    return list.slice(0, 4)
  }, [t, riskLevel, riskScore, next30DaysExposure, sectionPriorities, openClaims.length, openClaimExposure, latestRiskSummary])

  const modulesSorted = useMemo(() => {
    const modules = [
      { id: 'renewals', title: t('nav.policies'), to: '/policies', metric: t('dashboard.modulePoliciesMetric', { count: activePolicies.length }), description: t('dashboard.modulePoliciesDesc') },
      { id: 'claims', title: t('nav.claims'), to: '/claims', metric: t('dashboard.moduleClaimsMetric', { count: openClaims.length }), description: t('dashboard.moduleClaimsDesc') },
      { id: 'alerts', title: t('nav.weatherAlerts'), to: '/weather-alerts', metric: t('dashboard.moduleWeatherMetric', { count: criticalAlerts.length }), description: t('dashboard.moduleWeatherDesc') },
      { id: 'fleet', title: t('nav.fleetsAndPlates'), to: '/license-plates', metric: t('dashboard.moduleFleetMetric', { count: expiringFleetCoverage }), description: t('dashboard.moduleFleetDesc') },
      { id: 'partners', title: t('nav.partnersAndCredit'), to: '/partner-risk', metric: riskReports.length > 0 ? t('dashboard.modulePartnerMetric') : t('dashboard.modulePartnerNoData'), description: t('dashboard.modulePartnerDesc') },
      { id: 'documents', title: t('nav.documents'), to: '/documents', metric: t('dashboard.moduleDocumentsMetric', { count: documents.length }), description: t('dashboard.moduleDocumentsDesc') },
    ]

    const priorityById = new Map(sectionPriorities.map((item) => [item.id, item.priorityScore]))
    return modules.sort((a, b) => (priorityById.get(b.id) ?? 0) - (priorityById.get(a.id) ?? 0))
  }, [t, activePolicies.length, openClaims.length, criticalAlerts.length, expiringFleetCoverage, riskReports.length, documents.length, sectionPriorities])

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
            <div className="mb-4" style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', padding: '0.85rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.8rem' }}>
              <div>
                <p style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontSize: '0.68rem', color: '#777777', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {t('dashboard.globalRiskTitle')}
                </p>
                <p style={{ margin: '0.2rem 0 0', fontFamily: "'Montserrat', sans-serif", fontSize: '0.95rem', color: '#111111', fontWeight: 700 }}>
                  {t(`dashboard.riskLevel.${riskLevel}`)} · {riskScore}/100
                </p>
              </div>
              <Link to={(sectionPriorities[0]?.to ?? '/dashboard') as any} style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.74rem', color: '#C8961A', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                {t('dashboard.drillDown')}
              </Link>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
              <KpiCard label={t('dashboard.kpiActivePolicies')} value={String(stats?.activePolicies ?? 0)} accent="#2563EB" />
              <KpiCard label={t('dashboard.kpiRenewalsSoon')} value={String(stats?.renewalsIn90Days ?? 0)} accent="#D97706" />
              <KpiCard label={t('dashboard.kpiOpenClaims')} value={String(stats?.openClaims ?? 0)} accent="#DC2626" />
              <KpiCard label={t('dashboard.kpiCriticalAlerts')} value={String(criticalAlerts.length)} accent="#B91C1C" />
              <KpiCard label={t('dashboard.kpiInsuredCapital')} value={formatCurrency(totalInsuredValue)} accent="#1D4ED8" />
              <KpiCard label={t('dashboard.kpiClaimsExposure')} value={formatCurrency(openClaimExposure)} accent="#DC2626" />
            </div>

            <div className="grid md:grid-cols-3 gap-4 mb-6">
              <KpiCard label={t('dashboard.kpiTotalExposure')} value={formatCurrency(totalExposure)} accent="#0F766E" />
              <KpiCard label={t('dashboard.kpiFleetExpiring')} value={String(expiringFleetCoverage)} accent="#7C3AED" />
              <KpiCard label={t('dashboard.kpiNext30DaysExposure')} value={formatCurrency(next30DaysExposure)} accent="#92400E" />
            </div>

            <div className="grid lg:grid-cols-3 gap-6 mb-6">
              <div className="lg:col-span-2" style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #eeeeee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                  <h2 style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.9rem', color: '#111111' }}>
                    {t('dashboard.priorityTitle')}
                  </h2>
                  <Link to={(sectionPriorities[0]?.to ?? '/dashboard') as any} style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', color: '#C8961A', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                    {t('dashboard.drillDown')}
                  </Link>
                </div>
                <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3" style={{ padding: '1rem 1.25rem' }}>
                  {sectionPriorities.slice(0, 6).map((section) => (
                    <AttentionCard
                      key={section.id}
                      title={section.title}
                      value={section.value}
                      detail={section.detail}
                      to={section.to}
                      action={`${section.action} · ${t('dashboard.priorityScore', { score: section.priorityScore })}`}
                    />
                  ))}
                </div>
              </div>

              <div style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #eeeeee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                  <h2 style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.9rem', color: '#111111' }}>
                    {t('dashboard.smartSummaryTitle')}
                  </h2>
                  <Link to={(sectionPriorities[0]?.to ?? '/dashboard') as any} style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', color: '#C8961A', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                    {t('dashboard.drillDown')}
                  </Link>
                </div>
                <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  {summaryInsights.map((insight) => (
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
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #eeeeee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                  <h2 style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.9rem', color: '#111111' }}>
                    {t('dashboard.riskChartTitle')}
                  </h2>
                  <Link to="/policies" style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', color: '#C8961A', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                    {t('dashboard.drillDown')}
                  </Link>
                </div>
                <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                  <p style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', color: '#666666' }}>
                    {t('dashboard.next30DaysFocus', { value: formatCurrency(next30DaysExposure) })}
                  </p>
                  {riskTimeline.map((point) => (
                    <div key={point.key}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                        <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#555555' }}>{point.label}</span>
                        <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#111111', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          {point.isProjected && (
                            <span style={{ fontSize: '0.62rem', color: '#777777', fontWeight: 500 }}>{t('dashboard.projectedShort')}</span>
                          )}
                          {formatCurrency(point.value)}
                        </span>
                      </div>
                      <div style={{
                        height: '8px',
                        background: point.isNext30Days ? '#FEF3C7' : '#f0f0f0',
                        borderRadius: '999px',
                        overflow: 'hidden',
                        border: point.isProjected ? '1px dashed #cfcfcf' : 'none',
                      }}>
                        <div style={{ height: '100%', width: `${point.width}%`, background: point.isProjected ? 'linear-gradient(90deg, #D6D3D1 0%, #44403C 100%)' : 'linear-gradient(90deg, #C8961A 0%, #111111 100%)' }} />
                      </div>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: '0.9rem', marginTop: '0.2rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.68rem', color: '#666666' }}>
                      {t('dashboard.legendObserved')}
                    </span>
                    <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.68rem', color: '#666666' }}>
                      {t('dashboard.legendProjected')}
                    </span>
                    <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.68rem', color: '#666666' }}>
                      {t('dashboard.legend30Days')}
                    </span>
                  </div>
                </div>
              </div>

              <div style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #eeeeee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                  <h2 style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.9rem', color: '#111111' }}>
                    {t('dashboard.criticalAlertsTitle')}
                  </h2>
                  <Link to="/alerts" style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', color: '#C8961A', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                    {t('dashboard.drillDown')}
                  </Link>
                </div>
                <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                  {criticalAlerts.length === 0 ? (
                    <p style={{ margin: 0, padding: '1rem 1.25rem', color: '#888888', fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem' }}>
                      {t('dashboard.noCriticalAlerts')}
                    </p>
                  ) : (
                    criticalAlerts.slice(0, 6).map((alert) => (
                      <Link
                        key={alert.id}
                        to="/alerts"
                        style={{ display: 'block', textDecoration: 'none', padding: '0.8rem 1.25rem', borderBottom: '1px solid #f5f5f5' }}
                      >
                        <p style={{ margin: 0, color: '#111111', fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.78rem' }}>{alert.title}</p>
                        <p style={{ margin: '0.2rem 0 0', color: '#777777', fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem' }}>{alert.message}</p>
                        <p style={{ margin: '0.1rem 0 0', color: '#b4b4b4', fontFamily: "'Montserrat', sans-serif", fontSize: '0.66rem' }}>{formatDate(alert.createdAt)}</p>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #eeeeee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                <h2 style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.9rem', color: '#111111' }}>
                  {t('dashboard.modulesTitle')}
                </h2>
                <Link to={(sectionPriorities[0]?.to ?? '/dashboard') as any} style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', color: '#C8961A', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                  {t('dashboard.drillDown')}
                </Link>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" style={{ padding: '1rem 1.25rem' }}>
                {modulesSorted.map((module) => (
                  <ModuleCard key={module.id} title={module.title} to={module.to} metric={module.metric} description={module.description} />
                ))}
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
