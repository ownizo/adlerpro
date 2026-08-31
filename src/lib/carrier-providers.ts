/**
 * carrier-providers.ts — allowlist de seguradoras suportadas pelo importer
 * manual de portfolio (CRM3 Block 3).
 *
 * A seleção de seguradora é sempre EXPLÍCITA e feita pelo Admin ANTES do
 * upload — nunca inferida do nome do ficheiro, do número de apólice, ou do
 * conteúdo do Excel (ver requisito "Do NOT infer insurer"). O valor vindo
 * do browser nunca é confiado sem validação — ver isValidCarrierProvider,
 * usado no server function antes de qualquer processamento.
 */

export const CARRIER_PROVIDERS = ['mgen', 'allianz', 'zurich', 'hiscox'] as const

export type CarrierProviderId = (typeof CARRIER_PROVIDERS)[number]

export const CARRIER_PROVIDER_LABELS: Record<CarrierProviderId, string> = {
  mgen: 'MGEN',
  allianz: 'Allianz',
  zurich: 'Zurich',
  hiscox: 'Hiscox',
}

/** Validação server-side do valor de provider vindo do browser — nunca
 * confiar cegamente (ver requisito "Never trust browser provider value
 * blindly"). */
export function isValidCarrierProvider(value: unknown): value is CarrierProviderId {
  return typeof value === 'string' && (CARRIER_PROVIDERS as readonly string[]).includes(value)
}
