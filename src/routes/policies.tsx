import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import {
  fetchPolicies,
  fetchClaims,
  fetchPolicyListPreferences,
  savePolicyListPreferences,
  createPolicy,
  updatePolicy,
  deletePolicy,
} from '@/lib/server-fns'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Claim, Policy } from '@/lib/types'
import { POLICY_TYPE_LABELS } from '@/lib/types'
import { useState, useEffect, useRef, useMemo } from 'react'
import { getServerUser } from '@/lib/auth'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/policies')({
  beforeLoad: async () => {
    const user = await getServerUser()
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  component: PoliciesPage,
})

const POLICY_TYPE_COLORS: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  auto: { bg: '#EFF6FF', text: '#1D4ED8', dot: '#3B82F6', border: '#BFDBFE' },
  health: { bg: '#F0FDF4', text: '#166534', dot: '#22C55E', border: '#BBF7D0' },
  property: { bg: '#FFF7ED', text: '#9A3412', dot: '#F97316', border: '#FED7AA' },
  liability: { bg: '#FDF4FF', text: '#7E22CE', dot: '#A855F7', border: '#E9D5FF' },
  workers_comp: { bg: '#FFF1F2', text: '#9F1239', dot: '#F43F5E', border: '#FECDD3' },
  cyber: { bg: '#F0F9FF', text: '#0C4A6E', dot: '#0EA5E9', border: '#BAE6FD' },
  directors_officers: { bg: '#FAFAF9', text: '#44403C', dot: '#78716C', border: '#E7E5E4' },
  business_interruption: { bg: '#FFFBEB', text: '#92400E', dot: '#F59E0B', border: '#FDE68A' },
  life: { bg: '#F0FDF4', text: '#14532D', dot: '#16A34A', border: '#BBF7D0' },
  other: { bg: '#F8F8F8', text: '#444444', dot: '#999999', border: '#E5E5E5' },
}

const POLICY_TYPE_ICONS: Record<string, string> = {
  auto: '🚗', health: '🏥', property: '🏠', liability: '⚖️',
  workers_comp: '👷', cyber: '🔐', directors_officers: '👔',
  business_interruption: '🏭', life: '❤️', other: '📋',
}

type PortfolioHealthFilter = 'all' | 'active' | 'renewal' | 'critical'

type RiskLevel = 'low' | 'medium' | 'high'
type UrgencyTone = 'critical' | 'attention' | 'normal'
type RequiredAction = 'renew' | 'add_documents' | 'view_claim' | 'none'
type BulkAction = 'mark_renewal' | 'share_enable' | 'share_disable'

type PolicyListPreferences = {
  typeFilter: string
  statusFilter: string
  insurerFilter: string
  searchTerm: string
  portfolioFilter: PortfolioHealthFilter
}

const DEFAULT_POLICY_LIST_PREFERENCES: PolicyListPreferences = {
  typeFilter: 'all',
  statusFilter: 'all',
  insurerFilter: 'all',
  searchTerm: '',
  portfolioFilter: 'all',
}

function daysUntil(dateStr: string): number {
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function getRenewalDays(policy: Policy): number {
  return daysUntil(policy.renewalDate || policy.endDate)
}

function statusLabel(s: string, t: (k: string) => string): string {
  const m: Record<string, string> = {
    active: t('policies.statusActive'), expiring: t('policies.statusExpiring'),
    expired: t('policies.statusExpired'), cancelled: t('policies.statusCancelled'),
  }
  return m[s] || s
}

function getRiskLevel(policy: Policy): RiskLevel {
  const days = getRenewalDays(policy)
  const premium = policy.annualPremium || 0
  if (policy.status === 'expired' || days <= 15 || (days <= 30 && premium >= 10000)) return 'high'
  if (policy.status === 'expiring' || days <= 60 || premium >= 20000) return 'medium'
  return 'low'
}

function getUrgencyTone(policy: Policy): UrgencyTone {
  const risk = getRiskLevel(policy)
  if (risk === 'high') return 'critical'
  if (risk === 'medium') return 'attention'
  return 'normal'
}

function getRequiredAction(policy: Policy, hasOpenClaim: boolean): RequiredAction {
  const renewalDays = getRenewalDays(policy)
  if (policy.status === 'expired' || policy.status === 'expiring' || renewalDays <= 30) return 'renew'
  if (!policy.documentKey) return 'add_documents'
  if (hasOpenClaim) return 'view_claim'
  return 'none'
}

function getPriorityScore(policy: Policy): number {
  const days = getRenewalDays(policy)
  const premium = Math.max(0, policy.annualPremium || 0)
  const urgencyMultiplier = days <= 0
    ? 2.5
    : days <= 15
      ? 2.2
      : days <= 30
        ? 1.8
        : days <= 60
          ? 1.45
          : days <= 90
            ? 1.2
            : 1

  const statusBoost = policy.status === 'expiring' ? 8000 : policy.status === 'expired' ? 12000 : 0
  const daysBoost = days > 0 ? Math.max(0, 400 - days) : 450

  return premium * urgencyMultiplier + statusBoost + daysBoost
}

function compareByPriority(a: Policy, b: Policy): number {
  const scoreDiff = getPriorityScore(b) - getPriorityScore(a)
  if (scoreDiff !== 0) return scoreDiff

  const daysDiff = getRenewalDays(a) - getRenewalDays(b)
  if (daysDiff !== 0) return daysDiff

  return (a.policyNumber || '').localeCompare(b.policyNumber || '')
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
  const { t } = useTranslation()
  const m: Record<string, { bg: string; color: string }> = {
    active: { bg: '#EAF3DE', color: '#3B6D11' }, expiring: { bg: '#FAEEDA', color: '#854F0B' },
    expired: { bg: '#FEE2E2', color: '#991B1B' }, cancelled: { bg: '#F3F4F6', color: '#6B7280' },
  }
  const s = m[status] || { bg: '#F3F4F6', color: '#6B7280' }
  return <span style={{ display: 'inline-block', fontFamily: "'Montserrat', sans-serif", fontSize: '0.65rem', fontWeight: 600, padding: '0.15rem 0.5rem', borderRadius: '20px', background: s.bg, color: s.color }}>{statusLabel(status, t)}</span>
}

function RiskBadge({ level, t }: { level: RiskLevel; t: (k: string) => string }) {
  const map: Record<RiskLevel, { bg: string; color: string; label: string }> = {
    high: { bg: '#FEE2E2', color: '#B91C1C', label: t('policies.riskHigh') },
    medium: { bg: '#FEF3C7', color: '#B45309', label: t('policies.riskMedium') },
    low: { bg: '#DCFCE7', color: '#166534', label: t('policies.riskLow') },
  }
  const style = map[level]

  return (
    <span style={{ display: 'inline-block', fontFamily: "'Montserrat', sans-serif", fontSize: '0.65rem', fontWeight: 700, padding: '0.18rem 0.52rem', borderRadius: '999px', background: style.bg, color: style.color }}>
      {style.label}
    </span>
  )
}

function ActionBadge({ action, t }: { action: RequiredAction; t: (k: string) => string }) {
  const map: Record<RequiredAction, { bg: string; color: string; label: string }> = {
    renew: { bg: '#FEF2F2', color: '#991B1B', label: t('policies.requiredActionRenew') },
    add_documents: { bg: '#FFFBEB', color: '#92400E', label: t('policies.requiredActionAddDocuments') },
    view_claim: { bg: '#EFF6FF', color: '#1D4ED8', label: t('policies.requiredActionViewClaim') },
    none: { bg: '#F3F4F6', color: '#4B5563', label: t('policies.requiredActionNone') },
  }
  const style = map[action]
  return (
    <span style={{ display: 'inline-block', fontFamily: "'Montserrat', sans-serif", fontSize: '0.66rem', fontWeight: 700, padding: '0.18rem 0.52rem', borderRadius: '999px', background: style.bg, color: style.color }}>
      {style.label}
    </span>
  )
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.62rem', color: '#aaaaaa', margin: 0, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>{label}</p>
      <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem', fontWeight: 600, color: '#333333', margin: 0 }}>{value}</p>
    </div>
  )
}

function PortfolioPill({ active, onClick, label, value, tone }: { active: boolean; onClick: () => void; label: string; value: number; tone: 'green' | 'amber' | 'red' }) {
  const palette = {
    green: { bg: '#F0FDF4', border: '#BBF7D0', text: '#166534' },
    amber: { bg: '#FFFBEB', border: '#FDE68A', text: '#92400E' },
    red: { bg: '#FEF2F2', border: '#FECACA', text: '#991B1B' },
  }[tone]

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${active ? '#1f2937' : palette.border}`,
        background: active ? '#111827' : palette.bg,
        color: active ? '#ffffff' : palette.text,
        borderRadius: '999px',
        padding: '0.42rem 0.8rem',
        fontFamily: "'Montserrat', sans-serif",
        fontSize: '0.75rem',
        fontWeight: 700,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        cursor: 'pointer',
      }}
    >
      <span>{label}</span>
      <span style={{ opacity: active ? 0.95 : 0.8 }}>{value}</span>
    </button>
  )
}

function PolicyDetailModal({ policy, onClose, onEdit, onDelete, formatCurrency, formatDate, t }: {
  policy: Policy
  onClose: () => void
  onEdit: (p: Policy) => void
  onDelete: (id: string) => void
  formatCurrency: (v: number) => string
  formatDate: (s: string) => string
  t: (k: string, opts?: any) => string
}) {
  const c = POLICY_TYPE_COLORS[policy.type] || POLICY_TYPE_COLORS.other
  const icon = POLICY_TYPE_ICONS[policy.type] || '📋'
  const days = getRenewalDays(policy)

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#ffffff', borderRadius: '4px', width: '100%', maxWidth: '640px', maxHeight: '92vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ background: c.bg, padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', borderBottom: `1px solid ${c.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.75rem' }}>{icon}</span>
            <div>
              <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '1rem', color: c.text, margin: 0 }}>{POLICY_TYPE_LABELS[policy.type] || policy.type}</p>
              <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 400, fontSize: '0.82rem', color: c.text, opacity: 0.8, margin: 0 }}>{policy.insurer}</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <StatusBadge status={policy.status} />
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888888', fontSize: '1.4rem', lineHeight: 1, padding: '0.1rem 0.25rem' }}>×</button>
          </div>
        </div>

        <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1.25rem' }}>
            <DetailItem label={t('policies.policyNumber')} value={policy.policyNumber || '—'} />
            <DetailItem label={t('policies.annualPremium')} value={formatCurrency(policy.annualPremium)} />
            <DetailItem label={t('policies.insuredValue')} value={policy.insuredValue > 0 ? formatCurrency(policy.insuredValue) : '—'} />
            <DetailItem label={t('policies.deductible')} value={policy.deductible ? formatCurrency(policy.deductible) : '—'} />
            <DetailItem label={t('policies.startDate')} value={formatDate(policy.startDate)} />
            <DetailItem label={t('policies.endDate')} value={
              days >= 0 && days <= 90
                ? `${formatDate(policy.endDate)} (${days}d)`
                : formatDate(policy.endDate)
            } />
          </div>

          {policy.description && (
            <div style={{ marginBottom: '1.25rem', padding: '0.75rem', background: '#f9f9f9', borderRadius: '4px', border: '1px solid #eeeeee' }}>
              <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#666666', margin: 0 }}>{policy.description}</p>
            </div>
          )}

          {policy.coverages && policy.coverages.length > 0 && (
            <div style={{ marginBottom: '1.25rem' }}>
              <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.65rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase' as const, letterSpacing: '0.08em', margin: '0 0 0.5rem' }}>
                {t('policies.coverages')} ({policy.coverages.length})
              </p>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', listStyle: 'none' }}>
                {policy.coverages.map((cov: string, i: number) => (
                  <li key={i} style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem', color: '#333333', marginBottom: '0.4rem', display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
                    <span style={{ color: '#22C55E', flexShrink: 0, marginTop: '0.1rem' }}>✓</span>
                    {cov}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {policy.exclusions && policy.exclusions.length > 0 && (
            <div style={{ marginBottom: '1.25rem' }}>
              <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.65rem', fontWeight: 700, color: '#991B1B', textTransform: 'uppercase' as const, letterSpacing: '0.08em', margin: '0 0 0.5rem' }}>
                {t('policies.exclusions')} ({policy.exclusions.length})
              </p>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', listStyle: 'none' }}>
                {policy.exclusions.map((exc: string, i: number) => (
                  <li key={i} style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem', color: '#555555', marginBottom: '0.4rem', display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
                    <span style={{ color: '#EF4444', flexShrink: 0, marginTop: '0.1rem' }}>✕</span>
                    {exc}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #eeeeee', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' as const }}>
          {policy.documentKey && (
            <a
              href={`/api/download-document?key=${encodeURIComponent(policy.documentKey)}`}
              target="_blank" rel="noreferrer"
              style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem', fontWeight: 600, padding: '0.5rem 1rem', background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE', borderRadius: '4px', textDecoration: 'none' }}
            >
              {t('policies.viewDocument')}
            </a>
          )}
          <button onClick={() => { onClose(); onEdit(policy) }} style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem', fontWeight: 600, padding: '0.5rem 1rem', background: '#ffffff', color: '#333333', border: '1px solid #dddddd', borderRadius: '4px', cursor: 'pointer' }}>
            {t('policies.edit')}
          </button>
          <button onClick={() => onDelete(policy.id)} style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem', fontWeight: 600, padding: '0.5rem 1rem', background: '#FFF1F2', color: '#9F1239', border: '1px solid #FECDD3', borderRadius: '4px', cursor: 'pointer' }}>
            {t('policies.delete')}
          </button>
          <button onClick={onClose} style={{ marginLeft: 'auto', fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem', fontWeight: 600, padding: '0.5rem 1rem', background: '#f5f5f5', color: '#555555', border: '1px solid #dddddd', borderRadius: '4px', cursor: 'pointer' }}>
            {t('policies.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

function PoliciesPage() {
  const { t } = useTranslation()
  const [policies, setPolicies] = useState<Policy[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [insurerFilter, setInsurerFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [portfolioFilter, setPortfolioFilter] = useState<PortfolioHealthFilter>('all')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [hoveredPolicyId, setHoveredPolicyId] = useState<string | null>(null)
  const [bulkActionRunning, setBulkActionRunning] = useState<BulkAction | null>(null)
  const [readyToPersistPrefs, setReadyToPersistPrefs] = useState(false)
  const [selected, setSelected] = useState<Policy | null>(null)
  const [detailPolicy, setDetailPolicy] = useState<Policy | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [formData, setFormData] = useState<any>({})
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [nextPolicies, nextClaims] = await Promise.all([fetchPolicies(), fetchClaims()])
      setPolicies(nextPolicies)
      setClaims(nextClaims)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      try {
        const [nextPolicies, nextClaims, preferences] = await Promise.all([
          fetchPolicies(),
          fetchClaims(),
          fetchPolicyListPreferences().catch(() => DEFAULT_POLICY_LIST_PREFERENCES),
        ])
        if (!mounted) return
        setPolicies(nextPolicies)
        setClaims(nextClaims)
        const safePreferences = { ...DEFAULT_POLICY_LIST_PREFERENCES, ...(preferences || {}) }
        setTypeFilter(safePreferences.typeFilter || 'all')
        setStatusFilter(safePreferences.statusFilter || 'all')
        setInsurerFilter(safePreferences.insurerFilter || 'all')
        setSearchTerm(safePreferences.searchTerm || '')
        setPortfolioFilter(safePreferences.portfolioFilter || 'all')
      } finally {
        if (mounted) {
          setLoading(false)
          setReadyToPersistPrefs(true)
        }
      }
    })()

    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!readyToPersistPrefs) return
    const timer = window.setTimeout(() => {
      savePolicyListPreferences({
        data: { typeFilter, statusFilter, insurerFilter, searchTerm, portfolioFilter },
      }).catch(() => {})
    }, 350)
    return () => window.clearTimeout(timer)
  }, [typeFilter, statusFilter, insurerFilter, searchTerm, portfolioFilter, readyToPersistPrefs])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setDetailPolicy(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const insurers = useMemo(
    () => Array.from(new Set(policies.map((policy) => policy.insurer.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [policies],
  )

  const statusCounters = useMemo(() => {
    const active = policies.filter((policy) => policy.status === 'active').length
    const renewal = policies.filter((policy) => policy.status === 'expiring' || (policy.status === 'active' && getRenewalDays(policy) <= 60)).length
    const critical = policies.filter((policy) => getRiskLevel(policy) === 'high').length
    return { active, renewal, critical }
  }, [policies])

  const openClaimsByPolicy = useMemo(() => {
    const map = new Map<string, number>()
    for (const claim of claims) {
      if (['approved', 'denied', 'paid'].includes(claim.status)) continue
      map.set(claim.policyId, (map.get(claim.policyId) || 0) + 1)
    }
    return map
  }, [claims])

  const sortedPolicies = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    const filtered = policies.filter((policy) => {
      if (typeFilter !== 'all' && policy.type !== typeFilter) return false
      if (statusFilter !== 'all' && policy.status !== statusFilter) return false
      if (insurerFilter !== 'all' && policy.insurer.trim() !== insurerFilter) return false

      if (portfolioFilter === 'active' && policy.status !== 'active') return false
      if (portfolioFilter === 'renewal' && !(policy.status === 'expiring' || (policy.status === 'active' && getRenewalDays(policy) <= 60))) return false
      if (portfolioFilter === 'critical' && getRiskLevel(policy) !== 'high') return false

      if (!normalizedSearch) return true

      const searchable = [
        policy.policyNumber,
        policy.description,
        policy.individualClientId,
        policy.insurer,
        POLICY_TYPE_LABELS[policy.type] || policy.type,
      ]
        .join(' ')
        .toLowerCase()

      return searchable.includes(normalizedSearch)
    })

    return filtered.sort(compareByPriority)
  }, [policies, typeFilter, statusFilter, insurerFilter, searchTerm, portfolioFilter])

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => sortedPolicies.some((policy) => policy.id === id)))
  }, [sortedPolicies])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setUploading(true); setUploadError(null)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch('/api/extract-policy', { method: 'POST', body: fd })
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('application/json')) throw new Error('__generic__')
      const result = await res.json()
      if (!res.ok) {
        console.error('[extract-policy] erro:', result.error, '| detalhes:', result.details)
        const raw: string = result.error ?? result.details ?? ''
        if (/rate.?limit|ocupado|50[,.]?000/i.test(raw)) throw new Error('__ratelimit__')
        if (/JSON|extrair|reconhecível/i.test(raw)) throw new Error('__jsonparse__')
        throw new Error('__generic__')
      }
      setFormData({ ...result, description: `${t('policies.aiExtracted').replace('✦ ', '')} ${file.name}` })
      setShowForm(true)
    } catch (err: any) {
      const msg: string = err.message ?? ''
      if (msg === '__ratelimit__')
        setUploadError(t('policies.errors.rateLimitError'))
      else if (msg === '__jsonparse__')
        setUploadError(t('policies.errors.parseError'))
      else
        setUploadError(t('policies.errors.genericError'))
    }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true)
    try {
      if (editMode && selected) await updatePolicy({ data: { id: selected.id, updates: formData } })
      else await createPolicy({ data: { ...formData, companyId: 'comp_001' } })
      setShowForm(false); setEditMode(false); setSelected(null); load()
    } catch { alert(t('policies.errors.saveFailed')); setLoading(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('policies.deleteConfirm'))) return
    setLoading(true)
    setDetailPolicy(null)
    try { await deletePolicy({ data: id }); setSelected(null); load() }
    catch { alert(t('policies.errors.deleteFailed')); setLoading(false) }
  }

  const openEdit = (p: Policy) => { setFormData(p); setEditMode(true); setShowForm(true); setSelected(p) }
  const selectedPolicyCount = selectedIds.length
  const allVisibleSelected = sortedPolicies.length > 0 && sortedPolicies.every((policy) => selectedIds.includes(policy.id))

  const togglePolicySelection = (policyId: string) => {
    setSelectedIds((prev) => prev.includes(policyId) ? prev.filter((id) => id !== policyId) : [...prev, policyId])
  }

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds([])
      return
    }
    setSelectedIds(sortedPolicies.map((policy) => policy.id))
  }

  const runBulkAction = async (action: BulkAction) => {
    if (selectedIds.length === 0) return
    setBulkActionRunning(action)
    try {
      const updates: Partial<Policy> = action === 'mark_renewal'
        ? { status: 'expiring' }
        : action === 'share_enable'
          ? { visiblePortal: true }
          : { visiblePortal: false }

      await Promise.all(selectedIds.map((id) => updatePolicy({ data: { id, updates } })))
      await load()
      setSelectedIds([])
    } finally {
      setBulkActionRunning(null)
    }
  }

  const selectStyle: React.CSSProperties = {
    fontFamily: "'Montserrat', sans-serif",
    fontSize: '0.8rem',
    padding: '0.45rem 0.75rem',
    border: '1px solid #dddddd',
    borderRadius: '4px',
    background: '#ffffff',
    color: '#333333',
    minWidth: '9.5rem',
  }

  const headerMetaStyle: React.CSSProperties = {
    fontFamily: "'Montserrat', sans-serif",
    fontSize: '0.72rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: '0.2rem',
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '8px', padding: '1rem 1rem 0.9rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.9rem', flexWrap: 'wrap' as const }}>
            <div>
              <h1 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '1.3rem', color: '#111111', margin: 0 }}>{t('policies.title')}</h1>
              <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 400, fontSize: '0.82rem', color: '#6B7280', marginTop: '0.28rem' }}>
                {t('policies.totalPolicies')}: <strong style={{ color: '#111111' }}>{policies.length}</strong>
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' as const }}>
              <label style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.82rem', padding: '0.6rem 1rem', background: uploading ? '#cccccc' : '#C8961A', color: '#ffffff', border: 'none', borderRadius: '4px', cursor: uploading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {uploading
                  ? <><span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />{t('policies.extracting')}</>
                  : <>{t('policies.extractViaAI')}</>}
                <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={handleUpload} style={{ display: 'none' }} disabled={uploading} />
              </label>
              <button onClick={() => { setFormData({}); setEditMode(false); setShowForm(true) }} style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.82rem', padding: '0.6rem 1rem', background: '#111111', color: '#ffffff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>{t('policies.addManual')}</button>
            </div>
          </div>

          <div style={{ marginTop: '0.9rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.55rem' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={headerMetaStyle}>{t('policies.search')}</p>
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t('policies.searchPlaceholder')}
                style={{ ...inputStyle, padding: '0.58rem 0.75rem' }}
              />
            </div>

            <div>
              <p style={headerMetaStyle}>{t('policies.policyType')}</p>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={selectStyle}>
                <option value="all">{t('policies.allTypes')}</option>
                {Object.entries(POLICY_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>

            <div>
              <p style={headerMetaStyle}>{t('policies.filterStatus')}</p>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
                <option value="all">{t('policies.allStatuses')}</option>
                <option value="active">{t('policies.statusActive')}</option>
                <option value="expiring">{t('policies.statusExpiring')}</option>
                <option value="expired">{t('policies.statusExpired')}</option>
                <option value="cancelled">{t('policies.statusCancelled')}</option>
              </select>
            </div>

            <div>
              <p style={headerMetaStyle}>{t('policies.insurer')}</p>
              <select value={insurerFilter} onChange={(e) => setInsurerFilter(e.target.value)} style={selectStyle}>
                <option value="all">{t('policies.allInsurers')}</option>
                {insurers.map((insurer) => <option key={insurer} value={insurer}>{insurer}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '8px', padding: '0.8rem 1rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>
              {t('policies.portfolioStatus')}
            </span>

            <PortfolioPill
              active={portfolioFilter === 'active'}
              onClick={() => setPortfolioFilter((prev) => prev === 'active' ? 'all' : 'active')}
              label={t('policies.activeShort')}
              value={statusCounters.active}
              tone="green"
            />
            <PortfolioPill
              active={portfolioFilter === 'renewal'}
              onClick={() => setPortfolioFilter((prev) => prev === 'renewal' ? 'all' : 'renewal')}
              label={t('policies.renewalShort')}
              value={statusCounters.renewal}
              tone="amber"
            />
            <PortfolioPill
              active={portfolioFilter === 'critical'}
              onClick={() => setPortfolioFilter((prev) => prev === 'critical' ? 'all' : 'critical')}
              label={t('policies.criticalShort')}
              value={statusCounters.critical}
              tone="red"
            />

            <button
              type="button"
              onClick={() => setPortfolioFilter('all')}
              style={{ marginLeft: 'auto', fontFamily: "'Montserrat', sans-serif", border: 'none', background: 'transparent', color: '#6b7280', fontWeight: 600, fontSize: '0.75rem', cursor: 'pointer' }}
            >
              {t('policies.clearStatusFilter')}
            </button>
          </div>
        </div>

        {selectedPolicyCount > 0 && (
          <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '0.7rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' as const }}>
            <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', fontWeight: 700, color: '#374151' }}>
              {t('policies.bulkSelectedCount', { count: selectedPolicyCount })}
            </span>

            <button
              type="button"
              onClick={() => runBulkAction('mark_renewal')}
              disabled={Boolean(bulkActionRunning)}
              style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', fontWeight: 700, background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A', borderRadius: '999px', padding: '0.28rem 0.62rem', cursor: bulkActionRunning ? 'not-allowed' : 'pointer', opacity: bulkActionRunning ? 0.65 : 1 }}
            >
              {t('policies.bulkMarkRenewal')}
            </button>
            <button
              type="button"
              onClick={() => runBulkAction('share_enable')}
              disabled={Boolean(bulkActionRunning)}
              style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', fontWeight: 700, background: '#ECFDF5', color: '#166534', border: '1px solid #BBF7D0', borderRadius: '999px', padding: '0.28rem 0.62rem', cursor: bulkActionRunning ? 'not-allowed' : 'pointer', opacity: bulkActionRunning ? 0.65 : 1 }}
            >
              {t('policies.bulkEnableShare')}
            </button>
            <button
              type="button"
              onClick={() => runBulkAction('share_disable')}
              disabled={Boolean(bulkActionRunning)}
              style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', fontWeight: 700, background: '#F3F4F6', color: '#4B5563', border: '1px solid #D1D5DB', borderRadius: '999px', padding: '0.28rem 0.62rem', cursor: bulkActionRunning ? 'not-allowed' : 'pointer', opacity: bulkActionRunning ? 0.65 : 1 }}
            >
              {t('policies.bulkDisableShare')}
            </button>

            <button
              type="button"
              onClick={() => setSelectedIds([])}
              disabled={Boolean(bulkActionRunning)}
              style={{ marginLeft: 'auto', fontFamily: "'Montserrat', sans-serif", border: 'none', background: 'transparent', color: '#6B7280', fontWeight: 700, fontSize: '0.72rem', cursor: bulkActionRunning ? 'not-allowed' : 'pointer' }}
            >
              {t('policies.bulkClearSelection')}
            </button>
          </div>
        )}

        {uploadError && (
          <div style={{ background: '#fff5f5', border: '1px solid #fecaca', borderRadius: '4px', padding: '0.75rem 1rem', fontFamily: "'Montserrat', sans-serif", fontSize: '0.82rem', color: '#dc2626', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>⚠️ {uploadError}</span>
            <button onClick={() => setUploadError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: '1rem' }}>×</button>
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
            <div style={{ width: '32px', height: '32px', border: '3px solid #eeeeee', borderTopColor: '#C8961A', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          </div>
        ) : sortedPolicies.length === 0 ? (
          <div style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', padding: '3rem', textAlign: 'center' as const }}>
            <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.9rem', color: '#aaaaaa', marginBottom: '0.5rem' }}>{policies.length === 0 ? t('policies.noPolicies') : t('policies.noResults')}</p>
            {policies.length === 0 && <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem', color: '#cccccc' }}>{t('policies.noPoliciesHint')}</p>}
          </div>
        ) : (
          <div style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1420px' }}>
                <thead>
                  <tr style={{ background: '#F9FAFB' }}>
                    {[
                      '',
                      t('policies.policyType'),
                      t('policies.insurer'),
                      t('policies.policyNumber'),
                      t('policies.renewalDate'),
                      t('policies.annualPremium'),
                      t('policies.filterStatus'),
                      t('policies.riskIndicator'),
                      t('policies.lineContext'),
                      t('policies.requiredActionTitle'),
                    ].map((header) => (
                      <th key={header} style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6B7280', textAlign: 'left', padding: '0.72rem 0.78rem', borderBottom: '1px solid #E5E7EB', whiteSpace: 'nowrap' }}>
                        {header ? header : (
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={toggleSelectAllVisible}
                            aria-label={t('policies.bulkSelectAll')}
                            style={{ width: '14px', height: '14px', cursor: 'pointer' }}
                          />
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {sortedPolicies.map((policy) => {
                    const riskLevel = getRiskLevel(policy)
                    const urgencyTone = getUrgencyTone(policy)
                    const renewalDays = getRenewalDays(policy)
                    const showRenewalTag = renewalDays <= 60
                    const hasDocument = Boolean(policy.documentKey)
                    const visiblePortal = Boolean(policy.visiblePortal)
                    const openClaimCount = openClaimsByPolicy.get(policy.id) || 0
                    const requiredAction = getRequiredAction(policy, openClaimCount > 0)
                    const icon = POLICY_TYPE_ICONS[policy.type] || '📋'
                    const renewalDate = policy.renewalDate || policy.endDate
                    const isHovered = hoveredPolicyId === policy.id
                    const isSelected = selectedIds.includes(policy.id)
                    const toneBackground = urgencyTone === 'critical' ? '#FFF7F7' : urgencyTone === 'attention' ? '#FFFDF5' : '#FFFFFF'
                    const toneMarker = urgencyTone === 'critical' ? '#DC2626' : urgencyTone === 'attention' ? '#D97706' : '#D1D5DB'

                    return (
                      <tr
                        key={policy.id}
                        onClick={() => setDetailPolicy(policy)}
                        style={{
                          cursor: 'pointer',
                          borderBottom: '1px solid #F3F4F6',
                          background: isSelected ? '#F9FAFB' : (isHovered ? toneBackground : 'transparent'),
                          boxShadow: `inset 3px 0 0 ${toneMarker}`,
                          transition: 'background 0.16s ease',
                        }}
                        onMouseEnter={() => setHoveredPolicyId(policy.id)}
                        onMouseLeave={() => setHoveredPolicyId((prev) => prev === policy.id ? null : prev)}
                      >
                        <td style={{ padding: '0.75rem 0.78rem', verticalAlign: 'middle' }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => togglePolicySelection(policy.id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={t('policies.bulkSelectOne', { policy: policy.policyNumber || policy.id })}
                            style={{ width: '14px', height: '14px', cursor: 'pointer' }}
                          />
                        </td>

                        <td style={{ padding: '0.75rem 0.78rem', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.95rem' }}>{icon}</span>
                            <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem', color: '#111111', fontWeight: 600 }}>
                              {POLICY_TYPE_LABELS[policy.type] || policy.type}
                            </span>
                          </div>
                        </td>

                        <td style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem', color: '#111111', padding: '0.75rem 0.78rem', verticalAlign: 'middle' }}>
                          {policy.insurer || '—'}
                        </td>

                        <td style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem', color: '#111111', padding: '0.75rem 0.78rem', verticalAlign: 'middle', fontWeight: 600 }}>
                          <span>{policy.policyNumber || '—'}</span>
                          {isHovered && (
                            <p style={{ margin: '0.22rem 0 0', fontFamily: "'Montserrat', sans-serif", fontSize: '0.67rem', color: '#6B7280', fontWeight: 600 }}>
                              {t('policies.rowPreview', { premium: formatCurrency(policy.annualPremium || 0), days: renewalDays })}
                            </p>
                          )}
                        </td>

                        <td style={{ padding: '0.75rem 0.78rem', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' as const }}>
                            <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem', color: '#111111' }}>{formatDate(renewalDate)}</span>
                            {showRenewalTag && (
                              <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.66rem', fontWeight: 700, borderRadius: '999px', padding: '0.14rem 0.45rem', background: renewalDays <= 15 ? '#FEE2E2' : '#FEF3C7', color: renewalDays <= 15 ? '#B91C1C' : '#B45309' }}>
                                {renewalDays <= 0 ? t('policies.todayOrOverdue') : t('policies.daysToRenew', { count: renewalDays })}
                              </span>
                            )}
                          </div>
                        </td>

                        <td style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem', color: '#111111', fontWeight: 700, padding: '0.75rem 0.78rem', verticalAlign: 'middle' }}>
                          {formatCurrency(policy.annualPremium || 0)}
                        </td>

                        <td style={{ padding: '0.75rem 0.78rem', verticalAlign: 'middle' }}>
                          <StatusBadge status={policy.status} />
                        </td>

                        <td style={{ padding: '0.75rem 0.78rem', verticalAlign: 'middle' }}>
                          <RiskBadge level={riskLevel} t={t} />
                        </td>

                        <td style={{ padding: '0.75rem 0.78rem', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' as const }}>
                            <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.66rem', fontWeight: 700, borderRadius: '999px', padding: '0.14rem 0.44rem', background: showRenewalTag ? '#FEF3C7' : '#F3F4F6', color: showRenewalTag ? '#B45309' : '#6B7280' }}>
                              {showRenewalTag ? t('policies.contextRenewalNear') : t('policies.contextRenewalOk')}
                            </span>
                            <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.66rem', fontWeight: 700, borderRadius: '999px', padding: '0.14rem 0.44rem', background: hasDocument ? '#DCFCE7' : '#FEE2E2', color: hasDocument ? '#166534' : '#991B1B' }}>
                              {hasDocument ? t('policies.contextDocsComplete') : t('policies.contextDocsMissing')}
                            </span>
                            <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.66rem', fontWeight: 700, borderRadius: '999px', padding: '0.14rem 0.44rem', background: visiblePortal ? '#EFF6FF' : '#F3F4F6', color: visiblePortal ? '#1D4ED8' : '#6B7280' }}>
                              {visiblePortal ? t('policies.contextShareOn') : t('policies.contextShareOff')}
                            </span>
                          </div>
                          {isHovered && (
                            <div style={{ marginTop: '0.32rem', display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' as const }}>
                              {hasDocument && (
                                <a
                                  href={`/api/download-document?key=${encodeURIComponent(policy.documentKey!)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.66rem', fontWeight: 700, color: '#1D4ED8', textDecoration: 'none', border: '1px solid #BFDBFE', background: '#EFF6FF', padding: '0.12rem 0.4rem', borderRadius: '999px' }}
                                >
                                  {t('policies.openDocument')}
                                </a>
                              )}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setDetailPolicy(policy) }}
                                style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.66rem', fontWeight: 700, color: '#374151', border: '1px solid #D1D5DB', background: '#F9FAFB', padding: '0.12rem 0.4rem', borderRadius: '999px', cursor: 'pointer' }}
                              >
                                {t('policies.quickOpen')}
                              </button>
                            </div>
                          )}
                        </td>

                        <td style={{ padding: '0.75rem 0.78rem', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' as const }}>
                            <ActionBadge action={requiredAction} t={t} />
                            {requiredAction === 'view_claim' && (
                              <Link
                                to="/claims"
                                onClick={(e) => e.stopPropagation()}
                                style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.66rem', fontWeight: 700, color: '#1D4ED8', textDecoration: 'none' }}
                              >
                                {t('policies.viewClaimCta', { count: openClaimCount })}
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ padding: '0.7rem 0.9rem', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' as const }}>
              <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', color: '#6B7280', margin: 0 }}>
                {t('policies.sortedByPriority')}
              </p>
              <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', color: '#9CA3AF', margin: 0 }}>
                {t('policies.clickRowToOpen')}
              </p>
            </div>
          </div>
        )}
      </div>

      {detailPolicy && (
        <PolicyDetailModal
          policy={detailPolicy}
          onClose={() => setDetailPolicy(null)}
          onEdit={openEdit}
          onDelete={handleDelete}
          formatCurrency={formatCurrency}
          formatDate={formatDate}
          t={t}
        />
      )}

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: '#ffffff', borderRadius: '4px', width: '100%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #eeeeee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '1rem', color: '#111111', margin: 0 }}>{editMode ? t('policies.editPolicy') : t('policies.newPolicy')}</h2>
              <button onClick={() => { setShowForm(false); setEditMode(false); setFormData({}) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888888', fontSize: '1.25rem', lineHeight: 1 }}>×</button>
            </div>
            {formData.description?.includes('extraída') && (
              <div style={{ margin: '1rem 1.5rem 0', padding: '0.75rem 1rem', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '4px' }}>
                <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', fontWeight: 600, color: '#166534', margin: '0 0 0.25rem' }}>{t('policies.aiExtracted')}</p>
                <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', color: '#555555', margin: 0 }}>{t('policies.aiExtractedDetails', { capital: formatCurrency(formData.insuredValue || 0), premium: formatCurrency(formData.annualPremium || 0), deductible: formatCurrency(formData.deductible || 0) })}</p>
              </div>
            )}
            <form onSubmit={handleSave} style={{ padding: '1.25rem 1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <FormField label={t('policies.policyType')} required>
                  <select value={formData.type || ''} onChange={(e) => setFormData({ ...formData, type: e.target.value })} required style={inputStyle}>
                    <option value="">{t('policies.selectType')}</option>
                    {Object.entries(POLICY_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </FormField>
              </div>
              <FormField label={t('policies.insurer')} required><input type="text" value={formData.insurer || ''} onChange={(e) => setFormData({ ...formData, insurer: e.target.value })} required style={inputStyle} placeholder={t('policies.insurerPlaceholder')} /></FormField>
              <FormField label={t('policies.policyNumber')}><input type="text" value={formData.policyNumber || ''} onChange={(e) => setFormData({ ...formData, policyNumber: e.target.value })} style={inputStyle} /></FormField>
              <FormField label={t('policies.startDate')} required><input type="date" value={formData.startDate || ''} onChange={(e) => setFormData({ ...formData, startDate: e.target.value })} required style={inputStyle} /></FormField>
              <FormField label={t('policies.endDate')} required><input type="date" value={formData.endDate || ''} onChange={(e) => setFormData({ ...formData, endDate: e.target.value })} required style={inputStyle} /></FormField>
              <FormField label={`${t('policies.annualPremium')} (€)`}><input type="number" value={formData.annualPremium || ''} onChange={(e) => setFormData({ ...formData, annualPremium: parseFloat(e.target.value) || 0 })} style={inputStyle} placeholder="0.00" min="0" step="0.01" /></FormField>
              <FormField label={`${t('policies.insuredValue')} (€)`}><input type="number" value={formData.insuredValue || ''} onChange={(e) => setFormData({ ...formData, insuredValue: parseFloat(e.target.value) || 0 })} style={inputStyle} placeholder="0.00" min="0" step="0.01" /></FormField>
              <div style={{ gridColumn: '1 / -1' }}>
                <FormField label={t('policies.description')}><input type="text" value={formData.description || ''} onChange={(e) => setFormData({ ...formData, description: e.target.value })} style={inputStyle} /></FormField>
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', paddingTop: '0.5rem' }}>
                <button type="button" onClick={() => { setShowForm(false); setEditMode(false); setFormData({}) }} style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.85rem', padding: '0.65rem 1.25rem', background: '#f5f5f5', color: '#555555', border: '1px solid #dddddd', borderRadius: '4px', cursor: 'pointer' }}>{t('policies.cancel')}</button>
                <button type="submit" style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.85rem', padding: '0.65rem 1.25rem', background: '#111111', color: '#ffffff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>{editMode ? t('policies.saveChanges') : t('policies.createPolicy')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </AppLayout>
  )
}
