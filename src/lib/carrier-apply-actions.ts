/**
 * carrier-apply-actions.ts — CRM3 Block 4 (Confirm & Apply Portfolio
 * Import): pure logic for the explicit, resolved apply actions an Admin
 * must attach to an accepted carrier_import_record before it may ever
 * mutate the CRM.
 *
 * PURO: sem I/O, sem Supabase. "Accepted" (decisionStatus) never implies
 * an apply action by itself — see isRowReadyToApply, which is the single
 * source of truth for "this row has enough explicit information to be
 * applied", reused identically by the server function that rejects an
 * apply run with unresolved rows and by the UI's readiness summary, so
 * the two can never disagree.
 */

import type { CarrierDecisionStatus, CustomerApplyAction, PolicyApplyAction } from './types.ts'

export type { CustomerApplyAction, PolicyApplyAction }

export const CUSTOMER_APPLY_ACTIONS: readonly CustomerApplyAction[] = [
  'link_existing_individual',
  'link_existing_company',
  'create_individual',
  'create_company',
  'no_customer_change',
]

export const POLICY_APPLY_ACTIONS: readonly PolicyApplyAction[] = [
  'link_existing_policy',
  'create_policy',
  'update_existing_policy',
  'no_policy_change',
]

export function isValidCustomerApplyAction(value: unknown): value is CustomerApplyAction {
  return typeof value === 'string' && (CUSTOMER_APPLY_ACTIONS as readonly string[]).includes(value)
}

export function isValidPolicyApplyAction(value: unknown): value is PolicyApplyAction {
  return typeof value === 'string' && (POLICY_APPLY_ACTIONS as readonly string[]).includes(value)
}

/** Shape carried by both the "resolve apply action" validation path and
 * the run-readiness summary — deliberately just the fields needed to
 * decide readiness, not a full CarrierImportRecord. */
export interface ApplyActionRowState {
  decisionStatus: CarrierDecisionStatus
  customerApplyAction: CustomerApplyAction | null
  policyApplyAction: PolicyApplyAction | null
  selectedIndividualClientId: string | null
  selectedCompanyId: string | null
  selectedPolicyId: string | null
  approvedPolicyChanges: Record<string, unknown> | null
}

/** True only when a row has BOTH an explicit customer action and an
 * explicit policy action, AND each action's own required selection is
 * present. A row without this MUST NOT be applied — see requirement
 * "A row without sufficient explicit resolved actions MUST NOT be
 * applied." This function is the only place that decides that. */
export function isRowReadyToApply(state: ApplyActionRowState): boolean {
  if (state.decisionStatus !== 'accepted') return false
  if (!state.customerApplyAction || !state.policyApplyAction) return false

  switch (state.customerApplyAction) {
    case 'link_existing_individual':
      if (!state.selectedIndividualClientId) return false
      break
    case 'link_existing_company':
      if (!state.selectedCompanyId) return false
      break
    case 'create_individual':
    case 'create_company':
    case 'no_customer_change':
      break
  }

  switch (state.policyApplyAction) {
    case 'link_existing_policy':
      if (!state.selectedPolicyId) return false
      break
    case 'update_existing_policy':
      if (!state.selectedPolicyId) return false
      if (!state.approvedPolicyChanges || Object.keys(state.approvedPolicyChanges).length === 0) return false
      break
    case 'create_policy':
    case 'no_policy_change':
      break
  }

  return true
}

/** Only rows accepted AND fully resolved may ever be applied — rejected/
 * ignored/pending rows are excluded regardless of any actions that might
 * be stored on them. */
export function isRowApplicable(state: ApplyActionRowState): boolean {
  return state.decisionStatus === 'accepted' && isRowReadyToApply(state)
}

/** Owner-consistency gate: once a policy is linked/updated, both owner
 * dimensions must agree with the resolved customer. Blank legacy company
 * ids are equivalent to NULL for this comparison only. */
export function checkOwnerConsistency(params: {
  policyApplyAction: PolicyApplyAction
  selectedIndividualClientId: string | null
  selectedCompanyId: string | null
  policyOwnerIndividualClientId?: string | null
  policyOwnerCompanyId?: string | null
}): { consistent: boolean; reason?: string } {
  const linksExistingPolicy = params.policyApplyAction === 'link_existing_policy' || params.policyApplyAction === 'update_existing_policy'
  if (!linksExistingPolicy) return { consistent: true }

  const selectedIndividualId = params.selectedIndividualClientId?.trim() || null
  const selectedCompanyId = params.selectedCompanyId?.trim() || null
  const policyOwnerIndividualId = params.policyOwnerIndividualClientId?.trim() || null
  const policyOwnerCompanyId = params.policyOwnerCompanyId?.trim() || null

  const matches = selectedIndividualId
    ? policyOwnerIndividualId === selectedIndividualId && policyOwnerCompanyId === null && selectedCompanyId === null
    : selectedCompanyId
      ? policyOwnerCompanyId === selectedCompanyId && policyOwnerIndividualId === null
      : policyOwnerIndividualId === null && policyOwnerCompanyId === null

  return matches
    ? { consistent: true }
    : { consistent: false, reason: 'The selected policy belongs to a different CRM customer than the one selected for this row.' }
}

export interface RunApplyReadiness {
  acceptedCount: number
  readyCount: number
  unresolvedCount: number
  willLinkCustomers: number
  willCreateIndividuals: number
  willCreateCompanies: number
  willLinkPolicies: number
  willCreatePolicies: number
  willUpdatePolicies: number
  canApply: boolean
}

/** Drives the "Ready to apply / X accepted records" summary and the
 * "N accepted records still need an apply action" block message — the
 * exact same computation the server function uses to decide whether to
 * reject an apply run, so the UI's summary can never promise something
 * the server will then refuse. */
export function computeRunApplyReadiness(rows: ApplyActionRowState[]): RunApplyReadiness {
  const accepted = rows.filter((r) => r.decisionStatus === 'accepted')
  const ready = accepted.filter(isRowReadyToApply)
  const unresolved = accepted.length - ready.length

  let willLinkCustomers = 0
  let willCreateIndividuals = 0
  let willCreateCompanies = 0
  let willLinkPolicies = 0
  let willCreatePolicies = 0
  let willUpdatePolicies = 0

  for (const row of ready) {
    if (row.customerApplyAction === 'link_existing_individual' || row.customerApplyAction === 'link_existing_company') willLinkCustomers++
    if (row.customerApplyAction === 'create_individual') willCreateIndividuals++
    if (row.customerApplyAction === 'create_company') willCreateCompanies++
    if (row.policyApplyAction === 'link_existing_policy') willLinkPolicies++
    if (row.policyApplyAction === 'create_policy') willCreatePolicies++
    if (row.policyApplyAction === 'update_existing_policy') willUpdatePolicies++
  }

  return {
    acceptedCount: accepted.length,
    readyCount: ready.length,
    unresolvedCount: unresolved,
    willLinkCustomers,
    willCreateIndividuals,
    willCreateCompanies,
    willLinkPolicies,
    willCreatePolicies,
    willUpdatePolicies,
    canApply: accepted.length > 0 && unresolved === 0,
  }
}

export type RowApplyResultStatus = 'applied' | 'already_applied' | 'skipped' | 'failed'

const ROW_APPLY_RESULT_LABELS: Record<RowApplyResultStatus, string> = {
  applied: 'Applied',
  already_applied: 'Already applied',
  skipped: 'Skipped',
  failed: 'Failed',
}

export function describeRowApplyResult(status: RowApplyResultStatus): string {
  return ROW_APPLY_RESULT_LABELS[status]
}
