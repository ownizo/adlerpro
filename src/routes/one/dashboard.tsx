import { createFileRoute } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { useState, useEffect } from 'react'
import { OneLayout } from './__root'
import { oneT, oneBrand, fmtCurrency, fmtDate, typeLabel } from '@/lib/one-brand'

export const Route = createFileRoute('/one/dashboard')({
  component: OneDashboard,
  ssr: false,
  head: () => ({ meta: [{ title: oneBrand().docTitle }] }),
})

const navy = '#0A1628'
const gold  = '#C9A84C'

interface IndividualClient {
  id: string
  full_name: string
  nif?: string
  email?: string
  phone?: string
  address?: string
  status: string
}

interface Policy {
  id: string
  policy_number: string
  type: string
  insurer: string
  annual_premium: number
  start_date: string
  end_date: string
  renewal_date?: string
  status: string
  description?: string
  payment_frequency?: string
}

function daysUntil(dateStr: string): number {
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  ativa:      { bg: '#EAF3DE', color: '#3B6D11' },
  active:     { bg: '#EAF3DE', color: '#3B6D11' },
  expiring:   { bg: '#FAEEDA', color: '#854F0B' },
  expired:    { bg: '#FEE2E2', color: '#991B1B' },
  cancelled:  { bg: '#F3F4F6', color: '#6B7280' },
}

function OneDashboard() {
  const t = oneT()
  const [client,   setClient]   = useState<IndividualClient | null>(null)
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      // 1. Get current auth user
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) {
        window.location.replace('/one/login')
        return
      }

      // 2. Find individual_client linked to this auth user
      //    Try auth_user_id first, then fall back to email match
      let clientData: IndividualClient | null = null

      const { data: byAuthId } = await supabase
        .from('individual_clients')
        .select('*')
        .eq('auth_user_id', user.id)
        .maybeSingle()

      if (byAuthId) {
        clientData = byAuthId
      } else if (user.email) {
        const { data: byEmail } = await supabase
          .from('individual_clients')
          .select('*')
          .ilike('email', user.email)
          .maybeSingle()
        clientData = byEmail ?? null

        // Link auth_user_id for future logins
        if (clientData) {
          await supabase
            .from('individual_clients')
            .update({ auth_user_id: user.id })
            .eq('id', clientData.id)
        }
      }

      setClient(clientData)

      // 3. Fetch policies for this client
      if (clientData) {
        const { data: policyData, error: pErr } = await supabase
          .from('policies')
          .select('id, policy_number, type, insurer, annual_premium, start_date, end_date, renewal_date, status, description, payment_frequency')
          .eq('individual_client_id', clientData.id)
          .order('end_date', { ascending: true })

        if (pErr) console.error('policies fetch:', pErr)
        setPolicies(policyData ?? [])
      }
    } catch (e: any) {
      setError(t.dashboard.loadError)
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const activePolicies = policies.filter(p => p.status === 'ativa' || p.status === 'active' || p.status === 'expiring')
  const nextRenewal    = activePolicies
    .filter(p => p.end_date)
    .sort((a, b) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime())[0]
  const totalPremium   = activePolicies.reduce((s, p) => s + (p.annual_premium ?? 0), 0)

  return (
    <OneLayout>
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '4rem' }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', border: `3px solid ${gold}`, borderTopColor: 'transparent', animation: 'one-spin 0.75s linear infinite' }} />
          <style>{`@keyframes one-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : error ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#B91C1C', fontSize: '0.9rem' }}>{error}</div>
      ) : (
        <>
          {/* Welcome header */}
          <div style={{ marginBottom: '1.75rem' }}>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: navy, margin: 0 }}>
              {t.dashboard.greeting}{client?.full_name ? `, ${client.full_name.split(' ')[0]}` : ''}
            </h1>
            <p style={{ fontSize: '0.82rem', color: '#64748B', marginTop: '0.3rem', fontWeight: 400 }}>
              {t.dashboard.summary}
            </p>
          </div>

          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            <KPICard
              label={t.dashboard.kpiActive}
              value={String(activePolicies.length)}
              icon="📋"
              accent="#3B82F6"
            />
            <KPICard
              label={t.dashboard.kpiPremium}
              value={totalPremium > 0 ? fmtCurrency(totalPremium) : '—'}
              icon="💶"
              accent="#22C55E"
            />
            <KPICard
              label={t.dashboard.kpiRenewal}
              value={nextRenewal ? `${daysUntil(nextRenewal.end_date)}d` : '—'}
              sublabel={nextRenewal ? fmtDate(nextRenewal.end_date) : undefined}
              icon="⏰"
              accent={nextRenewal && daysUntil(nextRenewal.end_date) <= 30 ? '#EF4444' : '#F59E0B'}
              highlight={!!nextRenewal && daysUntil(nextRenewal.end_date) <= 30}
            />
          </div>

          {/* No client record warning */}
          {!client && (
            <div style={{ padding: '1.5rem', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, marginBottom: '1.5rem', fontSize: '0.85rem', color: '#92400E' }}>
              <strong>{t.dashboard.noClientTitle}</strong>{t.dashboard.noClientBody}
            </div>
          )}

          {/* Policies list */}
          {client && (
            <div>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: navy, marginBottom: '0.85rem', letterSpacing: '0.02em' }}>
                {t.dashboard.yourPolicies} {activePolicies.length > 0 && <span style={{ color: '#94A3B8', fontWeight: 400 }}>({policies.length})</span>}
              </h2>

              {policies.length === 0 ? (
                <div style={{ padding: '2.5rem', textAlign: 'center', background: '#fff', borderRadius: 8, border: '1px solid #E2E8F0', color: '#94A3B8', fontSize: '0.85rem' }}>
                  {t.dashboard.noneRegistered}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {policies.map(p => <PolicyCard key={p.id} policy={p} />)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </OneLayout>
  )
}

/* ── Sub-components ── */

function KPICard({ label, value, sublabel, icon, accent, highlight }: {
  label: string; value: string; sublabel?: string; icon: string; accent: string; highlight?: boolean
}) {
  return (
    <div style={{
      background: '#fff',
      border: highlight ? `1.5px solid ${accent}` : '1px solid #E2E8F0',
      borderRadius: 8,
      padding: '1rem 1.1rem',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '0.75rem',
    }}>
      <span style={{ fontSize: '1.4rem', flexShrink: 0, marginTop: 2 }}>{icon}</span>
      <div>
        <p style={{ fontSize: '0.68rem', color: '#94A3B8', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', margin: 0 }}>{label}</p>
        <p style={{ fontSize: '1.3rem', fontWeight: 700, color: highlight ? accent : navy, margin: '0.1rem 0 0', lineHeight: 1.2 }}>{value}</p>
        {sublabel && <p style={{ fontSize: '0.68rem', color: '#94A3B8', margin: '0.1rem 0 0' }}>{sublabel}</p>}
      </div>
    </div>
  )
}

function PolicyCard({ policy }: { policy: Policy }) {
  const t = oneT()
  const [expanded, setExpanded] = useState(false)
  const st = STATUS_STYLE[policy.status] ?? { bg: '#F3F4F6', color: '#6B7280' }
  const stLabel = t.policyStatus[policy.status as keyof typeof t.policyStatus] ?? policy.status
  const label = typeLabel(policy.type)
  const days = policy.end_date ? daysUntil(policy.end_date) : null
  const urgency = days !== null && days <= 14 ? '#EF4444' : days !== null && days <= 30 ? '#F59E0B' : gold

  return (
    <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '1rem 1.25rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: navy, fontFamily: "'Montserrat', sans-serif" }}>
              {label}
            </span>
            <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '0.15rem 0.55rem', borderRadius: 20, background: st.bg, color: st.color }}>
              {stLabel}
            </span>
          </div>
          <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '0.2rem 0 0', fontFamily: "'Montserrat', sans-serif" }}>
            {policy.insurer}{policy.policy_number ? ` · ${policy.policy_number}` : ''}
          </p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {policy.annual_premium > 0 && (
            <p style={{ fontSize: '0.9rem', fontWeight: 700, color: navy, margin: 0, fontFamily: "'Montserrat', sans-serif" }}>
              {fmtCurrency(policy.annual_premium)}
              <span style={{ fontSize: '0.65rem', fontWeight: 400, color: '#94A3B8' }}>{t.dashboard.perYear}</span>
            </p>
          )}
          {days !== null && (
            <p style={{ fontSize: '0.7rem', color: urgency, fontWeight: 600, margin: '0.1rem 0 0', fontFamily: "'Montserrat', sans-serif" }}>
              {days > 0 ? t.dashboard.renewsIn(days) : days === 0 ? t.dashboard.renewsToday : t.dashboard.expired}
            </p>
          )}
        </div>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid #F1F5F9', padding: '0.85rem 1.25rem', background: '#F8FAFC', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem' }}>
          {policy.start_date     && <DetailItem label={t.detail.start}       value={fmtDate(policy.start_date)} />}
          {policy.end_date       && <DetailItem label={t.detail.end}          value={fmtDate(policy.end_date)} />}
          {policy.renewal_date   && <DetailItem label={t.detail.renewal}    value={fmtDate(policy.renewal_date)} />}
          {policy.payment_frequency && <DetailItem label={t.detail.payment} value={policy.payment_frequency} />}
          {policy.description    && <DetailItem label={t.detail.description}    value={policy.description} span />}
        </div>
      )}
    </div>
  )
}

function DetailItem({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <div style={{ gridColumn: span ? '1 / -1' : undefined }}>
      <p style={{ fontSize: '0.62rem', fontWeight: 600, color: '#94A3B8', letterSpacing: '0.06em', textTransform: 'uppercase', margin: 0, fontFamily: "'Montserrat', sans-serif" }}>
        {label}
      </p>
      <p style={{ fontSize: '0.8rem', color: navy, fontWeight: 500, margin: '0.1rem 0 0', fontFamily: "'Montserrat', sans-serif" }}>
        {value}
      </p>
    </div>
  )
}
