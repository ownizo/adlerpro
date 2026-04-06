import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useState, useRef } from 'react'
import { getServerUser } from '@/lib/auth'
import { formatCurrency, formatDate } from '@/lib/utils'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

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
  const [exporting, setExporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  const doneQuotes = quotes.filter(q => q.status === 'done')
  const isAnalyzing = quotes.some(q => q.status === 'analyzing')
  const canAddMore = doneQuotes.length < 2 && !isAnalyzing && !compareResult
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
      const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
      if (!apiKey) throw new Error('Chave da API Anthropic não configurada (VITE_ANTHROPIC_API_KEY).')

      const quoteSummaries = doneQuotes.map((q, i) =>
        `Cotação ${i} (índice ${i}) — ${q.file.name}:\n${JSON.stringify(q.data, null, 2)}`
      ).join('\n\n')

      const prompt = `Analisa estas ${doneQuotes.length} cotações de seguro e responde APENAS com JSON válido, sem mais nada:

${quoteSummaries}

Responde com este JSON exacto (sem markdown, sem texto extra):
{
  "recommendedIndex": <número 0, 1 ou 2 — índice da cotação recomendada>,
  "reason": "<frase curta e directa com a razão principal da recomendação, em Português de Portugal>",
  "highlights": [
    "<ponto forte da cotação recomendada>",
    "<segundo ponto forte>",
    "<terceiro ponto forte se aplicável>"
  ],
  "warnings": {
    "<índice das outras cotações como string>": "<razão breve porque não é a melhor escolha>"
  }
}`

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || `Erro da API Anthropic (${res.status}).`)

      const text: string = data.content?.[0]?.text ?? ''
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('Resposta da IA não contém JSON válido.')

      const result = JSON.parse(jsonMatch[0])
      if (result.recommendedIndex === undefined) throw new Error('Resposta inválida da IA.')
      setCompareResult(result)
    } catch (err: any) {
      const msg: string = err.message ?? String(err)
      const isRateLimit = /rate.?limit|50[,.]?000/i.test(msg)
      setCompareError(
        isRateLimit
          ? '⏳ O serviço está temporariamente ocupado. Aguarde 1-2 minutos e tente novamente.'
          : 'Ocorreu um erro inesperado. Por favor tente novamente.'
      )
    } finally {
      setComparing(false)
    }
  }

  const exportPdf = async () => {
    if (!compareResult) return
    setExporting(true)
    try {
      const done = quotes.filter(q => q.status === 'done' && q.data)
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageW = doc.internal.pageSize.getWidth()
      const pageH = doc.internal.pageSize.getHeight()
      const marginL = 18
      const marginR = 18
      const contentW = pageW - marginL - marginR
      const now = new Date()
      const dateStr = now.toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' })

      const DARK = '#111111'
      const GOLD = '#C8961A'
      const GREEN = '#166534'
      const LIGHT = '#888888'
      const FOOTER_COLOR: [number, number, number] = [136, 136, 136]

      const addFooter = (pageNum: number, totalPages: number) => {
        doc.setFillColor(248, 248, 248)
        doc.rect(0, pageH - 14, pageW, 14, 'F')
        doc.setDrawColor(238, 238, 238)
        doc.line(0, pageH - 14, pageW, pageH - 14)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(...FOOTER_COLOR)
        doc.text('Adler & Rochefort  |  insurance@adlerrochefort.com  |  +351 928 226 570  |  adlerrochefort.com', marginL, pageH - 7)
        doc.text(`Página ${pageNum} de ${totalPages}`, pageW - marginR, pageH - 7, { align: 'right' })
      }

      // ── Página 1: Header ──
      // Fundo header
      doc.setFillColor(10, 22, 40)
      doc.rect(0, 0, pageW, 38, 'F')

      // Tentar carregar logo
      try {
        const logoRes = await fetch('/adler-logo.png')
        if (logoRes.ok) {
          const blob = await logoRes.blob()
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.readAsDataURL(blob)
          })
          doc.addImage(dataUrl, 'PNG', marginL, 7, 24, 24)
        }
      } catch {
        // Logo não disponível — usa texto
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(14)
        doc.setTextColor(200, 150, 26)
        doc.text('A&R', marginL, 22)
      }

      // Nome empresa no header
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(13)
      doc.setTextColor(255, 255, 255)
      doc.text('Adler & Rochefort', marginL + 28, 17)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(180, 180, 180)
      doc.text('Mediação de Seguros', marginL + 28, 23)

      // Título do documento (à direita no header)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(200, 150, 26)
      doc.text('COMPARATIVO DE COTAÇÕES', pageW - marginR, 17, { align: 'right' })
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(180, 180, 180)
      doc.text(`Gerado em ${dateStr}`, pageW - marginR, 23, { align: 'right' })

      let y = 48

      // ── Resumo das cotações ──
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(136, 136, 136)
      doc.text('COTAÇÕES ANALISADAS', marginL, y)
      y += 5

      done.forEach((q, i) => {
        const isRec = i === compareResult.recommendedIndex
        if (isRec) {
          doc.setFillColor(240, 253, 244)
          doc.roundedRect(marginL, y - 3.5, contentW, 10, 1, 1, 'F')
        }
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(9)
        doc.setTextColor(17, 17, 17)
        doc.text(`${i + 1}. ${q.data?.insurer || `Cotação ${i + 1}`}`, marginL + 3, y + 2)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7.5)
        doc.setTextColor(136, 136, 136)
        doc.text(q.file.name, marginL + 3, y + 6.5)
        if (isRec) {
          doc.setFillColor(22, 163, 74)
          doc.roundedRect(pageW - marginR - 22, y - 2, 22, 5.5, 1, 1, 'F')
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(6)
          doc.setTextColor(255, 255, 255)
          doc.text('RECOMENDADO', pageW - marginR - 11, y + 1.8, { align: 'center' })
        }
        y += 14
      })

      y += 4

      // ── Tabela comparativa ──
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(136, 136, 136)
      doc.text('TABELA COMPARATIVA', marginL, y)
      y += 4

      const headers = ['Métrica', ...done.map((q, i) => q.data?.insurer || `Cotação ${i + 1}`)]
      const metrics = [
        { label: 'Prémio Anual', key: 'annualPremium', format: (v: number) => v > 0 ? formatCurrency(v) : '—' },
        { label: 'Capital Segurado', key: 'insuredValue', format: (v: number) => v > 0 ? formatCurrency(v) : '—' },
        { label: 'Franquia', key: 'deductible', format: (v: number) => v > 0 ? formatCurrency(v) : '—' },
        { label: 'N.º Coberturas', key: 'coverages', format: (_: any, d: any) => d?.coverages?.length > 0 ? String(d.coverages.length) : '—' },
      ]

      const tableBody = metrics.map(m => [
        m.label,
        ...done.map(q => m.format((q.data as any)?.[m.key], q.data)),
      ])

      autoTable(doc, {
        startY: y,
        head: [headers],
        body: tableBody,
        margin: { left: marginL, right: marginR },
        styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 3.5 },
        headStyles: { fillColor: [10, 22, 40], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
        columnStyles: { 0: { fontStyle: 'bold', textColor: [85, 85, 85] } },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index > 0) {
            const colIdx = data.column.index - 1
            if (colIdx === compareResult.recommendedIndex) {
              data.cell.styles.fillColor = [240, 253, 244]
              data.cell.styles.textColor = [22, 100, 52]
              data.cell.styles.fontStyle = 'bold'
            }
          }
        },
        theme: 'grid',
      })

      y = (doc as any).lastAutoTable.finalY + 10

      // ── Recomendação ──
      doc.setFillColor(22, 163, 74)
      doc.roundedRect(marginL, y, contentW, 8, 1.5, 1.5, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(255, 255, 255)
      const recName = done[compareResult.recommendedIndex]?.data?.insurer || `Cotação ${compareResult.recommendedIndex + 1}`
      doc.text(`✦  Recomendação: ${recName}`, marginL + 4, y + 5.2)
      y += 13

      // Razão
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(9)
      doc.setTextColor(22, 100, 52)
      const reasonLines = doc.splitTextToSize(compareResult.reason, contentW - 4)
      doc.text(reasonLines, marginL + 2, y)
      y += reasonLines.length * 5 + 4

      // Highlights
      if (compareResult.highlights?.length > 0) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8.5)
        doc.setTextColor(50, 50, 50)
        compareResult.highlights.forEach(h => {
          const lines = doc.splitTextToSize(`✓  ${h}`, contentW - 6)
          doc.text(lines, marginL + 2, y)
          y += lines.length * 5 + 1.5
        })
        y += 3
      }

      // Warnings
      if (compareResult.warnings && Object.keys(compareResult.warnings).length > 0) {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.setTextColor(136, 136, 136)
        doc.text('OUTRAS OPÇÕES', marginL + 2, y)
        y += 5
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(100, 100, 100)
        Object.entries(compareResult.warnings).forEach(([idx, warning]) => {
          const q = done[Number(idx)]
          const name = q?.data?.insurer || `Cotação ${Number(idx) + 1}`
          const lines = doc.splitTextToSize(`${name}: ${warning}`, contentW - 6)
          doc.text(lines, marginL + 2, y)
          y += lines.length * 4.5 + 1.5
        })
      }

      y += 8

      // ── Disclaimer ──
      const disclaimer = 'Esta análise foi gerada automaticamente por inteligência artificial com base nos documentos fornecidos. Os resultados têm carácter meramente informativo e não constituem aconselhamento profissional de seguros. A Adler & Rochefort recomenda a consulta com um mediador certificado antes de tomar qualquer decisão.'
      doc.setDrawColor(238, 238, 238)
      doc.line(marginL, y, pageW - marginR, y)
      y += 5
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(170, 170, 170)
      const disclaimerLines = doc.splitTextToSize(disclaimer, contentW)
      doc.text(disclaimerLines, marginL, y)

      // ── Rodapés ──
      const totalPages = doc.getNumberOfPages()
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p)
        addFooter(p, totalPages)
      }

      const fileName = `adler-comparativo-${now.toISOString().slice(0, 10)}.pdf`
      doc.save(fileName)
    } finally {
      setExporting(false)
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
              Analise cada cotação individualmente e compare no final. Mínimo 2, máximo 2 cotações.
            </p>
          </div>
          {(quotes.length > 0 || compareResult) && (
            <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
              {compareResult && (
                <button
                  onClick={exportPdf}
                  disabled={exporting}
                  style={{ fontFamily: font, fontWeight: 600, fontSize: '0.78rem', padding: '0.45rem 0.85rem', background: exporting ? '#ccc' : '#111', color: '#fff', border: 'none', borderRadius: '4px', cursor: exporting ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}
                >
                  {exporting ? 'A gerar PDF...' : '↓ Exportar PDF'}
                </button>
              )}
              <button onClick={handleReset} style={{ fontFamily: font, fontWeight: 600, fontSize: '0.78rem', padding: '0.45rem 0.85rem', background: 'none', color: '#666', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                Recomeçar
              </button>
            </div>
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
                {quotes.length === 0 ? ' (obrigatória)' : ' (obrigatória)'}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '0.5rem 0 1.25rem' }}>
              <div style={{ flex: 1, height: '1px', background: '#eee' }} />
              <p style={{ fontFamily: font, fontWeight: 700, fontSize: '0.72rem', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, whiteSpace: 'nowrap' }}>
                Resumo e Recomendação
              </p>
              <div style={{ flex: 1, height: '1px', background: '#eee' }} />
              <button
                onClick={exportPdf}
                disabled={exporting}
                style={{ fontFamily: font, fontWeight: 600, fontSize: '0.72rem', padding: '0.35rem 0.75rem', background: exporting ? '#ccc' : '#111', color: '#fff', border: 'none', borderRadius: '4px', cursor: exporting ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                {exporting ? 'A gerar...' : '↓ Exportar PDF'}
              </button>
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

            {/* Disclaimer */}
            <p style={{ fontFamily: font, fontSize: '0.68rem', fontWeight: 300, color: '#aaaaaa', lineHeight: 1.6, marginTop: '1rem', padding: '0 0.25rem' }}>
              Esta análise foi gerada automaticamente por inteligência artificial com base nos documentos fornecidos. Os resultados têm carácter meramente informativo e não constituem aconselhamento profissional de seguros. A Adler & Rochefort recomenda a consulta com um mediador certificado antes de tomar qualquer decisão.
            </p>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </AppLayout>
  )
}
