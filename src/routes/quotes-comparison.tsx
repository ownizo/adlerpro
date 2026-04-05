import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useState, useRef } from 'react'
import { getServerUser } from '@/lib/auth'

export const Route = createFileRoute('/quotes-comparison')({
  beforeLoad: async () => {
    const user = await getServerUser()
    if (!user) throw redirect({ to: '/login' })
  },
  component: QuotesComparisonPage,
})

function QuotesComparisonPage() {
  const [files, setFiles] = useState<File[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files)
      if (selectedFiles.length + files.length > 2) {
        setError('Pode enviar no máximo 2 cotações.')
        return
      }
      setFiles([...files, ...selectedFiles])
      setError(null)
    }
  }

  const handleRemoveFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index))
  }

  const handleAnalyze = async () => {
    if (files.length === 0) {
      setError('Por favor, adicione pelo menos uma cotação.')
      return
    }

    setAnalyzing(true)
    setError(null)
    setResult(null)

    try {
      const formData = new FormData()
      files.forEach((file) => formData.append('quotes', file))

      const res = await fetch('/api/compare-quotes', {
        method: 'POST',
        body: formData,
      })

      // Verificar Content-Type antes de tentar parse JSON
      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) {
        const text = await res.text()
        console.error('[compare-quotes] Resposta não-JSON:', text.substring(0, 200))
        throw new Error('O servidor devolveu uma resposta inesperada. Tente novamente.')
      }

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Erro na análise das cotações.')
      }

      if (!data.report) {
        throw new Error('A análise não retornou resultados. Tente novamente.')
      }

      setResult(data.report)
    } catch (err: any) {
      setError(err.message || 'Ocorreu um erro inesperado. Tente novamente.')
    } finally {
      setAnalyzing(false)
    }
  }

  const getFileIcon = (file: File) => {
    if (file.type === 'application/pdf') return '📄'
    if (file.type.startsWith('image/')) return '🖼️'
    return '📝'
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '1.5rem', color: '#111111' }}>
            Comparativo de Cotações
          </h1>
          <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.9rem', color: '#666666', marginTop: '0.35rem' }}>
            Carregue até 2 cotações (PDF ou imagem) para uma análise comparativa detalhada pela nossa IA.
          </p>
        </div>

        {/* Upload Area */}
        <div style={{ background: '#ffffff', border: '1.5px solid #eeeeee', borderRadius: '4px', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <div
            style={{
              border: '2px dashed #dddddd',
              borderRadius: '4px',
              padding: '2rem',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'border-color 0.2s',
            }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = '#C8961A' }}
            onDragLeave={(e) => { e.currentTarget.style.borderColor = '#dddddd' }}
            onDrop={(e) => {
              e.preventDefault()
              e.currentTarget.style.borderColor = '#dddddd'
              const dropped = Array.from(e.dataTransfer.files)
              if (dropped.length + files.length > 2) {
                setError('Pode enviar no máximo 2 cotações.')
                return
              }
              setFiles([...files, ...dropped])
              setError(null)
            }}
          >
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📋</div>
            <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.9rem', color: '#333333', marginBottom: '0.35rem' }}>
              Arraste os ficheiros ou clique para selecionar
            </p>
            <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.8rem', color: '#999999' }}>
              Até 2 ficheiros · PDF, imagens (JPG, PNG) ou texto
            </p>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              style={{ display: 'none' }}
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.webp,.txt"
            />
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {files.map((file, index) => (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.65rem 0.85rem',
                    background: '#f8f8f8',
                    borderRadius: '4px',
                    border: '1px solid #eeeeee',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ fontSize: '1.25rem' }}>{getFileIcon(file)}</span>
                    <div>
                      <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.85rem', color: '#333333', margin: 0 }}>
                        {file.name}
                      </p>
                      <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.75rem', color: '#999999', margin: 0 }}>
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveFile(index)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#999999',
                      fontSize: '1.1rem',
                      padding: '0.25rem',
                      lineHeight: 1,
                    }}
                    title="Remover"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{
              marginTop: '1rem',
              padding: '0.75rem 1rem',
              background: '#fff5f5',
              border: '1px solid #fecaca',
              borderRadius: '4px',
              fontFamily: "'Montserrat', sans-serif",
              fontSize: '0.85rem',
              color: '#dc2626',
            }}>
              ⚠️ {error}
            </div>
          )}

          {/* Analyze Button */}
          <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button
              onClick={handleAnalyze}
              disabled={analyzing || files.length === 0}
              style={{
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 600,
                fontSize: '0.9rem',
                padding: '0.75rem 1.75rem',
                background: analyzing || files.length === 0 ? '#cccccc' : '#111111',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                cursor: analyzing || files.length === 0 ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                transition: 'background 0.2s',
              }}
            >
              {analyzing ? (
                <>
                  <span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid #ffffff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  A analisar...
                </>
              ) : (
                <>✦ Analisar com IA</>
              )}
            </button>
            {files.length > 0 && !analyzing && (
              <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem', color: '#999999' }}>
                {files.length} ficheiro{files.length > 1 ? 's' : ''} seleccionado{files.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Loading State */}
        {analyzing && (
          <div style={{
            background: '#ffffff',
            border: '1.5px solid #eeeeee',
            borderRadius: '4px',
            padding: '2.5rem',
            textAlign: 'center',
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              border: '3px solid #eeeeee',
              borderTopColor: '#C8961A',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 1rem',
            }} />
            <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.9rem', color: '#333333' }}>
              A analisar as cotações...
            </p>
            <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '0.8rem', color: '#999999', marginTop: '0.35rem' }}>
              Este processo pode demorar 15–30 segundos dependendo do tamanho dos documentos.
            </p>
          </div>
        )}

        {/* Result */}
        {result && !analyzing && (
          <div style={{ background: '#ffffff', border: '1.5px solid #eeeeee', borderRadius: '4px', padding: '1.5rem' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '1.25rem',
              paddingBottom: '1rem',
              borderBottom: '1px solid #eeeeee',
            }}>
              <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '1rem', color: '#111111', margin: 0 }}>
                ✦ Análise Comparativa
              </h2>
              <button
                onClick={() => { setResult(null); setFiles([]) }}
                style={{
                  fontFamily: "'Montserrat', sans-serif",
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  padding: '0.4rem 0.85rem',
                  background: 'none',
                  color: '#666666',
                  border: '1px solid #dddddd',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Nova análise
              </button>
            </div>
            <div
              className="prose prose-sm max-w-none"
              style={{ fontFamily: "'Montserrat', sans-serif" }}
              dangerouslySetInnerHTML={{ __html: result }}
            />
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </AppLayout>
  )
}
