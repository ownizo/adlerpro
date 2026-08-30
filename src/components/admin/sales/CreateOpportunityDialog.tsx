import { useEffect, useState } from 'react'
import type { Company, IndividualClient } from '@/lib/types'
import {
  SALES_OPPORTUNITY_SOURCES,
  SALES_OPPORTUNITY_SOURCE_LABELS_EN,
  SALES_OPPORTUNITY_PRODUCT_OPTIONS_EN,
} from '@/lib/sales-opportunity-rules'
import { adminCreateSalesOpportunity } from '@/lib/server-fns'
import { SearchableSelect } from './SearchableSelect'

interface Props {
  individualClients: IndividualClient[]
  companies: Company[]
  onCreated: () => void
  onClose: () => void
  /** Pré-seleciona o dono quando aberto a partir da ficha de um cliente/empresa. */
  initialOwner?: { kind: 'individual' | 'company'; id: string; name: string }
}

const fieldLabel = 'block text-[13px] font-medium text-slate-600 mb-1'
const inputClass = 'w-full px-2.5 py-1.5 text-[14px] border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400'

/**
 * Formulário de criação em secções curtas (Essencial / Comercial /
 * Financeiro / Planeamento) em vez de uma lista longa de campos — ver
 * requisito "create opportunity". Defaults: stage='new', source='manual',
 * currency='EUR', aplicados no server-fn (adminCreateSalesOpportunity), não
 * duplicados aqui.
 */
export function CreateOpportunityDialog({ individualClients, companies, onCreated, onClose, initialOwner }: Props) {
  const [ownerType, setOwnerType] = useState<'individual' | 'company'>(initialOwner?.kind ?? 'individual')
  const [ownerId, setOwnerId] = useState(initialOwner?.id ?? '')
  const [product, setProduct] = useState('')
  const [market, setMarket] = useState('PT')
  const [source, setSource] = useState('manual')
  const [assignedTo, setAssignedTo] = useState('')
  const [estimatedAnnualPremium, setEstimatedAnnualPremium] = useState('')
  const [estimatedRevenue, setEstimatedRevenue] = useState('')
  const [expectedCloseDate, setExpectedCloseDate] = useState('')
  const [nextFollowUpAt, setNextFollowUpAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const ownerOptions = (ownerType === 'individual' ? individualClients : companies).map((c) => ({
    id: c.id,
    label: 'fullName' in c ? c.fullName : c.name,
  }))

  const canSave = ownerId && product && !saving

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[88vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-[16px] font-semibold text-slate-800">New opportunity</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">✕</button>
        </div>

        <div className="p-5 space-y-5">
          <section>
            <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Essentials</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>Client type</label>
                <select
                  value={ownerType}
                  onChange={(e) => { setOwnerType(e.target.value as 'individual' | 'company'); setOwnerId('') }}
                  className={inputClass}
                  disabled={!!initialOwner}
                >
                  <option value="individual">Individual client</option>
                  <option value="company">Company</option>
                </select>
              </div>
              <div>
                <label className={fieldLabel}>{ownerType === 'individual' ? 'Client' : 'Company'}</label>
                {initialOwner ? (
                  <input value={initialOwner.name} disabled className={`${inputClass} bg-slate-50 text-slate-500`} />
                ) : (
                  <SearchableSelect
                    options={ownerOptions}
                    value={ownerId}
                    onChange={setOwnerId}
                    placeholder={ownerType === 'individual' ? 'Type a name…' : 'Type a company name…'}
                  />
                )}
              </div>
              <div>
                <label className={fieldLabel}>Product</label>
                <select value={product} onChange={(e) => setProduct(e.target.value)} className={inputClass}>
                  <option value="">Select…</option>
                  {SALES_OPPORTUNITY_PRODUCT_OPTIONS_EN.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className={fieldLabel}>Market</label>
                <select value={market} onChange={(e) => setMarket(e.target.value)} className={inputClass}>
                  <option value="PT">PT</option>
                  <option value="ES">ES</option>
                </select>
              </div>
            </div>
          </section>

          <section>
            <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Sales</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>Source</label>
                <select value={source} onChange={(e) => setSource(e.target.value)} className={inputClass}>
                  {SALES_OPPORTUNITY_SOURCES.map((s) => <option key={s} value={s}>{SALES_OPPORTUNITY_SOURCE_LABELS_EN[s]}</option>)}
                </select>
              </div>
              <div>
                <label className={fieldLabel}>Owner</label>
                <input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="email@adlerrochefort.com" className={inputClass} />
              </div>
            </div>
          </section>

          <section>
            <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Financials</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>Estimated annual premium</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[14px]">€</span>
                  <input type="number" value={estimatedAnnualPremium} onChange={(e) => setEstimatedAnnualPremium(e.target.value)} className={`${inputClass} pl-6`} />
                </div>
              </div>
              <div>
                <label className={fieldLabel}>Estimated revenue (Adler)</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[14px]">€</span>
                  <input type="number" value={estimatedRevenue} onChange={(e) => setEstimatedRevenue(e.target.value)} className={`${inputClass} pl-6`} />
                </div>
              </div>
            </div>
          </section>

          <section>
            <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Planning</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>Expected close date</label>
                <input type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={fieldLabel}>Next follow-up</label>
                <input type="date" value={nextFollowUpAt} onChange={(e) => setNextFollowUpAt(e.target.value)} className={inputClass} />
              </div>
            </div>
          </section>

          {error && <p className="text-[13px] text-rose-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-3.5 py-2 text-[14px] font-medium text-slate-600 hover:bg-slate-50 rounded-md">Cancel</button>
          <button
            disabled={!canSave}
            onClick={async () => {
              setSaving(true)
              setError(null)
              const clientName =
                initialOwner?.name ??
                (ownerType === 'individual'
                  ? individualClients.find((c) => c.id === ownerId)?.fullName ?? 'Cliente'
                  : companies.find((c) => c.id === ownerId)?.name ?? 'Cliente')
              try {
                await adminCreateSalesOpportunity({
                  data: {
                    companyId: ownerType === 'company' ? ownerId : undefined,
                    individualClientId: ownerType === 'individual' ? ownerId : undefined,
                    clientName,
                    product,
                    market,
                    source,
                    assignedTo: assignedTo || undefined,
                    estimatedAnnualPremium: estimatedAnnualPremium ? Number(estimatedAnnualPremium) : undefined,
                    estimatedRevenue: estimatedRevenue ? Number(estimatedRevenue) : undefined,
                    expectedCloseDate: expectedCloseDate || undefined,
                    nextFollowUpAt: nextFollowUpAt || undefined,
                  },
                })
                onCreated()
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not create the opportunity.')
              } finally {
                setSaving(false)
              }
            }}
            className="admin-create-button disabled:opacity-40"
          >
            {saving ? 'Creating…' : 'Create opportunity'}
          </button>
        </div>
      </div>
    </div>
  )
}
