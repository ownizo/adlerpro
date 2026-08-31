/**
 * carrier-policy-owner-options.ts — Reconciliation Editor hardening: pure
 * ordering logic for the manual "existing policy" selector (requirement
 * "the policy selector should show relevant policies for that owner,
 * preferably same provider first").
 *
 * PURO: sem I/O, sem Supabase. Never filters — every one of the owner's
 * policies stays in the list (the security-relevant filtering, "only
 * this owner's policies", happens server-side in
 * src/lib/data.ts listPoliciesForOwner, by querying individual_client_id/
 * company_id directly — this module only reorders an already-scoped
 * list for display).
 */

import { insurerTextMatchesProvider } from './carrier-import-matching.ts'
import type { CarrierProviderId } from './carrier-providers.ts'
import type { PolicyOwnerOptionSummary } from './types.ts'

/** Same-provider policies first, otherwise stable (Array.prototype.sort
 * in Node/V8 is a stable sort) — never drops or hides a policy, just
 * reorders. Reuses the exact same insurer-text-matches-provider rule the
 * reconciliation engine itself uses (carrier-import-matching.ts), so
 * "same provider" can never mean something different here than it does
 * during preview/staging. */
export function sortPolicyOwnerOptionsByProviderPreference(
  options: PolicyOwnerOptionSummary[],
  preferredProvider: CarrierProviderId,
): PolicyOwnerOptionSummary[] {
  return [...options].sort((a, b) => {
    const aMatches = insurerTextMatchesProvider(a.insurer, preferredProvider) ? 0 : 1
    const bMatches = insurerTextMatchesProvider(b.insurer, preferredProvider) ? 0 : 1
    return aMatches - bMatches
  })
}
