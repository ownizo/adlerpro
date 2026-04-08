import { useState, useMemo } from 'react'
import type { Policy, Company, IndividualClient } from '@/lib/types'
import { POLICY_TYPE_LABELS } from '@/lib/types'
import { formatCurrency } from '@/lib/utils'

interface AdminDashboardProps {
  policies: Policy[]
  companies: Company[]
  individualClients: IndividualClient[]
}

const PAYMENT_FREQUENCY_DIVISOR: Record<string, number> = {
  mensal: 12,
  trimestral: 4,
  semestral: 2,
  anual: 1,
  annual: 1,
  monthly: 12,
  quarterly: 4,
  'semi-annual': 2,
}

function getFrequencyDivisor(freq?: string): number {
  if (!freq) return 1
  const key = freq.trim().toLowerCase()
  return PAYMENT_FREQUENCY_DIVISOR[key] ?? 1
}

function getFrequencyLabel(freq?: string): string {
  if (!freq) return 'Anual'
  const key = freq.trim().toLowerCase()
  const labels: Record<string, string> = {
    mensal: 'Mensal',
    trimestral: 'Trimestral',
    semestral: 'Semestral',
    anual: 'Anual',
    annual: 'Anual',
    monthly: 'Mensal',
    quarterly: 'Trimestral',
    'semi-annual': 'Semestral',
  }
  return labels[key] ?? freq
}

/** Monthly commission from a policy considering its payment frequency */
function monthlyCommission(policy: Policy): number {
  const commission = policy.commissionValue ?? 0
  const divisor = getFrequencyDivisor(policy.paymentFrequency)
  // commission is per payment period; to get monthly: commission / (12 / divisor) ... wait
  // Actually: annualPremium is the yearly total. commissionValue is the total commission for the year (or per period).
  // Per the user request: "colocar o valor da comissao a dividir pelo fraccionamento"
  // So monthly = commissionValue / divisor (the fractionation splits it)
  // But actually commission is likely annual. Let's compute:
  // If paymentFrequency is "mensal" (12x/year), the commission per period = commission / 12
  // commission / divisor gives the per-period amount
  return commission / divisor
}

export function AdminDashboard({ policies, companies, individualClients }: AdminDashboardProps) {
  const activePolicies = useMemo(() => policies.filter(p => p.status === 'active' || p.status === 'expiring'), [policies])

  // Available years from policies
  const years = useMemo(() => {
    const s = new Set<number>()
    policies.forEach(p => {
      if (p.startDate) s.add(new Date(p.startDate).getFullYear())
      if (p.endDate) s.add(new Date(p.endDate).getFullYear())
    })
    const current = new Date().getFullYear()
    s.add(current)
    return Array.from(s).sort((a, b) => b - a)
  }, [policies])

  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())

  // Policies active in the selected year
  const policiesInYear = useMemo(() => {
    return activePolicies.filter(p => {
      const start = new Date(p.startDate).getFullYear()
      const end = new Date(p.endDate).getFullYear()
      return start <= selectedYear && end >= selectedYear
    })
  }, [activePolicies, selectedYear])

  // 1. Total premiums for selected year
  const totalPremiums = useMemo(() => policiesInYear.reduce((s, p) => s + (p.annualPremium || 0), 0), [policiesInYear])

  // 2. Total commissions for selected year
  const totalCommissions = useMemo(() => policiesInYear.reduce((s, p) => s + (p.commissionValue || 0), 0), [policiesInYear])

  // 3. Monthly commissions breakdown
  const monthlyCommissions = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => ({ month: i, total: 0 }))
    policiesInYear.forEach(p => {
      const divisor = getFrequencyDivisor(p.paymentFrequency)
      const commissionPerPeriod = (p.commissionValue || 0) / divisor
      const freqLabel = (p.paymentFrequency || 'anual').trim().toLowerCase()

      // Determine which months get a commission payment
      if (freqLabel === 'mensal' || freqLabel === 'monthly') {
        months.forEach(m => { m.total += commissionPerPeriod })
      } else if (freqLabel === 'trimestral' || freqLabel === 'quarterly') {
        // Quarterly: months 0,3,6,9
        ;[0, 3, 6, 9].forEach(mi => { months[mi].total += commissionPerPeriod })
      } else if (freqLabel === 'semestral' || freqLabel === 'semi-annual') {
        ;[0, 6].forEach(mi => { months[mi].total += commissionPerPeriod })
      } else {
        // Annual - January
        months[0].total += commissionPerPeriod
      }
    })
    return months
  }, [policiesInYear])

  const maxMonthlyCommission = Math.max(...monthlyCommissions.map(m => m.total), 1)

  // 4. Client type breakdown
  const clientTypeStats = useMemo(() => {
    const companyPolicies = policiesInYear.filter(p => p.companyId && !p.individualClientId)
    const individualPolicies = policiesInYear.filter(p => p.individualClientId)
    return {
      company: {
        count: companyPolicies.length,
        premiums: companyPolicies.reduce((s, p) => s + (p.annualPremium || 0), 0),
        commissions: companyPolicies.reduce((s, p) => s + (p.commissionValue || 0), 0),
      },
      individual: {
        count: individualPolicies.length,
        premiums: individualPolicies.reduce((s, p) => s + (p.annualPremium || 0), 0),
        commissions: individualPolicies.reduce((s, p) => s + (p.commissionValue || 0), 0),
      },
    }
  }, [policiesInYear])

  // 5. Premiums by insurer
  const insurerStats = useMemo(() => {
    const map = new Map<string, { premiums: number; count: number }>()
    policiesInYear.forEach(p => {
      const key = p.insurer || 'Desconhecida'
      const cur = map.get(key) || { premiums: 0, count: 0 }
      cur.premiums += p.annualPremium || 0
      cur.count += 1
      map.set(key, cur)
    })
    return Array.from(map.entries())
      .map(([insurer, stats]) => ({ insurer, ...stats }))
      .sort((a, b) => b.premiums - a.premiums)
  }, [policiesInYear])

  // 6. By policy type
  const typeStats = useMemo(() => {
    const map = new Map<string, { premiums: number; commissions: number; count: number }>()
    policiesInYear.forEach(p => {
      const key = p.type
      const cur = map.get(key) || { premiums: 0, commissions: 0, count: 0 }
      cur.premiums += p.annualPremium || 0
      cur.commissions += p.commissionValue || 0
      cur.count += 1
      map.set(key, cur)
    })
    return Array.from(map.entries())
      .map(([type, stats]) => ({ type, label: POLICY_TYPE_LABELS[type as keyof typeof POLICY_TYPE_LABELS] || type, ...stats }))
      .sort((a, b) => b.premiums - a.premiums)
  }, [policiesInYear])

  const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

  const cardCls = 'bg-white rounded-[4px] border border-navy-200 p-6'
  const headingCls = 'text-sm font-semibold text-navy-500 uppercase tracking-wide mb-1'
  const bigNumCls = 'text-2xl font-bold text-navy-700'

  return (
    <div>
      {/* Year filter */}
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-lg font-semibold text-navy-700">Dashboard Analítico</h2>
        <select
          value={selectedYear}
          onChange={e => setSelectedYear(Number(e.target.value))}
          className="px-3 py-1.5 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400"
        >
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className={cardCls}>
          <p className={headingCls}>Total Prémios ({selectedYear})</p>
          <p className={bigNumCls}>{formatCurrency(totalPremiums)}</p>
          <p className="text-xs text-navy-400 mt-1">{policiesInYear.length} apólices ativas</p>
        </div>
        <div className={cardCls}>
          <p className={headingCls}>Total Comissões ({selectedYear})</p>
          <p className={bigNumCls}>{formatCurrency(totalCommissions)}</p>
        </div>
        <div className={cardCls}>
          <p className={headingCls}>Clientes Empresa</p>
          <p className={bigNumCls}>{companies.length}</p>
          <p className="text-xs text-navy-400 mt-1">{clientTypeStats.company.count} apólices</p>
        </div>
        <div className={cardCls}>
          <p className={headingCls}>Clientes Individuais</p>
          <p className={bigNumCls}>{individualClients.length}</p>
          <p className="text-xs text-navy-400 mt-1">{clientTypeStats.individual.count} apólices</p>
        </div>
      </div>

      {/* Monthly Commissions Chart */}
      <div className={cardCls + ' mb-8'}>
        <h3 className="text-sm font-semibold text-navy-500 uppercase tracking-wide mb-4">
          Comissões Mensais ({selectedYear}) — por fraccionamento
        </h3>
        <div className="flex items-end gap-2 h-48">
          {monthlyCommissions.map((m, i) => {
            const pct = maxMonthlyCommission > 0 ? (m.total / maxMonthlyCommission) * 100 : 0
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] text-navy-500 font-medium">{formatCurrency(m.total)}</span>
                <div className="w-full flex items-end" style={{ height: '140px' }}>
                  <div
                    className="w-full bg-gold-400 rounded-t-[2px] transition-all duration-300"
                    style={{ height: `${Math.max(pct, 2)}%` }}
                  />
                </div>
                <span className="text-xs text-navy-500 font-medium">{MONTH_NAMES[i]}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Client Type Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className={cardCls}>
          <h3 className="text-sm font-semibold text-navy-500 uppercase tracking-wide mb-4">Por Tipo de Cliente</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-100">
                <th className="text-left py-2 text-navy-500 font-medium">Tipo</th>
                <th className="text-right py-2 text-navy-500 font-medium">Apólices</th>
                <th className="text-right py-2 text-navy-500 font-medium">Prémios</th>
                <th className="text-right py-2 text-navy-500 font-medium">Comissões</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-navy-50">
                <td className="py-2 text-navy-700 font-medium">Empresa</td>
                <td className="py-2 text-right text-navy-600">{clientTypeStats.company.count}</td>
                <td className="py-2 text-right text-navy-600">{formatCurrency(clientTypeStats.company.premiums)}</td>
                <td className="py-2 text-right text-navy-600">{formatCurrency(clientTypeStats.company.commissions)}</td>
              </tr>
              <tr className="border-b border-navy-50">
                <td className="py-2 text-navy-700 font-medium">Individual</td>
                <td className="py-2 text-right text-navy-600">{clientTypeStats.individual.count}</td>
                <td className="py-2 text-right text-navy-600">{formatCurrency(clientTypeStats.individual.premiums)}</td>
                <td className="py-2 text-right text-navy-600">{formatCurrency(clientTypeStats.individual.commissions)}</td>
              </tr>
              <tr className="font-semibold">
                <td className="py-2 text-navy-700">Total</td>
                <td className="py-2 text-right text-navy-700">{clientTypeStats.company.count + clientTypeStats.individual.count}</td>
                <td className="py-2 text-right text-navy-700">{formatCurrency(clientTypeStats.company.premiums + clientTypeStats.individual.premiums)}</td>
                <td className="py-2 text-right text-navy-700">{formatCurrency(clientTypeStats.company.commissions + clientTypeStats.individual.commissions)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* By Insurer */}
        <div className={cardCls}>
          <h3 className="text-sm font-semibold text-navy-500 uppercase tracking-wide mb-4">Prémios por Seguradora</h3>
          {insurerStats.length === 0 ? (
            <p className="text-navy-400 text-sm">Sem dados</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-100">
                  <th className="text-left py-2 text-navy-500 font-medium">Seguradora</th>
                  <th className="text-right py-2 text-navy-500 font-medium">Apólices</th>
                  <th className="text-right py-2 text-navy-500 font-medium">Prémios</th>
                </tr>
              </thead>
              <tbody>
                {insurerStats.map(s => (
                  <tr key={s.insurer} className="border-b border-navy-50">
                    <td className="py-2 text-navy-700 font-medium">{s.insurer}</td>
                    <td className="py-2 text-right text-navy-600">{s.count}</td>
                    <td className="py-2 text-right text-navy-600">{formatCurrency(s.premiums)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* By Policy Type */}
      <div className={cardCls}>
        <h3 className="text-sm font-semibold text-navy-500 uppercase tracking-wide mb-4">Por Tipo de Seguro</h3>
        {typeStats.length === 0 ? (
          <p className="text-navy-400 text-sm">Sem dados</p>
        ) : (
          <div>
            <table className="w-full text-sm mb-4">
              <thead>
                <tr className="border-b border-navy-100">
                  <th className="text-left py-2 text-navy-500 font-medium">Tipo</th>
                  <th className="text-right py-2 text-navy-500 font-medium">Apólices</th>
                  <th className="text-right py-2 text-navy-500 font-medium">Prémios</th>
                  <th className="text-right py-2 text-navy-500 font-medium">Comissões</th>
                </tr>
              </thead>
              <tbody>
                {typeStats.map(s => (
                  <tr key={s.type} className="border-b border-navy-50">
                    <td className="py-2 text-navy-700 font-medium">{s.label}</td>
                    <td className="py-2 text-right text-navy-600">{s.count}</td>
                    <td className="py-2 text-right text-navy-600">{formatCurrency(s.premiums)}</td>
                    <td className="py-2 text-right text-navy-600">{formatCurrency(s.commissions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Visual bar breakdown */}
            <div className="space-y-2">
              {typeStats.map(s => {
                const maxPrem = Math.max(...typeStats.map(t => t.premiums), 1)
                const pct = (s.premiums / maxPrem) * 100
                return (
                  <div key={s.type} className="flex items-center gap-3">
                    <span className="text-xs text-navy-600 w-40 truncate">{s.label}</span>
                    <div className="flex-1 bg-navy-50 rounded-full h-3">
                      <div
                        className="bg-gold-400 h-3 rounded-full transition-all duration-300"
                        style={{ width: `${Math.max(pct, 1)}%` }}
                      />
                    </div>
                    <span className="text-xs text-navy-500 w-24 text-right">{formatCurrency(s.premiums)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
