import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  fetchPortalClaims, fetchPortalClaim, submitPortalClaim, addClaimMessage,
  getStorageUploadUrl, registerClaimDocument, getClaimDocumentUrl,
} from '@/lib/server-fns'
import type { PortalClaim, PortalPolicy } from '@/lib/server-fns'
import {
  PortalLayout, PageTitle, Card, Pill, Empty, Spinner, ErrorNote, C,
  money, date, dateTime, fileSize, policyType, claimStatus, claimTone, button, input, label, openDocument, FileButton, todayIso,
} from '@/components/portal/portal-ui'

export const Route = createFileRoute('/portal/claims')({
  component: PortalClaims,
  ssr: false,
  head: () => ({ meta: [{ title: 'Claims — MillionGuard' }] }),
})

function PortalClaims() {
  const [claims, setClaims] = useState<PortalClaim[] | null>(null)
  const [policies, setPolicies] = useState<PortalPolicy[]>([])
  const [error, setError] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = () => {
    setError('')
    return fetchPortalClaims()
      .then((r) => { setClaims(r.claims); setPolicies(r.policies) })
      .catch(() => setError('We could not load your claims.'))
  }

  useEffect(() => { load() }, [])

  const policyName = (id: string) => {
    const p = policies.find((x) => x.id === id)
    return p ? `${policyType(p.type)} · ${p.insurer}` : ''
  }

  return (
    <PortalLayout>
      <PageTitle
        title="Claims"
        subtitle="Report a claim and follow it with us, message by message."
        action={!showNew && policies.length > 0 ? <button style={button()} onClick={() => setShowNew(true)}>Report a claim</button> : undefined}
      />
      {error && <ErrorNote onRetry={load}>{error}</ErrorNote>}
      {showNew && (
        <NewClaim
          policies={policies}
          onCancel={() => setShowNew(false)}
          onCreated={(id) => { setShowNew(false); setOpenId(id); load() }}
        />
      )}
      {!claims && !error && <Spinner />}
      {claims && (
        claims.length === 0 ? (
          <Card><Empty>No claims reported.{policies.length > 0 ? ' If something happened, report it here and we take it from there.' : ''}</Empty></Card>
        ) : (
          <div className="mg-grid">
            {claims.map((c) => (
              <Card key={c.id} style={{ padding: 0 }}>
                <button className="mg-list-btn" style={{ padding: 18 }} aria-expanded={openId === c.id} onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{c.title}</p>
                      <p style={{ margin: '4px 0 0', fontSize: 13, color: C.body }}>
                        {policyName(c.policyId) || 'Policy'} · Incident {date(c.incidentDate)}
                      </p>
                    </div>
                    <Pill tone={claimTone(c.status)}>{claimStatus(c.status)}</Pill>
                  </div>
                </button>
                {openId === c.id && <ClaimDetail claimId={c.id} />}
              </Card>
            ))}
          </div>
        )
      )}
    </PortalLayout>
  )
}

function NewClaim({ policies, onCancel, onCreated }: { policies: PortalPolicy[]; onCancel: () => void; onCreated: (id: string) => void }) {
  const [policyId, setPolicyId] = useState(policies[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [incidentDate, setIncidentDate] = useState('')
  const [description, setDescription] = useState('')
  const [estimate, setEstimate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const r = await submitPortalClaim({
        data: { policyId, title, description, incidentDate, estimatedValue: Number(estimate.replace(',', '.')) || 0 },
      })
      onCreated(r.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The claim could not be sent. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Report a claim</h2>
      <p style={{ margin: '0 0 16px', color: C.body, fontSize: 14 }}>Tell us what happened. You can add photos and documents right after.</p>
      {error && <ErrorNote>{error}</ErrorNote>}
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
        <div>
          <label style={label} htmlFor="mg-pol">Policy</label>
          <select id="mg-pol" value={policyId} onChange={(e) => setPolicyId(e.target.value)} style={input} required>
            {policies.map((p) => <option key={p.id} value={p.id}>{policyType(p.type)} · {p.insurer}{p.policyNumber ? ` · ${p.policyNumber}` : ''}</option>)}
          </select>
        </div>
        <div className="mg-two" style={{ gap: 14 }}>
          <div>
            <label style={label} htmlFor="mg-title">What happened, in a few words</label>
            <input id="mg-title" value={title} onChange={(e) => setTitle(e.target.value)} style={input} required maxLength={120} placeholder="e.g. Water damage in the kitchen" />
          </div>
          <div>
            <label style={label} htmlFor="mg-date">Date of the incident</label>
            <input id="mg-date" type="date" value={incidentDate} max={todayIso()} onChange={(e) => setIncidentDate(e.target.value)} style={input} required />
          </div>
        </div>
        <div>
          <label style={label} htmlFor="mg-desc">Description</label>
          <textarea id="mg-desc" value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...input, minHeight: 110, resize: 'vertical' }} required placeholder="Where and how it happened, what was damaged, anyone else involved." />
        </div>
        <div style={{ maxWidth: 260 }}>
          <label style={label} htmlFor="mg-est">Estimated loss (€, optional)</label>
          <input id="mg-est" inputMode="decimal" value={estimate} onChange={(e) => setEstimate(e.target.value)} style={input} />
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="submit" disabled={busy} style={{ ...button(), opacity: busy ? 0.6 : 1 }}>{busy ? 'Sending…' : 'Send claim'}</button>
          <button type="button" onClick={onCancel} style={button('ghost')}>Cancel</button>
        </div>
      </form>
    </Card>
  )
}

function ClaimDetail({ claimId }: { claimId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchPortalClaim>> | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)

  const load = () => {
    setError('')
    return fetchPortalClaim({ data: { claimId } }).then(setData).catch(() => setError('This claim could not be loaded.'))
  }
  useEffect(() => { load() }, [claimId])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!message.trim()) return
    setSending(true)
    try {
      await addClaimMessage({ data: { claimId, body: message.trim() } })
      setMessage('')
      await load()
    } catch {
      setError('The message could not be sent. Please try again.')
    } finally {
      setSending(false)
    }
  }

  async function upload(file: File) {
    setUploading(true)
    setError('')
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_')
      const storagePath = `claims/${claimId}/${Date.now()}-${safe}`
      const { token, path } = await getStorageUploadUrl({ data: { storagePath } })
      const { error: upErr } = await supabase.storage.from('documents').uploadToSignedUrl(path, token, file)
      if (upErr) throw upErr
      await registerClaimDocument({ data: { claimId, name: file.name, contentType: file.type || 'application/octet-stream', storagePath, size: file.size } })
      await load()
    } catch {
      setError('The file could not be uploaded. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  async function open(documentId: string) {
    setError('')
    try {
      await openDocument(async () => (await getClaimDocumentUrl({ data: { claimId, documentId } })).url)
    } catch {
      setError('This file could not be opened.')
    }
  }

  if (!data) return <div style={{ borderTop: `1px solid ${C.line}`, padding: 18 }}>{error ? <ErrorNote onRetry={load}>{error}</ErrorNote> : <Spinner />}</div>

  const c = data.claim
  return (
    <div style={{ borderTop: `1px solid ${C.line}`, padding: 18, display: 'grid', gap: 18 }}>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, fontSize: 14 }}>
        <div><p style={{ margin: 0, fontSize: 12, color: C.muted, fontWeight: 600 }}>Reported</p><p style={{ margin: '3px 0 0' }}>{date(c.claimDate || c.createdAt)}</p></div>
        {c.estimatedValue > 0 && <div><p style={{ margin: 0, fontSize: 12, color: C.muted, fontWeight: 600 }}>Estimated loss</p><p style={{ margin: '3px 0 0' }}>{money(c.estimatedValue)}</p></div>}
        {data.responsibleName && <div><p style={{ margin: 0, fontSize: 12, color: C.muted, fontWeight: 600 }}>Handled by</p><p style={{ margin: '3px 0 0' }}>{data.responsibleName}</p></div>}
      </div>
      {c.description && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: C.body, whiteSpace: 'pre-wrap' }}>{c.description}</p>}

      <div>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Messages</h3>
        {data.messages.length === 0 ? <p style={{ margin: 0, fontSize: 13, color: C.muted }}>No messages yet.</p> : (
          <div style={{ display: 'grid', gap: 10 }}>
            {data.messages.map((m) => {
              const mine = m.senderRole === 'client'
              return (
                <div key={m.id} style={{ justifySelf: mine ? 'end' : 'start', maxWidth: '85%', background: mine ? C.ink : '#F1F0EE', color: mine ? '#fff' : C.ink, padding: '10px 14px', borderRadius: 14 }}>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.body}</p>
                  <p style={{ margin: '6px 0 0', fontSize: 11, opacity: 0.7 }}>{mine ? 'You' : m.senderName || 'Adler & Rochefort'} · {dateTime(m.createdAt)}</p>
                </div>
              )
            })}
          </div>
        )}
        <form onSubmit={send} style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <textarea aria-label="Write a message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write a message to your agent" style={{ ...input, flex: '1 1 260px', minHeight: 48, resize: 'vertical' }} />
          <button type="submit" disabled={sending || !message.trim()} style={{ ...button(), opacity: sending || !message.trim() ? 0.5 : 1 }}>{sending ? 'Sending…' : 'Send'}</button>
        </form>
      </div>

      <div>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Photos and documents</h3>
        {data.documents.length > 0 && (
          <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
            {data.documents.map((d) => (
              <FileButton key={d.id} name={d.name} meta={[fileSize(d.size), date(d.uploadedAt)].filter(Boolean).join(' · ')} onClick={() => open(d.id)} />
            ))}
          </div>
        )}
        <label style={{ ...button('ghost'), display: 'inline-flex', alignItems: 'center', opacity: uploading ? 0.6 : 1 }}>
          {uploading ? 'Uploading…' : 'Add a photo or document'}
          <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
        </label>
      </div>
    </div>
  )
}
