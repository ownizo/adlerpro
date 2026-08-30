/**
 * reconciliation-authority.ts — configuração/documentação de "quem é dono
 * de cada campo" no CRM3, uma vez que um cliente/apólice fica ligado a um
 * registo de uma seguradora.
 *
 * ISTO É APENAS DOCUMENTAÇÃO/CONFIGURAÇÃO. Não existe aqui (nem em nenhum
 * outro sítio desta foundation) qualquer código que leia esta constante e
 * sobreponha ou sincronize um campo — isso é trabalho futuro, explicitamente
 * fora do âmbito deste bloco. `reconciliationFieldAuthority` só serve para
 * as próximas fases (e para revisão humana) saberem, sem ambiguidade, qual
 * o comportamento pretendido antes de o implementar.
 *
 * REGRA GERAL
 *   - Dados de relação/comerciais (nome preferido, contactos, notas,
 *     tarefas, oportunidades) são sempre autoritativos no CRM — nunca
 *     sobrepostos por uma seguradora, mesmo depois de uma ligação
 *     confirmada. Uma seguradora não sabe como o cliente prefere ser
 *     tratado nem o histórico comercial que o CRM já tem.
 *   - Dados de apólice que só a seguradora conhece com autoridade (estado,
 *     datas, prémio, recibos/pagamentos, identificadores externos,
 *     coberturas, capitais, franquias) tornam-se autoritativos DA
 *     SEGURADORA só DEPOIS de uma ligação confirmada (nunca antes — uma
 *     apólice sem carrier_sync_run/external_policy_identity confirmado
 *     continua inteiramente gerida manualmente, como hoje).
 */

export const reconciliationFieldAuthority = {
  crm: {
    customer: ['preferred_name', 'email', 'phone', 'address'],
    commercial: ['notes', 'tasks', 'opportunities'],
  },
  carrierAfterConfirmedLink: {
    policy: [
      'status',
      'start_date',
      'end_date',
      'renewal_date',
      'annual_premium',
      'receipt_status',
      'payment_status',
      'external_policy_number',
      'external_policy_id',
      'coverages',
      'insured_limits',
      'deductibles',
    ],
  },
} as const

export type ReconciliationFieldAuthority = typeof reconciliationFieldAuthority
export type CrmAuthoritativeCustomerField = (typeof reconciliationFieldAuthority.crm.customer)[number]
export type CrmAuthoritativeCommercialField = (typeof reconciliationFieldAuthority.crm.commercial)[number]
export type CarrierAuthoritativePolicyField =
  (typeof reconciliationFieldAuthority.carrierAfterConfirmedLink.policy)[number]
