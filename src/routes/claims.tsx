import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useState, useEffect, useMemo } from 'react'
import {
  fetchClaims,
  fetchPolicies,
  submitClaim,
  updateClaimDetails,
  fetchClaimDocuments,
  registerClaimDocument,
  getClaimDocumentUrl,
  fetchClaimMessages,
  sendClaimMessage,
  markClaimMessagesAsRead,
} from '@/lib/server-fns'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Claim, Policy, Document, ClaimMessage } from '@/lib/types'
import { CLAIM_STATUS_LABELS, POLICY_TYPE_LABELS } from '@/lib/types'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/claims')({
  component: ClaimsPage,
})

const CLAIM_TYPES = [
  { value: 'Acidente de Trabalho', label: 'Acidente de Trabalho' },
  { value: 'Sinistro Patrimonial', label: 'Sinistro Patrimonial' },
  { value: 'Sinistro de Frota', label: 'Sinistro de Frota' },
  { value: 'Responsabilidade Civil', label: 'Responsabilidade Civil' },
  { value: 'Incêndio / Explosão', label: 'Incêndio / Explosão' },
  { value: 'Inundação / Tempestade', label: 'Inundação / Tempestade' },
  { value: 'Furto / Roubo', label: 'Furto / Roubo' },
  { value: 'Danos a Terceiros', label: 'Danos a Terceiros' },
  { value: 'Saúde / Doença', label: 'Saúde / Doença' },
  { value: 'Ciber-Risco', label: 'Ciber-Risco' },
  { value: 'Outro', label: 'Outro' },
]

const STATUS_COLORS: Record<string, string> = {
  submitted: 'bg-blue-50 text-blue-700 border-blue-200',
  under_review: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  documentation: 'bg-orange-50 text-orange-700 border-orange-200',
  assessment: 'bg-purple-50 text-purple-700 border-purple-200',
  approved: 'bg-green-50 text-green-700 border-green-200',
  denied: 'bg-red-50 text-red-700 border-red-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

const STATUS_STEPS = ['submitted', 'under_review', 'documentation', 'assessment', 'approved', 'paid']

const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png'])
const MAX_FILE_SIZE = 10 * 1024 * 1024

function isImageDocument(doc: Document): boolean {
  if (doc.mimeType?.startsWith('image/')) return true
  return /\.(png|jpe?g)$/i.test(doc.name)
}

function fileTypeLabel(doc: Document): string {
  if (doc.mimeType === 'application/pdf') return 'PDF'
  if (doc.mimeType === 'image/jpeg') return 'JPG'
  if (doc.mimeType === 'image/png') return 'PNG'
  const ext = doc.name.split('.').pop()?.toUpperCase()
  return ext || 'Ficheiro'
}

function ClaimsPage() {
  const { t } = useTranslation()
  const [claims, setClaims] = useState<Claim[]>([])
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null)

  const [claimDocuments, setClaimDocuments] = useState<Record<string, Document[]>>({})
  const [claimMessages, setClaimMessages] = useState<Record<string, ClaimMessage[]>>({})
  const [documentUrls, setDocumentUrls] = useState<Record<string, string>>({})
  const [detailLoadingByClaim, setDetailLoadingByClaim] = useState<Record<string, boolean>>({})
  const [editDraftByClaim, setEditDraftByClaim] = useState<Record<string, { description: string; estimatedValue: string }>>({})
  const [draftMessageByClaim, setDraftMessageByClaim] = useState<Record<string, string>>({})
  const [uploadingByClaim, setUploadingByClaim] = useState<Record<string, boolean>>({})
  const [sendingByClaim, setSendingByClaim] = useState<Record<string, boolean>>({})
  const [savingByClaim, setSavingByClaim] = useState<Record<string, boolean>>({})
  const [errorByClaim, setErrorByClaim] = useState<Record<string, string>>({})

  const reload = async () => {
    const [c, p] = await Promise.all([fetchClaims(), fetchPolicies()])
    setClaims(c)
    setPolicies(p)
  }

  const loadClaimDetail = async (claim: Claim) => {
    setDetailLoadingByClaim((s) => ({ ...s, [claim.id]: true }))
    try {
      const [docs, msgs] = await Promise.all([
        fetchClaimDocuments({ data: claim.id }),
        fetchClaimMessages({ data: claim.id }),
      ])
      setClaimDocuments((s) => ({ ...s, [claim.id]: docs }))
      setClaimMessages((s) => ({ ...s, [claim.id]: msgs }))
      setEditDraftByClaim((s) => ({
        ...s,
        [claim.id]: {
          description: claim.description,
          estimatedValue: String(claim.estimatedValue || 0),
        },
      }))

      const imageDocs = docs.filter(isImageDocument)
      if (imageDocs.length > 0) {
        const urlPairs = await Promise.all(
          imageDocs.map(async (doc) => {
            try {
              const { url } = await getClaimDocumentUrl({ data: { documentId: doc.id } })
              return [doc.id, url] as const
            } catch {
              return [doc.id, ''] as const
            }
          }),
        )
        setDocumentUrls((s) => {
          const next = { ...s }
          for (const [id, url] of urlPairs) {
            if (url) next[id] = url
          }
          return next
        })
      }

      await markClaimMessagesAsRead({ data: claim.id })
      setClaimMessages((s) => ({
        ...s,
        [claim.id]: (s[claim.id] || msgs).map((msg) =>
          msg.senderType === 'admin' ? { ...msg, readAt: msg.readAt || new Date().toISOString() } : msg,
        ),
      }))
    } catch {
      setErrorByClaim((s) => ({ ...s, [claim.id]: 'Erro ao carregar detalhe do sinistro.' }))
    } finally {
      setDetailLoadingByClaim((s) => ({ ...s, [claim.id]: false }))
    }
  }

  useEffect(() => {
    reload().then(() => setLoading(false)).catch(() => setLoading(false))
  }, [])

  const availableYears = useMemo(() => {
    const years = [...new Set(claims.map((c) => new Date(c.incidentDate).getFullYear()))]
    return years.sort((a, b) => b - a)
  }, [claims])

  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterType, setFilterType] = useState<string>('all')
  const [filterYear, setFilterYear] = useState<string>('all')
  const [filterMonth, setFilterMonth] = useState<string>('all')
  const [searchText, setSearchText] = useState('')

  const filteredClaims = useMemo(() => {
    return claims.filter((c) => {
      const date = new Date(c.incidentDate)
      const year = date.getFullYear().toString()
      const month = (date.getMonth() + 1).toString()
      const matchStatus = filterStatus === 'all' || c.status === filterStatus
      const matchType = filterType === 'all' || c.title.includes(filterType)
      const matchYear = filterYear === 'all' || year === filterYear
      const matchMonth = filterMonth === 'all' || month === filterMonth
      const matchSearch = !searchText || c.title.toLowerCase().includes(searchText.toLowerCase()) || c.description.toLowerCase().includes(searchText.toLowerCase())
      return matchStatus && matchType && matchYear && matchMonth && matchSearch
    })
  }, [claims, filterStatus, filterType, filterYear, filterMonth, searchText])

  const stats = useMemo(() => {
    const total = filteredClaims.length
    const totalValue = filteredClaims.reduce((s, c) => s + (c.estimatedValue || 0), 0)
    const open = filteredClaims.filter((c) => !['approved', 'denied', 'paid'].includes(c.status)).length
    const approved = filteredClaims.filter((c) => c.status === 'approved' || c.status === 'paid').length
    const denied = filteredClaims.filter((c) => c.status === 'denied').length
    return { total, totalValue, open, approved, denied }
  }, [filteredClaims])

  const exportCSV = () => {
    const headers = [t('claims.refLabel').replace(':', ''), t('claims.claimType').replace(' *', ''), t('claims.incidentDateLabel').replace(' *', ''), t('claims.claimDate').replace(':', ''), `${t('claims.estimatedValue')}`, t('claims.allStatuses').replace('All ', '').replace('Todos os ', ''), 'Apólice']
    const rows = filteredClaims.map((c) => {
      const policy = policies.find((p) => p.id === c.policyId)
      return [
        c.id,
        c.title,
        c.incidentDate,
        c.claimDate,
        c.estimatedValue?.toString() || '0',
        CLAIM_STATUS_LABELS[c.status] || c.status,
        policy ? `${policy.policyNumber} — ${POLICY_TYPE_LABELS[policy.type] || policy.type}` : c.policyId,
      ]
    })
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sinistros_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const openClaimDetail = async (claim: Claim, isOpen: boolean) => {
    if (isOpen) {
      setSelectedClaimId(null)
      return
    }
    setSelectedClaimId(claim.id)
    await loadClaimDetail(claim)
  }

  const handleClaimUpdate = async (claim: Claim) => {
    const draft = editDraftByClaim[claim.id]
    if (!draft) return
    setSavingByClaim((s) => ({ ...s, [claim.id]: true }))
    setErrorByClaim((s) => ({ ...s, [claim.id]: '' }))
    try {
      await updateClaimDetails({
        data: {
          claimId: claim.id,
          description: draft.description,
          estimatedValue: parseFloat(draft.estimatedValue) || 0,
        },
      })
      await reload()
    } catch {
      setErrorByClaim((s) => ({ ...s, [claim.id]: 'Não foi possível guardar alterações.' }))
    } finally {
      setSavingByClaim((s) => ({ ...s, [claim.id]: false }))
    }
  }

  const handleClaimFileUpload = async (claim: Claim, file?: File) => {
    if (!file) return
    if (!ALLOWED_MIME.has(file.type)) {
      setErrorByClaim((s) => ({ ...s, [claim.id]: 'Formato inválido. Use PDF, JPG ou PNG.' }))
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setErrorByClaim((s) => ({ ...s, [claim.id]: 'Ficheiro excede 10MB.' }))
      return
    }

    setUploadingByClaim((s) => ({ ...s, [claim.id]: true }))
    setErrorByClaim((s) => ({ ...s, [claim.id]: '' }))
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('type', 'claim_document')
      fd.append('claimId', claim.id)

      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro no upload')
      }
      const payload = await res.json()

      await registerClaimDocument({
        data: {
          claimId: claim.id,
          name: payload.name,
          storagePath: payload.path,
          size: payload.size,
          mimeType: payload.type,
        },
      })

      const docs = await fetchClaimDocuments({ data: claim.id })
      setClaimDocuments((s) => ({ ...s, [claim.id]: docs }))

      if (file.type.startsWith('image/')) {
        const latestDoc = docs.find((doc) => doc.blobKey === payload.path)
        if (latestDoc) {
          const { url } = await getClaimDocumentUrl({ data: { documentId: latestDoc.id } })
          setDocumentUrls((s) => ({ ...s, [latestDoc.id]: url }))
        }
      }
    } catch (err: any) {
      setErrorByClaim((s) => ({ ...s, [claim.id]: err?.message || 'Erro ao enviar ficheiro.' }))
    } finally {
      setUploadingByClaim((s) => ({ ...s, [claim.id]: false }))
    }
  }

  const openDocument = async (doc: Document) => {
    const existing = documentUrls[doc.id]
    if (existing) {
      window.open(existing, '_blank')
      return
    }
    const { url } = await getClaimDocumentUrl({ data: { documentId: doc.id } })
    setDocumentUrls((s) => ({ ...s, [doc.id]: url }))
    window.open(url, '_blank')
  }

  const handleSendMessage = async (claim: Claim) => {
    const message = (draftMessageByClaim[claim.id] || '').trim()
    if (!message) return

    setSendingByClaim((s) => ({ ...s, [claim.id]: true }))
    setErrorByClaim((s) => ({ ...s, [claim.id]: '' }))
    try {
      await sendClaimMessage({ data: { claimId: claim.id, message } })
      setDraftMessageByClaim((s) => ({ ...s, [claim.id]: '' }))
      const msgs = await fetchClaimMessages({ data: claim.id })
      setClaimMessages((s) => ({ ...s, [claim.id]: msgs }))
    } catch {
      setErrorByClaim((s) => ({ ...s, [claim.id]: 'Não foi possível enviar a mensagem.' }))
    } finally {
      setSendingByClaim((s) => ({ ...s, [claim.id]: false }))
    }
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-navy-700">{t('claims.title')}</h1>
            <p className="text-navy-500 mt-1">{t('claims.subtitle')}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={exportCSV}
              className="px-4 py-2 border border-navy-200 text-navy-600 text-sm font-medium rounded-[2px] hover:bg-navy-50 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {t('claims.exportCSV')}
            </button>
            <button
              onClick={() => {
                setShowForm(true)
                setSelectedClaimId(null)
              }}
              className="px-4 py-2 bg-gold-400 text-navy-700 font-semibold text-sm rounded-[2px] hover:bg-gold-300 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {t('claims.newClaim')}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: t('claims.total'), value: stats.total, color: 'text-navy-700' },
            { label: t('claims.open'), value: stats.open, color: 'text-orange-600' },
            { label: t('claims.approved'), value: stats.approved, color: 'text-green-600' },
            { label: t('claims.totalValue'), value: formatCurrency(stats.totalValue), color: 'text-navy-700' },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-white rounded-[4px] border border-navy-200 p-4">
              <p className="text-xs text-navy-500 mb-1">{kpi.label}</p>
              <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-[4px] border border-navy-200 p-4 mb-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <input
              type="text"
              placeholder={t('claims.searchPlaceholder')}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="col-span-2 sm:col-span-1 px-3 py-2 text-sm border border-navy-200 rounded focus:outline-none focus:ring-1 focus:ring-gold-400"
            />
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="px-3 py-2 text-sm border border-navy-200 rounded focus:outline-none focus:ring-1 focus:ring-gold-400">
              <option value="all">{t('claims.allStatuses')}</option>
              {Object.entries(CLAIM_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="px-3 py-2 text-sm border border-navy-200 rounded focus:outline-none focus:ring-1 focus:ring-gold-400">
              <option value="all">{t('claims.allTypes')}</option>
              {CLAIM_TYPES.map((it) => (
                <option key={it.value} value={it.value}>{it.label}</option>
              ))}
            </select>
            <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)} className="px-3 py-2 text-sm border border-navy-200 rounded focus:outline-none focus:ring-1 focus:ring-gold-400">
              <option value="all">{t('claims.allYears')}</option>
              {availableYears.map((y) => (
                <option key={y} value={y.toString()}>{y}</option>
              ))}
            </select>
            <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} className="px-3 py-2 text-sm border border-navy-200 rounded focus:outline-none focus:ring-1 focus:ring-gold-400">
              <option value="all">{t('claims.allMonths')}</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                <option key={m} value={m.toString()}>{t(`claims.months.${m}`)}</option>
              ))}
            </select>
            <button onClick={() => {
              setFilterStatus('all')
              setFilterType('all')
              setFilterYear('all')
              setFilterMonth('all')
              setSearchText('')
            }} className="px-3 py-2 text-sm text-navy-500 border border-navy-200 rounded hover:bg-navy-50">
              {t('claims.clear')}
            </button>
          </div>
        </div>

        {showForm && (
          <NewClaimForm
            policies={policies}
            onClose={() => setShowForm(false)}
            onSubmit={async (data) => {
              await submitClaim({ data })
              await reload()
              setShowForm(false)
            }}
          />
        )}

        {filteredClaims.length === 0 ? (
          <div className="bg-white rounded-[4px] border border-navy-200 p-12 text-center">
            <svg className="w-12 h-12 text-navy-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-navy-500 font-medium">{t('claims.noResults')}</p>
            <p className="text-navy-400 text-sm mt-1">{t('claims.noResultsHint')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredClaims.map((claim) => {
              const policy = policies.find((p) => p.id === claim.policyId)
              const isSelected = selectedClaimId === claim.id
              const detailLoading = detailLoadingByClaim[claim.id]
              const docs = claimDocuments[claim.id] || []
              const messages = claimMessages[claim.id] || []
              const unreadAdminMessages = messages.filter((m) => m.senderType === 'admin' && !m.readAt).length
              const draft = editDraftByClaim[claim.id] || { description: claim.description, estimatedValue: String(claim.estimatedValue || 0) }

              return (
                <div key={claim.id} className="bg-white rounded-[4px] border border-navy-200 overflow-hidden">
                  <button
                    onClick={() => openClaimDetail(claim, isSelected)}
                    className="w-full p-5 text-left hover:bg-navy-50/50 transition-colors"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-navy-700">{claim.title}</h3>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[claim.status] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                            {CLAIM_STATUS_LABELS[claim.status] || claim.status}
                          </span>
                          {unreadAdminMessages > 0 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-amber-50 text-amber-700 border-amber-200">
                              {unreadAdminMessages} nova{unreadAdminMessages > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-navy-500 mt-1 truncate">{claim.description}</p>
                        <div className="flex flex-wrap gap-3 mt-2 text-xs text-navy-400">
                          <span>{t('claims.incidentDate')} {formatDate(claim.incidentDate)}</span>
                          <span>{t('claims.claimDate')} {formatDate(claim.claimDate)}</span>
                          {policy && <span>{t('claims.policyLabel')} {policy.policyNumber} ({POLICY_TYPE_LABELS[policy.type] || policy.type})</span>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold text-navy-700">{formatCurrency(claim.estimatedValue)}</p>
                        <p className="text-xs text-navy-400 mt-1">{t('claims.refLabel')} {claim.id.slice(-8).toUpperCase()}</p>
                      </div>
                    </div>
                  </button>

                  {isSelected && (
                    <div className="border-t border-navy-100 bg-navy-50/30 p-5 space-y-6">
                      {detailLoading ? (
                        <div className="flex items-center gap-2 text-sm text-navy-500">
                          <div className="w-4 h-4 border-2 border-navy-300 border-t-transparent rounded-full animate-spin" />
                          A carregar detalhe...
                        </div>
                      ) : (
                        <>
                          <div>
                            <h4 className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-3">{t('claims.progress')}</h4>
                            <div className="flex items-center gap-0 mb-6 overflow-x-auto pb-2">
                              {STATUS_STEPS.map((step, idx) => {
                                const stepOrder = STATUS_STEPS.indexOf(claim.status)
                                const isActive = idx <= stepOrder && claim.status !== 'denied'
                                const isCurrent = step === claim.status
                                const isDenied = claim.status === 'denied'
                                return (
                                  <div key={step} className="flex items-center flex-shrink-0">
                                    <div className="flex flex-col items-center">
                                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                                        isDenied && isCurrent ? 'bg-red-500 border-red-500 text-white' :
                                        isCurrent ? 'bg-gold-400 border-gold-400 text-navy-700' :
                                        isActive ? 'bg-navy-700 border-navy-700 text-white' :
                                        'bg-white border-navy-200 text-navy-300'
                                      }`}>
                                        {isActive && !isCurrent ? '✓' : idx + 1}
                                      </div>
                                      <span className={`text-xs mt-1 whitespace-nowrap ${isCurrent ? 'text-navy-700 font-semibold' : 'text-navy-400'}`}>
                                        {CLAIM_STATUS_LABELS[step as keyof typeof CLAIM_STATUS_LABELS]}
                                      </span>
                                    </div>
                                    {idx < STATUS_STEPS.length - 1 && (
                                      <div className={`h-0.5 w-8 mx-1 flex-shrink-0 ${idx < STATUS_STEPS.indexOf(claim.status) && claim.status !== 'denied' ? 'bg-navy-700' : 'bg-navy-200'}`} />
                                    )}
                                  </div>
                                )
                              })}
                              {claim.status === 'denied' && (
                                <div className="ml-4 flex-shrink-0">
                                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
                                    {t('claims.denied')}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          {claim.steps && claim.steps.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-3">{t('claims.history')}</h4>
                              <div className="space-y-2">
                                {[...claim.steps].reverse().map((step, idx) => (
                                  <div key={idx} className="flex items-start gap-3 text-sm">
                                    <div className="w-2 h-2 rounded-full bg-gold-400 mt-1.5 flex-shrink-0" />
                                    <div>
                                      <span className="font-medium text-navy-700">{CLAIM_STATUS_LABELS[step.status] || step.status}</span>
                                      <span className="text-navy-400 ml-2">{formatDate(step.date)}</span>
                                      {step.notes && <p className="text-navy-500 mt-0.5">{step.notes}</p>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="bg-white border border-navy-200 rounded-[4px] p-4">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="text-sm font-semibold text-navy-700">Dados do sinistro</h4>
                              <span className="text-xs text-navy-400">Edição contínua ativa</span>
                            </div>
                            <div className="space-y-3">
                              <div>
                                <label className="block text-xs font-semibold text-navy-500 uppercase tracking-wide mb-1">Descrição</label>
                                <textarea
                                  rows={4}
                                  value={draft.description}
                                  onChange={(e) => setEditDraftByClaim((s) => ({
                                    ...s,
                                    [claim.id]: { ...draft, description: e.target.value },
                                  }))}
                                  className="w-full px-3 py-2 border border-navy-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 resize-none"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-navy-500 uppercase tracking-wide mb-1">Valor estimado</label>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={draft.estimatedValue}
                                  onChange={(e) => setEditDraftByClaim((s) => ({
                                    ...s,
                                    [claim.id]: { ...draft, estimatedValue: e.target.value },
                                  }))}
                                  className="w-full sm:w-56 px-3 py-2 border border-navy-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gold-400"
                                />
                              </div>
                              <div className="flex justify-end">
                                <button
                                  onClick={() => handleClaimUpdate(claim)}
                                  disabled={!!savingByClaim[claim.id]}
                                  className="px-4 py-2 bg-navy-700 text-white text-sm font-medium rounded-[2px] hover:bg-navy-600 disabled:opacity-50"
                                >
                                  {savingByClaim[claim.id] ? 'A guardar...' : 'Guardar alterações'}
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="bg-white border border-navy-200 rounded-[4px] p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                              <h4 className="text-sm font-semibold text-navy-700">Ficheiros e provas</h4>
                              <label className="px-3 py-1.5 text-xs bg-navy-700 text-white rounded cursor-pointer hover:bg-navy-600">
                                {uploadingByClaim[claim.id] ? 'A enviar...' : 'Adicionar ficheiro'}
                                <input
                                  type="file"
                                  className="hidden"
                                  accept="application/pdf,image/jpeg,image/png"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0]
                                    void handleClaimFileUpload(claim, file)
                                    e.currentTarget.value = ''
                                  }}
                                  disabled={!!uploadingByClaim[claim.id]}
                                />
                              </label>
                            </div>

                            {docs.length === 0 ? (
                              <p className="text-sm text-navy-400">Sem ficheiros associados.</p>
                            ) : (
                              <div className="space-y-2">
                                {docs.map((doc) => (
                                  <div key={doc.id} className="border border-navy-100 rounded p-3 text-sm">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div>
                                        <p className="font-medium text-navy-700">{doc.name}</p>
                                        <p className="text-xs text-navy-500">
                                          {fileTypeLabel(doc)} · {formatDate(doc.uploadedAt)} · {doc.uploadedBy}
                                        </p>
                                      </div>
                                      <button
                                        onClick={() => openDocument(doc)}
                                        className="px-2.5 py-1 text-xs border border-navy-300 rounded hover:bg-navy-50"
                                      >
                                        Abrir
                                      </button>
                                    </div>
                                    {isImageDocument(doc) && documentUrls[doc.id] && (
                                      <img
                                        src={documentUrls[doc.id]}
                                        alt={doc.name}
                                        className="mt-2 max-h-40 rounded border border-navy-100"
                                      />
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="bg-white border border-navy-200 rounded-[4px] p-4">
                            <h4 className="text-sm font-semibold text-navy-700 mb-3">Mensagens do processo</h4>
                            {messages.length === 0 ? (
                              <p className="text-sm text-navy-400 mb-4">Sem mensagens neste sinistro.</p>
                            ) : (
                              <div className="space-y-2 mb-4 max-h-72 overflow-y-auto pr-1">
                                {messages.map((msg) => (
                                  <div
                                    key={msg.id}
                                    className={`rounded p-3 text-sm border ${msg.senderType === 'admin'
                                      ? 'bg-amber-50 border-amber-200 text-amber-900'
                                      : 'bg-navy-50 border-navy-200 text-navy-700'}`}
                                  >
                                    <p className="whitespace-pre-wrap">{msg.message}</p>
                                    <p className="text-xs mt-1 opacity-70">
                                      {msg.senderName} · {new Date(msg.createdAt).toLocaleDateString('pt-PT')} {new Date(msg.createdAt).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="flex gap-2">
                              <input
                                value={draftMessageByClaim[claim.id] || ''}
                                onChange={(e) => setDraftMessageByClaim((s) => ({ ...s, [claim.id]: e.target.value }))}
                                placeholder="Escreva a sua resposta..."
                                className="flex-1 px-3 py-2 border border-navy-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gold-400"
                              />
                              <button
                                onClick={() => handleSendMessage(claim)}
                                disabled={!!sendingByClaim[claim.id] || !(draftMessageByClaim[claim.id] || '').trim()}
                                className="px-4 py-2 bg-gold-400 text-navy-700 text-sm font-semibold rounded-[2px] hover:bg-gold-300 disabled:opacity-50"
                              >
                                {sendingByClaim[claim.id] ? 'A enviar...' : 'Enviar'}
                              </button>
                            </div>
                          </div>

                          {errorByClaim[claim.id] && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                              {errorByClaim[claim.id]}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AppLayout>
  )
}

function NewClaimForm({
  policies,
  onClose,
  onSubmit,
}: {
  policies: Policy[]
  onClose: () => void
  onSubmit: (data: { policyId: string; companyId: string; title: string; description: string; incidentDate: string; estimatedValue: number }) => Promise<void>
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    claimType: '',
    customTitle: '',
    policyId: '',
    description: '',
    incidentDate: new Date().toISOString().split('T')[0],
    estimatedValue: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const selectedPolicy = policies.find((p) => p.id === form.policyId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.policyId) { setError(t('claims.errors.noPolicy')); return }
    if (!form.claimType) { setError(t('claims.errors.noType')); return }
    if (!form.description.trim()) { setError(t('claims.errors.noDescription')); return }
    const title = form.claimType === 'Outro' ? (form.customTitle || 'Outro Sinistro') : form.claimType
    setSubmitting(true)
    try {
      await onSubmit({
        policyId: form.policyId,
        companyId: selectedPolicy?.companyId || '',
        title,
        description: form.description,
        incidentDate: form.incidentDate,
        estimatedValue: parseFloat(form.estimatedValue) || 0,
      })
    } catch {
      setError(t('claims.errors.submitFailed'))
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-[4px] border border-gold-400 shadow-lg p-6 mb-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-navy-700">{t('claims.registerTitle')}</h2>
          <p className="text-sm text-navy-500 mt-0.5">{t('claims.registerSubtitle')}</p>
        </div>
        <button onClick={onClose} className="text-navy-400 hover:text-navy-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1">{t('claims.claimType')}</label>
            <select
              value={form.claimType}
              onChange={(e) => setForm((f) => ({ ...f, claimType: e.target.value }))}
              className="w-full px-3 py-2 border border-navy-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gold-400"
              required
            >
              <option value="">{t('claims.selectType')}</option>
              {CLAIM_TYPES.map((ct) => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
            </select>
          </div>

          {form.claimType === 'Outro' && (
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">{t('claims.customTitle')}</label>
              <input
                type="text"
                value={form.customTitle}
                onChange={(e) => setForm((f) => ({ ...f, customTitle: e.target.value }))}
                placeholder={t('claims.customTitlePlaceholder')}
                className="w-full px-3 py-2 border border-navy-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gold-400"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1">{t('claims.associatedPolicy')}</label>
            <select
              value={form.policyId}
              onChange={(e) => setForm((f) => ({ ...f, policyId: e.target.value }))}
              className="w-full px-3 py-2 border border-navy-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gold-400"
              required
            >
              <option value="">{t('claims.selectPolicy')}</option>
              {policies.filter((p) => p.status === 'active' || p.status === 'expiring').map((p) => (
                <option key={p.id} value={p.id}>
                  {p.policyNumber} — {POLICY_TYPE_LABELS[p.type] || p.type} ({p.insurer})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1">{t('claims.incidentDateLabel')}</label>
            <input
              type="date"
              value={form.incidentDate}
              onChange={(e) => setForm((f) => ({ ...f, incidentDate: e.target.value }))}
              max={new Date().toISOString().split('T')[0]}
              className="w-full px-3 py-2 border border-navy-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gold-400"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1">{t('claims.estimatedValue')}</label>
            <input
              type="number"
              value={form.estimatedValue}
              onChange={(e) => setForm((f) => ({ ...f, estimatedValue: e.target.value }))}
              placeholder="0.00"
              min="0"
              step="0.01"
              className="w-full px-3 py-2 border border-navy-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gold-400"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1">{t('claims.descriptionLabel')}</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder={t('claims.descriptionPlaceholder')}
            rows={4}
            className="w-full px-3 py-2 border border-navy-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 resize-none"
            required
          />
        </div>

        <div className="bg-navy-50 rounded p-4 text-sm text-navy-600">
          <p className="font-medium mb-1">{t('claims.afterSubmitTitle')}</p>
          <ol className="list-decimal list-inside space-y-1 text-navy-500">
            <li dangerouslySetInnerHTML={{ __html: t('claims.afterSubmit1') }} />
            <li>{t('claims.afterSubmit2')}</li>
            <li>{t('claims.afterSubmit3')}</li>
          </ol>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-navy-200 text-navy-600 rounded hover:bg-navy-50">
            {t('claims.cancel')}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2 bg-gold-400 text-navy-700 font-semibold text-sm rounded-[2px] hover:bg-gold-300 disabled:opacity-50 flex items-center gap-2"
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-navy-700 border-t-transparent rounded-full animate-spin" />
                {t('claims.registering')}
              </>
            ) : t('claims.register')}
          </button>
        </div>
      </form>
    </div>
  )
}
