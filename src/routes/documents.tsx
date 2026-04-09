import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { fetchDocuments } from '@/lib/server-fns'
import type { Document } from '@/lib/types'
import { useEffect, useMemo, useState } from 'react'
import { formatDate } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/documents')({
  component: DocumentsPage,
})

function DocumentsPage() {
  const { t } = useTranslation()
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDocuments()
      .then((data) => setDocuments(data))
      .finally(() => setLoading(false))
  }, [])

  const docsByCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const doc of documents) map.set(doc.category, (map.get(doc.category) ?? 0) + 1)
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [documents])

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '1.4rem', color: '#111111', margin: 0 }}>
            {t('documents.title')}
          </h1>
          <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.85rem', color: '#888888', marginTop: '0.25rem' }}>
            {t('documents.subtitle')}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#eeeeee', borderTopColor: '#C8961A' }} />
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <MiniCard label={t('documents.total')} value={String(documents.length)} />
              <MiniCard label={t('documents.claimDocs')} value={String(documents.filter((doc) => doc.category === 'claim').length)} />
              <MiniCard label={t('documents.policyDocs')} value={String(documents.filter((doc) => doc.category === 'policy').length)} />
              <MiniCard label={t('documents.otherDocs')} value={String(documents.filter((doc) => !['claim', 'policy'].includes(doc.category)).length)} />
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2" style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #eeeeee' }}>
                  <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.9rem', color: '#111111', margin: 0 }}>
                    {t('documents.latest')}
                  </h2>
                </div>
                {documents.length === 0 ? (
                  <div style={{ padding: '1.5rem 1.25rem', color: '#999999', fontFamily: "'Montserrat', sans-serif", fontSize: '0.82rem' }}>
                    {t('documents.empty')}
                  </div>
                ) : (
                  <div style={{ maxHeight: '460px', overflowY: 'auto' }}>
                    {documents.map((doc) => (
                      <div key={doc.id} style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid #f5f5f5' }}>
                        <p style={{ margin: 0, color: '#111111', fontWeight: 600, fontFamily: "'Montserrat', sans-serif", fontSize: '0.82rem' }}>
                          {doc.name}
                        </p>
                        <p style={{ margin: '0.15rem 0 0', color: '#888888', fontWeight: 300, fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem' }}>
                          {doc.category} · {formatDate(doc.uploadedAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', overflow: 'hidden', alignSelf: 'start' }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #eeeeee' }}>
                  <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.9rem', color: '#111111', margin: 0 }}>
                    {t('documents.byCategory')}
                  </h2>
                </div>
                <div style={{ padding: '0.85rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  {docsByCategory.length === 0 ? (
                    <p style={{ margin: 0, color: '#999999', fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem' }}>
                      {t('documents.empty')}
                    </p>
                  ) : (
                    docsByCategory.map(([category, count]) => (
                      <div key={category} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ margin: 0, color: '#555555', fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem' }}>{category}</span>
                        <strong style={{ color: '#111111', fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem' }}>{count}</strong>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  )
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', padding: '0.85rem 1rem' }}>
      <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.68rem', color: '#888888', margin: 0 }}>{label}</p>
      <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '1.2rem', fontWeight: 700, color: '#111111', margin: '0.1rem 0 0' }}>{value}</p>
    </div>
  )
}
