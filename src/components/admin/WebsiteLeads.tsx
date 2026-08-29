import { useEffect, useState } from 'react'
import type { WebsiteLead } from '@/lib/types'
import { fetchWebsiteLeads } from '@/lib/server-fns'
import { formatDate } from '@/lib/utils'

interface Props {
  individualClientId: string
}

/**
 * Histórico de pedidos vindos do site público (adlerrochefort.com) para este
 * cliente. Só leitura — a escrita é feita pelo intake endpoint
 * (netlify/api-functions/lead-intake.mts), nunca por aqui.
 *
 * Não é um pipeline de vendas (sem estados, sem valores) — ver requisito
 * "website_leads é histórico de pedidos/submissões".
 */
export function WebsiteLeads({ individualClientId }: Props) {
  const [leads, setLeads] = useState<WebsiteLead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchWebsiteLeads({ data: individualClientId })
      .then((result) => {
        if (!cancelled) setLeads(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar pedidos do website')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [individualClientId])

  return (
    <div>
      <h4 className="text-sm font-semibold text-navy-700 mb-3">Pedidos do Website</h4>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {loading ? (
        <p className="text-sm text-navy-400">A carregar…</p>
      ) : leads.length === 0 ? (
        <p className="text-sm text-navy-400">Sem pedidos registados a partir do site.</p>
      ) : (
        <div className="grid gap-2">
          {leads.map((lead) => (
            <div key={lead.id} className="bg-white rounded-[4px] border border-navy-200 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-navy-700">
                  {lead.product || lead.formName}
                  {lead.market && <span className="text-navy-400 font-normal"> · {lead.market}</span>}
                </p>
                <span className="text-xs text-navy-400">{formatDate(lead.receivedAt)}</span>
              </div>
              <p className="text-xs text-navy-500 mt-1">
                Formulário: {lead.formName}
                {lead.sourceUrl && (
                  <>
                    {' · '}
                    <a
                      href={lead.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 break-all"
                    >
                      {lead.sourceUrl}
                    </a>
                  </>
                )}
              </p>
              {lead.metadata && Object.keys(lead.metadata).length > 0 && (
                <p className="text-xs text-navy-400 mt-1">
                  {Object.entries(lead.metadata)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(' · ')}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
