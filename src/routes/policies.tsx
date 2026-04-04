import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { fetchPolicies, createPolicy, updatePolicy, deletePolicy } from '@/lib/server-fns'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Policy } from '@/lib/types'
import { POLICY_TYPE_LABELS } from '@/lib/types'
import { useState, useEffect } from 'react'
import { getServerUser } from '@/lib/auth'

export const Route = createFileRoute('/policies')({
  beforeLoad: async () => {
    const user = await getServerUser()
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  component: PoliciesPage,
})

function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selected, setSelected] = useState<Policy | null>(null)

  const [showAddForm, setShowAddForm] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [formData, setFormData] = useState<any>({})
  const [uploading, setUploading] = useState(false)
  const [detailsExpanded, setDetailsExpanded] = useState(false)

  const loadPolicies = () => {
    setLoading(true)
    fetchPolicies().then((p) => {
      setPolicies(p)
      setLoading(false)
    })
  }

  useEffect(() => {
    loadPolicies()
  }, [])

  const filtered = policies.filter((p) => {
    if (typeFilter !== 'all' && p.type !== typeFilter) return false
    if (statusFilter !== 'all' && p.status !== statusFilter) return false
    return true
  })

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)

    try {
      const data = new FormData()
      data.append('file', file)
      
      const res = await fetch('/api/extract-policy', {
        method: 'POST',
        body: data,
      })
      if (!res.ok) throw new Error('Erro ao processar ficheiro')
      const extracted = await res.json()
      
      setFormData({
        ...formData,
        ...extracted,
        description: `Apólice extraída de ${file.name}`
      })
      setShowAddForm(true)
    } catch (err) {
      alert(err)
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      if (editMode && selected) {
        await updatePolicy({ data: { id: selected.id, updates: formData } })
      } else {
        await createPolicy({ data: { ...formData, companyId: 'comp_001' } }) // Dummy company ID
      }
      setShowAddForm(false)
      setEditMode(false)
      setSelected(null)
      loadPolicies()
    } catch (err) {
      alert('Erro ao guardar apólice')
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Tem a certeza que deseja eliminar esta apólice?')) return
    setLoading(true)
    try {
      await deletePolicy({ data: id })
      setSelected(null)
      loadPolicies()
    } catch (err) {
      alert('Erro ao eliminar apólice')
      setLoading(false)
    }
  }

  const openEdit = (policy: any) => {
    setFormData(policy)
    setEditMode(true)
    setShowAddForm(true)
    setSelected(policy)
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-navy-700">Portfólio de Apólices</h1>
            <p className="text-navy-500 mt-1">Consulte e efetue a gestão das suas apólices de seguros</p>
          </div>
          <div className="flex gap-3">
            <label className="cursor-pointer bg-navy-100 text-navy-800 px-4 py-2 rounded text-sm hover:bg-navy-200 transition-colors">
              {uploading ? 'A processar...' : 'Adicionar via IA (Upload PDF)'}
              <input type="file" className="hidden" accept=".pdf,image/*" onChange={handleFileUpload} disabled={uploading} />
            </label>
            <button 
              onClick={() => {
                setFormData({ type: 'auto', status: 'active', companyId: 'comp_001' })
                setEditMode(false)
                setShowAddForm(true)
              }}
              className="bg-[#111111] text-white px-4 py-2 rounded text-sm hover:bg-black transition-colors"
            >
              Adicionar Manualmente
            </button>
          </div>
        </div>

        {showAddForm && (
          <div className="bg-white p-6 rounded border border-navy-200 shadow-sm mb-8">
            {formData.description?.includes('Apólice extraída') && (
              <div className="mb-6 p-4 bg-navy-50 rounded border border-navy-200">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-navy-700">Resumo da Apólice (IA)</h3>
                  <button type="button" onClick={() => setDetailsExpanded(!detailsExpanded)} className="text-sm text-gold-600 hover:text-gold-700 font-medium">
                    {detailsExpanded ? 'Ocultar Detalhes' : 'Ver Detalhes'}
                  </button>
                </div>
                <p className="text-sm text-navy-600">
                  <strong>Capital:</strong> {formatCurrency(formData.insuredValue || 0)} | <strong>Prémio:</strong> {formatCurrency(formData.annualPremium || 0)} | <strong>Franquia:</strong> {formatCurrency(formData.deductible || 0)}
                </p>
                {detailsExpanded && (
                  <div className="mt-4 grid md:grid-cols-2 gap-4 text-sm text-navy-600">
                    <div>
                      <strong className="text-green-700 block mb-1">Coberturas:</strong>
                      <ul className="list-disc pl-4 space-y-0.5">{formData.coverages?.map((c: string, i: number) => <li key={i}>{c}</li>) || <li>Não especificadas</li>}</ul>
                    </div>
                    <div>
                      <strong className="text-red-700 block mb-1">Exclusões:</strong>
                      <ul className="list-disc pl-4 space-y-0.5">{formData.exclusions?.map((c: string, i: number) => <li key={i}>{c}</li>) || <li>Não especificadas</li>}</ul>
                    </div>
                  </div>
                )}
              </div>
            )}
            <h2 className="text-xl font-bold mb-4">{editMode ? 'Editar Apólice' : 'Nova Apólice'}</h2>
            <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Tipo</label>
                <select className="w-full p-2 border rounded" value={formData.type || ''} onChange={(e) => setFormData({...formData, type: e.target.value})} required>
                  <option value="">Selecione...</option>
                  {Object.entries(POLICY_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div><label className="block text-sm font-medium mb-1">Seguradora</label><input type="text" className="w-full p-2 border rounded" value={formData.insurer || ''} onChange={e => setFormData({...formData, insurer: e.target.value})} required /></div>
              <div><label className="block text-sm font-medium mb-1">Número</label><input type="text" className="w-full p-2 border rounded" value={formData.policyNumber || ''} onChange={e => setFormData({...formData, policyNumber: e.target.value})} required /></div>
              <div><label className="block text-sm font-medium mb-1">Início</label><input type="date" className="w-full p-2 border rounded" value={formData.startDate || ''} onChange={e => setFormData({...formData, startDate: e.target.value})} required /></div>
              <div><label className="block text-sm font-medium mb-1">Fim</label><input type="date" className="w-full p-2 border rounded" value={formData.endDate || ''} onChange={e => setFormData({...formData, endDate: e.target.value})} required /></div>
              <div><label className="block text-sm font-medium mb-1">Prémio Anual (€)</label><input type="number" className="w-full p-2 border rounded" value={formData.annualPremium || ''} onChange={e => setFormData({...formData, annualPremium: Number(e.target.value)})} required /></div>
              <div><label className="block text-sm font-medium mb-1">Capital Seguro (€)</label><input type="number" className="w-full p-2 border rounded" value={formData.insuredValue || ''} onChange={e => setFormData({...formData, insuredValue: Number(e.target.value)})} /></div>
              <div><label className="block text-sm font-medium mb-1">Franquia (€)</label><input type="number" className="w-full p-2 border rounded" value={formData.deductible || ''} onChange={e => setFormData({...formData, deductible: Number(e.target.value)})} /></div>
              <div className="md:col-span-2"><label className="block text-sm font-medium mb-1">Descrição</label><input type="text" className="w-full p-2 border rounded" value={formData.description || ''} onChange={e => setFormData({...formData, description: e.target.value})} /></div>
              <div className="md:col-span-2 flex justify-end gap-2 mt-4">
                <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 border rounded text-sm hover:bg-gray-50">Cancelar</button>
                <button type="submit" className="px-4 py-2 bg-[#111111] text-white rounded text-sm hover:bg-black">Guardar</button>
              </div>
            </form>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-4 mb-6">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-4 py-2 bg-white border border-navy-200 rounded-[2px] text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-gold-400">
            <option value="all">Todos os tipos</option>
            {Object.entries(POLICY_TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-4 py-2 bg-white border border-navy-200 rounded-[2px] text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-gold-400">
            <option value="all">Todos os estados</option>
            <option value="active">Ativa</option>
            <option value="expiring">A Expirar</option>
            <option value="expired">Expirada</option>
            <option value="cancelled">Cancelada</option>
          </select>
        </div>

        {loading && !policies.length ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid gap-4">
            {filtered.map((policy) => (
              <div key={policy.id} className="bg-white rounded-[4px] border border-navy-200 overflow-hidden">
                <div className="p-6 cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => setSelected(selected?.id === policy.id ? null : policy)}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="text-lg font-semibold text-navy-700">{POLICY_TYPE_LABELS[policy.type] || policy.type}</h3>
                        <PolicyStatusBadge status={policy.status} />
                      </div>
                      <p className="text-sm text-navy-400">{policy.description}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-navy-700">{formatCurrency(policy.annualPremium)}</p>
                      <p className="text-xs text-navy-400">Prémio anual</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-6 mt-4 text-sm text-navy-500">
                    <span>Seguradora: <strong>{policy.insurer}</strong></span>
                    <span>N.º: <strong>{policy.policyNumber}</strong></span>
                    <span>Validade: <strong>{formatDate(policy.startDate)} — {formatDate(policy.endDate)}</strong></span>
                  </div>
                </div>

                {selected?.id === policy.id && (
                  <div className="border-t border-navy-100 bg-navy-50/50 p-6">
                    <div className="flex justify-between items-center mb-4">
                      <h4 className="text-sm font-semibold text-navy-600">Detalhes da Apólice</h4>
                      <div className="flex gap-2">
                        {policy.documentKey && (
                          <a href={`/api/download-document?key=${encodeURIComponent(policy.documentKey)}`} target="_blank" rel="noreferrer" className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1 rounded hover:bg-blue-100 flex items-center">Ver Documento</a>
                        )}
                        <button onClick={() => openEdit(policy)} className="text-xs bg-white border border-gray-300 px-3 py-1 rounded hover:bg-gray-50">Editar</button>
                        <button onClick={() => handleDelete(policy.id)} className="text-xs bg-red-50 text-red-600 border border-red-200 px-3 py-1 rounded hover:bg-red-100">Eliminar</button>
                      </div>
                    </div>                    
                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <DetailItem label="Tipo" value={POLICY_TYPE_LABELS[policy.type] || policy.type} />
                      <DetailItem label="Seguradora" value={policy.insurer} />
                      <DetailItem label="N.º Apólice" value={policy.policyNumber} />
                      <DetailItem label="Estado" value={statusLabel(policy.status)} />
                      <DetailItem label="Início" value={formatDate(policy.startDate)} />
                      <DetailItem label="Fim" value={formatDate(policy.endDate)} />
                      <DetailItem label="Prémio Anual" value={formatCurrency(policy.annualPremium)} />
                      <DetailItem label="Capital Segurado" value={policy.insuredValue > 0 ? formatCurrency(policy.insuredValue) : 'N/A'} />
                      {policy.deductible && <DetailItem label="Franquia" value={formatCurrency(policy.deductible)} />}
                    </div>

                    {((policy.coverages && policy.coverages.length > 0) || (policy.exclusions && policy.exclusions.length > 0)) && (
                      <div className="mt-6 grid sm:grid-cols-2 gap-4">
                        {(policy.coverages && policy.coverages.length > 0) && (
                          <div>
                            <h5 className="text-xs font-semibold text-green-700 mb-2 uppercase tracking-wider">Coberturas</h5>
                            <ul className="text-sm text-navy-600 list-disc pl-4 space-y-1">
                              {policy.coverages.map((c: string, i: number) => <li key={i}>{c}</li>)}
                            </ul>
                          </div>
                        )}
                        {(policy.exclusions && policy.exclusions.length > 0) && (
                          <div>
                            <h5 className="text-xs font-semibold text-red-700 mb-2 uppercase tracking-wider">Exclusões</h5>
                            <ul className="text-sm text-navy-600 list-disc pl-4 space-y-1">
                              {policy.exclusions.map((c: string, i: number) => <li key={i}>{c}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="bg-white rounded-[4px] border border-navy-200 p-12 text-center">
                <p className="text-navy-400">Nenhuma apólice encontrada com os filtros selecionados.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  )
}

function PolicyStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = { active: 'bg-[#EAF3DE] text-[#3B6D11]', expiring: 'bg-[#FAEEDA] text-[#854F0B]', expired: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-600' }
  return <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${styles[status] || 'bg-gray-100 text-gray-600'}`}>{statusLabel(status)}</span>
}
function statusLabel(status: string): string {
  const labels: Record<string, string> = { active: 'Ativa', expiring: 'A Expirar', expired: 'Expirada', cancelled: 'Cancelada' }
  return labels[status] || status
}
function DetailItem({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-navy-400">{label}</p><p className="text-sm font-medium text-navy-700">{value}</p></div>
}
