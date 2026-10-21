import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { fetchPortalHome } from '@/lib/server-fns'
import {
  PortalLayout, PageTitle, Card, Pill, Empty, Spinner, ErrorNote, C, BRAND,
  money, date, policyType, claimStatus, claimTone, daysUntil,
} from '@/components/portal/portal-ui'

export const Route = createFileRoute('/portal/')({
  component: PortalHome,
  ssr: false,
  head: () => ({ meta: [{ title: 'Overview — MillionGuard' }] }),
})

type Home = Awaited<ReturnType<typeof fetchPortalHome>>

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card style={{ padding: 18 }}>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: C.muted, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</p>
      <p className="mg-stat-value" style={{ margin: '8px 0 0', fontSize: 26, fontWeight: 700, color: C.ink }}>{value}</p>
      {hint && <p style={{ margin: '4px 0 0', fontSize: 12, color: C.body }}>{hint}</p>}
    </Card>
  )
}

function PortalHome() {
  const [data, setData] = useState<Home | null>(null)
  const [error, setError] = useState('')

  const load = () => {
    setError('')
    fetchPortalHome().then(setData).catch(() => setError('We could not load your account.'))
  }
  useEffect(load, [])

  return (
    <PortalLayout>
      {error && <ErrorNote onRetry={load}>{error}</ErrorNote>}
      {!data && !error && <Spinner />}
      {data && <HomeContent data={data} />}
    </PortalLayout>
  )
}

function HomeContent({ data }: { data: Home }) {
  const { account, stats, renewals, recentClaims } = data
  const firstName = (account.userName || '').split(' ')[0]

  if (account.type === 'none') {
    return (
      <>
        <PageTitle title={firstName ? `Welcome, ${firstName}` : 'Welcome'} />
        <Card>
          <p style={{ margin: 0, color: C.body, lineHeight: 1.6 }}>
            {account.isAdmin
              ? 'You are signed in with an agency account. Client policies are managed in the backoffice.'
              : <>Your account is not linked to a client file yet. Write to <a href={`mailto:${BRAND.contactEmail}`} style={{ color: C.ink }}>{BRAND.contactEmail}</a> and we will set it up.</>}
          </p>
        </Card>
      </>
    )
  }

  return (
    <>
      <PageTitle
        title={firstName ? `Welcome, ${firstName}` : 'Welcome'}
        subtitle={account.accountName}
      />

      <div className="mg-stats" style={{ marginBottom: 16 }}>
        <Stat label="Active policies" value={String(stats.activePolicies)} />
        <Stat label="Annual premiums" value={money(stats.annualPremiums)} hint="Active policies" />
        <Stat label="Renewals in 90 days" value={String(stats.renewalsIn90Days)} />
        <Stat label="Open claims" value={String(stats.openClaims)} />
      </div>

      <div className="mg-two">
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>Upcoming renewals</h2>
            <Link to="/portal/policies" style={{ fontSize: 13, color: C.accentInk, fontWeight: 600 }}>All policies</Link>
          </div>
          {renewals.length === 0 ? <Empty>No renewals in the next 90 days.</Empty> : renewals.map((p) => {
            const d = daysUntil(p.endDate)
            return (
              <div key={p.id} className="mg-row">
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 600 }}>{policyType(p.type)} · {p.insurer}</p>
                  <p style={{ margin: '3px 0 0', fontSize: 13, color: C.body }}>Ends {date(p.endDate)}</p>
                </div>
                <Pill tone={d <= 30 ? 'bad' : 'warn'}>{d <= 0 ? 'Today' : `${d} days`}</Pill>
              </div>
            )
          })}
        </Card>

        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>Recent claims</h2>
            <Link to="/portal/claims" style={{ fontSize: 13, color: C.accentInk, fontWeight: 600 }}>Report or follow a claim</Link>
          </div>
          {recentClaims.length === 0 ? <Empty>No claims reported.</Empty> : recentClaims.map((c) => (
            <div key={c.id} className="mg-row">
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</p>
                <p style={{ margin: '3px 0 0', fontSize: 13, color: C.body }}>Reported {date(c.claimDate || c.createdAt)}</p>
              </div>
              <Pill tone={claimTone(c.status)}>{claimStatus(c.status)}</Pill>
            </div>
          ))}
        </Card>
      </div>

      <Card style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 17 }}>Talk to your agent</h2>
          <p style={{ margin: '6px 0 0', color: C.body, fontSize: 14 }}>Questions about cover, a renewal or a new risk: we answer in writing.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a href={`mailto:${BRAND.contactEmail}`} style={{ padding: '10px 16px', border: `1px solid ${C.line}`, borderRadius: 10, color: C.ink, textDecoration: 'none', fontWeight: 600, fontSize: 14 }}>{BRAND.contactEmail}</a>
          <a href="https://wa.me/351928226570" target="_blank" rel="noopener noreferrer" style={{ padding: '10px 16px', background: C.ink, borderRadius: 10, color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: 14 }}>WhatsApp</a>
        </div>
      </Card>
    </>
  )
}
