import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useState } from 'react'

export const Route = createFileRoute('/partner-risk')({
  component: PartnerRiskPage,
})

function PartnerRiskPage() {
  const [nif, setNif] = useState('')
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const [error, setError] = useState('')

  const analyzeRisk = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nif) return
    setLoading(true)
    setError('')
    setReport(null)

    try {
      const response = await fetch('/api/analyze-partner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nif }),
      })

      if (!response.ok) throw new Error('Falha na análise de risco')
      
      const data = await response.json()
      setReport(data.report)
    } catch (err: any) {
      setError(err.message || 'Erro desconhecido')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-navy-700 mb-2">Análise de Risco de Parceiros</h1>
        <p className="text-navy-500 mb-8">Introduza o NIF da empresa para analisar a exposição a riscos (dívidas, processos, etc) via Bizapis & IA.</p>

        <form onSubmit={analyzeRisk} className="bg-white p-6 rounded border border-navy-200 mb-8">
          <label className="block text-sm font-medium text-navy-700 mb-2">NIF da Empresa Parceira</label>
          <div className="flex gap-4">
            <input
              type="text"
              className="flex-1 p-2 border border-navy-200 rounded focus:ring-2 focus:ring-gold-400 outline-none"
              placeholder="Ex: 500000000"
              value={nif}
              onChange={(e) => setNif(e.target.value)}
              pattern="\d{9}"
              title="O NIF deve conter 9 dígitos"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-[#111111] text-white px-6 py-2 rounded hover:bg-black disabled:opacity-50"
            >
              {loading ? 'A analisar...' : 'Analisar Risco'}
            </button>
          </div>
          {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
        </form>

        {report && (
          <div className="bg-white p-8 rounded border border-navy-200 prose max-w-none prose-navy">
            <h2 className="text-xl font-bold text-navy-700 mb-6">Relatório de Risco</h2>
            <div className="whitespace-pre-wrap text-navy-600 text-sm" dangerouslySetInnerHTML={{ __html: report }} />
          </div>
        )}
      </div>
    </AppLayout>
  )
}
