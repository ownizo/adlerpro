/**
 * carrier-apply-field-mapping.ts — CRM3 Block 4: maps an already-mapped
 * ParsedImportRow (see carrier-import-mappers.ts) into the field shapes
 * needed to create a NEW individual_clients / companies / policies row,
 * plus the diff logic that turns a matched policy candidate + a parsed
 * row into individually-approvable field proposals.
 *
 * PURO: sem I/O, sem Supabase. Never invents a Policy/IndividualClient/
 * Company field that doesn't already exist on those TS types (see
 * src/lib/types.ts) — every field written here maps 1:1 to an existing
 * interface field. If a required field cannot be safely derived, the
 * row is not applied — see the `ok: false` branches below, which the
 * caller must treat as "surface a validation error, do not apply this
 * row" (never a silent partial create).
 *
 * carrier_import_records.raw_payload stores the sanitized-but-still-
 * provider-header-keyed row (tomador/nif/morada/...), not a persisted
 * ParsedImportRow — apply-time code re-derives the semantic
 * ParsedImportRow by re-running mapPortfolioRows(provider,
 * [record.rawPayload]) against that already-normalized, already-
 * sanitized payload (normalizeHeaderName is idempotent, so
 * re-normalizing already-normalized keys is safe and lossless). See
 * src/lib/data.ts applyCarrierImportRecord for that re-derivation step;
 * this module only consumes the resulting ParsedImportRow.
 */

import type { ParsedImportRow } from './carrier-import-parsing.ts'
import type { CarrierPolicyCandidateSummary } from './types.ts'

export interface NewIndividualFields {
  fullName: string
  nif?: string
  email?: string
  phone?: string
  address?: string
}

export interface NewCompanyFields {
  name: string
  nif: string
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  address?: string
}

export interface NewPolicyFields {
  insurer: string
  policyNumber: string
  startDate: string
  endDate: string
  annualPremium: number
  insuredValue: number
  type: string
  description: string
}

export type FieldMappingResult<T> = { ok: true; fields: T } | { ok: false; error: string }

/** Individual creation requires a full name — the only field the
 * existing creation contract (createIndividualClient) treats as
 * non-optional beyond what the DB itself defaults. */
export function mapParsedRowToNewIndividualFields(row: ParsedImportRow): FieldMappingResult<NewIndividualFields> {
  const fullName = row.customerName?.trim()
  if (!fullName) return { ok: false, error: 'Cannot create a new individual client: the imported row has no customer name.' }
  return {
    ok: true,
    fields: { fullName, nif: row.taxIdRaw, email: row.email, phone: row.phone, address: row.address },
  }
}

/** Company creation requires a name and a NIF, matching the existing
 * creation contract's own requirements (companies.nif NOT NULL). */
export function mapParsedRowToNewCompanyFields(row: ParsedImportRow): FieldMappingResult<NewCompanyFields> {
  const name = row.customerName?.trim()
  const nif = row.taxIdRaw?.trim()
  if (!name) return { ok: false, error: 'Cannot create a new company: the imported row has no company name.' }
  if (!nif) return { ok: false, error: 'Cannot create a new company: the imported row has no NIF.' }
  return {
    ok: true,
    fields: { name, nif, contactName: name, contactEmail: row.email, contactPhone: row.phone, address: row.address },
  }
}

/** New-policy field mapping for a health-insurance portfolio feed
 * (MGEN). insuredValue has no source column in this kind of feed at
 * all — defaulting it to 0 (rather than blocking every row on a field
 * that structurally doesn't exist here) is a deliberate, documented
 * choice; type is hardcoded to 'health' for MGEN, matching the task's
 * explicit instruction that MGEN's portfolio is a health portfolio. */
export function mapParsedRowToNewPolicyFields(row: ParsedImportRow, insurer: string): FieldMappingResult<NewPolicyFields> {
  const policyNumber = row.externalPolicyNumber?.trim()
  const startDate = row.startDate?.trim()
  const endDate = row.endDate?.trim()
  if (!policyNumber) return { ok: false, error: 'Cannot create a new policy: the imported row has no policy number.' }
  if (!startDate) return { ok: false, error: 'Cannot create a new policy: the imported row has no start date.' }
  if (!endDate) return { ok: false, error: 'Cannot create a new policy: the imported row has no end date.' }
  return {
    ok: true,
    fields: {
      insurer,
      policyNumber,
      startDate,
      endDate,
      annualPremium: row.premium ?? 0,
      insuredValue: 0,
      type: 'health',
      description: row.productDescription ?? '',
    },
  }
}

export type PolicyProposalField = 'policyNumber' | 'startDate' | 'endDate' | 'annualPremium'

export interface PolicyFieldProposal {
  field: PolicyProposalField
  current: string | number | undefined
  proposed: string | number
}

/** Field-by-field diff between the matched CRM policy and the imported
 * row's values — never a blanket "overwrite because matched". Only
 * fields where the imported value differs from (or fills in a gap in)
 * the CRM value are proposed; each one needs its own explicit Admin
 * approval before apply_carrier_import_record will ever write it (see
 * update_existing_policy in the migration). This is exactly the tool
 * that lets policy 75849's proposal-number scenario surface a single,
 * individually-approvable policyNumber change instead of silently
 * overwriting it. */
export function computePolicyFieldProposals(
  candidate: CarrierPolicyCandidateSummary | undefined,
  row: ParsedImportRow,
): PolicyFieldProposal[] {
  if (!candidate) return []
  const proposals: PolicyFieldProposal[] = []

  if (row.externalPolicyNumber && row.externalPolicyNumber !== candidate.policyNumber) {
    proposals.push({ field: 'policyNumber', current: candidate.policyNumber, proposed: row.externalPolicyNumber })
  }
  if (row.startDate && row.startDate !== candidate.startDate) {
    proposals.push({ field: 'startDate', current: candidate.startDate, proposed: row.startDate })
  }
  if (row.endDate && row.endDate !== candidate.endDate) {
    proposals.push({ field: 'endDate', current: candidate.endDate, proposed: row.endDate })
  }
  if (row.premium != null && row.premium !== candidate.annualPremium) {
    proposals.push({ field: 'annualPremium', current: candidate.annualPremium, proposed: row.premium })
  }

  return proposals
}

/** Turns a set of proposals + the Admin's explicitly-approved field
 * names into the exact jsonb shape apply_carrier_import_record expects
 * for approved_policy_changes — only approved keys are ever included. */
export function buildApprovedPolicyChanges(
  proposals: PolicyFieldProposal[],
  approvedFields: ReadonlySet<PolicyProposalField>,
): Record<string, string | number> {
  const changes: Record<string, string | number> = {}
  for (const proposal of proposals) {
    if (approvedFields.has(proposal.field)) changes[proposal.field] = proposal.proposed
  }
  return changes
}

/** The ONLY keys approved_policy_changes may ever carry for Block 4 —
 * broader than PolicyProposalField (which only covers what the UI's own
 * diff can propose) because 'status' is an allowed approved-change field
 * even though nothing here currently proposes it. Enforced twice: here
 * in TypeScript (setCarrierImportRecordApplyActions rejects an unknown
 * key before ever persisting it) and again, independently, inside
 * apply_carrier_import_record on the SQL side (re-checks the value it
 * reads off the locked row — never trusts that the TypeScript check was
 * the only gate). Unknown keys are always rejected outright, never
 * silently dropped. */
export const APPROVED_POLICY_CHANGE_KEYS = ['policyNumber', 'startDate', 'endDate', 'annualPremium', 'status'] as const

export type ApprovedPolicyChangeKey = (typeof APPROVED_POLICY_CHANGE_KEYS)[number]

/** Returns every key in `changes` that isn't in the allowlist — empty
 * when every key is allowed. Deliberately returns the offending keys
 * (not just a boolean) so a caller can build a specific, actionable
 * error message. */
export function findInvalidApprovedPolicyChangeKeys(changes: Record<string, unknown>): string[] {
  return Object.keys(changes).filter((key) => !(APPROVED_POLICY_CHANGE_KEYS as readonly string[]).includes(key))
}
