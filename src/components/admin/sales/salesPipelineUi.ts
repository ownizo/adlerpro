import type { Company, IndividualClient, SalesOpportunity, SalesOpportunityStage } from '@/lib/types'

// -----------------------------------------------------------------------------
// salesPipelineUi.ts — pequenos helpers de apresentação partilhados pelos
// componentes do workspace de Vendas (src/components/admin/sales/*). A lógica
// de negócio pura (datas, stages, KPIs) fica em
// src/lib/sales-opportunity-rules.ts, testada; isto é só o que junta essa
// lógica aos dados já carregados no Admin (individualClients/companies).
// -----------------------------------------------------------------------------

// Paleta admin-only, ver "Admin visual direction" no relatório desta fase —
// deliberadamente contida (sem vermelho vivo, sem gradientes, sem cores por
// stage "arco-íris"): neutros para os stages intermédios, e só 3 acentos
// semânticos (âmbar = atenção, verde = ganho, vermelho suave = perdido).
export const STAGE_PALETTE: Record<SalesOpportunityStage, { border: string; badgeBg: string; badgeText: string; dot: string }> = {
  new: { border: 'border-slate-200', badgeBg: 'bg-slate-100', badgeText: 'text-slate-700', dot: 'bg-slate-400' },
  contacted: { border: 'border-sky-200', badgeBg: 'bg-sky-50', badgeText: 'text-sky-700', dot: 'bg-sky-400' },
  needs_analysis: { border: 'border-violet-200', badgeBg: 'bg-violet-50', badgeText: 'text-violet-700', dot: 'bg-violet-400' },
  quoted: { border: 'border-amber-200', badgeBg: 'bg-amber-50', badgeText: 'text-amber-700', dot: 'bg-amber-400' },
  negotiation: { border: 'border-orange-200', badgeBg: 'bg-orange-50', badgeText: 'text-orange-700', dot: 'bg-orange-400' },
  won: { border: 'border-emerald-200', badgeBg: 'bg-emerald-50', badgeText: 'text-emerald-700', dot: 'bg-emerald-500' },
  lost: { border: 'border-rose-200', badgeBg: 'bg-rose-50', badgeText: 'text-rose-700', dot: 'bg-rose-400' },
}

export const FOLLOW_UP_URGENCY_STYLE: Record<string, string> = {
  overdue: 'bg-rose-50 text-rose-700 border-rose-200',
  today: 'bg-amber-50 text-amber-800 border-amber-200',
  tomorrow: 'bg-sky-50 text-sky-700 border-sky-200',
  upcoming: 'bg-slate-50 text-slate-600 border-slate-200',
  none: 'text-slate-400',
}

export interface OwnerLookup {
  name: string
  email?: string
  kind: 'individual' | 'company'
}

export function buildOwnerLookup(
  opportunity: SalesOpportunity,
  individualClients: IndividualClient[],
  companies: Company[],
): OwnerLookup {
  if (opportunity.individualClientId) {
    const client = individualClients.find((c) => c.id === opportunity.individualClientId)
    return { name: client?.fullName ?? 'Cliente removido', email: client?.email, kind: 'individual' }
  }
  const company = companies.find((c) => c.id === opportunity.companyId)
  return { name: company?.name ?? 'Empresa removida', email: company?.contactEmail, kind: 'company' }
}
