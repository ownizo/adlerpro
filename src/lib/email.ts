/**
 * email.ts — normalização e validação de email, centralizadas.
 *
 * Usado por findOrCreateIndividualClientByEmail (data.ts) e pelo
 * intake endpoint (netlify/api-functions/lead-intake.mts) para que
 * exista uma única definição de "o mesmo email" em todo o CRM. Não
 * faz fuzzy matching — dois emails só são considerados o mesmo se,
 * depois de normalizados, forem string-iguais.
 */

/** trim + lowercase. Não faz mais nenhuma transformação (sem fuzzy matching). */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

// Validação básica de formato — suficiente para rejeitar lixo óbvio antes de
// usar o valor como chave de deduplicação; não pretende validar RFC 5322 na
// íntegra nem verificar entregabilidade.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email)
  return normalized.length > 0 && EMAIL_RE.test(normalized)
}
