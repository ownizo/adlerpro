import { createFileRoute, Link, Navigate, Outlet, useRouterState } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useIdentity } from '@/lib/identity-context'
import { adminUpdateClaimStatus, fetchAdminClaimsList } from '@/lib/server-fns'
import { CLAIM_STATUS_LABELS, type AdminClaimListItem, type ClaimStatus } from '@/lib/types'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useEffect, useMemo, useState } from 'react'

export const Route = createFileRoute('/admin-claims')({
  component: AdminClaimsListPage,
  head: () => ({ meta: [{ title: 'Admin • Sinistros' }] }),
})

function AdminClaimsListPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { user, ready } = useIdentity()
  const [rows, setRows] = useState<AdminClaimListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [statusDrafts, setStatusDrafts] = useState<Record<string, ClaimStatus | ''>>({})
  const [updatingClaimId, setUpdatingClaimId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchAdminClaimsList()
      setRows(data)
      setStatusDrafts({})
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao carregar sinistros.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (pathname !== '/admin-claims') return
    if (!ready || !user || !user.roles?.includes('admin')) return
    load()
  }, [ready, user, pathname])

  const totals = useMemo(() => {
    const estimatedValue = rows.reduce((sum, row) => sum + (row.claim.estimatedValue || 0), 0)
    const openCount = rows.filter((row) => !['approved', 'denied', 'paid'].includes(row.claim.status)).length
    return {
      total: rows.length,
      estimatedValue,
      openCount,
    }
  }, [rows])

  const handleQuickStatusUpdate = async (claimId: string, nextStatus: ClaimStatus) => {
    const current = rows.find((row) => row.claim.id === claimId)?.claim.status
    if (!current || current === nextStatus) return

    setUpdatingClaimId(claimId)
    setRows((prev) => prev.map((row) => (
      row.claim.id === claimId
        ? { ...row, claim: { ...row.claim, status: nextStatus } }
        : row
    )))

    try {
      await adminUpdateClaimStatus({ data: { claimId, status: nextStatus, notes: 'Atualização rápida na lista de Admin' } })
      setStatusDrafts((prev) => ({ ...prev, [claimId]: '' }))
    } catch (err) {
      await load()
      alert('Não foi possível atualizar o estado do sinistro.')
    } finally {
      setUpdatingClaimId(null)
    }
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" />
  if (!user.roles?.includes('admin')) return <Navigate to="/dashboard" />
  if (pathname !== '/admin-claims') return <Outlet />

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-navy-700">Admin • Sinistros</h1>
            <p className="text-sm text-navy-500 mt-1">Controlo operacional completo dos sinistros no backoffice.</p>
          </div>
          <Link
            to="/admin"
            search={{ tab: 'claims' }}
            className="px-3 py-2 border border-navy-200 text-sm text-navy-600 rounded-[2px] hover:bg-navy-50"
          >
            Ver Tab Legado
          </Link>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 mb-6">
          <KpiCard label="Total" value={String(totals.total)} />
          <KpiCard label="Em aberto" value={String(totals.openCount)} />
          <KpiCard label="Valor estimado" value={formatCurrency(totals.estimatedValue)} />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-[4px] p-4 text-sm">{error}</div>
        ) : rows.length === 0 ? (
          <div className="bg-white border border-navy-200 rounded-[4px] p-8 text-center text-sm text-navy-500">
            Não existem sinistros para apresentar.
          </div>
        ) : (
          <div className="bg-white border border-navy-200 rounded-[4px] overflow-x-auto">
            <table className="w-full min-w-[980px]">
              <thead className="bg-navy-50 border-b border-navy-200">
                <tr>
                  <Th>Cliente / Empresa</Th>
                  <Th>Apólice</Th>
                  <Th>Tipo</Th>
                  <Th>Data</Th>
                  <Th>Estado</Th>
                  <Th>Valor estimado</Th>
                  <Th>Responsável</Th>
                  <Th>Detalhe</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {rows.map((row) => {
                  const currentStatus = row.claim.status
                  const draft = statusDrafts[row.claim.id]
                  const selectedStatus = (draft || currentStatus) as ClaimStatus
                  const policyLabel = row.policy
                    ? `${row.policy.policyNumber} · ${row.policy.insurer}`
                    : 'Sem apólice associada'

                  return (
                    <tr key={row.claim.id} className="hover:bg-navy-50/50">
                      <Td>
                        <p className="font-medium text-navy-700">{row.clientName}</p>
                        <p className="text-xs text-navy-500">{row.companyName}</p>
                      </Td>
                      <Td>{policyLabel}</Td>
                      <Td>{row.claim.title}</Td>
                      <Td>{formatDate(row.claim.incidentDate)}</Td>
                      <Td>
                        <select
                          value={selectedStatus}
                          disabled={updatingClaimId === row.claim.id}
                          onChange={(event) => {
                            const nextStatus = event.target.value as ClaimStatus
                            setStatusDrafts((prev) => ({ ...prev, [row.claim.id]: nextStatus }))
                            void handleQuickStatusUpdate(row.claim.id, nextStatus)
                          }}
                          className="px-2.5 py-1.5 border border-navy-200 rounded text-xs bg-white"
                        >
                          {Object.entries(CLAIM_STATUS_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                          ))}
                        </select>
                      </Td>
                      <Td>{formatCurrency(row.claim.estimatedValue || 0)}</Td>
                      <Td>{row.assigneeLabel || 'Sem responsável'}</Td>
                      <Td>
                        <Link
                          to="/admin-claims/$claimId"
                          params={{ claimId: row.claim.id }}
                          className="text-xs font-semibold text-navy-700 underline"
                        >
                          Abrir
                        </Link>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-navy-200 rounded-[4px] p-4">
      <p className="text-xs text-navy-500">{label}</p>
      <p className="text-lg font-semibold text-navy-700 mt-0.5">{value}</p>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 uppercase tracking-wide">{children}</th>
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 text-sm text-navy-600 align-top">{children}</td>
}
