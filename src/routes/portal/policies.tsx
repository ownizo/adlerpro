import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { fetchPortalPolicies, fetchPolicyDocuments, getDocumentUrl } from '@/lib/server-fns'
import {
  PortalLayout, PageTitle, Card, Pill, Empty, Spinner, ErrorNote, C,
  money, date, fileSize, policyType, policyTone, POLICY_STATUS_EN,
} from '@/components/portal/portal-ui'
import type { PortalPolicy } from '@/lib/server-fns'

export const Route = createFileRoute('/portal/policies')({
  component: PortalPolicies,
  ssr: false,
  head: () => ({ meta: [{ title: 'Policies — MillionGuard' }] }),
})

type Filter = 'current' | 'all'

function PortalPolicies() {
  const [policies, setPolicies] = useState<PortalPolicy[] | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('current')
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    fetchPortalPolicies().then(setPolicies).catch(() => setError('We could not load your policies. Please refresh the page.'))
  }, [])

  const shown = (policies ?? []).filter((p) => filter === 'all' || p.status === 'active' || p.status === 'expiring')

  return (
    <PortalLayout>
      <PageTitle
        title="Policies"
        subtitle="Cover, limits and documents of every policy we arranged for you."
        action={
          <div style={{ display: 'inline-flex', background: '#fff', border: `1px solid ${C.line}`, borderRadius: 10, padding: 3 }}>
            {(['current', 'all'] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)} style={{ border: 0, borderRadius: 8, padding: '8px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: filter === f ? C.ink : 'transparent', color: filter === f ? '#fff' : C.body }}>
                {f === 'current' ? 'Current' : 'All'}
              </button>
            ))}
          </div>
        }
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      {!policies && !error && <Spinner />}
      {policies && (
        shown.length === 0 ? <Card><Empty>No policies to show.</Empty></Card> : (
          <div className="mg-grid">
            {shown.map((p) => (
              <PolicyCard key={p.id} policy={p} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)} />
            ))}
          </div>
        )
      )}
    </PortalLayout>
  )
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div>
      <p style={{ margin: 0, fontSize: 12, color: C.muted, fontWeight: 600 }}>{label}</p>
      <p style={{ margin: '3px 0 0', fontSize: 14, color: C.ink, whiteSpace: 'pre-wrap' }}>{value}</p>
    </div>
  )
}

function PolicyCard({ policy: p, open, onToggle }: { policy: PortalPolicy; open: boolean; onToggle: () => void }) {
  return (
    <Card style={{ padding: 0 }}>
      <button className="mg-list-btn" onClick={onToggle} aria-expanded={open} style={{ padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{policyType(p.type)}</p>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: C.body }}>{p.insurer}{p.policyNumber ? ` · No. ${p.policyNumber}` : ''}</p>
          </div>
          <Pill tone={policyTone(p.status)}>{POLICY_STATUS_EN[p.status] ?? p.status}</Pill>
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 12, fontSize: 13, color: C.body }}>
          <span>{date(p.startDate)} → {date(p.endDate)}</span>
          {p.annualPremium > 0 && <span>Premium {money(p.annualPremium)}/year</span>}
          {p.insuredValue > 0 && <span>Sum insured {money(p.insuredValue)}</span>}
        </div>
      </button>
      {open && <PolicyDetail policy={p} />}
    </Card>
  )
}

function PolicyDetail({ policy: p }: { policy: PortalPolicy }) {
  const [docs, setDocs] = useState<Awaited<ReturnType<typeof fetchPolicyDocuments>> | null>(null)
  const [docError, setDocError] = useState('')

  useEffect(() => {
    fetchPolicyDocuments({ data: { policyId: p.id } })
      .then(setDocs)
      .catch(() => { setDocs([]); setDocError('Documents are not available right now.') })
  }, [p.id])

  async function download(storagePath: string) {
    try {
      const { url } = await getDocumentUrl({ data: { storagePath } })
      window.open(url, '_blank', 'noopener')
    } catch {
      setDocError('This document could not be opened. Please try again.')
    }
  }

  return (
    <div style={{ borderTop: `1px solid ${C.line}`, padding: 18, display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <Field label="Description" value={p.description} />
        <Field label="Excess" value={p.deductible ? money(p.deductible) : undefined} />
        <Field label="Payment" value={p.paymentFrequency} />
        <Field label="Emergency contacts" value={p.emergencyContacts} />
      </div>
      {!!p.coverages?.length && (
        <div>
          <p style={{ margin: '0 0 6px', fontSize: 12, color: C.muted, fontWeight: 600 }}>Main cover</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>{p.coverages.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}
      {!!p.exclusions?.length && (
        <div>
          <p style={{ margin: '0 0 6px', fontSize: 12, color: C.muted, fontWeight: 600 }}>Main exclusions</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>{p.exclusions.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}
      <div>
        <p style={{ margin: '0 0 6px', fontSize: 12, color: C.muted, fontWeight: 600 }}>Documents</p>
        {docError && <p style={{ margin: '0 0 8px', fontSize: 13, color: C.bad }}>{docError}</p>}
        {!docs ? <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Loading…</p> : docs.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: C.muted }}>No documents for this policy yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {docs.map((d) => (
              <button key={d.id} onClick={() => download(d.storagePath)} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: '10px 12px', border: `1px solid ${C.line}`, borderRadius: 10, background: '#fff', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}>
                <span style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
                <span style={{ fontSize: 12, color: C.muted, whiteSpace: 'nowrap' }}>{fileSize(d.size)} · Open</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
