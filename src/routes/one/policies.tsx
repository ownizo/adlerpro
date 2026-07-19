import { createFileRoute } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { useState, useEffect, useRef } from 'react'
import { OneLayout } from './__root'
import { oneT, oneBrand, fmtCurrency, fmtDate, typeLabel } from '@/lib/one-brand'
import { adminDeletePolicyDocument, createPolicy, deletePolicy, fetchPolicyDocuments, getDocumentUrl } from '@/lib/server-fns'

export const Route = createFileRoute('/one/policies')({
  component: OnePolicies,
  ssr: false,
  head: () => ({ meta: [{ title: oneBrand().docTitle }] }),
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
  deductible?: number | null
  coverages?: string[] | null
  exclusions?: string[] | null
  company_id?: string
}

interface PolicyDoc {
  id: string
  name: string
  storagePath: string
  size: number
  mimeType: string
  uploadedAt: string
}

type PolicyDraft = {
  name: string
  type: string
  insurer: string
  policyNumber: string
  startDate: string
  endDate: string
  annualPremium: number
  insuredValue: number
  deductible: number
  coverages: string[]
  exclusions: string[]
}

function formatDocSize(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  ativa:     { bg: '#EAF3DE', color: '#3B6D11' },
  active:    { bg: '#EAF3DE', color: '#3B6D11' },
  expiring:  { bg: '#FAEEDA', color: '#854F0B' },
  expired:   { bg: '#FEE2E2', color: '#991B1B' },
  cancelled: { bg: '#F3F4F6', color: '#6B7280' },
}

function daysUntil(dateStr: string): number {
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function OnePolicies() {
  const t = oneT()
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [extracting, setExtracting] = useState(false)
  const [addError, setAddError] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [draft, setDraft] = useState({
    name: '', type: '', insurer: '', policyNumber: '', startDate: '', endDate: '',
    annualPremium: 0, insuredValue: 0, deductible: 0, coverages: [] as string[], exclusions: [] as string[],
  })
  const addFileRef = useRef<HTMLInputElement>(null)

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
          // Apenas campos visíveis ao cliente. NUNCA inclui campos internos
          // (commission_percentage, commission_value, notes_internal).
          .select('id, policy_number, type, insurer, annual_premium, start_date, end_date, renewal_date, status, description, payment_frequency, deductible, coverages, exclusions, company_id')
          .eq('individual_client_id', clientId)
          .order('end_date', { ascending: true })
        if (pErr) throw pErr
        setPolicies(data ?? [])
      }
    } catch (e: any) {
      setError(t.policies.loadError)
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function handlePolicyFile(file: File | undefined) {
    if (!file) return
    setExtracting(true)
    setAddError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error(t.policies.addAuthError)
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/extract-policy', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      })
      const extracted = await response.json()
      if (!response.ok) throw new Error(extracted.error || t.policies.addReadError)
      setPendingFile(file)
      setDraft({
        name: extracted.name || file.name,
        type: extracted.type || 'other',
        insurer: extracted.insurer || '',
        policyNumber: extracted.policyNumber || '',
        startDate: extracted.startDate || '',
        endDate: extracted.endDate || '',
        annualPremium: Number(extracted.annualPremium) || 0,
        insuredValue: Number(extracted.insuredValue) || 0,
        deductible: Number(extracted.deductible) || 0,
        coverages: Array.isArray(extracted.coverages) ? extracted.coverages : [],
        exclusions: Array.isArray(extracted.exclusions) ? extracted.exclusions : [],
      })
      setShowAdd(true)
    } catch (e: any) {
      setAddError(e.message || t.policies.addReadError)
    } finally {
      setExtracting(false)
      if (addFileRef.current) addFileRef.current.value = ''
    }
  }

  async function savePolicy(event: React.FormEvent) {
    event.preventDefault()
    if (!pendingFile) return
    setSaving(true)
    setAddError('')
    try {
      const created = await createPolicy({
        data: {
          type: draft.type,
          insurer: draft.insurer,
          policyNumber: draft.policyNumber,
          description: draft.name,
          startDate: draft.startDate,
          endDate: draft.endDate,
          annualPremium: draft.annualPremium,
          insuredValue: draft.insuredValue,
          deductible: draft.deductible,
          coverages: draft.coverages,
          exclusions: draft.exclusions,
        },
      })
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error(t.policies.addAuthError)
      const formData = new FormData()
      formData.append('policyId', created.id)
      formData.append('file', pendingFile)
      const response = await fetch('/api/policy-document', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      })
      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        await deletePolicy({ data: created.id }).catch(() => undefined)
        throw new Error(result.error || t.policies.addSaveError)
      }
      setShowAdd(false)
      setPendingFile(null)
      await loadData()
    } catch (e: any) {
      setAddError(e.message || t.policies.addSaveError)
    } finally {
      setSaving(false)
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
          <div style={{ marginBottom: '1.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: navy, margin: 0 }}>{t.policies.title}</h1>
              <p style={{ fontSize: '0.82rem', color: '#64748B', marginTop: '0.3rem' }}>{t.policies.count(policies.length)}</p>
            </div>
            <button
              type="button"
              disabled={extracting}
              onClick={() => addFileRef.current?.click()}
              style={{ background: gold, color: '#fff', border: 0, borderRadius: 6, padding: '0.65rem 1rem', fontSize: '0.82rem', fontWeight: 700, cursor: extracting ? 'wait' : 'pointer', opacity: extracting ? 0.7 : 1 }}
            >
              {extracting ? t.policies.extracting : t.policies.addPolicy}
            </button>
            <input ref={addFileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden onChange={(event) => handlePolicyFile(event.target.files?.[0])} />
          </div>

          {addError && <ErrorMsg msg={addError} />}

          {policies.length === 0 ? (
            <EmptyState msg={t.policies.none} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {policies.map(p => (
                <PolicyCard
                  key={p.id}
                  policy={p}
                  onDeleted={() => setPolicies((current) => current.filter((item) => item.id !== p.id))}
                />
              ))}
            </div>
          )}
          {showAdd && (
            <AddPolicyModal
              draft={draft}
              file={pendingFile}
              saving={saving}
              error={addError}
              onChange={setDraft}
              onClose={() => { setShowAdd(false); setPendingFile(null); setAddError('') }}
              onSubmit={savePolicy}
            />
          )}
        </>
      )}
    </OneLayout>
  )
}

function PolicyCard({ policy, onDeleted }: { policy: Policy; onDeleted: () => void }) {
  const t = oneT()
  const [expanded,    setExpanded]    = useState(false)
  const [docs,        setDocs]        = useState<PolicyDoc[]>([])
  const [docsLoaded,  setDocsLoaded]  = useState(false)
  const [docsLoading, setDocsLoading] = useState(false)
  const [uploading,   setUploading]   = useState(false)
  const [uploadMsg,   setUploadMsg]   = useState('')
  const [previewUrl,  setPreviewUrl]  = useState<string | null>(null)
  const [previewName, setPreviewName] = useState('')
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null)
  const [deletingPolicy, setDeletingPolicy] = useState(false)
  const docFileRef = useRef<HTMLInputElement>(null)

  const st = STATUS_STYLE[policy.status] ?? { bg: '#F3F4F6', color: '#6B7280' }
  const stLabel = t.policyStatus[policy.status as keyof typeof t.policyStatus] ?? policy.status
  const label = typeLabel(policy.type)
  const days = policy.end_date ? daysUntil(policy.end_date) : null
  const urgency = days !== null && days <= 14 ? '#EF4444' : days !== null && days <= 30 ? '#F59E0B' : gold

  async function loadDocs() {
    if (docsLoaded) return
    setDocsLoading(true)
    try {
      const data = await fetchPolicyDocuments({ data: { policyId: policy.id, companyId: policy.company_id } })
      setDocs(data)
    } catch (e) {
      console.error('loadDocs error', e)
    } finally {
      setDocsLoaded(true)
      setDocsLoading(false)
    }
  }

  async function handleExpand() {
    const next = !expanded
    setExpanded(next)
    if (next && !docsLoaded) loadDocs()
  }

  async function handleDocPreview(doc: PolicyDoc) {
    try {
      const { url } = await getDocumentUrl({ data: { storagePath: doc.storagePath } })
      setPreviewName(doc.name)
      setPreviewUrl(url)
    } catch (e: any) {
      alert(t.documents.openError + e.message)
    }
  }

  async function handleDocUpload(files: FileList | null) {
    if (!files || !files.length) return
    setUploading(true)
    setUploadMsg(t.policies.uploading)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    for (const file of Array.from(files)) {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('policyId', policy.id)
      try {
        const response = await fetch('/api/policy-document', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: fd,
        })
        if (!response.ok) throw new Error('upload error')
      } catch (e) {
        console.error('upload error', e)
      }
    }

    if (docFileRef.current) docFileRef.current.value = ''
    setUploading(false)
    setDocsLoaded(false)
    setUploadMsg(t.policies.uploaded)
    setTimeout(() => { setUploadMsg(''); loadDocs() }, 800)
  }

  async function handleDocDelete(doc: PolicyDoc) {
    if (!window.confirm(t.policies.confirmDeleteDocument.replace('{name}', doc.name))) return
    setDeletingDocId(doc.id)
    try {
      await adminDeletePolicyDocument({ data: { storagePath: doc.storagePath } })
      setDocs((current) => current.filter((item) => item.id !== doc.id))
    } catch {
      window.alert(t.policies.deleteFailed)
    } finally {
      setDeletingDocId(null)
    }
  }

  async function handlePolicyDelete() {
    if (!window.confirm(t.policies.confirmDeletePolicy)) return
    setDeletingPolicy(true)
    try {
      await deletePolicy({ data: policy.id })
      onDeleted()
    } catch {
      window.alert(t.policies.deleteFailed)
      setDeletingPolicy(false)
    }
  }

  return (
    <>
      <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
        <button
          onClick={handleExpand}
          style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '1rem 1.25rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 700, color: navy }}>{label}</span>
              <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '0.15rem 0.55rem', borderRadius: 20, background: st.bg, color: st.color }}>{stLabel}</span>
            </div>
            <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '0.2rem 0 0' }}>
              {policy.insurer}{policy.policy_number ? ` · ${policy.policy_number}` : ''}
            </p>
            {policy.description && (
              <p style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 500, margin: '0.15rem 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {policy.description}
              </p>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            {policy.annual_premium > 0 && (
              <p style={{ fontSize: '0.9rem', fontWeight: 700, color: navy, margin: 0 }}>
                {fmtCurrency(policy.annual_premium)}
                <span style={{ fontSize: '0.65rem', fontWeight: 400, color: '#94A3B8' }}>{t.policies.perYear}</span>
              </p>
            )}
            {days !== null && (
              <p style={{ fontSize: '0.7rem', color: urgency, fontWeight: 600, margin: '0.1rem 0 0' }}>
                {days > 0 ? t.policies.renewsIn(days) : days === 0 ? t.policies.renewsToday : t.policies.expired}
              </p>
            )}
          </div>
        </button>

        {expanded && (
          <div style={{ borderTop: '1px solid #F1F5F9', padding: '0.85rem 1.25rem', background: '#F8FAFC' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', marginBottom: '1rem' }}>
              {policy.start_date        && <DetailItem label={t.detail.start}     value={fmtDate(policy.start_date)} />}
              {policy.end_date          && <DetailItem label={t.detail.end}        value={fmtDate(policy.end_date)} />}
              {policy.renewal_date      && <DetailItem label={t.detail.renewal}  value={fmtDate(policy.renewal_date)} />}
              {policy.payment_frequency && <DetailItem label={t.detail.payment}  value={policy.payment_frequency} />}
              {policy.deductible != null && <DetailItem label={t.detail.deductible}   value={fmtCurrency(policy.deductible)} />}
              {policy.description       && <DetailItem label={t.detail.description}  value={policy.description} span />}
            </div>

            {/* Coberturas e exclusões (read-only) */}
            {policy.coverages && policy.coverages.length > 0 && (
              <PolicyClauseList title={t.policies.coverages} items={policy.coverages} tone="cover" />
            )}
            {policy.exclusions && policy.exclusions.length > 0 && (
              <PolicyClauseList title={t.policies.exclusions} items={policy.exclusions} tone="exclude" />
            )}

            {/* Documentos da apólice */}
            <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                <p style={{ fontSize: '0.65rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
                  {t.policies.documents} {docs.length > 0 ? `(${docs.length})` : ''}
                </p>
                <label style={{ fontSize: '0.72rem', fontWeight: 600, padding: '0.28rem 0.65rem', background: uploading ? '#94A3B8' : navy, color: '#fff', borderRadius: 6, cursor: uploading ? 'not-allowed' : 'pointer', fontFamily: "'Montserrat', sans-serif", display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  {uploading ? <><span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'one-spin 0.75s linear infinite' }} /> {t.policies.uploading}</> : t.policies.addDocument}
                  <input ref={docFileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple style={{ display: 'none' }} disabled={uploading} onChange={e => handleDocUpload(e.target.files)} />
                </label>
              </div>
              {uploadMsg && <p style={{ fontSize: '0.75rem', color: '#16A34A', fontWeight: 600, margin: '0 0 0.5rem' }}>✓ {uploadMsg}</p>}
              {docsLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem' }}>
                  <div style={{ width: 18, height: 18, border: `2px solid ${gold}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'one-spin 0.75s linear infinite' }} />
                </div>
              ) : docs.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: '#94A3B8', textAlign: 'center', padding: '0.75rem 0', margin: 0 }}>{t.policies.noDocs}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  {docs.map(doc => {
                    const isPdf = doc.name.toLowerCase().endsWith('.pdf')
                    const isImg = /\.(jpg|jpeg|png|webp)$/i.test(doc.name)
                    return (
                      <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0.7rem', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 6 }}>
                        <span style={{ fontSize: '1rem', flexShrink: 0 }}>{isPdf ? '📄' : isImg ? '🖼️' : '📎'}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: '0.78rem', fontWeight: 600, color: navy, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</p>
                          <p style={{ fontSize: '0.65rem', color: '#94A3B8', margin: 0 }}>{formatDocSize(doc.size)}</p>
                        </div>
                        <button
                          onClick={() => handleDocPreview(doc)}
                          style={{ padding: '0.25rem 0.6rem', background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE', borderRadius: 6, cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600, flexShrink: 0, fontFamily: "'Montserrat', sans-serif" }}
                        >{t.policies.view}</button>
                        <button
                          type="button"
                          disabled={deletingDocId === doc.id}
                          onClick={() => handleDocDelete(doc)}
                          style={{ padding: '0.25rem 0.6rem', background: '#FFF1F2', color: '#BE123C', border: '1px solid #FECDD3', borderRadius: 6, cursor: deletingDocId === doc.id ? 'wait' : 'pointer', fontSize: '0.7rem', fontWeight: 600, flexShrink: 0, opacity: deletingDocId === doc.id ? 0.65 : 1 }}
                        >{deletingDocId === doc.id ? t.policies.deleting : t.policies.deleteDocument}</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div style={{ borderTop: '1px solid #E2E8F0', marginTop: '1rem', paddingTop: '0.85rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={deletingPolicy}
                onClick={handlePolicyDelete}
                style={{ padding: '0.45rem 0.8rem', background: '#FFF1F2', color: '#BE123C', border: '1px solid #FECDD3', borderRadius: 6, cursor: deletingPolicy ? 'wait' : 'pointer', fontSize: '0.72rem', fontWeight: 700, opacity: deletingPolicy ? 0.65 : 1 }}
              >
                {deletingPolicy ? t.policies.deleting : t.policies.deletePolicy}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Preview modal */}
      {previewUrl && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={() => setPreviewUrl(null)}
        >
          <div
            style={{ background: '#fff', borderRadius: 8, width: '100%', maxWidth: '900px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ fontWeight: 600, fontSize: '0.85rem', color: navy, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previewName}</p>
              <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                <a href={previewUrl} target="_blank" rel="noreferrer" style={{ padding: '0.3rem 0.75rem', background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE', borderRadius: 6, textDecoration: 'none', fontSize: '0.78rem', fontWeight: 600 }}>{t.policies.open}</a>
                <button onClick={() => setPreviewUrl(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: '1.25rem' }}>×</button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {/\.(jpg|jpeg|png|webp)$/i.test(previewName) ? (
                <img src={previewUrl} alt={previewName} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <iframe src={previewUrl} title={previewName} style={{ width: '100%', height: '70vh', border: 'none' }} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function AddPolicyModal({ draft, file, saving, error, onChange, onClose, onSubmit }: {
  draft: PolicyDraft
  file: File | null
  saving: boolean
  error: string
  onChange: (draft: PolicyDraft) => void
  onClose: () => void
  onSubmit: (event: React.FormEvent) => void
}) {
  const t = oneT()
  const inputStyle: React.CSSProperties = {
    width: '100%', border: '1px solid #CBD5E1', borderRadius: 6, padding: '0.6rem 0.7rem',
    fontSize: '0.82rem', color: navy, background: '#fff', boxSizing: 'border-box',
  }
  const field = (key: keyof PolicyDraft, value: string | number) => onChange({ ...draft, [key]: value })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(10,22,40,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={onClose}>
      <div style={{ width: '100%', maxWidth: 620, maxHeight: '92vh', overflowY: 'auto', background: '#fff', borderRadius: 8 }} onClick={(event) => event.stopPropagation()}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1rem', color: navy }}>{t.policies.addTitle}</h2>
            {file && <p style={{ margin: '0.2rem 0 0', fontSize: '0.72rem', color: '#64748B' }}>{file.name} · {formatDocSize(file.size)}</p>}
          </div>
          <button type="button" onClick={onClose} style={{ border: 0, background: 'none', fontSize: '1.3rem', color: '#64748B', cursor: 'pointer' }}>×</button>
        </div>
        <form onSubmit={onSubmit} style={{ padding: '1.25rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.9rem' }}>
          <label style={{ gridColumn: '1 / -1', fontSize: '0.72rem', fontWeight: 700, color: '#64748B' }}>
            {t.policies.fieldName}
            <input value={draft.name} onChange={(event) => field('name', event.target.value)} style={{ ...inputStyle, marginTop: '0.3rem' }} />
          </label>
          <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748B' }}>
            {t.policies.fieldType}
            <select required value={draft.type} onChange={(event) => field('type', event.target.value)} style={{ ...inputStyle, marginTop: '0.3rem' }}>
              <option value="">—</option>
              {['auto', 'health', 'property', 'life', 'liability', 'workers_comp', 'cyber', 'directors_officers', 'business_interruption', 'other'].map((value) => (
                <option key={value} value={value}>{typeLabel(value)}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748B' }}>
            {t.policies.fieldInsurer}
            <input required value={draft.insurer} onChange={(event) => field('insurer', event.target.value)} style={{ ...inputStyle, marginTop: '0.3rem' }} />
          </label>
          <label style={{ gridColumn: '1 / -1', fontSize: '0.72rem', fontWeight: 700, color: '#64748B' }}>
            {t.policies.fieldNumber}
            <input value={draft.policyNumber} onChange={(event) => field('policyNumber', event.target.value)} style={{ ...inputStyle, marginTop: '0.3rem' }} />
          </label>
          <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748B' }}>
            {t.policies.fieldStart}
            <input required type="date" value={draft.startDate} onChange={(event) => field('startDate', event.target.value)} style={{ ...inputStyle, marginTop: '0.3rem' }} />
          </label>
          <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748B' }}>
            {t.policies.fieldEnd}
            <input required type="date" value={draft.endDate} onChange={(event) => field('endDate', event.target.value)} style={{ ...inputStyle, marginTop: '0.3rem' }} />
          </label>
          {error && <p style={{ gridColumn: '1 / -1', margin: 0, color: '#B91C1C', fontSize: '0.78rem' }}>{error}</p>}
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', paddingTop: '0.3rem' }}>
            <button type="button" onClick={onClose} style={{ border: '1px solid #CBD5E1', background: '#fff', color: navy, borderRadius: 6, padding: '0.6rem 1rem', cursor: 'pointer' }}>{t.policies.cancel}</button>
            <button disabled={saving} type="submit" style={{ border: 0, background: gold, color: '#fff', borderRadius: 6, padding: '0.6rem 1rem', fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}>{saving ? t.policies.saving : t.policies.savePolicy}</button>
          </div>
        </form>
      </div>
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

// Lista read-only de coberturas / exclusões (arrays de texto da apólice).
function PolicyClauseList({ title, items, tone }: { title: string; items: string[]; tone: 'cover' | 'exclude' }) {
  const accent = tone === 'cover' ? '#3B6D11' : '#B91C1C'
  const dotBg  = tone === 'cover' ? '#EAF3DE' : '#FEE2E2'
  const mark   = tone === 'cover' ? '✓' : '✕'
  return (
    <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '0.85rem', marginBottom: '1rem' }}>
      <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.65rem' }}>
        {title} ({items.length})
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {items.map((item, i) => (
          <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
            <span style={{ marginTop: 1, flexShrink: 0, width: 20, height: 20, borderRadius: '50%', background: dotBg, color: accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 700 }}>
              {mark}
            </span>
            <span style={{ fontSize: '0.9rem', color: '#1E293B', lineHeight: 1.5 }}>{item}</span>
          </li>
        ))}
      </ul>
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
