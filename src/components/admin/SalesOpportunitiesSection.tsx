import { useEffect, useState } from 'react'
import type { SalesOpportunity } from '@/lib/types'
import {
  SALES_OPPORTUNITY_STAGE_LABELS_PT,
  SALES_OPPORTUNITY_PRODUCT_OPTIONS,
} from '@/lib/sales-opportunity-rules'
import { fetchSalesOpportunitiesByOwner, adminCreateSalesOpportunity } from '@/lib/server-fns'
import { formatCurrency, formatDate } from '@/lib/utils'

interface Props {
  companyId?: string
  individualClientId?: string
  clientName: string
}

/**
 * Secção "Oportunidades" na ficha unificada do cliente (individual ou
 * empresa) — histórico comercial, não um pipeline completo (isso vive no
 * separador Comercial/Pipeline). BACKOFFICE ONLY, tal como o resto do CRM
 * comercial.
 */
export function SalesOpportunitiesSection({ companyId, individualClientId, clientName }: Props) {
  const [opportunities, setOpportunities] = useState<SalesOpportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)
  const [product, setProduct] = useState('')
  const [saving, setSaving] = useState(false)

  const reload = () => {
    setLoading(true)
    setError(null)
    fetchSalesOpportunitiesByOwner({ data: { companyId, individualClientId } })
      .then(setOpportunities)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Erro ao carregar oportunidades'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, individualClientId])

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-navy-700">Oportunidades</h4>
        <button
          onClick={() => setShowNewForm((v) => !v)}
          className="text-xs px-3 py-1.5 rounded-[4px] bg-navy-700 text-white font-medium"
        >
          {showNewForm ? 'Cancelar' : 'Nova oportunidade'}
        </button>
      </div>

      {showNewForm && (
        <div className="mb-3 bg-navy-50 border border-navy-200 rounded-[4px] p-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="text-[11px] text-navy-600">Produto</label>
            <select value={product} onChange={(e) => setProduct(e.target.value)} className="block mt-1 px-2 py-1 text-xs border border-navy-200 rounded-[2px]">
              <option value="">Selecionar…</option>
              {SALES_OPPORTUNITY_PRODUCT_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <button
            disabled={!product || saving}
            onClick={async () => {
              setSaving(true)
              setError(null)
              try {
                await adminCreateSalesOpportunity({
                  data: { companyId, individualClientId, clientName, product, source: 'manual' },
                })
                setShowNewForm(false)
                setProduct('')
                reload()
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Erro ao criar oportunidade')
              } finally {
                setSaving(false)
              }
            }}
            className="text-xs px-3 py-1.5 rounded-[2px] bg-gold-400 text-navy-700 font-semibold disabled:opacity-50"
          >
            {saving ? 'A criar…' : 'Criar'}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

      {loading ? (
        <p className="text-sm text-navy-400">A carregar…</p>
      ) : opportunities.length === 0 ? (
        <p className="text-sm text-navy-400">Sem oportunidades registadas.</p>
      ) : (
        <div className="grid gap-2">
          {opportunities.map((opp) => (
            <div key={opp.id} className="bg-white rounded-[4px] border border-navy-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-navy-700">{opp.product ?? opp.title}</p>
                <p className="text-xs text-navy-500 mt-0.5">
                  {formatDate(opp.createdAt)} · {opp.source ?? 'manual'}
                  {(opp.estimatedAnnualPremium || opp.estimatedRevenue) &&
                    ` · ${formatCurrency(opp.estimatedAnnualPremium ?? opp.estimatedRevenue ?? 0)}`}
                  {opp.nextFollowUpAt && ` · Follow-up: ${formatDate(opp.nextFollowUpAt)}`}
                </p>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-navy-100 text-navy-600">
                {SALES_OPPORTUNITY_STAGE_LABELS_PT[opp.stage]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
