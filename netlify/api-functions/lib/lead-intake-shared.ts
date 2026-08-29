/**
 * lead-intake-shared.ts — validação e sanitização pura do payload do
 * intake endpoint (lead-intake.mts). Isolado do handler HTTP para
 * poder ser testado sem rede/Supabase — ver lead-intake-shared.test.ts.
 *
 * ALLOWLIST: só os campos definidos aqui chegam a sair desta função.
 * Um payload com campos extra (ex.: `health_preexisting`, `dob`,
 * `nif`) simplesmente não os vê copiados para o resultado — não é
 * preciso "esquecer" de os bloquear, eles nunca estiveram na forma
 * de saída.
 */
import { normalizeEmail, isValidEmail } from '../../../src/lib/email.ts'

const MAX_SHORT = 200
const MAX_PHONE = 40
const MAX_LONG = 500
const MAX_METADATA_KEYS = 20
const MAX_METADATA_VALUE_LEN = 200

export interface LeadIntakeUtm {
  source?: string
  medium?: string
  campaign?: string
  content?: string
  term?: string
}

export interface LeadIntakeRequestPayload {
  submissionId?: unknown
  name?: unknown
  email?: unknown
  phone?: unknown
  formName?: unknown
  market?: unknown
  product?: unknown
  source?: unknown
  sourceUrl?: unknown
  utm?: unknown
  metadata?: unknown
}

export interface SanitizedLeadIntake {
  submissionId?: string
  name: string
  email: string
  phone?: string
  formName: string
  market?: string
  product?: string
  source?: string
  sourceUrl?: string
  utm: LeadIntakeUtm
  metadata?: Record<string, string | number | boolean>
}

export type LeadIntakeValidationResult =
  | { ok: true; value: SanitizedLeadIntake }
  | { ok: false; status: number; error: string }

function cleanString(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, maxLen)
}

function cleanMetadata(value: unknown): Record<string, string | number | boolean> | undefined {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>)
  const out: Record<string, string | number | boolean> = {}
  let count = 0
  for (const [key, v] of entries) {
    if (count >= MAX_METADATA_KEYS) break
    // Só primitivos simples — nunca objetos/arrays aninhados (evita que dados
    // sensíveis passem "escondidos" dentro de metadata em profundidade).
    if (typeof v === 'string') {
      const trimmed = v.trim()
      if (!trimmed) continue
      out[key] = trimmed.slice(0, MAX_METADATA_VALUE_LEN)
      count++
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[key] = v
      count++
    }
  }
  return count > 0 ? out : undefined
}

/**
 * Valida e sanitiza o body já parseado como JSON. Não faz I/O — o
 * handler HTTP trata de: Authorization, method, content-type e limite
 * de tamanho do payload antes de chamar isto.
 */
export function parseLeadIntakePayload(body: unknown): LeadIntakeValidationResult {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'invalid_payload' }
  }
  const raw = body as LeadIntakeRequestPayload

  const name = cleanString(raw.name, MAX_SHORT)
  if (!name) return { ok: false, status: 422, error: 'missing_name' }

  const emailInput = typeof raw.email === 'string' ? raw.email : ''
  const email = normalizeEmail(emailInput)
  if (!isValidEmail(email)) return { ok: false, status: 422, error: 'invalid_email' }

  const formName = cleanString(raw.formName, MAX_SHORT)
  if (!formName) return { ok: false, status: 422, error: 'missing_form_name' }

  const utmInput = raw.utm && typeof raw.utm === 'object' && !Array.isArray(raw.utm) ? (raw.utm as Record<string, unknown>) : {}

  const value: SanitizedLeadIntake = {
    submissionId: cleanString(raw.submissionId, MAX_SHORT),
    name,
    email,
    phone: cleanString(raw.phone, MAX_PHONE),
    formName,
    market: cleanString(raw.market, MAX_SHORT),
    product: cleanString(raw.product, MAX_SHORT),
    source: cleanString(raw.source, MAX_SHORT),
    sourceUrl: cleanString(raw.sourceUrl, MAX_LONG),
    utm: {
      source: cleanString(utmInput.source, MAX_SHORT),
      medium: cleanString(utmInput.medium, MAX_SHORT),
      campaign: cleanString(utmInput.campaign, MAX_SHORT),
      content: cleanString(utmInput.content, MAX_SHORT),
      term: cleanString(utmInput.term, MAX_SHORT),
    },
    metadata: cleanMetadata(raw.metadata),
  }

  return { ok: true, value }
}

export interface LeadIntakeOutcome {
  clientId: string
  clientCreated: boolean
  leadCreated: boolean
  opportunityCreated: boolean
}

/**
 * Constrói o corpo de resposta de sucesso do intake — a única fonte da
 * forma de resposta, para o handler nunca ter de decidir isto ad-hoc.
 * `opportunityCreated` reflete só se ESTA chamada criou a oportunidade
 * agora (false tanto quando já existia como quando a criação falhou —
 * ver requisito "proteger o lead-intake": a oportunidade é sempre
 * best-effort e nunca faz esta função devolver `ok: false`).
 *
 * Não recebe nenhuma mensagem de erro interna/Supabase como argumento — não
 * há como esta função expor por engano um detalhe interno ao website, ela
 * simplesmente não tem essa informação disponível.
 */
export function buildLeadIntakeResponse(outcome: LeadIntakeOutcome) {
  return {
    ok: true as const,
    clientId: outcome.clientId,
    clientCreated: outcome.clientCreated,
    leadCreated: outcome.leadCreated,
    duplicateSubmission: !outcome.leadCreated,
    opportunityCreated: outcome.opportunityCreated,
  }
}
