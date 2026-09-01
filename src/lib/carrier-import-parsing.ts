/**
 * carrier-import-parsing.ts — utilitários PUROS partilhados por todos os
 * mappers de portfolio (CRM3 Block 3): normalização de cabeçalhos,
 * datas/prémios "parsed safely" (nunca lançam, devolvem undefined em vez
 * de adivinhar um valor ambíguo), e a remoção de campos bancários antes de
 * qualquer staging.
 *
 * PURO: sem I/O, sem Supabase, sem `xlsx` — só transforma dados já lidos
 * (a leitura do ficheiro .xlsx em si vive em carrier-excel-workbook.ts,
 * que é a única peça desta pipeline que não é 100% pura).
 */

import type { Json } from './types.ts'

/**
 * trim + lowercase + remove diacríticos (só para comparação — nunca altera
 * um valor guardado) + colapsa espaços a um único espaço + substitui por
 * underscore. "Código Postal" -> "codigo_postal", "Data Início" ->
 * "data_inicio", "NIF" -> "nif". Conservador: não remove pontuação além do
 * espaço (ver requisito "Normalize headers conservatively").
 */
export function normalizeHeaderName(header: unknown): string {
  if (header === null || header === undefined) return ''
  // Some real carrier exports (seen in the Allianz POLRES CSV) include a
  // malformed trailing column whose header is filled with NUL bytes
  // (U+0000) — String.prototype.trim() does NOT strip those (they are
  // control characters, not whitespace), so without this the column would
  // survive as a NUL-filled key all the way into sanitizedRaw. Stripping
  // NUL bytes here — before trim — makes such a header normalize to ''
  // (discarded by every caller that already skips '' keys), while leaving
  // every legitimate header's punctuation (periods, slashes, etc.)
  // completely untouched — this is not a punctuation-semantics change.
  const withoutNul = String(header).replace(/\u0000/g, '')
  const trimmed = withoutNul.trim()
  if (trimmed === '') return ''
  const withoutDiacritics = trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const collapsed = withoutDiacritics.toLowerCase().replace(/\s+/g, ' ').trim()
  return collapsed.replace(/ /g, '_')
}

/** Devolve um novo objeto com as chaves normalizadas (normalizeHeaderName) —
 * nunca muta `row`. Chaves que normalizam para '' são descartadas. */
export function normalizeRowKeys(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeHeaderName(key)
    if (normalized === '') continue
    result[normalized] = value
  }
  return result
}

const DDMMYYYY_RE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})(?: \d{2}:\d{2}:\d{2})?$/
const YYYYMMDD_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

/**
 * Devolve uma data ISO 'YYYY-MM-DD' ou `undefined` — NUNCA lança, NUNCA
 * adivinha um formato ambíguo (ver requisito "dates parsed safely").
 * Aceita:
 *   - um objeto Date real (já resolvido pelo parser do workbook, quando o
 *     Excel guarda a célula como data nativa)
 *   - 'DD/MM/AAAA', 'DD-MM-AAAA', 'DD.MM.AAAA' (com ou sem HH:mm:ss,
 *     formato português comum em ficheiros de seguradoras portuguesas)
 *   - 'AAAA-MM-DD' (ISO, já inequívoco)
 * Qualquer outro formato (incluindo MM/DD/AAAA americano, que seria
 * ambíguo com DD/MM/AAAA para a maioria dos dias) devolve undefined em vez
 * de arriscar trocar dia com mês.
 */
export function parseImportDateSafely(value: unknown): string | undefined {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined
    return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return undefined

    const iso = YYYYMMDD_RE.exec(trimmed)
    if (iso) {
      const [, y, m, d] = iso
      const year = Number(y), month = Number(m), day = Number(d)
      return isValidCalendarDate(year, month, day) ? `${y}-${pad2(month)}-${pad2(day)}` : undefined
    }

    const ddmmyyyy = DDMMYYYY_RE.exec(trimmed)
    if (ddmmyyyy) {
      const [, d, m, y] = ddmmyyyy
      const day = Number(d), month = Number(m), year = Number(y)
      return isValidCalendarDate(year, month, day) ? `${year}-${pad2(month)}-${pad2(day)}` : undefined
    }
  }
  return undefined
}

/**
 * Devolve um número (euros, ponto decimal) ou `undefined` — NUNCA lança
 * (ver requisito "premium parsed safely"). Aceita números nativos (já
 * resolvidos pelo `xlsx`), e texto no formato português "1.234,56 €" ou
 * simples "1234.56"/"1234,56". Símbolos de moeda e espaços são removidos
 * antes de interpretar o número; nunca inspeciona o valor para além disso.
 */
export function parseAmountSafely(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value !== 'string') return undefined

  const cleaned = value.trim().replace(/[€$\s]/g, '')
  if (cleaned === '') return undefined

  // Formato português "1.234,56" — ponto como separador de milhares,
  // vírgula como decimal.
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(cleaned)) {
    const normalized = cleaned.replace(/\./g, '').replace(',', '.')
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  // Formato simples "1234.56" ou "1234,56" (uma só vírgula/ponto, decimal).
  if (/^-?\d+([.,]\d+)?$/.test(cleaned)) {
    const parsed = Number(cleaned.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

/**
 * Remove QUALQUER chave que pareça dados bancários (NIB/IBAN/número de
 * conta/BIC/SWIFT) — chamado SEMPRE antes de qualquer persistência de
 * staging, nunca opcional (ver requisito "PRIVACY — CRITICAL"). Devolve um
 * objeto novo, nunca muta `row`.
 *
 * Reforçado para o formato real Allianz POLRES: os seus cabeçalhos
 * bancários/de débito direto em português (NOME BANCO, CÓD BANCO, AGÊNCIA
 * BANC., CTA BANCO, DÍGITO CONTROLO, AUTORIZAÇÃO — além de IBAN/BIC, já
 * cobertos) normalizam para chaves como nome_banco/cod_banco/
 * agencia_banc./cta_banco/digito_controlo/autorizacao — nenhuma delas
 * contém as palavras inglesas "bank"/"account", por isso as cláusulas
 * genéricas acima não as apanhavam. A cláusula `banco|banc\.` cobre
 * nome_banco/cod_banco/cta_banco/agencia_banc. (não usa \b — chaves
 * normalizadas usam "_" como separador, que \b trata como carácter de
 * palavra — mas "banco"/"banc." continuam suficientemente específicas
 * para não apanhar campos genéricos não relacionados como "tipo").
 *
 * digito_controlo e autorizacao são âncoras EXATAS de chave completa
 * (^...$), não substring — uma primeira versão usava `controlo`/
 * `autorizacao` como substring genérica, o que também apanhava campos
 * não bancários só de nome parecido (ex.: controlo_risco,
 * autorizacao_marketing, autorizacao_documental). Isto continua a
 * apanhar exatamente os dois campos POLRES reais, sem falsos positivos.
 */
const BANKING_KEY_RE =
  /\bnib\b|\biban\b|bank.*account|account.*(number|nr|no)|\bswift\b|\bbic\b|banco|banc\.|^digito_controlo$|^autorizacao$/i

export function stripBankingFields(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (BANKING_KEY_RE.test(key)) continue
    result[key] = value
  }
  return result
}

/** Estrutura comum de saída de qualquer mapper — ver carrier-import-mappers.ts. */
export interface ParsedImportRow {
  externalClientId?: string
  customerName?: string
  taxIdRaw?: string
  address?: string
  postalCode?: string
  city?: string
  country?: string
  phone?: string
  email?: string
  externalPolicyNumber?: string
  carrierPlanId?: string
  productDescription?: string
  startDate?: string
  endDate?: string
  effectiveDate?: string
  premium?: number
  paymentFrequency?: string
  carrierStatus?: string
  carrierSegment?: string
  /** Linha original, JÁ sem campos bancários e JÁ redigida de chaves
   * médicas — é isto, e SÓ isto, que pode ir para
   * carrier_import_records.raw_payload. */
  sanitizedRaw: Record<string, Json>
}

export interface ProviderMapperResult {
  recognized: boolean
  rows: ParsedImportRow[]
  /** Presente só quando recognized=false — ex.: "File format not yet
   * recognised for Allianz". */
  error?: string
}

/** Recebe linhas já com chaves normalizadas (normalizeRowKeys aplicado a
 * cada uma) — nunca `xlsx` bruto, nunca I/O. */
export type ProviderMapper = (normalizedRows: Array<Record<string, unknown>>) => ProviderMapperResult
