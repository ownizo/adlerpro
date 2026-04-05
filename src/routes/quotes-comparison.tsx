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

interface CompareResult {
  recommendedIndex: number
  reason: string
  highlights: string[]
  warnings: Record<string, string>
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const font = "'Montserrat', sans-serif"

function ExtractedDataCard({ data, name }: { data: Record<string, any>; name: string }) {
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

function ComparisonTable({ quotes, recommendedIndex }: { quotes: QuoteEntry[]; recommendedIndex: number }) {
  const done = quotes.filter(q => q.status === 'done' && q.data)

  // Determinar melhor valor em cada métrica (para highlight)
  const premiums = done.map(q => q.data!.annualPremium || 0)
  const capitals = done.map(q => q.data!.insuredValue || 0)
  const deductibles = done.map(q => q.data!.deductible || 0)
  const coverageCounts = done.map(q => q.data!.coverages?.length || 0)

  const minPremium = Math.min(...premiums.filter(v => v > 0))
  const maxCapital = Math.max(...capitals)
  const minDeductible = Math.min(...deductibles.filter(v => v > 0))
  const maxCoverages = Math.max(...coverageCounts)

  const colWidth = `${100 / (done.length + 1)}%`

  return (
    <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: font }}>
        <thead>
          <tr style={{ background: '#f8f8f8' }}>
            <th style={{ padding: '0.6rem 0.85rem', textAlign: 'left', fontSize: '0.65rem', fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #eee', width: colWidth }}>
              Métrica
            </th>
            {done.map((q, i) => {
              const isRec = i === recommendedIndex
              return (
                <th key={i} style={{ padding: '0.6rem 0.85rem', textAlign: 'center', fontSize: '0.72rem', fontWeight: 700, color: isRec ? '#166534' : '#333', borderBottom: `2px solid ${isRec ? '#22C55E' : '#eee'}`, background: isRec ? '#F0FDF4' : '#f8f8f8', width: colWidth }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem' }}>
                    {isRec && (
                      <span style={{ background: '#16A34A', color: '#fff', fontSize: '0.55rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '20px', letterSpacing: '0.06em' }}>
                        RECOMENDADO
                      </span>
                    )}
                    <span>{q.data?.insurer || `Cotação ${i + 1}`}</span>
                    <span style={{ fontWeight: 300, fontSize: '0.65rem', color: '#999' }}>{q.file.name}</span>
                  </div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {[
            {
              label: 'Prémio Anual',
              values: premiums,
              format: (v: number) => v > 0 ? formatCurrency(v) : '—',
              best: (v: number) => v === minPremium && v > 0,
              bestLabel: 'mais baixo',
            },
            {
              label: 'Capital Segurado',
              values: capitals,
              format: (v: number) => v > 0 ? formatCurrency(v) : '—',
              best: (v: number) => v === maxCapital && v > 0,
              bestLabel: 'mais alto',
            },
            {
              label: 'Franquia',
              values: deductibles,
              format: (v: number) => v > 0 ? formatCurrency(v) : '—',
              best: (v: number) => v === minDeductible && v > 0,
              bestLabel: 'mais baixa',
            },
            {
              label: 'N.º Coberturas',
              values: coverageCounts,
              format: (v: number) => v > 0 ? String(v) : '—',
              best: (v: number) => v === maxCoverages && v > 0,
              bestLabel: 'mais coberturas',
            },
          ].map((row, ri) => (
            <tr key={ri} style={{ borderBottom: '1px solid #f5f5f5' }}>
              <td style={{ padding: '0.6rem 0.85rem', fontSize: '0.72rem', fontWeight: 600, color: '#555' }}>
                {row.label}
              </td>
              {row.values.map((v, ci) => {
                const isBest = row.best(v)
                const isRec = ci === recommendedIndex
                return (
                  <td key={ci} style={{ padding: '0.6rem 0.85rem', textAlign: 'center', background: isRec ? '#FAFFF7' : 'transparent' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: isBest ? 700 : 400, color: isBest ? '#166534' : '#333' }}>
                      {row.format(v)}
                    </span>
                    {isBest && (
                      <span style={{ display: 'block', fontSize: '0.55rem', color: '#16A34A', fontWeight: 600, marginTop: '0.1rem' }}>
                        ↑ {row.bestLabel}
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RecommendationCard({ result, quotes }: { result: CompareResult; quotes: QuoteEntry[] }) {
  const done = quotes.filter(q => q.status === 'done' && q.data)
  const recommended = done[result.recommendedIndex]
  if (!recommended) return null

  return (
    <div style={{ border: '2px solid #16A34A', borderRadius: '4px', overflow: 'hidden', marginBottom: '1.5rem' }}>
      {/* Header */}
      <div style={{ background: '#16A34A', padding: '0.85rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span style={{ fontSize: '1.25rem' }}>✦</span>
        <div>
          <p style={{ fontFamily: font, fontWeight: 700, fontSize: '0.9rem', color: '#fff', margin: 0 }}>
            Recomendação: {recommended.data?.insurer || `Cotação ${result.recommendedIndex + 1}`}
          </p>
          <p style={{ fontFamily: font, fontWeight: 300, fontSize: '0.75rem', color: 'rgba(255,255,255,0.85)', margin: 0 }}>
            {recommended.file.name}
          </p>
        </div>
      </div>

      <div style={{ padding: '1rem 1.25rem', background: '#F0FDF4' }}>
        {/* Razão principal */}
        <p style={{ fontFamily: font, fontSize: '0.82rem', color: '#166534', fontWeight: 500, margin: '0 0 0.75rem', lineHeight: 1.5 }}>
          {result.reason}
        </p>

        {/* Pontos fortes */}
        {result.highlights?.length > 0 && (
          <ul style={{ margin: '0 0 0.75rem', paddingLeft: 0, listStyle: 'none' }}>
            {result.highlights.map((h, i) => (
              <li key={i} style={{ fontFamily: font, fontSize: '0.78rem', color: '#166534', marginBottom: '0.3rem', display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
                <span style={{ flexShrink: 0, marginTop: '0.1rem' }}>✓</span>
                {h}
              </li>
            ))}
          </ul>
        )}

        {/* Avisos sobre as outras */}
        {result.warnings && Object.keys(result.warnings).length > 0 && (
          <div style={{ borderTop: '1px solid #BBF7D0', paddingTop: '0.75rem', marginTop: '0.5rem' }}>
            <p style={{ fontFamily: font, fontSize: '0.65rem', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.4rem' }}>
              Outras opções
            </p>
            {Object.entries(result.warnings).map(([idx, warning]) => {
              const q = done[Number(idx)]
              return (
                <p key={idx} style={{ fontFamily: font, fontSize: '0.75rem', color: '#666', margin: '0 0 0.2rem' }}>
                  <strong>{q?.data?.insurer || `Cotação ${Number(idx) + 1}`}:</strong> {warning}
                </p>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function QuotesComparisonPage() {
  const [quotes, setQuotes] = useState<QuoteEntry[]>([])
  const [comparing, setComparing] = useState(false)
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null)
  const [compareError, setCompareError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  const doneQuotes = quotes.filter(q => q.status === 'done')
  const isAnalyzing = quotes.some(q => q.status === 'analyzing')
  const canAddMore = doneQuotes.length < 3 && !isAnalyzing && !compareResult
  const canCompare = doneQuotes.length >= 2 && !isAnalyzing && !compareResult

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPendingFile(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleAnalyze = async () => {
    if (!pendingFile) return
    const entry: QuoteEntry = { file: pendingFile, status: 'analyzing', data: null, error: null }
    const idx = quotes.length
    setQuotes(prev => [...prev, entry])
    setPendingFile(null)

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
      const payload = { quotes: doneQuotes.map(q => ({ name: q.file.name, data: q.data })) }
      const res = await fetch('/api/compare-quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('application/json')) throw new Error('Resposta inesperada do servidor.')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro na comparação.')
      if (data.recommendedIndex === undefined) throw new Error('Resposta inválida da IA.')
      setCompareResult(data)
    } catch (err: any) {
      setCompareError(err.message)
    } finally {
      setComparing(false)
    }
  }

  const handleReset = () => {
    setQuotes([])
    setPendingFile(null)
    setCompareResult(null)
    setCompareError(null)
  }

  const handleRemoveQuote = (idx: number) => {
    setQuotes(prev => prev.filter((_, i) => i !== idx))
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem', gap: '1rem' }}>
          <div>
            <h1 style={{ fontFamily: font, fontWeight: 700, fontSize: '1.4rem', color: '#111', margin: 0 }}>Comparativo de Cotações</h1>
            <p style={{ fontFamily: font, fontWeight: 300, fontSize: '0.85rem', color: '#666', marginTop: '0.35rem' }}>
              Analise cada cotação individualmente e compare no final. Mínimo 2, máximo 3 cotações.
            </p>
          </div>
          {(quotes.length > 0 || compareResult) && (
            <button onClick={handleReset} style={{ fontFamily: font, fontWeight: 600, fontSize: '0.78rem', padding: '0.45rem 0.85rem', background: 'none', color: '#666', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Recomeçar
            </button>
          )}
        </div>

        {/* Cotações já adicionadas */}
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
                {(q.status === 'done' || q.status === 'error') && !isAnalyzing && !compareResult && (
                  <button onClick={() => handleRemoveQuote(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', fontSize: '1.1rem', lineHeight: 1, padding: '0.1rem' }} title="Remover">×</button>
                )}
              </div>
            </div>
            {q.status === 'done' && q.data && (
              <ExtractedDataCard data={q.data} name={q.file.name} />
            )}
          </div>
        ))}

        {/* Adicionar próxima cotação */}
        {canAddMore && (
          <div style={{ background: '#fff', border: '1.5px dashed #ddd', borderRadius: '4px', padding: '1.25rem', marginBottom: '0.75rem' }}>
            <p style={{ fontFamily: font, fontWeight: 600, fontSize: '0.82rem', color: '#555', margin: '0 0 0.75rem' }}>
              Cotação {quotes.length + 1}
              <span style={{ fontWeight: 300, color: '#999' }}>
                {quotes.length < 2 ? ' (obrigatória)' : ' (opcional)'}
              </span>
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
                <button onClick={handleAnalyze} style={{ fontFamily: font, fontWeight: 600, fontSize: '0.82rem', padding: '0.55rem 1.1rem', background: '#111', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  ✦ Analisar
                </button>
              </div>
            )}
          </div>
        )}

        {/* Indicação de progresso */}
        {!canCompare && doneQuotes.length < 2 && quotes.length > 0 && !isAnalyzing && !compareResult && (
          <p style={{ fontFamily: font, fontSize: '0.78rem', color: '#999', margin: '0.25rem 0 0.75rem' }}>
            Adicione mais {2 - doneQuotes.length} cotação(ões) para poder comparar.
          </p>
        )}

        {/* Botão comparar */}
        {canCompare && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '0.5rem 0 1.5rem' }}>
            <button
              onClick={handleCompare}
              disabled={comparing}
              style={{ fontFamily: font, fontWeight: 600, fontSize: '0.9rem', padding: '0.75rem 2rem', background: comparing ? '#ccc' : '#C8961A', color: '#fff', border: 'none', borderRadius: '4px', cursor: comparing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              {comparing
                ? <><span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />A comparar...</>
                : <>✦ Comparar {doneQuotes.length} cotações</>}
            </button>
            {comparing && <span style={{ fontFamily: font, fontSize: '0.78rem', color: '#999' }}>Normalmente demora 5–10 segundos</span>}
          </div>
        )}

        {/* Erro de comparação */}
        {compareError && (
          <div style={{ padding: '0.75rem 1rem', background: '#fff5f5', border: '1px solid #fecaca', borderRadius: '4px', fontFamily: font, fontSize: '0.82rem', color: '#dc2626', marginBottom: '1rem' }}>
            ⚠️ {compareError}
          </div>
        )}

        {/* ── Resumo e Recomendação ── */}
        {compareResult && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.5rem 0 1.25rem' }}>
              <div style={{ flex: 1, height: '1px', background: '#eee' }} />
              <p style={{ fontFamily: font, fontWeight: 700, fontSize: '0.72rem', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, whiteSpace: 'nowrap' }}>
                Resumo e Recomendação
              </p>
              <div style={{ flex: 1, height: '1px', background: '#eee' }} />
            </div>

            {/* Tabela comparativa */}
            <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: '4px', padding: '1.25rem', marginBottom: '1rem' }}>
              <p style={{ fontFamily: font, fontWeight: 700, fontSize: '0.72rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 1rem' }}>
                Tabela Comparativa
              </p>
              <ComparisonTable quotes={quotes} recommendedIndex={compareResult.recommendedIndex} />
            </div>

            {/* Card de recomendação */}
            <RecommendationCard result={compareResult} quotes={quotes} />
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </AppLayout>
  )
}
