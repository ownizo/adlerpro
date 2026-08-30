/**
 * client-reconciliation.ts — motor DETERMINÍSTICO de reconciliação de
 * clientes para o CRM3.
 *
 * PURO: sem chamadas Supabase, sem rede, sem escrita de dados. Recebe um
 * cliente externo (de uma seguradora) e uma lista de candidatos já
 * existentes no CRM, e devolve uma decisão estruturada — nunca cria,
 * atualiza nem apaga nada. NÃO faz merge automático nem fuzzy matching por
 * biblioteca externa (sem Levenshtein, sem IA) — ver requisito "NO fuzzy
 * package, NO AI, NO Levenshtein dependency".
 *
 * ORDEM ESTRITA das regras (parar na primeira que produzir uma decisão):
 *   1. external identity exata (provider + externalClientId)
 *   2. NIF normalizado + mesma jurisdição EXPLÍCITA em ambos os lados (ver
 *      matchByTaxId abaixo — endurecido para nunca tratar "jurisdição
 *      desconhecida" como uma correspondência, e para exigir NIF português
 *      validamente formado nos dois lados quando a jurisdição é PT)
 *   3-5. sinais de PROBABLE (email+nome, telefone+nome, nome/morada sozinhos)
 *      — juntos numa só "pool" (ver nota antes de buildProbablePool)
 *   6. nenhum sinal significativo => NEW
 *
 * Nunca resulta em EXACT a partir de fuzzy matching (regra 5), e nunca
 * escolhe um candidato "porque calhou vir primeiro no array" — todas as
 * comparações são feitas sobre o array inteiro, nunca com "primeiro que
 * bater".
 */

import {
  isValidPortugueseTaxId,
  normalizeEmail,
  normalizePhone,
  normalizeTaxCountry,
  normalizeTaxId,
} from './identity-normalization.ts'

export type ClientCandidateType = 'individual' | 'company'

export interface ExternalIdentityRef {
  provider: string
  externalClientId: string
}

export interface ClientCandidate {
  type: ClientCandidateType
  id: string
  name?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  taxCountry?: string | null
  taxId?: string | null
  externalIdentities?: ExternalIdentityRef[]
}

export interface ExternalClientInput {
  provider: string
  externalClientId?: string | null
  name?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  taxCountry?: string | null
  taxId?: string | null
}

export type ClientMatchStatus = 'exact' | 'probable' | 'ambiguous' | 'new'

export interface ClientMatchResult {
  status: ClientMatchStatus
  candidateType: ClientCandidateType | null
  candidateId: string | null
  candidateIds: string[]
  reason: string
  signals: string[]
}

// ── comparação de texto determinística (sem fuzzy matching) ─────────────

/** lowercase-insensível, trim, colapso de espaços, sem diacríticos — usada
 * tanto para nome como para morada. "Concordância forte" = string igual
 * depois desta normalização; nunca comparação parcial/por tokens. */
function normalizeTextForComparison(value?: string | null): string {
  if (!value) return ''
  const withoutDiacritics = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return withoutDiacritics.trim().toLowerCase().replace(/\s+/g, ' ')
}

function textsAgree(a?: string | null, b?: string | null): boolean {
  const na = normalizeTextForComparison(a)
  const nb = normalizeTextForComparison(b)
  return na !== '' && na === nb
}

function trimmedNonEmpty(value?: string | null): string {
  return (value ?? '').trim()
}

function providersMatch(a: string, b: string): boolean {
  const ta = trimmedNonEmpty(a)
  const tb = trimmedNonEmpty(b)
  return ta !== '' && ta === tb
}

function sortedUnique(ids: string[]): string[] {
  return Array.from(new Set(ids)).sort()
}

// ── regra 1: external identity exata ─────────────────────────────────────

function matchByExternalIdentity(external: ExternalClientInput, candidates: ClientCandidate[]): ClientCandidate[] {
  const externalId = trimmedNonEmpty(external.externalClientId)
  if (externalId === '') return []
  return candidates.filter((candidate) =>
    (candidate.externalIdentities ?? []).some(
      (ref) => providersMatch(ref.provider, external.provider) && trimmedNonEmpty(ref.externalClientId) === externalId,
    ),
  )
}

// ── regra 2: NIF normalizado + mesma jurisdição (endurecida) ────────────
//
// Uma correspondência EXACT por NIF só é permitida quando, simultaneamente:
//   A) a jurisdição é explicitamente conhecida DOS DOIS LADOS — duas
//      jurisdições "desconhecidas" já NÃO contam como iguais entre si (ao
//      contrário da primeira versão desta regra: sem saber o país de
//      nenhum dos dois lados, não há como confirmar que é a mesma
//      jurisdição, só porque nenhum dos dois a indicou);
//   B) as jurisdições normalizadas são iguais;
//   C) os NIFs normalizados são iguais;
//   D) para jurisdição PT especificamente: os NIFs ORIGINAIS (antes de
//      normalizar) têm de passar isValidPortugueseTaxId() nos dois lados —
//      dois valores PT textualmente iguais mas com dígito de controlo
//      inválido nunca produzem EXACT (podem, no máximo, ficar por resolver
//      manualmente numa fase futura; esta função não inventa aqui uma nova
//      regra fuzzy/"probable" para esse caso).
// Nunca infere Portugal só porque um valor tem 9 dígitos — a jurisdição
// vem sempre do campo taxCountry explícito, nunca do formato do NIF.
function matchByTaxId(external: ExternalClientInput, candidates: ClientCandidate[]): ClientCandidate[] {
  const externalJurisdiction = normalizeTaxCountry(external.taxCountry)
  if (externalJurisdiction === null) return [] // A) jurisdição desconhecida do lado externo

  const externalTaxId = normalizeTaxId(external.taxId, external.taxCountry)
  if (externalTaxId === null) return []

  return candidates.filter((candidate) => {
    const candidateJurisdiction = normalizeTaxCountry(candidate.taxCountry)
    if (candidateJurisdiction === null) return false // A) jurisdição desconhecida do lado do candidato
    if (candidateJurisdiction !== externalJurisdiction) return false // B)

    const candidateTaxId = normalizeTaxId(candidate.taxId, candidate.taxCountry)
    if (candidateTaxId === null || candidateTaxId !== externalTaxId) return false // C)

    if (externalJurisdiction === 'PT') {
      // D) ambos os NIFs têm de ser validamente formados (dígito de
      // controlo correto) — não basta serem textualmente iguais.
      return isValidPortugueseTaxId(external.taxId) && isValidPortugueseTaxId(candidate.taxId)
    }

    return true
  })
}

// ── regras 3-5: pool de sinais PROBABLE ──────────────────────────────────
//
// Estas três regras nunca produzem EXACT sozinhas, por isso são avaliadas
// em conjunto: juntamos o candidato de CADA sinal que bater, e só decidimos
// no fim, olhando para quantos candidatos DISTINTOS foram alcançados por
// pelo menos um sinal — 0 => NEW, 1 => PROBABLE, >1 => AMBIGUOUS (regra
// explícita: "If multiple probable candidates have equivalent meaningful
// signals: => AMBIGUOUS"). Isto evita que a regra 3 decida sozinha "só há
// 1 candidato" e ignore um segundo candidato que só bate pela regra 4/5.
interface ProbableSignal {
  candidateId: string
  signal: string
}

function collectProbableSignals(external: ExternalClientInput, candidates: ClientCandidate[]): ProbableSignal[] {
  const signals: ProbableSignal[] = []

  const externalEmail = normalizeEmail(external.email)
  const externalPhone = normalizePhone(external.phone)

  for (const candidate of candidates) {
    // regra 3: email exato + nome concorda fortemente
    if (externalEmail !== null && normalizeEmail(candidate.email) === externalEmail && textsAgree(external.name, candidate.name)) {
      signals.push({ candidateId: candidate.id, signal: 'email_name' })
    }

    // regra 4: telefone exato + nome concorda fortemente
    if (externalPhone !== null && normalizePhone(candidate.phone) === externalPhone && textsAgree(external.name, candidate.name)) {
      signals.push({ candidateId: candidate.id, signal: 'phone_name' })
    }

    // regra 5: nome sozinho (concordância forte) ou morada sozinha (+ nome)
    // — similaridade de nome/morada nunca chega a EXACT, só PROBABLE aqui
    // ou AMBIGUOUS mais abaixo se houver mais do que um candidato.
    if (textsAgree(external.name, candidate.name)) {
      signals.push({ candidateId: candidate.id, signal: 'name' })
    } else if (textsAgree(external.address, candidate.address)) {
      signals.push({ candidateId: candidate.id, signal: 'address' })
    }
  }

  return signals
}

/**
 * Reconcilia um cliente externo (de uma seguradora) com os candidatos já
 * existentes no CRM. Função pura e determinística — ver cabeçalho do
 * ficheiro para a ordem estrita das regras.
 */
export function reconcileClient(external: ExternalClientInput, candidates: ClientCandidate[]): ClientMatchResult {
  // Regra 1 — external identity exata.
  const externalIdentityMatches = matchByExternalIdentity(external, candidates)
  if (externalIdentityMatches.length === 1) {
    const match = externalIdentityMatches[0]!
    return {
      status: 'exact',
      candidateType: match.type,
      candidateId: match.id,
      candidateIds: [match.id],
      reason: `Existing external identity for provider "${external.provider}" and externalClientId "${external.externalClientId}" points to exactly one CRM record.`,
      signals: ['external_identity'],
    }
  }
  if (externalIdentityMatches.length > 1) {
    const ids = sortedUnique(externalIdentityMatches.map((c) => c.id))
    return {
      status: 'ambiguous',
      candidateType: null,
      candidateId: null,
      candidateIds: ids,
      reason: `More than one CRM record claims the same external identity (provider "${external.provider}", externalClientId "${external.externalClientId}").`,
      signals: ['external_identity'],
    }
  }

  // Regra 2 — NIF normalizado + mesma jurisdição.
  const taxIdMatches = matchByTaxId(external, candidates)
  if (taxIdMatches.length === 1) {
    const match = taxIdMatches[0]!
    return {
      status: 'exact',
      candidateType: match.type,
      candidateId: match.id,
      candidateIds: [match.id],
      reason: 'Exactly one CRM record shares the same normalized tax id and jurisdiction.',
      signals: ['tax_id_jurisdiction'],
    }
  }
  if (taxIdMatches.length > 1) {
    const ids = sortedUnique(taxIdMatches.map((c) => c.id))
    return {
      status: 'ambiguous',
      candidateType: null,
      candidateId: null,
      candidateIds: ids,
      reason: 'More than one CRM record shares the same normalized tax id and jurisdiction.',
      signals: ['tax_id_jurisdiction'],
    }
  }

  // Regras 3-5 — pool de sinais PROBABLE (nunca produzem EXACT).
  const probableSignals = collectProbableSignals(external, candidates)
  const distinctCandidateIds = sortedUnique(probableSignals.map((s) => s.candidateId))

  if (distinctCandidateIds.length === 0) {
    return {
      status: 'new',
      candidateType: null,
      candidateId: null,
      candidateIds: [],
      reason: 'No existing external identity, tax id, email, phone, name, or address match found.',
      signals: [],
    }
  }

  const signalNames = sortedUnique(probableSignals.map((s) => s.signal))

  if (distinctCandidateIds.length > 1) {
    return {
      status: 'ambiguous',
      candidateType: null,
      candidateId: null,
      candidateIds: distinctCandidateIds,
      reason: 'More than one CRM record has equivalent probable-match signals (email/phone/name/address); manual review required.',
      signals: signalNames,
    }
  }

  const onlyCandidateId = distinctCandidateIds[0]!
  const matchedCandidate = candidates.find((c) => c.id === onlyCandidateId)!
  return {
    status: 'probable',
    candidateType: matchedCandidate.type,
    candidateId: onlyCandidateId,
    candidateIds: [onlyCandidateId],
    reason: 'Exactly one CRM record has probable-match signals (email/phone/name/address agreement); manual review recommended before linking.',
    signals: signalNames,
  }
}
