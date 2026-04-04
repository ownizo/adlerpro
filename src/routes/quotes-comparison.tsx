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
      if (selectedFiles.length + files.length > 3) {
        setError('Pode enviar no máximo 3 cotações.')
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

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Erro na análise')
      }

      setResult(data.report)
    } catch (err: any) {
      setError(err.message || 'Ocorreu um erro inesperado')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-navy-700">Comparativo de Cotações (IA)</h1>
          <p className="text-navy-500 mt-1">Carregue até 3 cotações para uma análise detalhada feita pela nossa inteligência artificial Claude.</p>
        </div>

        <div className="bg-white rounded-[4px] border border-navy-200 p-6 mb-8">
          <div className="border-2 border-dashed border-navy-200 rounded-[4px] p-8 text-center hover:bg-navy-50/50 transition-colors">
            <svg className="w-12 h-12 mx-auto text-navy-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-navy-600 mb-2">Arraste os ficheiros ou clique para selecionar</p>
            <p className="text-xs text-navy-400 mb-4">Até 3 ficheiros (Texto, HTML, etc)</p>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              multiple
              accept="text/plain,text/html,application/json,.csv,.md,.pdf"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={files.length >= 3}
              className="px-6 py-2 bg-navy-700 text-white font-medium rounded-[2px] hover:bg-navy-600 transition-colors text-sm disabled:opacity-50"
            >
              Selecionar Ficheiros
            </button>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-50 text-red-700 text-sm rounded-[2px] border border-red-100">
              {error}
            </div>
          )}

          {files.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium text-navy-700 mb-3">Ficheiros Selecionados ({files.length}/3)</h3>
              <ul className="space-y-2">
                {files.map((file, i) => (
                  <li key={i} className="flex items-center justify-between p-3 bg-navy-50 rounded-[2px] border border-navy-100">
                    <span className="text-sm text-navy-600 truncate">{file.name}</span>
                    <button
                      onClick={() => handleRemoveFile(i)}
                      className="text-red-500 hover:text-red-700 p-1"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="flex items-center gap-2 px-6 py-2.5 bg-gold-400 text-navy-700 font-semibold rounded-[2px] hover:bg-gold-300 disabled:opacity-50 transition-colors"
                >
                  {analyzing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-navy-700 border-t-transparent rounded-full animate-spin" />
                      A Analisar...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Analisar Cotações
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {result && (
          <div className="bg-white rounded-[4px] border border-navy-200 p-8 shadow-sm">
            <h2 className="text-xl font-bold text-navy-700 mb-6 pb-4 border-b border-navy-100">
              Conclusão da Análise (Claude IA)
            </h2>
            <div 
              className="prose prose-navy max-w-none prose-headings:font-bold prose-h3:text-lg prose-p:text-navy-600 prose-li:text-navy-600"
              dangerouslySetInnerHTML={{ __html: result }} 
            />
          </div>
        )}
      </div>
    </AppLayout>
  )
}
