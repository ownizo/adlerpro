/**
 * duplicate-warning.ts — avisos DETERMINÍSTICOS de possível duplicado para
 * as criações manuais de Pessoa/Empresa/Apólice no admin (CRM3 Block 2).
 *
 * PURO: sem chamadas Supabase, sem rede, sem escrita de dados. Recebe o que
 * o admin está prestes a criar e a lista de candidatos já existentes no CRM
 * (o CALLER busca-os), e devolve avisos — nunca bloqueia a criação, nunca
 * funde/altera o candidato, nunca impõe uma regra de unicidade global. Ver
 * requisito "Do not block creation" / "Do not enforce uniqueness" / "No
 * global UNIQUE behavior".
 *
 * Reutiliza deliberadamente as mesmas normalizações do motor de
 * reconciliação de carriers (identity-normalization.ts) — "o mesmo email"
 * ou "o mesmo NIF válido" deve significar exatamente a mesma coisa quer o
 * admin esteja a criar um cliente à mão, quer esteja a reconciliar um
 * registo vindo de uma seguradora.
 */

import {
  isValidPortugueseTaxId,
  normalizeEmail,
  normalizePhone,
  normalizePolicyNumber,
  normalizeTaxCountry,
  normalizeTaxId,
} from './identity-normalization.ts'

export type DuplicateWarningType = 'tax_id' | 'email' | 'phone' | 'policy_number'
export type DuplicateWarningSeverity = 'strong' | 'possible'

export interface DuplicateWarning {
  type: DuplicateWarningType
  severity: DuplicateWarningSeverity
  /** Registos CRM já existentes que geraram este aviso — nunca alterados
   * por esta função; o caller pode oferecer "Review existing record" para
   * cada um. */
  candidateIds: string[]
  message: string
}

function sortedUniqueIds(candidates: Array<{ id: string }>): string[] {
  return Array.from(new Set(candidates.map((c) => c.id))).sort()
}

/** Mesma comparação conservadora de texto usada em client-reconciliation.ts
 * (lowercase-insensível, trim, colapso de espaços, sem diacríticos) —
 * duplicada aqui deliberadamente pequena em vez de importada, para manter
 * este ficheiro sem dependência do motor de reconciliação de clientes (são
 * módulos irmãos, não um em cima do outro). */
function normalizeTextForComparison(value?: string | null): string {
  if (!value) return ''
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function textsAgree(a?: string | null, b?: string | null): boolean {
  const na = normalizeTextForComparison(a)
  const nb = normalizeTextForComparison(b)
  return na !== '' && na === nb
}

interface TaxIdBearing {
  nif?: string | null
  taxCountry?: string | null
}

/**
 * Encontra candidatos cujo NIF/tax id é uma correspondência forte o
 * suficiente para um aviso "strong":
 *   - jurisdição PT (explícita, ou inferida quando nenhum lado indica
 *     jurisdição mas o valor introduzido passa a validação de NIF
 *     português — as fichas de Pessoa/Empresa deste CRM nem sequer têm um
 *     campo de país fiscal, por isso "sem jurisdição indicada" tem de
 *     poder mesmo assim reconhecer um NIF português válido): SÓ conta
 *     quando os NIFs de AMBOS os lados passam isValidPortugueseTaxId() —
 *     um NIF (do input ou do candidato) com dígito de controlo inválido
 *     nunca gera um aviso forte, mesmo que os dois sejam textualmente
 *     iguais (ver requisito "If PT NIF is invalid: do not use it as a
 *     strong identity signal").
 *   - jurisdição não-PT: só quando ambos os lados indicam explicitamente a
 *     MESMA jurisdição (nunca inferida) — ver requisito "For non-PT tax
 *     ID: only use exact warning if jurisdiction is explicitly available
 *     and same".
 * Nunca compara jurisdições diferentes como correspondência.
 */
function findTaxIdMatches<T extends TaxIdBearing & { id: string }>(input: TaxIdBearing, candidates: T[]): T[] {
  const inputNif = (input.nif ?? '').trim()
  if (inputNif === '') return []

  const inputJurisdiction = normalizeTaxCountry(input.taxCountry)
  const treatAsPt = inputJurisdiction === 'PT' || (inputJurisdiction === null && isValidPortugueseTaxId(inputNif))

  if (treatAsPt) {
    if (!isValidPortugueseTaxId(inputNif)) return []
    const inputNormalized = normalizeTaxId(inputNif, 'PT')
    return candidates.filter((c) => {
      const candidateJurisdiction = normalizeTaxCountry(c.taxCountry)
      if (candidateJurisdiction !== null && candidateJurisdiction !== 'PT') return false
      const candidateNif = (c.nif ?? '').trim()
      if (candidateNif === '' || !isValidPortugueseTaxId(candidateNif)) return false
      return normalizeTaxId(candidateNif, 'PT') === inputNormalized
    })
  }

  // Não-PT: exige jurisdição explícita e igual dos dois lados.
  if (inputJurisdiction === null) return []
  const inputNormalized = normalizeTaxId(inputNif, input.taxCountry)
  if (inputNormalized === null) return []
  return candidates.filter((c) => {
    const candidateJurisdiction = normalizeTaxCountry(c.taxCountry)
    if (candidateJurisdiction === null || candidateJurisdiction !== inputJurisdiction) return false
    const candidateNif = (c.nif ?? '').trim()
    if (candidateNif === '') return false
    return normalizeTaxId(candidateNif, c.taxCountry) === inputNormalized
  })
}

// ── Person ───────────────────────────────────────────────────────────────

export interface PersonDuplicateCheckInput {
  nif?: string | null
  taxCountry?: string | null
  email?: string | null
  phone?: string | null
}

export interface PersonDuplicateCandidate {
  id: string
  nif?: string | null
  taxCountry?: string | null
  email?: string | null
  phone?: string | null
}

export function getPersonDuplicateWarnings(
  input: PersonDuplicateCheckInput,
  candidates: PersonDuplicateCandidate[],
): DuplicateWarning[] {
  const warnings: DuplicateWarning[] = []

  const taxMatches = findTaxIdMatches(input, candidates)
  if (taxMatches.length > 0) {
    warnings.push({
      type: 'tax_id',
      severity: 'strong',
      candidateIds: sortedUniqueIds(taxMatches),
      message:
        taxMatches.length === 1
          ? 'Another person uses the same validated Portuguese tax ID.'
          : 'Other people use the same validated Portuguese tax ID.',
    })
  }

  const inputEmail = normalizeEmail(input.email)
  if (inputEmail !== null) {
    const emailMatches = candidates.filter((c) => normalizeEmail(c.email) === inputEmail)
    if (emailMatches.length > 0) {
      warnings.push({
        type: 'email',
        severity: 'possible',
        candidateIds: sortedUniqueIds(emailMatches),
        message: 'Another client uses this email address.',
      })
    }
  }

  const inputPhone = normalizePhone(input.phone)
  if (inputPhone !== null) {
    const phoneMatches = candidates.filter((c) => normalizePhone(c.phone) === inputPhone)
    if (phoneMatches.length > 0) {
      warnings.push({
        type: 'phone',
        severity: 'possible',
        candidateIds: sortedUniqueIds(phoneMatches),
        message: 'Another client uses this phone number.',
      })
    }
  }

  return warnings
}

// ── Company ──────────────────────────────────────────────────────────────

export interface CompanyDuplicateCheckInput {
  nif?: string | null
  taxCountry?: string | null
  name?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
}

export interface CompanyDuplicateCandidate {
  id: string
  nif?: string | null
  taxCountry?: string | null
  name?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
}

export function getCompanyDuplicateWarnings(
  input: CompanyDuplicateCheckInput,
  candidates: CompanyDuplicateCandidate[],
): DuplicateWarning[] {
  const warnings: DuplicateWarning[] = []

  const taxMatches = findTaxIdMatches(input, candidates)
  if (taxMatches.length > 0) {
    warnings.push({
      type: 'tax_id',
      severity: 'strong',
      candidateIds: sortedUniqueIds(taxMatches),
      message:
        taxMatches.length === 1
          ? 'Another company uses the same validated Portuguese tax ID (NIPC).'
          : 'Other companies use the same validated Portuguese tax ID (NIPC).',
    })
  }

  const inputEmail = normalizeEmail(input.contactEmail)
  if (inputEmail !== null) {
    const emailMatches = candidates.filter((c) => normalizeEmail(c.contactEmail) === inputEmail)
    if (emailMatches.length > 0) {
      warnings.push({
        type: 'email',
        severity: 'possible',
        candidateIds: sortedUniqueIds(emailMatches),
        message: 'Another company uses this contact email address.',
      })
    }
  }

  // Telefone sozinho não é suficiente para uma empresa (nomes de contacto
  // partilham centrais telefónicas com frequência) — exige também
  // concordância de nome, ao contrário do aviso de telefone de Pessoa.
  const inputPhone = normalizePhone(input.contactPhone)
  if (inputPhone !== null) {
    const phoneNameMatches = candidates.filter(
      (c) => normalizePhone(c.contactPhone) === inputPhone && textsAgree(input.name, c.name),
    )
    if (phoneNameMatches.length > 0) {
      warnings.push({
        type: 'phone',
        severity: 'possible',
        candidateIds: sortedUniqueIds(phoneNameMatches),
        message: 'Another company uses this phone number and name.',
      })
    }
  }

  return warnings
}

// ── Policy ───────────────────────────────────────────────────────────────

export interface PolicyDuplicateCheckInput {
  insurer?: string | null
  policyNumber?: string | null
}

export interface PolicyDuplicateCandidate {
  id: string
  insurer?: string | null
  policyNumber?: string | null
}

/**
 * Aviso quando outra apólice do MESMO segurador já usa o mesmo número
 * normalizado — nunca por coincidência de número entre seguradoras
 * diferentes (ver requisito "Never warn as duplicate solely because: same
 * policy number with different insurer/provider"), e sem impor nenhuma
 * unicidade global.
 */
export function getPolicyDuplicateWarnings(
  input: PolicyDuplicateCheckInput,
  candidates: PolicyDuplicateCandidate[],
): DuplicateWarning[] {
  const insurer = (input.insurer ?? '').trim()
  if (insurer === '') return []

  const inputNormalized = normalizePolicyNumber(input.policyNumber, insurer)
  if (inputNormalized === null) return []

  const matches = candidates.filter((c) => {
    const candidateInsurer = (c.insurer ?? '').trim()
    if (candidateInsurer === '' || candidateInsurer !== insurer) return false
    return normalizePolicyNumber(c.policyNumber, candidateInsurer) === inputNormalized
  })

  if (matches.length === 0) return []
  return [
    {
      type: 'policy_number',
      severity: 'possible',
      candidateIds: sortedUniqueIds(matches),
      message:
        matches.length === 1
          ? 'A policy from the same insurer already uses this policy number.'
          : 'Other policies from the same insurer already use this policy number.',
    },
  ]
}
