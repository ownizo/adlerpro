/**
 * carrier-import-mappers.ts — mapeamento de linhas normalizadas de Excel
 * para ParsedImportRow, por seguradora (CRM3 Block 3).
 *
 * PURO: sem I/O, sem Supabase. Recebe linhas já normalizadas
 * (normalizeRowKeys aplicado — ver carrier-import-parsing.ts) e devolve um
 * ProviderMapperResult.
 *
 * ARQUITETURA — pensada para crescer sem tocar no motor de reconciliação:
 * cada seguradora é uma função ProviderMapper independente, registada em
 * PROVIDER_MAPPERS. Adicionar uma seguradora nova é só escrever a função e
 * acrescentá-la ao registo — client-reconciliation.ts/
 * policy-reconciliation.ts nunca precisam de saber que uma seguradora nova
 * existe, só recebem sempre a mesma forma (ParsedImportRow).
 *
 * Allianz/Zurich/Hiscox: o formato real do ficheiro destas seguradoras não
 * é conhecido — os mappers abaixo devolvem sempre recognized=false com
 * uma mensagem clara, nunca fingem reconhecer um formato que não foi
 * verificado (ver requisito "Do NOT pretend their Excel format is
 * known").
 */

import {
  normalizeHeaderName,
  parseAmountSafely,
  parseImportDateSafely,
  stripBankingFields,
  type ParsedImportRow,
  type ProviderMapper,
  type ProviderMapperResult,
} from './carrier-import-parsing.ts'
import { redactSensitivePayload } from './carrier-payload-redaction.ts'
import { CARRIER_PROVIDER_LABELS, type CarrierProviderId } from './carrier-providers.ts'
import type { Json } from './types.ts'

// ── MGEN — primeiro template real ────────────────────────────────────

// nib é intencionalmente EXCLUÍDO deste mapa — nunca copiado para
// ParsedImportRow. stripBankingFields (aplicado a sanitizedRaw mais abaixo)
// é a segunda camada de defesa contra qualquer coluna bancária.
const MGEN_FIELD_MAP: Partial<Record<string, keyof ParsedImportRow>> = {
  tomador_id: 'externalClientId',
  tomador: 'customerName',
  nif: 'taxIdRaw',
  morada: 'address',
  codigo_postal: 'postalCode',
  localidade: 'city',
  pais: 'country',
  telefone: 'phone',
  email: 'email',
  contrato_id: 'externalPolicyNumber',
  plano_id: 'carrierPlanId',
  plano: 'productDescription',
  data_inicio: 'startDate',
  data_fim: 'endDate',
  data_efeito: 'effectiveDate',
  premio_total: 'premium',
  fracionamento: 'paymentFrequency',
  estado: 'carrierStatus',
  segmento: 'carrierSegment',
}

const DATE_FIELDS = new Set<keyof ParsedImportRow>(['startDate', 'endDate', 'effectiveDate'])
const AMOUNT_FIELDS = new Set<keyof ParsedImportRow>(['premium'])
const STRING_FIELDS = new Set<keyof ParsedImportRow>([
  'externalClientId', 'customerName', 'taxIdRaw', 'address', 'postalCode', 'city', 'country',
  'phone', 'email', 'externalPolicyNumber', 'carrierPlanId', 'productDescription',
  'paymentFrequency', 'carrierStatus', 'carrierSegment',
])

// Presença mínima destas chaves normalizadas decide "isto parece mesmo um
// ficheiro MGEN" — nif e contrato_id são o núcleo de identidade
// cliente/apólice; tomador_id ou tomador identificam o titular. Sem isto,
// devolve recognized=false em vez de mapear parcialmente às cegas.
const MGEN_REQUIRED_KEYS = ['nif', 'contrato_id']

function sanitizeRawRowForStaging(row: Record<string, unknown>): Record<string, Json> {
  const withoutBanking = stripBankingFields(row)
  // redactSensitivePayload já é recursivo e seguro para valores primitivos
  // — aqui a linha é sempre plana, mas reutiliza-se a mesma função em vez
  // de reimplementar a lista de chaves médicas.
  return redactSensitivePayload(withoutBanking) as Record<string, Json>
}

// Real Excel cell values are always flat scalars, but this stays properly
// recursive (rather than stringifying anything unexpected) so that IF a
// nested structure ever shows up — a stray object/array value — the
// sensitive-key redaction below can still walk into it and strip a
// medical-looking key at any depth, instead of it surviving as an opaque
// "[object Object]" string.
function toJsonSafeValue(value: unknown): Json {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(toJsonSafeValue)
  if (typeof value === 'object') {
    const result: Record<string, Json> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      result[key] = toJsonSafeValue(nested)
    }
    return result
  }
  return String(value)
}

export const mgenMapper: ProviderMapper = (normalizedRows) => {
  if (normalizedRows.length === 0) {
    return { recognized: false, rows: [], error: 'File format not yet recognised for MGEN' }
  }

  const firstRowKeys = new Set(Object.keys(normalizedRows[0]!))
  const hasCore = MGEN_REQUIRED_KEYS.every((key) => firstRowKeys.has(key))
  const hasCustomerIdentity = firstRowKeys.has('tomador_id') || firstRowKeys.has('tomador')
  if (!hasCore || !hasCustomerIdentity) {
    return { recognized: false, rows: [], error: 'File format not yet recognised for MGEN' }
  }

  const rows: ParsedImportRow[] = normalizedRows.map((rawRow) => {
    const parsed: ParsedImportRow = { sanitizedRaw: {} }
    for (const [key, value] of Object.entries(rawRow)) {
      const targetField = MGEN_FIELD_MAP[key]
      if (!targetField) continue
      if (value === null || value === undefined || value === '') continue

      if (DATE_FIELDS.has(targetField)) {
        const parsedDate = parseImportDateSafely(value)
        if (parsedDate !== undefined) (parsed as any)[targetField] = parsedDate
      } else if (AMOUNT_FIELDS.has(targetField)) {
        const parsedAmount = parseAmountSafely(value)
        if (parsedAmount !== undefined) (parsed as any)[targetField] = parsedAmount
      } else if (STRING_FIELDS.has(targetField)) {
        (parsed as any)[targetField] = String(value).trim()
      }
    }

    // sanitizedRaw: a linha bruta inteira (nunca só os campos mapeados —
    // preserva-se para auditoria/revisão), sempre sem NIB/IBAN e sempre
    // com chaves médicas redigidas.
    const jsonSafeRow: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(rawRow)) jsonSafeRow[key] = toJsonSafeValue(value)
    parsed.sanitizedRaw = sanitizeRawRowForStaging(jsonSafeRow)

    return parsed
  })

  return { recognized: true, rows }
}

// ── Zurich / Hiscox — placeholders, formato desconhecido ────────────────

function unknownFormatMapper(provider: CarrierProviderId): ProviderMapper {
  return (): ProviderMapperResult => ({
    recognized: false,
    rows: [],
    error: `File format not yet recognised for ${CARRIER_PROVIDER_LABELS[provider]}`,
  })
}

export const zurichMapper: ProviderMapper = unknownFormatMapper('zurich')
export const hiscoxMapper: ProviderMapper = unknownFormatMapper('hiscox')

// ── Allianz — POLRES, primeiro mapper real (CRM3 Block 3) ───────────────
//
// Este mapper é DELIBERADAMENTE parcial: só mapeia campos cujo significado
// está confirmado pelo portfolio real (ver requisito "INTENTIONALLY DO
// NOT MAP YET") para o porquê de premium/startDate/endDate/effectiveDate
// ficarem por mapear nesta PR: PRÉMIO COM.S1/S2/S3
// não está provado que corresponda a policies.annual_premium (valores
// comerciais divergem materialmente dos annual_premium já em CRM), e
// D.INICIO/D.FIM ora são datas de início original ora coincidem com um dia
// a mais do que o fim de cobertura atual em CRM — nenhum dos dois é seguro
// para propor automaticamente. Esses campos sobrevivem SÓ em sanitizedRaw
// para revisão manual; isto significa que o dry-run/reconciliation
// funciona mas o "create policy" apply para Allianz continua
// intencionalmente por ativar (mapParsedRowToNewPolicyFields exige
// start/end date).

const ALLIANZ_FIELD_MAP: Partial<Record<string, keyof ParsedImportRow>> = {
  nome_tomador: 'customerName',
  doc_tomador: 'taxIdRaw',
  'mor.tomador': 'address',
  'c.postal_tomador': 'postalCode',
  localidade_tomador: 'city',
  tlf_tomador: 'phone',
  // APÓLICE é sempre o número de apólice BASE — nunca combinado com
  // ADESÃO (ver requisito "POLICY + ADHESION EDGE CASE"): duas linhas com
  // a mesma APÓLICE e ADESÃO diferente (00001/00002) têm de reconciliar
  // contra a MESMA policies.policy_number existente em CRM.
  apolice: 'externalPolicyNumber',
  // ADESÃO fica em carrierPlanId, nunca fundida em externalPolicyNumber —
  // string sempre (nunca parseAmountSafely), para preservar zeros à
  // esquerda ("00001" nunca vira 1).
  adesao: 'carrierPlanId',
  'objecto/bem_seguro': 'productDescription',
  'f.pagamento': 'paymentFrequency',
  // RAMO fica tal e qual (código Allianz, ex.: 1289/0229/2050) — nunca
  // traduzido para um tipo de apólice inventado.
  ramo: 'carrierSegment',
}

// Núcleo mínimo que decide "isto é mesmo um POLRES Allianz" (ver requisito
// "FORMAT RECOGNITION"). apolice/adesao/nome_tomador/doc_tomador/ramo por
// si só não bastam — um Excel genérico qualquer também pode ter NIF, nome
// e "apólice" — por isso exige-se ainda pelo menos um campo
// estruturalmente específico do POLRES.
const ALLIANZ_CORE_REQUIRED_KEYS = ['apolice', 'adesao', 'nome_tomador', 'doc_tomador', 'ramo']
const ALLIANZ_STRUCTURAL_KEYS = ['objecto/bem_seguro', 'cod_subramo_s1', 'premio_com.s1']

export const allianzMapper: ProviderMapper = (normalizedRows) => {
  if (normalizedRows.length === 0) {
    return { recognized: false, rows: [], error: 'File format not yet recognised for Allianz' }
  }

  const firstRowKeys = new Set(Object.keys(normalizedRows[0]!))
  const hasCore = ALLIANZ_CORE_REQUIRED_KEYS.every((key) => firstRowKeys.has(key))
  const hasStructural = ALLIANZ_STRUCTURAL_KEYS.some((key) => firstRowKeys.has(key))
  if (!hasCore || !hasStructural) {
    return { recognized: false, rows: [], error: 'File format not yet recognised for Allianz' }
  }

  const rows: ParsedImportRow[] = normalizedRows.map((rawRow) => {
    const parsed: ParsedImportRow = { sanitizedRaw: {} }
    for (const [key, value] of Object.entries(rawRow)) {
      const targetField = ALLIANZ_FIELD_MAP[key]
      if (!targetField) continue
      if (value === null || value === undefined || value === '') continue
      // Todos os campos mapeados acima são strings (ver STRING_FIELDS) —
      // nunca datas/valores nesta PR (ver "INTENTIONALLY DO NOT MAP YET").
      if (STRING_FIELDS.has(targetField)) {
        (parsed as any)[targetField] = String(value).trim()
      }
    }

    // D.ANULAÇÃO: só "cancelled" havendo uma data de anulação válida e não
    // vazia (ver requisito "CANCELLATION / REPLACEMENT EDGE CASE") — texto
    // em branco, ou um valor que não é sequer uma data reconhecível, nunca
    // marca uma apólice como cancelada por engano. A data em si nunca é
    // guardada num campo ParsedImportRow — sobrevive só em sanitizedRaw,
    // como todos os outros campos de data desta seguradora.
    parsed.carrierStatus = parseImportDateSafely(rawRow['d.anulacao']) !== undefined ? 'cancelled' : 'active'

    // premium/startDate/endDate/effectiveDate NÃO são mapeados aqui — ver
    // comentário no topo desta secção. PRÉMIO COM.S1/S2/S3 e D.EMISSÃO/
    // D.INICIO/D.FIM/D.ANULAÇÃO, tal como APÓLICE SUBST/ADESÃO SUBST.,
    // sobrevivem só em sanitizedRaw via a cópia integral da linha abaixo —
    // nunca resumida só aos campos mapeados.
    const jsonSafeRow: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(rawRow)) jsonSafeRow[key] = toJsonSafeValue(value)
    parsed.sanitizedRaw = sanitizeRawRowForStaging(jsonSafeRow)

    return parsed
  })

  return { recognized: true, rows }
}

export const PROVIDER_MAPPERS: Record<CarrierProviderId, ProviderMapper> = {
  mgen: mgenMapper,
  allianz: allianzMapper,
  zurich: zurichMapper,
  hiscox: hiscoxMapper,
}

/** Aplica normalizeHeaderName às chaves de cada linha e despacha para o
 * mapper certo — ponto de entrada único usado pelo server function. */
export function mapPortfolioRows(
  provider: CarrierProviderId,
  rows: Array<Record<string, unknown>>,
): ProviderMapperResult {
  const normalizedRows = rows.map((row) => {
    const normalized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      const normalizedKey = normalizeHeaderName(key)
      if (normalizedKey === '') continue
      normalized[normalizedKey] = value
    }
    return normalized
  })
  return PROVIDER_MAPPERS[provider](normalizedRows)
}
