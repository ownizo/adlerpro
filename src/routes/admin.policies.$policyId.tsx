import { createFileRoute, Navigate, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { AppLayout } from '@/components/AppLayout'
import {
  fetchAdminPolicyDetail,
  adminUpdatePolicy,
  adminDeletePolicy,
  adminRestorePolicy,
  adminSetPolicyUsers,
  adminUploadPolicyDocument,
  adminGetDocumentUrl,
  adminDeletePolicyDocument,
} from '@/lib/server-fns'
import { formatCurrency, formatDate } from '@/lib/utils'
import { POLICY_TYPE_LABELS } from '@/lib/types'
import type { Policy, PolicyUser } from '@/lib/types'
import { useIdentity } from '@/lib/identity-context'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/admin/policies/$policyId' as any)({
  component: AdminPolicyDetailPage,
  head: () => ({ meta: [{ title: 'Admin · Detalhe da Apólice' }] }),
})

type PolicyFormState = {
  type: string
  insurer: string
  policyNumber: string
  description: string
  startDate: string
  endDate: string
  renewalDate: string
  annualPremium: string
  insuredValue: string
  status: string
  paymentFrequency: string
  commissionPercentage: string
  commissionValue: string
  deductible: string
  visiblePortal: boolean
  emergencyContacts: string
  notesInternal: string
}

function AdminPolicyDetailPage() {
  const { policyId } = Route.useParams() as { policyId: string }
  const { user, ready } = useIdentity()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string>('')
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof fetchAdminPolicyDetail>> | null>(null)
  const [form, setForm] = useState<PolicyFormState | null>(null)
  const [shareAssignments, setShareAssignments] = useState<Array<{ userId: string; role: PolicyUser['role'] }>>([])

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminPolicyDetail({ data: { policyId } })
      setDetail(result)
      setForm(toPolicyForm(result.policy))
      setShareAssignments((result.policyUsers ?? []).map((item) => ({ userId: item.userId, role: item.role })))
    } catch (err: any) {
      setError(err?.message || 'Não foi possível carregar o detalhe da apólice.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!ready || !user || !user.roles?.includes('admin')) return
    load()
  }, [ready, user, policyId])

  if (!ready) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" />
  if (!user.roles?.includes('admin')) return <Navigate to="/dashboard" />

  const policy = detail?.policy
  const companyLabel = detail?.company?.name
    ?? detail?.individualClient?.fullName
    ?? 'Cliente não identificado'

  const usersMap = useMemo(() => {
    const map = new Map<string, { name: string; email: string }>()
    for (const item of detail?.companyUsers ?? []) {
      map.set(item.id, { name: item.name, email: item.email })
    }
    return map
  }, [detail?.companyUsers])

  const toggleShareUser = (userId: string) => {
    setShareAssignments((current) =>
      current.some((item) => item.userId === userId)
        ? current.filter((item) => item.userId !== userId)
        : [...current, { userId, role: 'viewer' }]
    )
  }

  const updateShareRole = (userId: string, role: PolicyUser['role']) => {
    setShareAssignments((current) =>
      current.map((item) => (item.userId === userId ? { ...item, role } : item))
    )
  }

  const saveMainData = async () => {
    if (!policy || !form) return
    setSaving(true)
    setError('')
    try {
      await adminUpdatePolicy({
        data: {
          id: policy.id,
          updates: {
            type: form.type,
            insurer: form.insurer,
            policyNumber: form.policyNumber,
            description: form.description,
            startDate: form.startDate,
            endDate: form.endDate,
            renewalDate: form.renewalDate || null,
            annualPremium: Number(form.annualPremium) || 0,
            insuredValue: Number(form.insuredValue) || 0,
            status: form.status,
            paymentFrequency: form.paymentFrequency || null,
            commissionPercentage: Number(form.commissionPercentage) || 0,
            commissionValue: Number(form.commissionValue) || 0,
            deductible: Number(form.deductible) || 0,
            visiblePortal: form.visiblePortal,
            emergencyContacts: form.emergencyContacts,
            notesInternal: form.notesInternal,
          },
        },
      })
      await load()
    } catch (err: any) {
      setError(err?.message || 'Erro ao guardar dados da apólice.')
    } finally {
      setSaving(false)
    }
  }

  const markRenewal = async () => {
    if (!policy) return
    setSaving(true)
    try {
      await adminUpdatePolicy({ data: { id: policy.id, updates: { status: 'renovacao' } } })
      await load()
    } catch (err: any) {
      setError(err?.message || 'Não foi possível assinalar renovação.')
    } finally {
      setSaving(false)
    }
  }

  const renewPolicy = async () => {
    if (!policy) return
    const end = new Date(policy.endDate)
    if (Number.isNaN(end.getTime())) {
      setError('Data de fim inválida para renovação automática.')
      return
    }

    const nextEnd = new Date(end)
    nextEnd.setFullYear(nextEnd.getFullYear() + 1)

    setSaving(true)
    try {
      await adminUpdatePolicy({
        data: {
          id: policy.id,
          updates: {
            endDate: nextEnd.toISOString().slice(0, 10),
            renewalDate: nextEnd.toISOString().slice(0, 10),
            status: 'ativa',
          },
        },
      })
      await load()
    } catch (err: any) {
      setError(err?.message || 'Não foi possível renovar a apólice.')
    } finally {
      setSaving(false)
    }
  }

  const removePolicy = async () => {
    if (!policy) return
    if (!confirm(`Eliminar a apólice ${policy.policyNumber}?`)) return
    setSaving(true)
    try {
      await adminDeletePolicy({ data: { id: policy.id } })
      await load()
    } catch (err: any) {
      setError(err?.message || 'Não foi possível eliminar a apólice.')
    } finally {
      setSaving(false)
    }
  }

  const restorePolicy = async () => {
    if (!policy) return
    setSaving(true)
    try {
      await adminRestorePolicy({ data: { id: policy.id } })
      await load()
    } catch (err: any) {
      setError(err?.message || 'Não foi possível recuperar a apólice.')
    } finally {
      setSaving(false)
    }
  }

  const saveSharing = async () => {
    if (!policy) return
    setSaving(true)
    try {
      await adminSetPolicyUsers({ data: { policyId: policy.id, assignments: shareAssignments } })
      await load()
    } catch (err: any) {
      setError(err?.message || 'Não foi possível atualizar partilha da apólice.')
    } finally {
      setSaving(false)
    }
  }

  const uploadDocument = async (file: File | undefined) => {
    if (!policy || !file) return
    setUploading(true)
    setError('')
    try {
      const storagePath = `policies/${policy.id}/${Date.now()}-${file.name}`
      const { error: uploadError } = await supabase.storage.from('documents').upload(storagePath, file, {
        upsert: false,
      })
      if (uploadError) throw uploadError

      await adminUploadPolicyDocument({
        data: {
          policyId: policy.id,
          companyId: policy.companyId,
          individualClientId: policy.individualClientId,
          name: file.name,
          storagePath,
          size: file.size,
          category: file.type.startsWith('image/') ? 'certificate' : 'policy',
        },
      })
      await load()
    } catch (err: any) {
      setError(err?.message || 'Erro no upload do documento.')
    } finally {
      setUploading(false)
    }
  }

  const openDocument = async (storagePath: string) => {
    try {
      const { url } = await adminGetDocumentUrl({ data: { storagePath } })
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      alert('Não foi possível abrir o documento.')
    }
  }

  const removeDocument = async (documentId: string, name: string) => {
    if (!policy) return
    if (!confirm(`Remover documento ${name}?`)) return
    setSaving(true)
    try {
      await adminDeletePolicyDocument({ data: { policyId: policy.id, documentId } })
      await load()
    } catch (err: any) {
      setError(err?.message || 'Não foi possível remover documento.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppLayout>
      <div className="w-full space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to="/admin" search={{ tab: 'policies' }} className="text-xs text-navy-500 hover:text-navy-700">
              ← Voltar à gestão de apólices
            </Link>
            <h1 className="text-2xl font-bold text-navy-700 mt-1">Detalhe da Apólice</h1>
            <p className="text-sm text-navy-500">Entidade central de gestão operacional no módulo Admin.</p>
          </div>
        </div>

        {loading ? (
          <div className="bg-white border border-navy-200 rounded-[4px] p-10 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !policy ? (
          <div className="bg-white border border-red-200 text-red-700 rounded-[4px] p-5">
            {error || 'Apólice não encontrada.'}
          </div>
        ) : (
          <>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-[4px] p-3 text-sm">
                {error}
              </div>
            )}

            <section className="bg-white border border-navy-200 rounded-[4px] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-navy-500">Cabeçalho da Apólice</p>
                  <h2 className="text-lg font-semibold text-navy-700">
                    {POLICY_TYPE_LABELS[policy.type as keyof typeof POLICY_TYPE_LABELS] ?? policy.type} · {policy.policyNumber}
                  </h2>
                  <p className="text-sm text-navy-500">{policy.insurer} · {companyLabel}</p>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-navy-100 text-navy-700 font-semibold">{policy.status}</span>
              </div>

              <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-3 mt-4 text-sm">
                <InfoCell label="Início" value={formatDate(policy.startDate)} />
                <InfoCell label="Fim" value={formatDate(policy.endDate)} />
                <InfoCell label="Renovação" value={policy.renewalDate ? formatDate(policy.renewalDate) : '—'} />
                <InfoCell label="Fracionamento" value={policy.paymentFrequency || 'anual'} />
                <InfoCell label="Prémio" value={formatCurrency(policy.annualPremium)} />
                <InfoCell label="Comissão" value={formatCurrency(policy.commissionValue || 0)} />
                <InfoCell label="% Comissão" value={`${policy.commissionPercentage || 0}%`} />
                <InfoCell label="Portal" value={policy.visiblePortal ? 'Visível' : 'Oculta'} />
              </div>

              <div className="flex flex-wrap gap-2 mt-5">
                <button onClick={saveMainData} disabled={saving || !form} className="px-3 py-1.5 text-xs border border-navy-300 rounded hover:bg-navy-50 disabled:opacity-60">
                  Editar / Guardar
                </button>
                {policy.deletedAt ? (
                  <button onClick={restorePolicy} disabled={saving} className="px-3 py-1.5 text-xs border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-50 disabled:opacity-60">
                    Recuperar
                  </button>
                ) : (
                  <button onClick={removePolicy} disabled={saving} className="px-3 py-1.5 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50 disabled:opacity-60">
                    Eliminar
                  </button>
                )}
                <button onClick={markRenewal} disabled={saving} className="px-3 py-1.5 text-xs border border-amber-300 text-amber-700 rounded hover:bg-amber-50 disabled:opacity-60">
                  Assinalar renovação
                </button>
                <button onClick={renewPolicy} disabled={saving} className="px-3 py-1.5 text-xs bg-gold-400 text-navy-700 border border-gold-500 rounded hover:bg-gold-300 disabled:opacity-60">
                  Renovar (+1 ano)
                </button>
                <button onClick={saveSharing} disabled={saving} className="px-3 py-1.5 text-xs border border-navy-300 rounded hover:bg-navy-50 disabled:opacity-60">
                  Partilhar (guardar)
                </button>
              </div>
            </section>

            <section className="bg-white border border-navy-200 rounded-[4px] p-5">
              <h3 className="text-sm font-semibold text-navy-700 mb-3">Dados Principais da Apólice</h3>
              {!form ? (
                <p className="text-sm text-navy-400">Sem dados para edição.</p>
              ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                  <Input label="Tipo" value={form.type} onChange={(value) => setForm((prev) => (prev ? { ...prev, type: value } : prev))} />
                  <Input label="Seguradora" value={form.insurer} onChange={(value) => setForm((prev) => (prev ? { ...prev, insurer: value } : prev))} />
                  <Input label="N.º Apólice" value={form.policyNumber} onChange={(value) => setForm((prev) => (prev ? { ...prev, policyNumber: value } : prev))} />
                  <Input label="Estado" value={form.status} onChange={(value) => setForm((prev) => (prev ? { ...prev, status: value } : prev))} />
                  <Input label="Data início" type="date" value={form.startDate} onChange={(value) => setForm((prev) => (prev ? { ...prev, startDate: value } : prev))} />
                  <Input label="Data fim" type="date" value={form.endDate} onChange={(value) => setForm((prev) => (prev ? { ...prev, endDate: value } : prev))} />
                  <Input label="Data renovação" type="date" value={form.renewalDate} onChange={(value) => setForm((prev) => (prev ? { ...prev, renewalDate: value } : prev))} />
                  <Input label="Prémio anual" type="number" value={form.annualPremium} onChange={(value) => setForm((prev) => (prev ? { ...prev, annualPremium: value } : prev))} />
                  <Input label="Capital seguro" type="number" value={form.insuredValue} onChange={(value) => setForm((prev) => (prev ? { ...prev, insuredValue: value } : prev))} />
                  <Input label="Fracionamento" value={form.paymentFrequency} onChange={(value) => setForm((prev) => (prev ? { ...prev, paymentFrequency: value } : prev))} />
                  <Input label="% comissão" type="number" value={form.commissionPercentage} onChange={(value) => setForm((prev) => (prev ? { ...prev, commissionPercentage: value } : prev))} />
                  <Input label="Valor comissão" type="number" value={form.commissionValue} onChange={(value) => setForm((prev) => (prev ? { ...prev, commissionValue: value } : prev))} />
                  <Input label="Franquia" type="number" value={form.deductible} onChange={(value) => setForm((prev) => (prev ? { ...prev, deductible: value } : prev))} />
                  <Input label="Contactos emergência" value={form.emergencyContacts} onChange={(value) => setForm((prev) => (prev ? { ...prev, emergencyContacts: value } : prev))} />
                  <Input label="Notas internas" value={form.notesInternal} onChange={(value) => setForm((prev) => (prev ? { ...prev, notesInternal: value } : prev))} />
                  <label className="text-xs text-navy-600 flex items-center gap-2 mt-5">
                    <input
                      type="checkbox"
                      checked={form.visiblePortal}
                      onChange={(event) => setForm((prev) => (prev ? { ...prev, visiblePortal: event.target.checked } : prev))}
                      className="accent-gold-400"
                    />
                    Visível no portal
                  </label>
                  <label className="md:col-span-2 lg:col-span-3 text-xs text-navy-600">
                    Descrição
                    <textarea
                      value={form.description}
                      onChange={(event) => setForm((prev) => (prev ? { ...prev, description: event.target.value } : prev))}
                      className="w-full mt-1 px-2 py-1.5 border border-navy-200 rounded-[2px] text-sm"
                      rows={3}
                    />
                  </label>
                </div>
              )}
            </section>

            <section className="bg-white border border-navy-200 rounded-[4px] p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h3 className="text-sm font-semibold text-navy-700">Documentos da Apólice</h3>
                <label className="px-3 py-1.5 text-xs border border-navy-300 rounded hover:bg-navy-50 cursor-pointer">
                  {uploading ? 'A carregar...' : 'Upload documento'}
                  <input
                    type="file"
                    className="hidden"
                    disabled={uploading}
                    onChange={(event) => uploadDocument(event.target.files?.[0])}
                  />
                </label>
              </div>
              <div className="space-y-2">
                {(detail.documents ?? []).length === 0 ? (
                  <p className="text-sm text-navy-400">Sem documentos associados.</p>
                ) : (
                  detail.documents.map((doc) => (
                    <div key={doc.id} className="border border-navy-100 rounded-[2px] p-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-navy-700">{doc.name}</p>
                        <p className="text-xs text-navy-500">Upload: {formatDate(doc.uploadedAt)}</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => openDocument(doc.blobKey)} className="px-2 py-1 text-xs border border-navy-300 rounded hover:bg-navy-50">
                          Ver / Download
                        </button>
                        <button onClick={() => removeDocument(doc.id, doc.name)} className="px-2 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50">
                          Remover
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="bg-white border border-navy-200 rounded-[4px] p-5">
              <h3 className="text-sm font-semibold text-navy-700 mb-3">Utilizadores com Acesso</h3>
              {(detail.companyUsers ?? []).length === 0 ? (
                <p className="text-sm text-navy-400">Sem utilizadores disponíveis para esta apólice.</p>
              ) : (
                <div className="space-y-2">
                  {detail.companyUsers.map((companyUser) => {
                    const assigned = shareAssignments.find((item) => item.userId === companyUser.id)
                    return (
                      <div key={companyUser.id} className="border border-navy-100 rounded-[2px] p-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-navy-700">{companyUser.name}</p>
                          <p className="text-xs text-navy-500">{companyUser.email}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-navy-600 flex items-center gap-1">
                            <input
                              type="checkbox"
                              className="accent-gold-400"
                              checked={Boolean(assigned)}
                              onChange={() => toggleShareUser(companyUser.id)}
                            />
                            Com acesso
                          </label>
                          <select
                            className="px-2 py-1 text-xs border border-navy-200 rounded"
                            value={assigned?.role ?? 'viewer'}
                            onChange={(event) => updateShareRole(companyUser.id, event.target.value as PolicyUser['role'])}
                            disabled={!assigned}
                          >
                            <option value="owner">owner</option>
                            <option value="editor">editor</option>
                            <option value="viewer">viewer</option>
                          </select>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            <section className="bg-white border border-navy-200 rounded-[4px] p-5">
              <h3 className="text-sm font-semibold text-navy-700 mb-3">Histórico / Atividade</h3>
              {(detail.auditTrail ?? []).length === 0 ? (
                <p className="text-sm text-navy-400">Sem registos de atividade.</p>
              ) : (
                <div className="space-y-2">
                  {detail.auditTrail.map((item) => {
                    const actor = usersMap.get(item.userId)
                    return (
                      <div key={item.id} className="border border-navy-100 rounded-[2px] p-3">
                        <p className="text-xs text-navy-700 font-semibold">
                          {item.action.toUpperCase()} · {item.entity}
                        </p>
                        <p className="text-xs text-navy-500 mt-0.5">
                          {formatDate(item.timestamp)} · {actor?.name || item.userId}
                        </p>
                        <pre className="mt-2 text-[11px] text-navy-600 bg-navy-50 border border-navy-100 rounded p-2 overflow-auto">
                          {JSON.stringify(item.changes, null, 2)}
                        </pre>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            <section className="bg-white border border-navy-200 rounded-[4px] p-5">
              <h3 className="text-sm font-semibold text-navy-700 mb-3">Resumo Operacional</h3>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                <InfoCell
                  label="Renovação"
                  value={
                    detail.summary.daysUntilRenewal === null
                      ? 'Sem data'
                      : detail.summary.daysUntilRenewal >= 0
                        ? `Em ${detail.summary.daysUntilRenewal} dias`
                        : `Atrasada (${Math.abs(detail.summary.daysUntilRenewal)} dias)`
                  }
                />
                <InfoCell label="Alertas" value={detail.summary.hasUpcomingRenewal ? 'Renovação próxima (≤90 dias)' : 'Sem alerta crítico'} />
                <InfoCell label="Sinistros ligados" value={`${detail.claims.length} (${detail.summary.openClaimsCount} abertos)`} />
                <InfoCell label="Estado documental" value={detail.summary.documentState} />
              </div>
              {detail.claims.length > 0 && (
                <div className="mt-4 border border-navy-100 rounded-[2px] p-3">
                  <p className="text-xs font-semibold text-navy-600 uppercase tracking-wide mb-2">Sinistros ligados</p>
                  <div className="space-y-1.5">
                    {detail.claims.slice(0, 5).map((claim) => (
                      <p key={claim.id} className="text-xs text-navy-600">
                        {claim.title} · {claim.status} · {formatDate(claim.claimDate)}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </AppLayout>
  )
}

function toPolicyForm(policy: Policy): PolicyFormState {
  return {
    type: policy.type || '',
    insurer: policy.insurer || '',
    policyNumber: policy.policyNumber || '',
    description: policy.description || '',
    startDate: policy.startDate || '',
    endDate: policy.endDate || '',
    renewalDate: policy.renewalDate || '',
    annualPremium: String(policy.annualPremium ?? ''),
    insuredValue: String(policy.insuredValue ?? ''),
    status: policy.status || 'ativa',
    paymentFrequency: policy.paymentFrequency || '',
    commissionPercentage: String(policy.commissionPercentage ?? ''),
    commissionValue: String(policy.commissionValue ?? ''),
    deductible: String(policy.deductible ?? ''),
    visiblePortal: policy.visiblePortal ?? true,
    emergencyContacts: policy.emergencyContacts || '',
    notesInternal: policy.notesInternal || '',
  }
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-navy-100 rounded-[2px] p-3">
      <p className="text-[11px] uppercase tracking-wide text-navy-500">{label}</p>
      <p className="text-sm font-medium text-navy-700 mt-1">{value}</p>
    </div>
  )
}

function Input({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'date' | 'number'
}) {
  return (
    <label className="text-xs text-navy-600">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full mt-1 px-2 py-1.5 border border-navy-200 rounded-[2px] text-sm"
      />
    </label>
  )
}
