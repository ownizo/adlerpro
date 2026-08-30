/**
 * policy-reconciliation.ts — motor DETERMINÍSTICO de reconciliação de
 * apólices para o CRM3.
 *
 * PURO: sem chamadas Supabase, sem rede, sem escrita de dados. Recebe uma
 * apólice externa (de uma seguradora) e uma lista de apólices já existentes
 * no CRM, e devolve uma decisão estruturada — nunca cria, atualiza nem
 * apaga nada.
 *
 * ORDEM ESTRITA das regras:
 *   1. external identity exata (provider + externalPolicyId)
 *   2. provider + número de apólice normalizado — só quando o candidato
 *      tem um `provider` conhecido e igual ao da apólice externa (nunca
 *      cruzar seguradoras diferentes, mesmo com o mesmo número — ver regra
 *      3) e só quando a apólice externa TEM provider (ver regra 4)
 *   3. nenhum candidato => NEW
 */

import { normalizePolicyNumber } from './identity-normalization.ts'

export interface PolicyExternalIdentityRef {
  provider: string
  externalPolicyId?: string | null
}

export interface PolicyCandidate {
  id: string
  /** Seguradora/insurer conhecido para esta apólice interna, se houver.
   * Necessário para a regra 3 ("same policy number but different provider
   * must NOT match") — uma apólice cujo provider não é conhecido nunca é
   * elegível para correspondência por número, mesmo que o número normalizado
   * seja igual (não há como provar que é da mesma seguradora). */
  provider?: string | null
  policyNumber?: string | null
  externalIdentities?: PolicyExternalIdentityRef[]
}

export interface ExternalPolicyInput {
  provider: string
  externalPolicyId?: string | null
  policyNumber?: string | null
}

export type PolicyMatchStatus = 'exact' | 'ambiguous' | 'new'

export interface PolicyMatchResult {
  status: PolicyMatchStatus
  candidateId: string | null
  candidateIds: string[]
  reason: string
  signals: string[]
}

function trimmedNonEmpty(value?: string | null): string {
  return (value ?? '').trim()
}

function providersMatch(a?: string | null, b?: string | null): boolean {
  const ta = trimmedNonEmpty(a)
  const tb = trimmedNonEmpty(b)
  return ta !== '' && ta === tb
}

function sortedUnique(ids: string[]): string[] {
  return Array.from(new Set(ids)).sort()
}

// ── regra 1: external identity exata ─────────────────────────────────────

function matchByExternalIdentity(external: ExternalPolicyInput, candidates: PolicyCandidate[]): PolicyCandidate[] {
  const externalPolicyId = trimmedNonEmpty(external.externalPolicyId)
  if (externalPolicyId === '') return []
  return candidates.filter((candidate) =>
    (candidate.externalIdentities ?? []).some(
      (ref) => providersMatch(ref.provider, external.provider) && trimmedNonEmpty(ref.externalPolicyId) === externalPolicyId,
    ),
  )
}

// ── regra 2: provider + número de apólice normalizado ───────────────────

function matchByPolicyNumber(external: ExternalPolicyInput, candidates: PolicyCandidate[]): PolicyCandidate[] {
  // Regra 4: sem provider na apólice externa, nunca corresponder por número.
  if (trimmedNonEmpty(external.provider) === '') return []

  const externalNormalized = normalizePolicyNumber(external.policyNumber, external.provider)
  if (externalNormalized === null) return []

  return candidates.filter((candidate) => {
    // Regra 3: mesmo número, seguradora diferente (ou desconhecida) nunca
    // corresponde — só candidatos com provider explicitamente igual ao da
    // apólice externa são elegíveis.
    if (!providersMatch(candidate.provider, external.provider)) return false
    const candidateNormalized = normalizePolicyNumber(candidate.policyNumber, candidate.provider)
    return candidateNormalized !== null && candidateNormalized === externalNormalized
  })
}

/**
 * Reconcilia uma apólice externa (de uma seguradora) com as apólices já
 * existentes no CRM. Função pura e determinística — ver cabeçalho do
 * ficheiro para a ordem estrita das regras. Nunca cria, atualiza ou apaga
 * nada.
 */
export function reconcilePolicy(external: ExternalPolicyInput, candidates: PolicyCandidate[]): PolicyMatchResult {
  // Regra 1 — external identity exata.
  const externalIdentityMatches = matchByExternalIdentity(external, candidates)
  if (externalIdentityMatches.length === 1) {
    const match = externalIdentityMatches[0]!
    return {
      status: 'exact',
      candidateId: match.id,
      candidateIds: [match.id],
      reason: `Existing external identity for provider "${external.provider}" and externalPolicyId "${external.externalPolicyId}" points to exactly one CRM policy.`,
      signals: ['external_identity'],
    }
  }
  if (externalIdentityMatches.length > 1) {
    const ids = sortedUnique(externalIdentityMatches.map((c) => c.id))
    return {
      status: 'ambiguous',
      candidateId: null,
      candidateIds: ids,
      reason: `More than one CRM policy claims the same external identity (provider "${external.provider}", externalPolicyId "${external.externalPolicyId}").`,
      signals: ['external_identity'],
    }
  }

  // Regra 2 — provider + número de apólice normalizado.
  const policyNumberMatches = matchByPolicyNumber(external, candidates)
  if (policyNumberMatches.length === 1) {
    const match = policyNumberMatches[0]!
    return {
      status: 'exact',
      candidateId: match.id,
      candidateIds: [match.id],
      reason: `Exactly one CRM policy from the same provider ("${external.provider}") shares the same normalized policy number.`,
      signals: ['policy_number'],
    }
  }
  if (policyNumberMatches.length > 1) {
    const ids = sortedUnique(policyNumberMatches.map((c) => c.id))
    return {
      status: 'ambiguous',
      candidateId: null,
      candidateIds: ids,
      reason: `More than one CRM policy from provider "${external.provider}" shares the same normalized policy number.`,
      signals: ['policy_number'],
    }
  }

  // Regra 5 — nenhum candidato.
  return {
    status: 'new',
    candidateId: null,
    candidateIds: [],
    reason: 'No existing external identity or same-provider policy number match found.',
    signals: [],
  }
}
