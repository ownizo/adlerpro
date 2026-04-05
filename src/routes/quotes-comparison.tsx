import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useState, useRef } from 'react'
import { getServerUser } from '@/lib/auth'
import { formatCurrency, formatDate } from '@/lib/utils'

export const Route = createFileRoute('/quotes-comparison')({
  beforeLoad: async () => {
    const user = await getServerUser()
    if (!user) throw redirect({ to: '/login' })
  },
  component: QuotesComparisonPage,
})

type QuoteStatus = 'idle' | 'analyzing' | 'done' | 'error'

interface QuoteEntry {
  file: File
  status: QuoteStatus
  data: Record<string, any> | null
  error: string | null
}

const POLICY_TYPE_LABELS: Record<string, string> = {
  auto: 'Automóvel', health: 'Saúde', home: 'Habitação', life: 'Vida',
  liability: 'Responsabilidade Civil', property: 'Propriedade',
  workers_comp: 'Acidentes de Trabalho', cyber: 'Ciber-Risco',
  directors_officers: 'D&O', business_interruption: 'Interrupção de Negócio',
  other: 'Outro',
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ExtractedDataCard({ data, name }: { data: Record<string, any>; name: string }) {
  const font = "'Montserrat', sans-serif"
  return (
    <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '4px', padding: '1rem', marginTop: '0.75rem' }}>
      <p style={{ fontFamily: font, fontSize: '0.65rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 0.6rem' }}>
        ✓ Dados extraídos — {name}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem', marginBottom: '0.6rem' }}>
        {data.insurer && <div><p style={{ fontFamily: font, fontSize: '0.6rem', color: '#aaa', margin: 0 }}>SEGURADORA</p><p style={{ fontFamily: font, fontSize: '0.78rem', fontWeight: 600, color: '#111', margin: 0 }}>{data.insurer}</p></div>}
        {data.policyNumber && <div><p style={{ fontFamily: font, fontSize: '0.6rem', color: '#aaa', margin: 0 }}>N.º APÓLICE</p><p style={{ fontFamily: font, fontSize: '0.78rem', fontWeight: 600, color: '#111', margin: 0 }}>{data.policyNumber}</p></div>}
        {data.annualPremium > 0 && <div><p style={{ fontFamily: font, fontSize: '0.6rem', color: '#aaa', margin: 0 }}>PRÉMIO ANUAL</p><p style={{ fontFamily: font, fontSize: '0.78rem', fontWeight: 700, color: '#111', margin: 0 }}>{formatCurrency(data.annualPremium)}</p></div>}
        {data.insuredValue > 0 && <div><p style={{ fontFamily: font, fontSize: '0.6rem', color: '#aaa', margin: 0 }}>CAPITAL SEGURADO</p><p style={{ fontFamily: font, fontSize: '0.78rem', fontWeight: 600, color: '#111', margin: 0 }}>{formatCurrency(data.insuredValue)}</p></div>}
        {data.startDate && <div><p style={{ fontFamily: font, fontSize: '0.6rem', color: '#aaa', margin: 0 }}>INÍCIO</p><p style={{ fontFamily: font, fontSize: '0.78rem', fontWeight: 600, color: '#111', margin: 0 }}>{formatDate(data.startDate)}</p></div>}
        {data.endDate && <div><p style={{ fontFamily: font, fontSize: '0.6rem', color: '#aaa', margin: 0 }}>FIM</p><p style={{ fontFamily: font, fontSize: '0.78rem', fontWeight: 600, color: '#111', margin: 0 }}>{formatDate(data.endDate)}</p></div>}
      </div>
      {data.coverages?.length > 0 && (
        <div style={{ marginBottom: '0.4rem' }}>
          <p style={{ fontFamily: font, fontSize: '0.6rem', fontWeight: 700, color: '#166534', margin: '0 0 0.25rem' }}>COBERTURAS</p>
          <ul style={{ margin: 0, paddingLeft: '1rem' }}>
            {data.coverages.slice(0, 4).map((c: string, i: number) => (
              <li key={i} style={{ fontFamily: font, fontSize: '0.72rem', color: '#333', marginBottom: '0.15rem' }}>{c}</li>
            ))}
            {data.coverages.length > 4 && <li style={{ fontFamily: font, fontSize: '0.72rem', color: '#999' }}>+{data.coverages.length - 4} mais</li>}
          </ul>
        </div>
      )}
      {data.exclusions?.length > 0 && (
        <div>
          <p style={{ fontFamily: font, fontSize: '0.6rem', fontWeight: 700, color: '#991B1B', margin: '0 0 0.25rem' }}>EXCLUSÕES</p>
          <ul style={{ margin: 0, paddingLeft: '1rem' }}>
            {data.exclusions.slice(0, 3).map((e: string, i: number) => (
              <li key={i} style={{ fontFamily: font, fontSize: '0.72rem', color: '#555', marginBottom: '0.15rem' }}>{e}</li>
            ))}
            {data.exclusions.length > 3 && <li style={{ fontFamily: font, fontSize: '0.72rem', color: '#999' }}>+{data.exclusions.length - 3} mais</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

function QuotesComparisonPage() {
  const font = "'Montserrat', sans-serif"
  const [quotes, setQuotes] = useState<QuoteEntry[]>([])
  const [comparing, setComparing] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const [compareError, setCompareError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  const doneQuotes = quotes.filter(q => q.status === 'done')
  const isAnalyzing = quotes.some(q => q.status === 'analyzing')
  const canAddMore = doneQuotes.length < 3 && !isAnalyzing && !report
  const canCompare = doneQuotes.length >= 2 && !isAnalyzing

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPendingFile(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleAnalyze = async () => {
    if (!pendingFile) return
    const entry: QuoteEntry = { file: pendingFile, status: 'analyzing', data: null, error: null }
    setQuotes(prev => [...prev, entry])
    setPendingFile(null)
    const idx = quotes.length

    try {
      const fd = new FormData()
      fd.append('file', pendingFile)
      const res = await fetch('/api/extract-policy', { method: 'POST', body: fd })
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('application/json')) throw new Error('Resposta inesperada do servidor.')
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Erro ao analisar o ficheiro.')
      setQuotes(prev => prev.map((q, i) => i === idx ? { ...q, status: 'done', data: result } : q))
    } catch (err: any) {
      setQuotes(prev => prev.map((q, i) => i === idx ? { ...q, status: 'error', error: err.message } : q))
    }
  }

  const handleCompare = async () => {
    setComparing(true)
    setCompareError(null)
    try {
      const payload = {
        quotes: doneQuotes.map(q => ({ name: q.file.name, data: q.data })),
      }
      const res = await fetch('/api/compare-quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('application/json')) throw new Error('Resposta inesperada do servidor.')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro na comparação.')
      setReport(data.report)
    } catch (err: any) {
      setCompareError(err.message)
    } finally {
      setComparing(false)
    }
  }

  const handleReset = () => {
    setQuotes([])
    setPendingFile(null)
    setReport(null)
    setCompareError(null)
  }

  const handleRemoveQuote = (idx: number) => {
    setQuotes(prev => prev.filter((_, i) => i !== idx))
  }

  if (report) {
    return (
      <AppLayout>
        <div className="max-w-4xl mx-auto">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
            <div>
              <h1 style={{ fontFamily: font, fontWeight: 700, fontSize: '1.4rem', color: '#111', margin: 0 }}>Comparativo de Cotações</h1>
              <p style={{ fontFamily: font, fontWeight: 300, fontSize: '0.82rem', color: '#888', marginTop: '0.25rem' }}>{doneQuotes.length} cotações analisadas</p>
            </div>
            <button onClick={handleReset} style={{ fontFamily: font, fontWeight: 600, fontSize: '0.82rem', padding: '0.5rem 1rem', background: 'none', color: '#666', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer' }}>
              Nova análise
            </button>
          </div>
          <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: '4px', padding: '1.5rem' }}>
            <p style={{ fontFamily: font, fontWeight: 700, fontSize: '0.82rem', color: '#C8961A', margin: '0 0 1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              ✦ Análise Comparativa IA
            </p>
            <div style={{ fontFamily: font }} dangerouslySetInnerHTML={{ __html: report }} />
          </div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto">
        <div style={{ marginBottom: '1.75rem' }}>
          <h1 style={{ fontFamily: font, fontWeight: 700, fontSize: '1.4rem', color: '#111', margin: 0 }}>Comparativo de Cotações</h1>
          <p style={{ fontFamily: font, fontWeight: 300, fontSize: '0.85rem', color: '#666', marginTop: '0.35rem' }}>
            Analise cada cotação individualmente e compare no final. Mínimo 2, máximo 3 cotações.
          </p>
        </div>

        {/* Lista de cotações já adicionadas */}
        {quotes.map((q, idx) => (
          <div key={idx} style={{ background: '#fff', border: '1px solid #eee', borderRadius: '4px', padding: '1rem 1.25rem', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{
                  width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '0.7rem', fontWeight: 700, fontFamily: font,
                  background: q.status === 'done' ? '#EAF3DE' : q.status === 'error' ? '#FEE2E2' : '#f0f0f0',
                  color: q.status === 'done' ? '#166534' : q.status === 'error' ? '#991B1B' : '#888',
                }}>
                  {q.status === 'done' ? '✓' : q.status === 'error' ? '✕' : idx + 1}
                </div>
                <div>
                  <p style={{ fontFamily: font, fontWeight: 600, fontSize: '0.82rem', color: '#111', margin: 0 }}>{q.file.name}</p>
                  <p style={{ fontFamily: font, fontWeight: 300, fontSize: '0.72rem', color: '#999', margin: 0 }}>{formatFileSize(q.file.size)}</p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {q.status === 'analyzing' && (
                  <span style={{ fontFamily: font, fontSize: '0.72rem', color: '#C8961A', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid #C8961A', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    A analisar...
                  </span>
                )}
                {q.status === 'done' && (
                  <span style={{ fontFamily: font, fontSize: '0.72rem', fontWeight: 600, color: '#166534' }}>Analisado</span>
                )}
                {q.status === 'error' && (
                  <span style={{ fontFamily: font, fontSize: '0.72rem', color: '#dc2626' }}>{q.error}</span>
                )}
                {(q.status === 'done' || q.status === 'error') && !isAnalyzing && (
                  <button onClick={() => handleRemoveQuote(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', fontSize: '1.1rem', lineHeight: 1, padding: '0.1rem' }} title="Remover">×</button>
                )}
              </div>
            </div>

            {q.status === 'done' && q.data && (
              <ExtractedDataCard data={q.data} name={q.file.name} />
            )}
          </div>
        ))}

        {/* Área para adicionar próxima cotação */}
        {canAddMore && (
          <div style={{ background: '#fff', border: '1.5px dashed #ddd', borderRadius: '4px', padding: '1.25rem', marginBottom: '0.75rem' }}>
            <p style={{ fontFamily: font, fontWeight: 600, fontSize: '0.82rem', color: '#555', margin: '0 0 0.75rem' }}>
              Cotação {quotes.length + 1}{quotes.length === 0 ? ' (obrigatória)' : quotes.length === 1 ? ' (obrigatória)' : ' (opcional)'}
            </p>

            {!pendingFile ? (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontFamily: font, fontWeight: 600, fontSize: '0.82rem', padding: '0.55rem 1rem', background: '#f5f5f5', color: '#333', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer' }}>
                📎 Seleccionar ficheiro
                <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={handleFileSelect} style={{ display: 'none' }} />
              </label>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', background: '#f8f8f8', border: '1px solid #eee', borderRadius: '4px' }}>
                  <span>📄</span>
                  <div>
                    <p style={{ fontFamily: font, fontWeight: 600, fontSize: '0.82rem', color: '#333', margin: 0 }}>{pendingFile.name}</p>
                    <p style={{ fontFamily: font, fontSize: '0.72rem', color: '#999', margin: 0 }}>{formatFileSize(pendingFile.size)}</p>
                  </div>
                  <button onClick={() => setPendingFile(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', fontSize: '1.1rem', lineHeight: 1, marginLeft: '0.25rem' }}>×</button>
                </div>
                <button
                  onClick={handleAnalyze}
                  style={{ fontFamily: font, fontWeight: 600, fontSize: '0.82rem', padding: '0.55rem 1.1rem', background: '#111', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  ✦ Analisar
                </button>
              </div>
            )}
          </div>
        )}

        {/* Erro de comparação */}
        {compareError && (
          <div style={{ padding: '0.75rem 1rem', background: '#fff5f5', border: '1px solid #fecaca', borderRadius: '4px', fontFamily: font, fontSize: '0.82rem', color: '#dc2626', marginBottom: '0.75rem' }}>
            ⚠️ {compareError}
          </div>
        )}

        {/* Botão comparar */}
        {canCompare && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button
              onClick={handleCompare}
              disabled={comparing}
              style={{ fontFamily: font, fontWeight: 600, fontSize: '0.9rem', padding: '0.75rem 2rem', background: comparing ? '#ccc' : '#C8961A', color: '#fff', border: 'none', borderRadius: '4px', cursor: comparing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              {comparing ? (
                <><span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />A comparar...</>
              ) : (
                <>✦ Comparar {doneQuotes.length} cotações</>
              )}
            </button>
            {comparing && (
              <span style={{ fontFamily: font, fontSize: '0.78rem', color: '#999' }}>Normalmente demora 5–10 segundos</span>
            )}
          </div>
        )}

        {/* Indicação de progresso */}
        {!canCompare && doneQuotes.length < 2 && quotes.length > 0 && !isAnalyzing && (
          <p style={{ fontFamily: font, fontSize: '0.78rem', color: '#999', marginTop: '0.5rem' }}>
            Adicione mais {2 - doneQuotes.length} cotação(ões) para poder comparar.
          </p>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </AppLayout>
  )
}
