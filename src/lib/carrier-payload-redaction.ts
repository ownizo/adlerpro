/**
 * carrier-payload-redaction.ts — redação DETERMINÍSTICA e recursiva de
 * chaves sensíveis num raw_payload de carrier_import_records, antes de
 * expor esse payload na vista "Technical details" do admin (ver
 * src/routes/admin.carrier-integrations.runs.$id.tsx).
 *
 * PURA: sem chamadas Supabase, sem rede, sem escrita de dados, e nunca
 * muta o objeto recebido — devolve sempre uma cópia nova.
 *
 * Porquê recursivo: filtrar só as chaves de topo (a versão anterior,
 * Object.entries(payload).filter(...)) não protege dados médicos que uma
 * seguradora envie aninhados dentro de outra estrutura (ex.:
 * payload.beneficiary.medicalHistory.diagnosis) — uma chave-pai não
 * sensível ("beneficiary") nunca deve blindar uma chave-filha sensível.
 *
 * Redação ESTRUTURAL apenas (ver requisito "Do not try to inspect
 * free-text VALUES for medical words") — só o NOME da chave é avaliado,
 * nunca o conteúdo textual de um valor. Uma chave sensível é omitida por
 * completo (a chave desaparece do objeto devolvido), nunca substituída por
 * um placeholder — nada aqui finge que o valor "não existia", só que não é
 * exposto nesta vista.
 */

const SENSITIVE_PAYLOAD_KEY_RE =
  /health|medical|diagnos|condition|treatment|therapy|disease|symptom|clinic|hospital|doctor|physician|medication|prescription|patient/i

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PAYLOAD_KEY_RE.test(key)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Devolve uma cópia de `value` com toda a árvore percorrida
 * recursivamente: qualquer chave de objeto cujo NOME bata com
 * SENSITIVE_PAYLOAD_KEY_RE é omitida inteiramente (chave e valor), em
 * qualquer profundidade — mesmo quando as chaves-pai são inofensivas.
 * Primitivos e `null` são devolvidos tal como estão; arrays são
 * processados elemento a elemento. Nunca muta `value`.
 */
export function redactSensitivePayload(value: unknown): unknown {
  if (value === null) return null

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitivePayload(item))
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      if (isSensitiveKey(key)) continue
      result[key] = redactSensitivePayload(value[key])
    }
    return result
  }

  // Primitivos (string, number, boolean, undefined) — devolvidos sem
  // alteração; o conteúdo textual nunca é inspecionado (ver cabeçalho).
  return value
}
