import { createFileRoute } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { useState, useEffect } from 'react'
import { OneLayout } from './__root'
import { fetchClaimWorkspace, addClaimMessage, registerClaimDocument, getClaimDocumentUrl, fetchIndividualClaims, submitIndividualClaim } from '@/lib/server-fns'
import type { ClaimOperationalData } from '@/lib/types'

export const Route = createFileRoute('/one/claims')({
  component: OneClaims,
  ssr: false,
  head: () => ({ meta: [{ title: 'Adler One' }] }),
})

const navy = '#0A1628'
const gold  = '#C9A84C'

interface Policy {
  id: string
  policy_number: string
  type: string
  insurer: string
}

interface Claim {
  id: string
  title: string
  description: string
  incident_date: string
  claim_date: string
  estimated_value: number
  status: string
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
  'Automovel':              'Automóvel',
  'Multirriscos Habitacao': 'Multirriscos Habitação',
  'MR Empresas':            'MR Empresas',
  'Responsabilidade Civil': 'Responsabilidade Civil',
}

const CLAIM_STATUS: Record<string, { bg: string; color: string; label: string }> = {
  submitted:    { bg: '#EFF6FF', color: '#1D4ED8', label: 'Submetido'     },
  under_review: { bg: '#FEF3C7', color: '#92400E', label: 'Em Análise'    },
  documentation:{ bg: '#F3E8FF', color: '#6D28D9', label: 'Documentação'  },
  assessment:   { bg: '#FEF3C7', color: '#92400E', label: 'Avaliação'     },
  approved:     { bg: '#EAF3DE', color: '#3B6D11', label: 'Aprovado'      },
  denied:       { bg: '#FEE2E2', color: '#991B1B', label: 'Recusado'      },
  paid:         { bg: '#D1FAE5', color: '#065F46', label: 'Pago'          },
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(n)
}

function formatDate(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatDateTime(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function OneClaims() {
  const [clientId,   setClientId]   = useState<string | null>(null)
  const [policies,   setPolicies]   = useState<Policy[]>([])
  const [claims,     setClaims]     = useState<Claim[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [showForm,   setShowForm]   = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError,  setFormError]  = useState('')
  const [form, setForm] = useState({
    policyId: '', title: '', description: '', incidentDate: '', estimatedValue: '',
  })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) { window.location.replace('/one/login'); return }

      let cid: string | null = null
      const { data: byAuthId } = await supabase
        .from('individual_clients').select('id').eq('auth_user_id', user.id).maybeSingle()

      if (byAuthId) {
        cid = byAuthId.id
      } else if (user.email) {
        const { data: byEmail } = await supabase
          .from('individual_clients').select('id').ilike('email', user.email).maybeSingle()
        if (byEmail) {
          cid = byEmail.id
          await supabase.from('individual_clients').update({ auth_user_id: user.id }).eq('id', cid)
        }
      }

      setClientId(cid)

      if (cid) {
        const [{ data: pData }, { data: cData }] = await Promise.all([
          supabase.from('policies')
            .select('id, policy_number, type, insurer')
            .eq('individual_client_id', cid)
            .order('end_date', { ascending: true }),
          fetchIndividualClaims(),
        ])
        setPolicies(pData ?? [])
        setClaims((cData as Claim[]) ?? [])
      }
    } catch (e: any) {
      setError('Erro ao carregar sinistros.')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!clientId) return
    setFormError('')
    setSubmitting(true)
    try {
      await submitIndividualClaim({
        data: {
          policyId: form.policyId,
          title: form.title,
          description: form.description,
          incidentDate: form.incidentDate,
          estimatedValue: Number(form.estimatedValue) || 0,
        },
      })
      setForm({ policyId: '', title: '', description: '', incidentDate: '', estimatedValue: '' })
      setShowForm(false)
      await loadData()
    } catch (e: any) {
      setFormError('Erro ao submeter sinistro. Tente novamente.')
      console.error(e)
    } finally {
      setSubmitting(false)
    }
  }

  const update = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  return (
    <OneLayout>
      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorMsg msg={error} />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1.75rem', flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: navy, margin: 0 }}>Sinistros</h1>
              <p style={{ fontSize: '0.82rem', color: '#64748B', marginTop: '0.3rem' }}>
                {claims.length} sinistro{claims.length !== 1 ? 's' : ''} registado{claims.length !== 1 ? 's' : ''}
              </p>
            </div>
            {clientId && (
              <button
                onClick={() => setShowForm(s => !s)}
                style={{ padding: '0.6rem 1.2rem', background: showForm ? '#E2E8F0' : gold, color: showForm ? '#475569' : navy, fontWeight: 700, fontSize: '0.82rem', border: 'none', borderRadius: 6, cursor: 'pointer', letterSpacing: '0.02em' }}
              >
                {showForm ? 'Cancelar' : 'Novo Sinistro'}
              </button>
            )}
          </div>

          {showForm && (
            <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, padding: '1.5rem', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: navy, marginTop: 0, marginBottom: '1.25rem' }}>Novo Sinistro</h2>
              <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <FieldLabel>Apólice Associada</FieldLabel>
                  <select value={form.policyId} onChange={e => update('policyId', e.target.value)} style={selectStyle}>
                    <option value="">Selecionar apólice (opcional)</option>
                    {policies.map(p => (
                      <option key={p.id} value={p.id}>
                        {TYPE_LABELS[p.type] ?? p.type} · {p.insurer}{p.policy_number ? ` · ${p.policy_number}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <FieldLabel>Título *</FieldLabel>
                  <input value={form.title} onChange={e => update('title', e.target.value)} required placeholder="Resumo do sinistro" style={inputStyle} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <FieldLabel>Descrição *</FieldLabel>
                  <textarea value={form.description} onChange={e => update('description', e.target.value)} required rows={3} placeholder="Descrição detalhada do ocorrido" style={{ ...inputStyle, resize: 'vertical' }} />
                </div>
                <div>
                  <FieldLabel>Data do Incidente *</FieldLabel>
                  <input type="date" value={form.incidentDate} onChange={e => update('incidentDate', e.target.value)} required style={inputStyle} />
                </div>
                <div>
                  <FieldLabel>Valor Estimado (EUR)</FieldLabel>
                  <input type="number" min="0" step="0.01" value={form.estimatedValue} onChange={e => update('estimatedValue', e.target.value)} placeholder="0.00" style={inputStyle} />
                </div>
                {formError && (
                  <div style={{ gridColumn: '1 / -1', padding: '0.65rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 4, color: '#B91C1C', fontSize: '0.78rem' }}>
                    {formError}
                  </div>
                )}
                <div style={{ gridColumn: '1 / -1' }}>
                  <button type="submit" disabled={submitting} style={{ padding: '0.65rem 1.5rem', background: submitting ? '#e5c97a' : gold, color: navy, fontWeight: 700, fontSize: '0.83rem', border: 'none', borderRadius: 4, cursor: submitting ? 'not-allowed' : 'pointer' }}>
                    {submitting ? 'A submeter...' : 'Submeter Sinistro'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {claims.length === 0 ? (
            <EmptyState msg="Sem sinistros registados." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {claims.map(c => <ClaimCard key={c.id} claim={c} />)}
            </div>
          )}
        </>
      )}
    </OneLayout>
  )
}

function ClaimCard({ claim }: { claim: Claim }) {
  const [expanded, setExpanded] = useState(false)
  const [ops, setOps] = useState<ClaimOperationalData | null>(null)
  const [loadingOps, setLoadingOps] = useState(false)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const st = CLAIM_STATUS[claim.status] ?? { bg: '#F3F4F6', color: '#6B7280', label: claim.status }

  async function loadOps() {
    setLoadingOps(true)
    try {
      const data = await fetchClaimWorkspace({ data: { claimId: claim.id } })
      setOps((data as any).operations ?? null)
    } catch (error) {
      console.error('[OneClaims] fetchClaimWorkspace error:', error)
      setOps(null)
    } finally {
      setLoadingOps(false)
    }
  }

  useEffect(() => {
    if (expanded) loadOps()
  }, [expanded])

  return (
    <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '1rem 1.25rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: navy }}>{claim.title}</span>
            <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '0.15rem 0.55rem', borderRadius: 20, background: st.bg, color: st.color }}>{st.label}</span>
          </div>
          <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '0.2rem 0 0' }}>
            Incidente: {formatDate(claim.incident_date)}
          </p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {claim.estimated_value > 0 && (
            <p style={{ fontSize: '0.9rem', fontWeight: 700, color: navy, margin: 0 }}>
              {formatCurrency(claim.estimated_value)}
            </p>
          )}
          <p style={{ fontSize: '0.7rem', color: '#94A3B8', margin: '0.1rem 0 0' }}>
            Submetido: {formatDate(claim.claim_date)}
          </p>
        </div>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid #F1F5F9', padding: '0.85rem 1.25rem', background: '#F8FAFC', display: 'grid', gap: '0.9rem' }}>
          {claim.description && (
            <div>
              <p style={{ fontSize: '0.62rem', fontWeight: 600, color: '#94A3B8', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 0.25rem' }}>Descrição</p>
              <p style={{ fontSize: '0.82rem', color: navy, margin: 0, lineHeight: 1.5 }}>{claim.description}</p>
            </div>
          )}

          <div>
            <p style={{ fontSize: '0.62rem', fontWeight: 600, color: '#94A3B8', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 0.5rem' }}>Documentos</p>
            {loadingOps ? (
              <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>A carregar...</p>
            ) : (
              <>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 0.75rem', background: navy, color: '#fff', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', marginBottom: '0.6rem' }}>
                  {uploading ? 'A carregar...' : 'Adicionar ficheiro'}
                  <input
                    type="file"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      setUploading(true)
                      try {
                        const storagePath = `claims/${claim.id}/${Date.now()}-${file.name}`
                        const { error } = await supabase.storage.from('documents').upload(storagePath, file)
                        if (error) throw error
                        await registerClaimDocument({
                          data: {
                            claimId: claim.id,
                            name: file.name,
                            contentType: file.type || 'application/octet-stream',
                            storagePath,
                            size: file.size,
                          },
                        })
                        await loadOps()
                      } catch (error) {
                        console.error('[OneClaims] registerClaimDocument error:', error)
                      } finally {
                        setUploading(false)
                        e.target.value = ''
                      }
                    }}
                  />
                </label>
                {ops?.documents?.length ? (
                  <div style={{ display: 'grid', gap: '0.45rem' }}>
                    {ops.documents.map((doc) => (
                      <div key={doc.id} style={{ padding: '0.55rem 0.65rem', border: '1px solid #E2E8F0', borderRadius: 6, display: 'flex', justifyContent: 'space-between', gap: '0.8rem', alignItems: 'center' }}>
                        <div>
                          <p style={{ fontSize: '0.78rem', color: navy, margin: 0, fontWeight: 600 }}>{doc.name}</p>
                          <p style={{ fontSize: '0.68rem', color: '#94A3B8', margin: '0.1rem 0 0' }}>{formatDateTime(doc.uploadedAt)} · {doc.uploadedByName}</p>
                        </div>
                        <button
                          onClick={async () => {
                            const { url, name } = await getClaimDocumentUrl({ data: { claimId: claim.id, documentId: doc.id } })
                            const a = document.createElement('a')
                            a.href = url
                            a.download = name
                            a.click()
                          }}
                          style={{ border: '1px solid #CBD5E1', background: '#fff', color: '#334155', borderRadius: 4, padding: '0.3rem 0.6rem', fontSize: '0.72rem', cursor: 'pointer' }}
                        >
                          Download
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>Sem documentos neste sinistro.</p>
                )}
              </>
            )}
          </div>

          <div>
            <p style={{ fontSize: '0.62rem', fontWeight: 600, color: '#94A3B8', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 0.5rem' }}>Mensagens</p>
            {ops?.messages?.length ? (
              <div style={{ display: 'grid', gap: '0.45rem', marginBottom: '0.65rem', maxHeight: 220, overflowY: 'auto' }}>
                {ops.messages.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: '0.55rem 0.65rem',
                      border: item.senderRole === 'client' ? '1px solid #BFDBFE' : '1px solid #FDE68A',
                      background: item.senderRole === 'client' ? '#EFF6FF' : '#FFFBEB',
                      borderRadius: 6,
                    }}
                  >
                    <p style={{ fontSize: '0.78rem', color: navy, margin: 0 }}>{item.body}</p>
                    <p style={{ fontSize: '0.68rem', color: '#94A3B8', margin: '0.18rem 0 0' }}>{item.senderName} · {formatDateTime(item.createdAt)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: '0 0 0.65rem' }}>Ainda sem mensagens.</p>
            )}
            <div style={{ display: 'flex', gap: '0.45rem' }}>
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Escreva a sua resposta..."
                style={{ ...inputStyle, flex: 1, padding: '0.5rem 0.65rem', fontSize: '0.78rem' }}
              />
              <button
                onClick={async () => {
                  if (!message.trim()) return
                  setSending(true)
                  try {
                    await addClaimMessage({ data: { claimId: claim.id, body: message } })
                    setMessage('')
                    await loadOps()
                  } finally {
                    setSending(false)
                  }
                }}
                disabled={sending}
                style={{ padding: '0.5rem 0.8rem', border: 'none', background: gold, color: navy, borderRadius: 4, fontSize: '0.74rem', fontWeight: 700, cursor: sending ? 'not-allowed' : 'pointer' }}
              >
                {sending ? '...' : 'Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 600, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.3rem' }}>{children}</label>
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.85rem',
  border: '1px solid #E2E8F0', borderRadius: 4, outline: 'none',
  color: '#111', boxSizing: 'border-box', fontFamily: "'Montserrat', sans-serif",
}

const selectStyle: React.CSSProperties = { ...inputStyle, background: '#fff' }

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
