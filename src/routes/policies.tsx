import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { fetchPolicies, createPolicy, updatePolicy, deletePolicy } from '@/lib/server-fns'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Policy } from '@/lib/types'
import { POLICY_TYPE_LABELS } from '@/lib/types'
import { useState, useEffect, useRef } from 'react'
import { getServerUser } from '@/lib/auth'

export const Route = createFileRoute('/policies')({
  beforeLoad: async () => {
    const user = await getServerUser()
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  component: PoliciesPage,
})

const POLICY_TYPE_COLORS: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  auto:                  { bg: '#EFF6FF', text: '#1D4ED8', dot: '#3B82F6', border: '#BFDBFE' },
  health:                { bg: '#F0FDF4', text: '#166534', dot: '#22C55E', border: '#BBF7D0' },
  property:              { bg: '#FFF7ED', text: '#9A3412', dot: '#F97316', border: '#FED7AA' },
  liability:             { bg: '#FDF4FF', text: '#7E22CE', dot: '#A855F7', border: '#E9D5FF' },
  workers_comp:          { bg: '#FFF1F2', text: '#9F1239', dot: '#F43F5E', border: '#FECDD3' },
  cyber:                 { bg: '#F0F9FF', text: '#0C4A6E', dot: '#0EA5E9', border: '#BAE6FD' },
  directors_officers:    { bg: '#FAFAF9', text: '#44403C', dot: '#78716C', border: '#E7E5E4' },
  business_interruption: { bg: '#FFFBEB', text: '#92400E', dot: '#F59E0B', border: '#FDE68A' },
  life:                  { bg: '#F0FDF4', text: '#14532D', dot: '#16A34A', border: '#BBF7D0' },
  other:                 { bg: '#F8F8F8', text: '#444444', dot: '#999999', border: '#E5E5E5' },
}

const POLICY_TYPE_ICONS: Record<string, string> = {
  auto: '🚗', health: '🏥', property: '🏠', liability: '⚖️',
  workers_comp: '👷', cyber: '🔐', directors_officers: '👔',
  business_interruption: '🏭', life: '❤️', other: '📋',
}

function daysUntil(dateStr: string): number {
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function statusLabel(s: string): string {
  const m: Record<string, string> = { active: 'Activa', expiring: 'A Expirar', expired: 'Expirada', cancelled: 'Cancelada' }
  return m[s] || s
}

const inputStyle: React.CSSProperties = {
  width: '100%', fontFamily: "'Montserrat', sans-serif", fontSize: '0.82rem',
  padding: '0.55rem 0.75rem', border: '1px solid #dddddd', borderRadius: '4px',
  background: '#ffffff', color: '#111111', boxSizing: 'border-box',
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.68rem', fontWeight: 600, color: '#777777', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>
        {label}{required && <span style={{ color: '#C8961A', marginLeft: '2px' }}>*</span>}
      </label>
      {children}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const m: Record<string, { bg: string; color: string }> = {
    active: { bg: '#EAF3DE', color: '#3B6D11' }, expiring: { bg: '#FAEEDA', color: '#854F0B' },
    expired: { bg: '#FEE2E2', color: '#991B1B' }, cancelled: { bg: '#F3F4F6', color: '#6B7280' },
  }
  const s = m[status] || { bg: '#F3F4F6', color: '#6B7280' }
  return <span style={{ display: 'inline-block', fontFamily: "'Montserrat', sans-serif", fontSize: '0.65rem', fontWeight: 600, padding: '0.15rem 0.5rem', borderRadius: '20px', background: s.bg, color: s.color }}>{statusLabel(status)}</span>
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.62rem', color: '#aaaaaa', margin: 0, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>{label}</p>
      <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem', fontWeight: 600, color: '#333333', margin: 0 }}>{value}</p>
    </div>
  )
}

function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards')
  const [selected, setSelected] = useState<Policy | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [formData, setFormData] = useState<any>({})
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = () => { setLoading(true); fetchPolicies().then((p) => { setPolicies(p); setLoading(false) }) }
  useEffect(() => { load() }, [])

  const filtered = policies.filter((p) =>
    (typeFilter === 'all' || p.type === typeFilter) && (statusFilter === 'all' || p.status === statusFilter)
  )

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setUploading(true); setUploadError(null)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch('/api/extract-policy', { method: 'POST', body: fd })
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('application/json')) throw new Error('O servidor devolveu uma resposta inesperada. Tente novamente.')
      const result = await res.json()
      if (!res.ok) {
        console.error('[extract-policy] erro:', result.error, '| detalhes:', result.details)
        throw new Error(result.error || 'Erro ao processar ficheiro.')
      }
      setFormData({ ...result, description: `Apólice extraída de ${file.name}` })
      setShowForm(true)
    } catch (err: any) { setUploadError(err.message) }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true)
    try {
      if (editMode && selected) await updatePolicy({ data: { id: selected.id, updates: formData } })
      else await createPolicy({ data: { ...formData, companyId: 'comp_001' } })
      setShowForm(false); setEditMode(false); setSelected(null); load()
    } catch { alert('Erro ao guardar apólice'); setLoading(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Tem a certeza que deseja eliminar esta apólice?')) return
    setLoading(true)
    try { await deletePolicy({ data: id }); setSelected(null); load() }
    catch { alert('Erro ao eliminar apólice'); setLoading(false) }
  }

  const openEdit = (p: Policy) => { setFormData(p); setEditMode(true); setShowForm(true); setSelected(p) }

  const selectStyle: React.CSSProperties = { fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem', padding: '0.45rem 0.75rem', border: '1px solid #dddddd', borderRadius: '4px', background: '#ffffff', color: '#333333' }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap' as const, gap: '0.75rem' }}>
          <div>
            <h1 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '1.4rem', color: '#111111', margin: 0 }}>Portfólio de Apólices</h1>
            <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.85rem', color: '#888888', marginTop: '0.25rem' }}>{policies.length} apólice{policies.length !== 1 ? 's' : ''} registada{policies.length !== 1 ? 's' : ''}</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' as const }}>
            <label style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.82rem', padding: '0.6rem 1rem', background: uploading ? '#cccccc' : '#C8961A', color: '#ffffff', border: 'none', borderRadius: '4px', cursor: uploading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {uploading
                ? <><span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />A extrair...</>
                : <>✦ Extrair via IA</>}
              <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={handleUpload} style={{ display: 'none' }} disabled={uploading} />
            </label>
            <button onClick={() => { setFormData({}); setEditMode(false); setShowForm(true) }} style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.82rem', padding: '0.6rem 1rem', background: '#111111', color: '#ffffff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>+ Adicionar</button>
          </div>
        </div>

        {uploadError && (
          <div style={{ background: '#fff5f5', border: '1px solid #fecaca', borderRadius: '4px', padding: '0.75rem 1rem', marginBottom: '1rem', fontFamily: "'Montserrat', sans-serif", fontSize: '0.82rem', color: '#dc2626', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>⚠️ {uploadError}</span>
            <button onClick={() => setUploadError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: '1rem' }}>×</button>
          </div>
        )}

        {/* Filters + View toggle */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' as const, alignItems: 'center' }}>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={selectStyle}>
            <option value="all">Todos os tipos</option>
            {Object.entries(POLICY_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
            <option value="all">Todos os estados</option>
            <option value="active">Activa</option>
            <option value="expiring">A Expirar</option>
            <option value="expired">Expirada</option>
            <option value="cancelled">Cancelada</option>
          </select>
          <div style={{ marginLeft: 'auto', display: 'flex', border: '1px solid #dddddd', borderRadius: '4px', overflow: 'hidden' }}>
            <button onClick={() => setViewMode('cards')} style={{ padding: '0.4rem 0.65rem', background: viewMode === 'cards' ? '#111111' : '#ffffff', color: viewMode === 'cards' ? '#ffffff' : '#666666', border: 'none', cursor: 'pointer' }}>
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
            </button>
            <button onClick={() => setViewMode('list')} style={{ padding: '0.4rem 0.65rem', background: viewMode === 'list' ? '#111111' : '#ffffff', color: viewMode === 'list' ? '#ffffff' : '#666666', border: 'none', cursor: 'pointer' }}>
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
            </button>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
            <div style={{ width: '32px', height: '32px', border: '3px solid #eeeeee', borderTopColor: '#C8961A', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', padding: '3rem', textAlign: 'center' as const }}>
            <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.9rem', color: '#aaaaaa', marginBottom: '0.5rem' }}>{policies.length === 0 ? 'Ainda não tem apólices registadas.' : 'Nenhuma apólice encontrada.'}</p>
            {policies.length === 0 && <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem', color: '#cccccc' }}>Use "Extrair via IA" para carregar um PDF ou imagem de uma apólice.</p>}
          </div>
        ) : viewMode === 'cards' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
            {filtered.map((policy) => {
              const c = POLICY_TYPE_COLORS[policy.type] || POLICY_TYPE_COLORS.other
              const icon = POLICY_TYPE_ICONS[policy.type] || '📋'
              const days = daysUntil(policy.endDate)
              const isSel = selected?.id === policy.id
              return (
                <div key={policy.id} onClick={() => setSelected(isSel ? null : policy)} style={{ background: '#ffffff', border: isSel ? `2px solid ${c.dot}` : `1px solid ${days >= 0 && days <= 30 ? '#FECDD3' : '#eeeeee'}`, borderRadius: '4px', overflow: 'hidden', cursor: 'pointer', boxShadow: isSel ? `0 0 0 3px ${c.dot}22` : 'none', transition: 'box-shadow 0.15s' }}>
                  <div style={{ background: c.bg, padding: '1rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ fontSize: '1.4rem' }}>{icon}</span>
                      <div>
                        <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.82rem', color: c.text, margin: 0 }}>{POLICY_TYPE_LABELS[policy.type] || policy.type}</p>
                        <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.72rem', color: c.text, opacity: 0.8, margin: 0 }}>{policy.insurer}</p>
                      </div>
                    </div>
                    <StatusBadge status={policy.status} />
                  </div>
                  <div style={{ padding: '0.85rem 1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <div>
                        <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.62rem', color: '#aaaaaa', margin: 0 }}>N.º Apólice</p>
                        <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.8rem', color: '#333333', margin: 0 }}>{policy.policyNumber || '—'}</p>
                      </div>
                      <div style={{ textAlign: 'right' as const }}>
                        <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.62rem', color: '#aaaaaa', margin: 0 }}>Prémio Anual</p>
                        <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.9rem', color: '#111111', margin: 0 }}>{formatCurrency(policy.annualPremium)}</p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', color: '#888888', margin: 0 }}>Válida até {formatDate(policy.endDate)}</p>
                      {days >= 0 && days <= 90 && (
                        <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.65rem', fontWeight: 700, color: days <= 14 ? '#dc2626' : days <= 30 ? '#d97706' : '#C8961A', background: days <= 14 ? '#FEE2E2' : days <= 30 ? '#FEF3C7' : '#FFFBEB', padding: '0.15rem 0.5rem', borderRadius: '20px' }}>{days}d</span>
                      )}
                    </div>
                  </div>
                  {isSel && (
                    <div style={{ borderTop: `1px solid ${c.border}`, padding: '0.85rem 1rem', background: '#fafafa' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        <DetailItem label="Capital Segurado" value={policy.insuredValue > 0 ? formatCurrency(policy.insuredValue) : 'N/A'} />
                        {policy.deductible ? <DetailItem label="Franquia" value={formatCurrency(policy.deductible)} /> : <div />}
                        <DetailItem label="Início" value={formatDate(policy.startDate)} />
                        <DetailItem label="Fim" value={formatDate(policy.endDate)} />
                      </div>
                      {policy.coverages && policy.coverages.length > 0 && (
                        <div style={{ marginBottom: '0.5rem' }}>
                          <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.62rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase' as const, letterSpacing: '0.08em', margin: '0 0 0.3rem' }}>Coberturas</p>
                          <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                            {policy.coverages.slice(0, 3).map((cov: string, i: number) => <li key={i} style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', color: '#555555', marginBottom: '0.15rem' }}>{cov}</li>)}
                            {policy.coverages.length > 3 && <li style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', color: '#aaaaaa' }}>+{policy.coverages.length - 3} mais</li>}
                          </ul>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' as const }}>
                        {policy.documentKey && <a href={`/api/download-document?key=${encodeURIComponent(policy.documentKey)}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', fontWeight: 600, padding: '0.35rem 0.7rem', background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE', borderRadius: '4px', textDecoration: 'none' }}>Ver Documento</a>}
                        <button onClick={(e) => { e.stopPropagation(); openEdit(policy) }} style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', fontWeight: 600, padding: '0.35rem 0.7rem', background: '#ffffff', color: '#333333', border: '1px solid #dddddd', borderRadius: '4px', cursor: 'pointer' }}>Editar</button>
                        <button onClick={(e) => { e.stopPropagation(); handleDelete(policy.id) }} style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', fontWeight: 600, padding: '0.35rem 0.7rem', background: '#FFF1F2', color: '#9F1239', border: '1px solid #FECDD3', borderRadius: '4px', cursor: 'pointer' }}>Eliminar</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', overflow: 'hidden' }}>
            {filtered.map((policy, idx) => {
              const c = POLICY_TYPE_COLORS[policy.type] || POLICY_TYPE_COLORS.other
              const icon = POLICY_TYPE_ICONS[policy.type] || '📋'
              const days = daysUntil(policy.endDate)
              const isSel = selected?.id === policy.id
              return (
                <div key={policy.id} style={{ borderBottom: idx < filtered.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
                  <div onClick={() => setSelected(isSel ? null : policy)} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1.25rem', cursor: 'pointer', background: isSel ? '#fafafa' : 'transparent' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '4px', background: c.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '1.1rem' }}>{icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.82rem', color: '#111111', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{POLICY_TYPE_LABELS[policy.type] || policy.type} — {policy.insurer}</p>
                      <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.72rem', color: '#888888', margin: 0 }}>{policy.policyNumber} · Válida até {formatDate(policy.endDate)}</p>
                    </div>
                    <div style={{ textAlign: 'right' as const, flexShrink: 0 }}>
                      <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.85rem', color: '#111111', margin: 0 }}>{formatCurrency(policy.annualPremium)}</p>
                      <StatusBadge status={policy.status} />
                    </div>
                    {days >= 0 && days <= 90 && <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.65rem', fontWeight: 700, color: days <= 30 ? '#dc2626' : '#C8961A', background: days <= 30 ? '#FEE2E2' : '#FFFBEB', padding: '0.15rem 0.5rem', borderRadius: '20px', flexShrink: 0 }}>{days}d</span>}
                  </div>
                  {isSel && (
                    <div style={{ padding: '0.85rem 1.25rem 1rem', background: '#fafafa', borderTop: '1px solid #f0f0f0' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                        <DetailItem label="Capital Segurado" value={policy.insuredValue > 0 ? formatCurrency(policy.insuredValue) : 'N/A'} />
                        {policy.deductible ? <DetailItem label="Franquia" value={formatCurrency(policy.deductible)} /> : null}
                        <DetailItem label="Início" value={formatDate(policy.startDate)} />
                        <DetailItem label="Fim" value={formatDate(policy.endDate)} />
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' as const }}>
                        {policy.documentKey && <a href={`/api/download-document?key=${encodeURIComponent(policy.documentKey)}`} target="_blank" rel="noreferrer" style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', fontWeight: 600, padding: '0.35rem 0.7rem', background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE', borderRadius: '4px', textDecoration: 'none' }}>Ver Documento</a>}
                        <button onClick={() => openEdit(policy)} style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', fontWeight: 600, padding: '0.35rem 0.7rem', background: '#ffffff', color: '#333333', border: '1px solid #dddddd', borderRadius: '4px', cursor: 'pointer' }}>Editar</button>
                        <button onClick={() => handleDelete(policy.id)} style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', fontWeight: 600, padding: '0.35rem 0.7rem', background: '#FFF1F2', color: '#9F1239', border: '1px solid #FECDD3', borderRadius: '4px', cursor: 'pointer' }}>Eliminar</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal Add/Edit */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: '#ffffff', borderRadius: '4px', width: '100%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #eeeeee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '1rem', color: '#111111', margin: 0 }}>{editMode ? 'Editar Apólice' : 'Nova Apólice'}</h2>
              <button onClick={() => { setShowForm(false); setEditMode(false); setFormData({}) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888888', fontSize: '1.25rem', lineHeight: 1 }}>×</button>
            </div>
            {formData.description?.includes('extraída') && (
              <div style={{ margin: '1rem 1.5rem 0', padding: '0.75rem 1rem', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '4px' }}>
                <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', fontWeight: 600, color: '#166534', margin: '0 0 0.25rem' }}>✦ Dados extraídos via IA</p>
                <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', color: '#555555', margin: 0 }}>Capital: {formatCurrency(formData.insuredValue || 0)} · Prémio: {formatCurrency(formData.annualPremium || 0)} · Franquia: {formatCurrency(formData.deductible || 0)}</p>
              </div>
            )}
            <form onSubmit={handleSave} style={{ padding: '1.25rem 1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <FormField label="Tipo de Seguro" required>
                  <select value={formData.type || ''} onChange={(e) => setFormData({ ...formData, type: e.target.value })} required style={inputStyle}>
                    <option value="">Seleccionar tipo...</option>
                    {Object.entries(POLICY_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </FormField>
              </div>
              <FormField label="Seguradora" required><input type="text" value={formData.insurer || ''} onChange={(e) => setFormData({ ...formData, insurer: e.target.value })} required style={inputStyle} placeholder="Ex: Fidelidade" /></FormField>
              <FormField label="N.º Apólice"><input type="text" value={formData.policyNumber || ''} onChange={(e) => setFormData({ ...formData, policyNumber: e.target.value })} style={inputStyle} /></FormField>
              <FormField label="Data de Início" required><input type="date" value={formData.startDate || ''} onChange={(e) => setFormData({ ...formData, startDate: e.target.value })} required style={inputStyle} /></FormField>
              <FormField label="Data de Fim" required><input type="date" value={formData.endDate || ''} onChange={(e) => setFormData({ ...formData, endDate: e.target.value })} required style={inputStyle} /></FormField>
              <FormField label="Prémio Anual (€)"><input type="number" value={formData.annualPremium || ''} onChange={(e) => setFormData({ ...formData, annualPremium: parseFloat(e.target.value) || 0 })} style={inputStyle} placeholder="0.00" min="0" step="0.01" /></FormField>
              <FormField label="Capital Segurado (€)"><input type="number" value={formData.insuredValue || ''} onChange={(e) => setFormData({ ...formData, insuredValue: parseFloat(e.target.value) || 0 })} style={inputStyle} placeholder="0.00" min="0" step="0.01" /></FormField>
              <div style={{ gridColumn: '1 / -1' }}>
                <FormField label="Descrição"><input type="text" value={formData.description || ''} onChange={(e) => setFormData({ ...formData, description: e.target.value })} style={inputStyle} /></FormField>
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', paddingTop: '0.5rem' }}>
                <button type="button" onClick={() => { setShowForm(false); setEditMode(false); setFormData({}) }} style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.85rem', padding: '0.65rem 1.25rem', background: '#f5f5f5', color: '#555555', border: '1px solid #dddddd', borderRadius: '4px', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.85rem', padding: '0.65rem 1.25rem', background: '#111111', color: '#ffffff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>{editMode ? 'Guardar Alterações' : 'Criar Apólice'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </AppLayout>
  )
}
