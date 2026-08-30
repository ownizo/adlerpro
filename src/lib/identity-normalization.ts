/**
 * identity-normalization.ts — normalização determinística de identidade
 * para o motor de reconciliação CRM3 (email, telefone, NIF/tax id, número
 * de apólice).
 *
 * Regra geral (ver requisito "IMPORTANT: Default behavior must NOT globally
 * remove punctuation"): estas funções são conservadoras por omissão — só
 * removem formatação quando há uma razão específica e documentada para o
 * fazer (ex.: NIF português tem um formato numérico bem conhecido; um NIF
 * estrangeiro não tem, por isso é preservado quase tal como está). Nenhuma
 * função aqui faz fuzzy matching, chama rede, ou grava nada — são funções
 * puras usadas pelos motores de reconciliação (client-reconciliation.ts,
 * policy-reconciliation.ts).
 */

/** trim + lowercase. Não remove +aliases nem altera pontos do Gmail — dois
 * emails só são "o mesmo" depois desta normalização se forem string-iguais.
 * Mesma regra de normalizeEmail em src/lib/email.ts, mas devolve `null` em
 * vez de `''` para vazio (contrato usado pelo motor de reconciliação). */
export function normalizeEmail(value?: string | null): string | null {
  const trimmed = (value ?? '').trim().toLowerCase()
  return trimmed === '' ? null : trimmed
}

/**
 * trim; preserva um eventual '+' inicial tal como veio; remove espaços,
 * parênteses e hífenes (formatação de exibição óbvia). NUNCA inventa nem
 * completa um indicativo de país — um número local português não é
 * convertido para +351, e um número sem indicativo continua sem indicativo.
 */
export function normalizePhone(value?: string | null): string | null {
  const trimmed = (value ?? '').trim()
  if (trimmed === '') return null
  const cleaned = trimmed.replace(/[\s()\-]/g, '')
  return cleaned === '' ? null : cleaned
}

/**
 * Bucket de jurisdição para efeitos de comparação/normalização de NIF — só
 * distingue "Portugal" (em qualquer grafia de entrada aceite) do resto.
 * Exportada porque o motor de reconciliação de clientes precisa da mesma
 * noção de "mesma jurisdição" usada aqui, para nunca considerar dois NIFs
 * de países diferentes como EXACT (ver requisito "Do not compare tax IDs
 * across jurisdictions as exact").
 */
export function normalizeTaxCountry(country?: string | null): string | null {
  const trimmed = (country ?? '').trim().toUpperCase()
  if (trimmed === '') return null
  if (trimmed === 'PT' || trimmed === 'PRT' || trimmed === 'PORTUGAL') return 'PT'
  return trimmed
}

const PT_TAX_ID_STRIP_RE = /[\s.\-]/g

/**
 * trim + uppercase sempre. Para Portugal (PT/PRT/PORTUGAL), remove também
 * espaços, pontos e hífenes — formatação comum em NIFs introduzidos
 * manualmente (ex.: "123.456.789") — mas preserva quaisquer letras que
 * apareçam num valor malformado (não valida nem rejeita, só normaliza para
 * comparação). Para qualquer outro país (ou país desconhecido), a
 * normalização é deliberadamente conservadora: só uppercase + colapso de
 * espaços internos, sem remover pontuação — um tax id estrangeiro pode ter
 * hífenes ou pontos que fazem parte do formato oficial do país emissor, que
 * este código não conhece.
 */
export function normalizeTaxId(value?: string | null, country?: string | null): string | null {
  const trimmed = (value ?? '').trim()
  if (trimmed === '') return null
  const upper = trimmed.toUpperCase()

  if (normalizeTaxCountry(country) === 'PT') {
    const stripped = upper.replace(PT_TAX_ID_STRIP_RE, '')
    return stripped === '' ? null : stripped
  }

  const collapsed = upper.replace(/\s+/g, ' ')
  return collapsed === '' ? null : collapsed
}

/** Uma normalização de número de apólice específica de uma seguradora —
 * preparação para quando integrações concretas precisarem de regras
 * próprias (ex.: uma seguradora que usa sempre maiúsculas mas mantém
 * hífenes como separador com significado). Nenhuma existe ainda. */
export type PolicyNumberNormalizer = (value: string) => string

/**
 * Normalizadores por seguradora — a chave é o `provider` tal como usado em
 * todo o CRM3 (texto livre, comparado com trim, sem case-folding — ver
 * client-reconciliation.ts/policy-reconciliation.ts). Vazio de propósito:
 * nenhuma transformação específica de seguradora foi ainda desenhada. Não
 * inventar aqui regras de uma seguradora concreta (Zurich, Allianz, MGEN,
 * ASISA, ...) — isso é trabalho de integração, fora do âmbito desta
 * foundation.
 */
export const providerPolicyNormalizers: Record<string, PolicyNumberNormalizer> = {}

/**
 * trim + uppercase + colapso de espaços repetidos. NÃO remove pontuação por
 * omissão (ver "IMPORTANT" no topo do ficheiro) — um número de apólice como
 * "PT-2026/001.4" fica "PT-2026/001.4", só normalizado em caixa e espaços.
 * Usa o normalizador específico do `provider` quando existe um em
 * providerPolicyNormalizers; caso contrário aplica a regra conservadora
 * acima.
 */
export function normalizePolicyNumber(value?: string | null, provider?: string | null): string | null {
  const trimmed = (value ?? '').trim()
  if (trimmed === '') return null

  const providerKey = (provider ?? '').trim()
  const customNormalizer = providerKey ? providerPolicyNormalizers[providerKey] : undefined
  if (customNormalizer) {
    const result = customNormalizer(trimmed).trim()
    return result === '' ? null : result
  }

  const normalized = trimmed.toUpperCase().replace(/\s+/g, ' ')
  return normalized === '' ? null : normalized
}
