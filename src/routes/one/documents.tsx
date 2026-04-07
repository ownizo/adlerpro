import { createFileRoute } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { useState, useEffect, useRef } from 'react'
import { OneLayout } from './__root'

export const Route = createFileRoute('/one/documents')({
  component: OneDocuments,
  ssr: false,
  head: () => ({ meta: [{ title: 'Adler One' }] }),
})

const navy = '#0A1628'
const gold  = '#C9A84C'

interface Document {
  id: string
  name: string
  category: string
  size: number
  uploaded_at: string
  blob_key?: string
}

const CATEGORY_LABELS: Record<string, string> = {
  policy:      'Apólice',
  claim:       'Sinistro',
  invoice:     'Fatura',
  report:      'Relatório',
  certificate: 'Certificado',
  other:       'Outro',
}

const CATEGORY_COLOR: Record<string, { bg: string; color: string }> = {
  policy:      { bg: '#EFF6FF', color: '#1D4ED8' },
  claim:       { bg: '#FEF3C7', color: '#92400E' },
  invoice:     { bg: '#F3E8FF', color: '#6D28D9' },
  report:      { bg: '#EAF3DE', color: '#3B6D11' },
  certificate: { bg: '#D1FAE5', color: '#065F46' },
  other:       { bg: '#F3F4F6', color: '#6B7280' },
}

function formatSize(bytes: number) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })
}

function OneDocuments() {
  const [documents,    setDocuments]    = useState<Document[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef   = useRef<HTMLInputElement>(null)

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
        const { data, error: dErr } = await supabase
          .from('documents')
          .select('id, name, category, size, uploaded_at, blob_key')
          .eq('individual_client_id', clientId)
          .order('uploaded_at', { ascending: false })
        if (dErr) throw dErr
        setDocuments(data ?? [])
      }
    } catch (e: any) {
      setError('Erro ao carregar documentos.')
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
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: navy, margin: 0 }}>Documentos</h1>
            <p style={{ fontSize: '0.82rem', color: '#64748B', marginTop: '0.3rem' }}>
              {documents.length} documento{documents.length !== 1 ? 's' : ''}
            </p>
          </div>

          {/* ── Upload area ── */}
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, padding: '1.25rem', marginBottom: '1.5rem' }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.85rem' }}>
              Adicionar Documento
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {/* Camera button (mobile) */}
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.1rem', background: navy, color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: "'Montserrat', sans-serif" }}
              >
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Tirar Foto
              </button>
              {/* File picker button */}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.1rem', background: '#F8FAFC', color: navy, border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: "'Montserrat', sans-serif" }}
              >
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
                Escolher Ficheiro
              </button>
            </div>

            {/* Hidden inputs */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              style={{ display: 'none' }}
              onChange={e => setSelectedFile(e.target.files?.[0] ?? null)}
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              style={{ display: 'none' }}
              onChange={e => setSelectedFile(e.target.files?.[0] ?? null)}
            />

            {/* Selected file preview */}
            {selectedFile && (
              <div style={{ marginTop: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 0.85rem', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 6 }}>
                <span style={{ fontSize: '1.2rem' }}>{selectedFile.type.startsWith('image/') ? '🖼️' : '📄'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: '0.82rem', fontWeight: 600, color: navy, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedFile.name}</p>
                  <p style={{ fontSize: '0.7rem', color: '#64748B', margin: '0.1rem 0 0' }}>{formatSize(selectedFile.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedFile(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: '1rem', padding: '0 0.25rem' }}
                  aria-label="Remover"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {documents.length === 0 ? (
            <div style={{ padding: '3rem 2rem', textAlign: 'center', background: '#fff', borderRadius: 8, border: '1px solid #E2E8F0' }}>
              <p style={{ fontSize: '2rem', margin: '0 0 0.75rem' }}>📄</p>
              <p style={{ fontSize: '0.9rem', fontWeight: 600, color: navy, margin: '0 0 0.4rem' }}>Sem documentos disponíveis</p>
              <p style={{ fontSize: '0.82rem', color: '#94A3B8', margin: 0 }}>
                Os seus documentos serão disponibilizados aqui pela Adler Rochefort.
              </p>
            </div>
          ) : (
            <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
              {documents.map((doc, i) => {
                const cat = CATEGORY_COLOR[doc.category] ?? CATEGORY_COLOR.other
                const catLabel = CATEGORY_LABELS[doc.category] ?? doc.category
                return (
                  <div
                    key={doc.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '1rem',
                      padding: '0.9rem 1.25rem',
                      borderTop: i > 0 ? '1px solid #F1F5F9' : undefined,
                    }}
                  >
                    <div style={{ fontSize: '1.5rem', flexShrink: 0 }}>📄</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '0.85rem', fontWeight: 600, color: navy, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {doc.name}
                      </p>
                      <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: '0.15rem 0 0' }}>
                        {formatSize(doc.size)} · {formatDate(doc.uploaded_at)}
                      </p>
                    </div>
                    <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '0.2rem 0.6rem', borderRadius: 20, background: cat.bg, color: cat.color, flexShrink: 0 }}>
                      {catLabel}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </OneLayout>
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
