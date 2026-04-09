import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { AppLayout } from '@/components/AppLayout'
import { fetchClaims, fetchPolicies } from '@/lib/server-fns'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Claim, ClaimStatus, Policy } from '@/lib/types'

export const Route = createFileRoute('/claims')({
  component: ClaimsPage,
})

type StateFilter = 'all' | 'open' | 'analysis' | 'resolved'
type UrgencyLevel = 'high' | 'medium' | 'low'

const OPEN_STATUSES: ClaimStatus[] = ['submitted']
const ANALYSIS_STATUSES: ClaimStatus[] = ['under_review', 'documentation', 'assessment']
const RESOLVED_STATUSES: ClaimStatus[] = ['approved', 'denied', 'paid']

const STATUS_GROUP_LABELS: Record<StateFilter, string> = {
  all: 'Todos',
  open: 'Abertos',
  analysis: 'Em análise',
  resolved: 'Resolvidos',
}

const STATE_LABELS: Record<ClaimStatus, string> = {
  submitted: 'A aguardar resposta',
  under_review: 'Em análise',
  documentation: 'A aguardar documentos',
  assessment: 'Em avaliação',
  approved: 'Resolvido com aprovação',
  denied: 'Encerrado sem aprovação',
  paid: 'Resolvido e pago',
}

const ROW_STATUS_LABELS: Record<StateFilter, string> = {
  all: 'Todos',
  open: 'Aberto',
  analysis: 'Em análise',
  resolved: 'Resolvido',
}

const STATE_BADGE_CLASS: Record<StateFilter, string> = {
  all: 'bg-slate-100 text-slate-700 border-slate-200',
  open: 'bg-amber-50 text-amber-700 border-amber-200',
  analysis: 'bg-blue-50 text-blue-700 border-blue-200',
  resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

const URGENCY_LABELS: Record<UrgencyLevel, string> = {
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
}

const URGENCY_CLASS: Record<UrgencyLevel, string> = {
  high: 'bg-red-50 text-red-700 border-red-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

function ClaimsPage() {
  const [claims, setClaims] = useState<Claim[]>([])
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')

  useEffect(() => {
    async function load() {
      try {
        const [claimsData, policiesData] = await Promise.all([fetchClaims(), fetchPolicies()])
        setClaims(claimsData)
        setPolicies(policiesData)
      } finally {
        setLoading(false)
      }
    }

    load().catch(() => setLoading(false))
  }, [])

  const claimsWithMeta = useMemo(() => {
    return claims
      .map((claim) => {
        const policy = policies.find((item) => item.id === claim.policyId)
        const state = getClaimState(claim.status)
        const lastUpdated = getLastUpdated(claim)
        const urgency = getUrgency(claim, lastUpdated, state)

        return {
          claim,
          policy,
          state,
          lastUpdated,
          urgency,
        }
      })
      .sort((a, b) => {
        const stateDiff = stateSortPriority(a.state) - stateSortPriority(b.state)
        if (stateDiff !== 0) return stateDiff

        const urgencyDiff = urgencySortPriority(a.urgency) - urgencySortPriority(b.urgency)
        if (urgencyDiff !== 0) return urgencyDiff

        return b.lastUpdated.getTime() - a.lastUpdated.getTime()
      })
  }, [claims, policies])

  const totals = useMemo(() => {
    const open = claimsWithMeta.filter((item) => item.state === 'open').length
    const analysis = claimsWithMeta.filter((item) => item.state === 'analysis').length
    const resolved = claimsWithMeta.filter((item) => item.state === 'resolved').length

    return {
      total: claimsWithMeta.length,
      open,
      analysis,
      resolved,
    }
  }, [claimsWithMeta])

  const filtered = useMemo(() => {
    if (stateFilter === 'all') return claimsWithMeta
    return claimsWithMeta.filter((item) => item.state === stateFilter)
  }, [claimsWithMeta, stateFilter])

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gold-400 border-t-transparent" />
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-navy-700">Sinistros</h1>
            <p className="mt-1 text-sm text-navy-500">Acompanhe o estado de cada sinistro e veja os próximos passos com clareza.</p>
          </div>
          <Link
            to="/policies"
            className="rounded-[2px] border border-navy-200 px-4 py-2 text-sm font-medium text-navy-600 transition-colors hover:bg-navy-50"
          >
            Ver apólices relacionadas
          </Link>
        </header>

        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Total" value={totals.total} tone="text-navy-700" />
          <StatCard label="Abertos" value={totals.open} tone="text-amber-700" />
          <StatCard label="Em análise" value={totals.analysis} tone="text-blue-700" />
          <StatCard label="Resolvidos" value={totals.resolved} tone="text-emerald-700" />
        </section>

        <section className="rounded-[4px] border border-navy-200 bg-white p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-navy-500">Estado</p>
          <div className="flex flex-wrap gap-2">
            {(['open', 'analysis', 'resolved'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setStateFilter((current) => (current === key ? 'all' : key))}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                  stateFilter === key
                    ? 'border-navy-700 bg-navy-700 text-white'
                    : 'border-navy-200 bg-white text-navy-600 hover:border-navy-300 hover:bg-navy-50'
                }`}
              >
                {STATUS_GROUP_LABELS[key]}
              </button>
            ))}
            {stateFilter !== 'all' && (
              <button
                type="button"
                onClick={() => setStateFilter('all')}
                className="rounded-full border border-navy-200 px-4 py-2 text-sm text-navy-500 hover:bg-navy-50"
              >
                Limpar filtro
              </button>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-[4px] border border-navy-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-navy-100">
              <thead className="bg-navy-50/60">
                <tr className="text-left text-xs uppercase tracking-wide text-navy-500">
                  <th className="px-4 py-3 font-semibold">Tipo</th>
                  <th className="px-4 py-3 font-semibold">Apólice</th>
                  <th className="px-4 py-3 font-semibold">Data</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3 font-semibold">Estado atual</th>
                  <th className="px-4 py-3 font-semibold">Valor estimado</th>
                  <th className="px-4 py-3 font-semibold">Última atualização</th>
                  <th className="px-4 py-3 font-semibold">Urgência</th>
                  <th className="px-4 py-3 font-semibold text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-sm text-navy-500">
                      Sem sinistros para o filtro selecionado.
                    </td>
                  </tr>
                ) : (
                  filtered.map(({ claim, policy, state, urgency, lastUpdated }) => (
                    <tr key={claim.id} className="align-top text-sm text-navy-600">
                      <td className="px-4 py-4">
                        <p className="font-semibold text-navy-700">{claim.title}</p>
                        <p className="mt-1 text-xs text-navy-400">Ref. {claim.id.slice(-8).toUpperCase()}</p>
                      </td>
                      <td className="px-4 py-4">
                        {policy ? (
                          <>
                            <p className="font-medium text-navy-700">{policy.policyNumber}</p>
                            <p className="text-xs text-navy-400">{policy.insurer}</p>
                          </>
                        ) : (
                          <span className="text-xs text-navy-400">Sem apólice associada</span>
                        )}
                      </td>
                      <td className="px-4 py-4">{formatDate(claim.incidentDate)}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${STATE_BADGE_CLASS[state]}`}>
                          {ROW_STATUS_LABELS[state]}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm text-navy-700">{STATE_LABELS[claim.status]}</td>
                      <td className="px-4 py-4 font-semibold text-navy-700">{formatCurrency(claim.estimatedValue || 0)}</td>
                      <td className="px-4 py-4">{formatDate(lastUpdated.toISOString())}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${URGENCY_CLASS[urgency]}`}>
                          {URGENCY_LABELS[urgency]}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col items-end gap-1 text-xs font-medium">
                          <a href={`/claims/${claim.id}`} className="text-navy-700 hover:text-navy-500">
                            Ver detalhe
                          </a>
                          <a href={`/claims/${claim.id}#documentos`} className="text-navy-700 hover:text-navy-500">
                            Adicionar documento
                          </a>
                          <a href="/contact" className="text-navy-700 hover:text-navy-500">
                            Contactar apoio
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppLayout>
  )
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-[4px] border border-navy-200 bg-white p-4">
      <p className="text-xs text-navy-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  )
}

function getClaimState(status: ClaimStatus): StateFilter {
  if (OPEN_STATUSES.includes(status)) return 'open'
  if (ANALYSIS_STATUSES.includes(status)) return 'analysis'
  if (RESOLVED_STATUSES.includes(status)) return 'resolved'
  return 'open'
}

function getLastUpdated(claim: Claim): Date {
  const latestStep = claim.steps
    ?.map((step) => Date.parse(step.date))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0]

  if (typeof latestStep === 'number') return new Date(latestStep)

  const claimDate = Date.parse(claim.claimDate)
  if (Number.isFinite(claimDate)) return new Date(claimDate)

  const createdAt = Date.parse(claim.createdAt)
  if (Number.isFinite(createdAt)) return new Date(createdAt)

  return new Date(0)
}

function getUrgency(claim: Claim, lastUpdated: Date, state: StateFilter): UrgencyLevel {
  if (state === 'resolved') return 'low'

  const now = Date.now()
  const daysWithoutUpdate = Math.floor((now - lastUpdated.getTime()) / (1000 * 60 * 60 * 24))

  if (daysWithoutUpdate >= 7 || claim.estimatedValue >= 20000 || claim.status === 'documentation') {
    return 'high'
  }

  if (daysWithoutUpdate >= 3 || claim.estimatedValue >= 5000) {
    return 'medium'
  }

  return 'low'
}

function stateSortPriority(state: StateFilter): number {
  if (state === 'open') return 0
  if (state === 'analysis') return 1
  if (state === 'resolved') return 2
  return 3
}

function urgencySortPriority(level: UrgencyLevel): number {
  if (level === 'high') return 0
  if (level === 'medium') return 1
  return 2
}
