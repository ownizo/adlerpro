/**
 * carrier-import-matching.ts — liga cada ParsedImportRow (linha já
 * mapeada/sanitizada de um portfolio) aos motores de reconciliação já
 * existentes do CRM3 Block 1 (client-reconciliation.ts /
 * policy-reconciliation.ts). NÃO reimplementa matching — só traduz o
 * "mundo do import" (linhas de Excel) para os tipos que esses motores já
 * esperam, e traduz o resultado de volta para os campos de
 * carrier_import_records.
 *
 * PURO: recebe todos os candidatos já carregados (o caller — data.ts — faz
 * o fetch uma única vez por corrida de import, não uma vez por linha) e
 * devolve resultados; nenhuma chamada Supabase aqui.
 *
 * Pessoa vs empresa: NUNCA decidido aqui. reconcileClient já aceita
 * candidatos individual E company misturados e devolve o candidateType de
 * quem bateu — quando NINGUÉM bate (status 'new'), esta linha fica
 * simplesmente sem matchedIndividualClientId nem matchedCompanyId (os
 * dois ficam null, o que a CHECK de carrier_import_records já permite) e
 * cabe ao Admin decidir manualmente mais tarde (ver requisito "A
 * Portuguese 9-digit tax number alone does NOT prove person vs company").
 */

import { reconcileClient, type ClientCandidate, type ExternalIdentityRef } from './client-reconciliation.ts'
import { reconcilePolicy, type PolicyCandidate, type PolicyExternalIdentityRef } from './policy-reconciliation.ts'
import { isValidPortugueseTaxId } from './identity-normalization.ts'
import type { ParsedImportRow } from './carrier-import-parsing.ts'
import type { CarrierProviderId } from './carrier-providers.ts'
import { CARRIER_PROVIDER_LABELS } from './carrier-providers.ts'
import type { CarrierMatchStatus } from './types.ts'

export interface CandidateIndividualClient {
  id: string
  fullName: string
  nif?: string
  email?: string
  phone?: string
  address?: string
}

export interface CandidateCompany {
  id: string
  name: string
  nif: string
  contactEmail?: string
  contactPhone?: string
  address?: string
}

export interface CandidatePolicy {
  id: string
  insurer: string
  policyNumber: string
  companyId?: string
  individualClientId?: string
  startDate?: string
  endDate?: string
  annualPremium?: number
}

export interface CandidateExternalClientIdentity {
  provider: string
  externalClientId: string
  individualClientId?: string
  companyId?: string
}

export interface CandidateExternalPolicyIdentity {
  provider: string
  externalPolicyId?: string
  policyId: string
}

export interface PortfolioMatchingContext {
  individualClients: CandidateIndividualClient[]
  companies: CandidateCompany[]
  policies: CandidatePolicy[]
  externalClientIdentities: CandidateExternalClientIdentity[]
  externalPolicyIdentities: CandidateExternalPolicyIdentity[]
}

export interface StagedRowMatch {
  row: ParsedImportRow
  customerMatchStatus: CarrierMatchStatus
  customerMatchReason: string
  matchedIndividualClientId?: string
  matchedCompanyId?: string
  policyMatchStatus: CarrierMatchStatus
  policyMatchReason: string
  matchedPolicyId?: string
}

/**
 * Heurística CONSERVADORA e não-destrutiva para saber se o texto livre
 * policies.insurer se refere à seguradora canónica desta corrida de
 * import — nunca escreve nem normaliza o valor guardado, só decide se
 * esta apólice é elegível para matching por número nesta corrida (ver
 * regra "never cross providers" em policy-reconciliation.ts). Substring
 * case-insensitive do label ("MGEN") ou do slug ("mgen") — não tenta ser
 * mais esperta do que isso: um falso negativo aqui só significa "fica
 * como New Policy em vez de Exact", nunca um falso match entre
 * seguradoras diferentes.
 */
export function insurerTextMatchesProvider(insurerText: string, provider: CarrierProviderId): boolean {
  const normalized = insurerText.trim().toLowerCase()
  if (normalized === '') return false
  return normalized.includes(provider) || normalized.includes(CARRIER_PROVIDER_LABELS[provider].toLowerCase())
}

function buildClientCandidates(context: PortfolioMatchingContext): ClientCandidate[] {
  const identitiesByIndividual = new Map<string, ExternalIdentityRef[]>()
  const identitiesByCompany = new Map<string, ExternalIdentityRef[]>()
  for (const identity of context.externalClientIdentities) {
    const ref: ExternalIdentityRef = { provider: identity.provider, externalClientId: identity.externalClientId }
    if (identity.individualClientId) {
      const list = identitiesByIndividual.get(identity.individualClientId) ?? []
      list.push(ref)
      identitiesByIndividual.set(identity.individualClientId, list)
    } else if (identity.companyId) {
      const list = identitiesByCompany.get(identity.companyId) ?? []
      list.push(ref)
      identitiesByCompany.set(identity.companyId, list)
    }
  }

  const individualCandidates: ClientCandidate[] = context.individualClients.map((c) => ({
    type: 'individual',
    id: c.id,
    name: c.fullName,
    email: c.email,
    phone: c.phone,
    address: c.address,
    taxId: c.nif,
    // individual_clients has no taxCountry field at all (same gap already
    // documented and worked around in duplicate-warning.ts) — a valid PT
    // NIF checksum is the only signal available, so it's treated as PT
    // for matching, exactly like that existing precedent. An invalid or
    // absent NIF stays with no jurisdiction, so reconcileClient's hardened
    // rule 2 correctly never treats it as an exact match.
    taxCountry: c.nif && isValidPortugueseTaxId(c.nif) ? 'PT' : undefined,
    externalIdentities: identitiesByIndividual.get(c.id),
  }))
  const companyCandidates: ClientCandidate[] = context.companies.map((c) => ({
    type: 'company',
    id: c.id,
    name: c.name,
    email: c.contactEmail,
    phone: c.contactPhone,
    address: c.address,
    taxId: c.nif,
    taxCountry: c.nif && isValidPortugueseTaxId(c.nif) ? 'PT' : undefined,
    externalIdentities: identitiesByCompany.get(c.id),
  }))
  return [...individualCandidates, ...companyCandidates]
}

function buildPolicyCandidates(context: PortfolioMatchingContext, provider: CarrierProviderId): PolicyCandidate[] {
  const identitiesByPolicy = new Map<string, PolicyExternalIdentityRef[]>()
  for (const identity of context.externalPolicyIdentities) {
    const list = identitiesByPolicy.get(identity.policyId) ?? []
    list.push({ provider: identity.provider, externalPolicyId: identity.externalPolicyId })
    identitiesByPolicy.set(identity.policyId, list)
  }

  return context.policies.map((p) => ({
    id: p.id,
    provider: insurerTextMatchesProvider(p.insurer, provider) ? provider : undefined,
    policyNumber: p.policyNumber,
    externalIdentities: identitiesByPolicy.get(p.id),
  }))
}

/**
 * Corre reconcileClient/reconcilePolicy para todas as linhas de uma
 * corrida de import, reutilizando os mesmos candidatos pré-carregados
 * (ver PortfolioMatchingContext) — nunca refaz o fetch por linha.
 */
export function matchPortfolioRows(
  provider: CarrierProviderId,
  rows: ParsedImportRow[],
  context: PortfolioMatchingContext,
): StagedRowMatch[] {
  const clientCandidates = buildClientCandidates(context)
  const policyCandidates = buildPolicyCandidates(context, provider)

  return rows.map((row) => {
    const clientResult = reconcileClient(
      {
        provider,
        externalClientId: row.externalClientId,
        name: row.customerName,
        email: row.email,
        phone: row.phone,
        address: row.address,
        taxCountry: row.taxIdRaw ? 'PT' : undefined,
        taxId: row.taxIdRaw,
      },
      clientCandidates,
    )

    const matchedIndividualClientId = clientResult.candidateType === 'individual' ? clientResult.candidateId ?? undefined : undefined
    const matchedCompanyId = clientResult.candidateType === 'company' ? clientResult.candidateId ?? undefined : undefined

    const policyResult = reconcilePolicy(
      { provider, externalPolicyId: undefined, policyNumber: row.externalPolicyNumber },
      policyCandidates,
    )

    let policyMatchStatus: CarrierMatchStatus = policyResult.status
    let policyMatchReason = policyResult.reason
    let matchedPolicyId = policyResult.candidateId ?? undefined

    // Real-world case D: the customer already matched, but no existing
    // policy shares the normalized number (e.g. CRM still holds a
    // proposal number, the carrier feed already has the definitive one).
    // Never silently treated as brand new — downgraded to a review
    // signal instead, still never auto-linked.
    if (policyResult.status === 'new' && (matchedIndividualClientId || matchedCompanyId)) {
      const ownerPolicies = context.policies.filter(
        (p) =>
          (matchedIndividualClientId && p.individualClientId === matchedIndividualClientId) ||
          (matchedCompanyId && p.companyId === matchedCompanyId),
      )
      const sameProviderOwnerPolicies = ownerPolicies.filter((p) => insurerTextMatchesProvider(p.insurer, provider))
      if (sameProviderOwnerPolicies.length > 0) {
        policyMatchStatus = 'probable'
        policyMatchReason = `Customer already has ${sameProviderOwnerPolicies.length} existing ${CARRIER_PROVIDER_LABELS[provider]} polic${sameProviderOwnerPolicies.length === 1 ? 'y' : 'ies'} under a different number — review before treating as a new policy (possible proposal-vs-definitive-number case).`
      }
    }

    // Real-world case F: the policy number matched exactly, but the
    // imported dates/premium disagree with what the CRM already has.
    // Never silently overwritten during preview (preview never writes to
    // policies at all) — downgraded from exact to a review signal instead,
    // so the difference gets a human look before anything is confirmed.
    if (policyMatchStatus === 'exact' && matchedPolicyId) {
      const matchedPolicy = context.policies.find((p) => p.id === matchedPolicyId)
      if (matchedPolicy) {
        const conflicts: string[] = []
        if (row.startDate && matchedPolicy.startDate && row.startDate !== matchedPolicy.startDate) conflicts.push('start date')
        if (row.endDate && matchedPolicy.endDate && row.endDate !== matchedPolicy.endDate) conflicts.push('end date')
        if (
          row.premium !== undefined &&
          matchedPolicy.annualPremium !== undefined &&
          Math.abs(row.premium - matchedPolicy.annualPremium) > 0.01
        ) {
          conflicts.push('premium')
        }
        if (conflicts.length > 0) {
          policyMatchStatus = 'probable'
          policyMatchReason = `Existing policy matched by number, but ${conflicts.join(', ')} differ from the imported data — review before confirming (never silently overwritten).`
        }
      }
    }

    return {
      row,
      customerMatchStatus: clientResult.status,
      customerMatchReason: clientResult.reason,
      matchedIndividualClientId,
      matchedCompanyId,
      policyMatchStatus,
      policyMatchReason,
      matchedPolicyId,
    }
  })
}

/**
 * Classifica UMA linha já casada num dos 4 baldes do KPI strip
 * (Exact/Review/New/Error) — usado só para agregar
 * carrier_sync_runs.records_exact_match/records_review/records_new/
 * records_error num único conjunto de contadores por corrida (o esquema
 * só tem um contador de cada, não um par separado para cliente/apólice).
 * A tabela de registos em si continua a mostrar customerMatchStatus e
 * policyMatchStatus em separado — esta agregação é só para o resumo.
 */
export function classifyStagedRowForCounts(match: StagedRowMatch): 'exact' | 'review' | 'new' | 'error' {
  if (match.customerMatchStatus === 'error' || match.policyMatchStatus === 'error') return 'error'
  const needsReview = (status: CarrierMatchStatus) => status === 'ambiguous' || status === 'probable'
  if (needsReview(match.customerMatchStatus) || needsReview(match.policyMatchStatus)) return 'review'
  if (match.customerMatchStatus === 'exact' && match.policyMatchStatus === 'exact') return 'exact'
  return 'new'
}
