import { createFileRoute } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { useState, useEffect } from 'react'
import { OneLayout } from './__root'

export const Route = createFileRoute('/one/policies')({
  component: OnePolicies,
  ssr: false,
})

const navy = '#0A1628'
const gold  = '#C9A84C'

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

const TYPE_LABELS: Record<string, string> = {
  property:              'Propriedade',
  liability:             'Responsabilidade Civil',
  workers_comp:          'Acidentes de Trabalho',
  auto:                  'Automóvel',
  health:                'Saúde',
  cyber:                 'Ciber-Risco',
  directors_officers:    'D&O',
  business_interruption: 'Interrupção de Negócio',
  'Automovel':                 'Automóvel',
  'Multirriscos Habitacao':    'Multirriscos Habitação',
  'MR Empresas':               'MR Empresas',
  'Responsabilidade Civil':    'Responsabilidade Civil',
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  ativa:     { bg: '#EAF3DE', color: '#3B6D11', label: 'Ativa'     },
  active:    { bg: '#EAF3DE', color: '#3B6D11', label: 'Ativa'     },
  expiring:  { bg: '#FAEEDA', color: '#854F0B', label: 'A Renovar' },
  expired:   { bg: '#FEE2E2', color: '#991B1B', label: 'Expirada'  },
  cancelled: { bg: '#F3F4F6', color: '#6B7280', label: 'Cancelada' },
}

function daysUntil(dateStr: string): number {
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(n)
}

function formatDate(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })
}

function OnePolicies() {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) { window.location.replace('/one/login'); return }

      let clientId: string | null = null

      const { data: byAuthId } = await supabase
        .from('individual_clients').select('id').eq('auth_user_id', user.id).maybeSingle()

      if (byAuthId) {
        clientId = byAuthId.id
      } else if (user.email) {
        const { data: byEmail } = await supabase
          .from('individual_clients').select('id').ilike('email', user.email).maybeSingle()
        if (byEmail) {
          clientId = byEmail.id
          await supabase.from('individual_clients').update({ auth_user_id: user.id }).eq('id', clientId)
        }
      }

      if (clientId) {
        const { data, error: pErr } = await supabase
          .from('policies')
          .select('id, policy_number, type, insurer, annual_premium, start_date, end_date, renewal_date, status, description, payment_frequency')
          .eq('individual_client_id', clientId)
          .order('end_date', { ascending: true })
        if (pErr) throw pErr
        setPolicies(data ?? [])
      }
    } catch (e: any) {
      setError('Erro ao carregar apólices.')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <OneLayout>
      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorMsg msg={error} />
      ) : (
        <>
          <div style={{ marginBottom: '1.75rem' }}>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: navy, margin: 0 }}>As Suas Apólices</h1>
            <p style={{ fontSize: '0.82rem', color: '#64748B', marginTop: '0.3rem' }}>
              {policies.length} apólice{policies.length !== 1 ? 's' : ''} registada{policies.length !== 1 ? 's' : ''}
            </p>
          </div>

          {policies.length === 0 ? (
            <EmptyState msg="Sem apólices registadas." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {policies.map(p => <PolicyCard key={p.id} policy={p} />)}
            </div>
          )}
        </>
      )}
    </OneLayout>
  )
}

function PolicyCard({ policy }: { policy: Policy }) {
  const [expanded, setExpanded] = useState(false)
  const st = STATUS_STYLE[policy.status] ?? { bg: '#F3F4F6', color: '#6B7280', label: policy.status }
  const typeLabel = TYPE_LABELS[policy.type] ?? policy.type
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
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: navy }}>{typeLabel}</span>
            <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '0.15rem 0.55rem', borderRadius: 20, background: st.bg, color: st.color }}>{st.label}</span>
          </div>
          <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '0.2rem 0 0' }}>
            {policy.insurer}{policy.policy_number ? ` · ${policy.policy_number}` : ''}
          </p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {policy.annual_premium > 0 && (
            <p style={{ fontSize: '0.9rem', fontWeight: 700, color: navy, margin: 0 }}>
              {formatCurrency(policy.annual_premium)}
              <span style={{ fontSize: '0.65rem', fontWeight: 400, color: '#94A3B8' }}>/ano</span>
            </p>
          )}
          {days !== null && (
            <p style={{ fontSize: '0.7rem', color: urgency, fontWeight: 600, margin: '0.1rem 0 0' }}>
              {days > 0 ? `Renova em ${days}d` : days === 0 ? 'Renova hoje' : 'Expirada'}
            </p>
          )}
        </div>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid #F1F5F9', padding: '0.85rem 1.25rem', background: '#F8FAFC', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem' }}>
          {policy.start_date        && <DetailItem label="Início"     value={formatDate(policy.start_date)} />}
          {policy.end_date          && <DetailItem label="Fim"        value={formatDate(policy.end_date)} />}
          {policy.renewal_date      && <DetailItem label="Renovação"  value={formatDate(policy.renewal_date)} />}
          {policy.payment_frequency && <DetailItem label="Pagamento"  value={policy.payment_frequency} />}
          {policy.description       && <DetailItem label="Descrição"  value={policy.description} span />}
        </div>
      )}
    </div>
  )
}

function DetailItem({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <div style={{ gridColumn: span ? '1 / -1' : undefined }}>
      <p style={{ fontSize: '0.62rem', fontWeight: 600, color: '#94A3B8', letterSpacing: '0.06em', textTransform: 'uppercase', margin: 0 }}>{label}</p>
      <p style={{ fontSize: '0.8rem', color: navy, fontWeight: 500, margin: '0.1rem 0 0' }}>{value}</p>
    </div>
  )
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '4rem' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', border: `3px solid ${gold}`, borderTopColor: 'transparent', animation: 'one-spin 0.75s linear infinite' }} />
      <style>{`@keyframes one-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function ErrorMsg({ msg }: { msg: string }) {
  return <div style={{ padding: '2rem', textAlign: 'center', color: '#B91C1C', fontSize: '0.9rem' }}>{msg}</div>
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div style={{ padding: '2.5rem', textAlign: 'center', background: '#fff', borderRadius: 8, border: '1px solid #E2E8F0', color: '#94A3B8', fontSize: '0.85rem' }}>
      {msg}
    </div>
  )
}
