import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { fetchPortalDocuments, getPortalDocumentUrl } from '@/lib/server-fns'
import type { PortalDocument } from '@/lib/server-fns'
import { PortalLayout, PageTitle, Card, Empty, Spinner, ErrorNote, C, date, fileSize } from '@/components/portal/portal-ui'

export const Route = createFileRoute('/portal/documents')({
  component: PortalDocuments,
  ssr: false,
  head: () => ({ meta: [{ title: 'Documents — MillionGuard' }] }),
})

const CATEGORY: Record<string, string> = {
  policy: 'Policy',
  claim: 'Claim',
  invoice: 'Invoice',
  report: 'Report',
  certificate: 'Certificate',
  other: 'Other',
}

function PortalDocuments() {
  const [docs, setDocs] = useState<PortalDocument[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchPortalDocuments().then(setDocs).catch(() => setError('We could not load your documents. Please refresh the page.'))
  }, [])

  async function open(id: string) {
    setError('')
    try {
      const { url } = await getPortalDocumentUrl({ data: { documentId: id } })
      window.open(url, '_blank', 'noopener')
    } catch {
      setError('This document could not be opened. Please try again.')
    }
  }

  return (
    <PortalLayout>
      <PageTitle title="Documents" subtitle="Certificates, invoices and reports we shared with you. Policy documents are also inside each policy." />
      {error && <ErrorNote>{error}</ErrorNote>}
      {!docs && !error && <Spinner />}
      {docs && (
        <Card style={{ padding: '6px 20px' }}>
          {docs.length === 0 ? <Empty>No documents yet.</Empty> : docs.map((d) => (
            <div key={d.id} className="mg-row">
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</p>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: C.muted }}>{CATEGORY[d.category] ?? 'Document'} · {date(d.uploadedAt)}{d.size ? ` · ${fileSize(d.size)}` : ''}</p>
              </div>
              <button onClick={() => open(d.id)} style={{ border: `1px solid ${C.line}`, background: '#fff', borderRadius: 10, padding: '8px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 40 }}>Open</button>
            </div>
          ))}
        </Card>
      )}
    </PortalLayout>
  )
}
