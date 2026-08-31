import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * carrier-apply-migration.test.ts — CRM3 Block 4: proves the new
 * migration is purely additive (no edits to the two already-live
 * migrations), and that the apply RPC/trigger have the expected shape
 * and security posture, by inspecting the actual SQL text. There is no
 * real Postgres in this sandbox — this proves the SQL says what it must
 * say, not that it executes correctly.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, '..', '..', 'migrations')

const newMigrationPath = join(migrationsDir, '20260831_crm3_apply_portfolio_import.sql')
const legacyOwnerFixMigrationPath = join(migrationsDir, '20260831_crm3_apply_legacy_owner_fix.sql')
const priorIdentityMigrationPath = join(migrationsDir, '20260830_crm3_identity_reconciliation.sql')
const priorFingerprintMigrationPath = join(migrationsDir, '20260831_carrier_sync_runs_import_fingerprint.sql')

test('the new Block 4 migration file exists as its own additive file', () => {
  assert.ok(existsSync(newMigrationPath), 'expected migrations/20260831_crm3_apply_portfolio_import.sql to exist')
  assert.ok(existsSync(legacyOwnerFixMigrationPath), 'expected additive legacy-owner fix migration to exist')
})

const newMigrationSrc = readFileSync(newMigrationPath, 'utf8')
const legacyOwnerFixSrc = readFileSync(legacyOwnerFixMigrationPath, 'utf8')

test('the legacy-owner fix replaces only the RPC and does not alter data or use SECURITY DEFINER', () => {
  assert.match(legacyOwnerFixSrc, /CREATE OR REPLACE FUNCTION public\.apply_carrier_import_record/)
  assert.match(legacyOwnerFixSrc, /NULLIF\(BTRIM\(v_policy\.company_id\), ''\)/)
  assert.doesNotMatch(legacyOwnerFixSrc, /UPDATE public\.policies SET[^;]*company_id/)
  assert.doesNotMatch(legacyOwnerFixSrc, /SECURITY DEFINER/)
  assert.match(legacyOwnerFixSrc, /REVOKE ALL ON FUNCTION public\.apply_carrier_import_record\([^)]*\) FROM PUBLIC/)
  assert.match(legacyOwnerFixSrc, /GRANT EXECUTE ON FUNCTION public\.apply_carrier_import_record\([^)]*\) TO service_role/)
})

test('the legacy-owner fix keeps exact individual ownership and no-owner protection', () => {
  assert.match(legacyOwnerFixSrc, /v_policy\.individual_client_id::text IS DISTINCT FROM v_individual_id::text/)
  assert.match(legacyOwnerFixSrc, /v_policy\.individual_client_id IS NOT NULL OR NULLIF\(BTRIM\(v_policy\.company_id\), ''\) IS NOT NULL/)
})

test('policy participants migration is additive, constrained, RLS-protected, and idempotent', () => {
  const participantSrc = readFileSync(join(migrationsDir, '20260831_crm3_policy_participants.sql'), 'utf8')
  assert.match(participantSrc, /CREATE TABLE IF NOT EXISTS public\.policy_participants/)
  assert.match(participantSrc, /individual_client_id uuid NULL REFERENCES public\.individual_clients\(id\) ON DELETE RESTRICT/)
  assert.match(participantSrc, /company_id text NULL REFERENCES public\.companies\(id\) ON DELETE RESTRICT/)
  assert.match(participantSrc, /policy_participants_owner_xor/)
  assert.match(participantSrc, /role IN \('policyholder'\)/)
  assert.match(participantSrc, /CREATE UNIQUE INDEX IF NOT EXISTS policy_participants_policy_owner_role_uidx/)
  assert.match(participantSrc, /ALTER TABLE public\.policy_participants ENABLE ROW LEVEL SECURITY/)
  assert.match(participantSrc, /CREATE OR REPLACE FUNCTION public\.apply_carrier_import_record/)
  assert.match(participantSrc, /ON CONFLICT DO NOTHING/)
  assert.match(participantSrc, /external client identity .*already linked to a different CRM customer/)
  assert.match(participantSrc, /participant_ind|participant_company/)
  assert.doesNotMatch(participantSrc, /SECURITY DEFINER/)
})

test('the two already-live migrations are untouched — their own defining anchors are still present verbatim', () => {
  const identitySrc = readFileSync(priorIdentityMigrationPath, 'utf8')
  const fingerprintSrc = readFileSync(priorFingerprintMigrationPath, 'utf8')
  assert.match(identitySrc, /CREATE TABLE IF NOT EXISTS public\.carrier_import_records/)
  assert.match(identitySrc, /CONSTRAINT carrier_import_records_matched_owner_check/)
  assert.match(fingerprintSrc, /carrier_sync_runs_import_fingerprint_uidx/)
})

test('the new migration only ALTERs/extends existing tables — never DROP TABLE, never a redefinition of carrier_import_records/carrier_sync_runs from scratch', () => {
  assert.doesNotMatch(newMigrationSrc, /DROP TABLE/i)
  assert.doesNotMatch(newMigrationSrc, /CREATE TABLE (IF NOT EXISTS )?public\.carrier_import_records/i)
  assert.doesNotMatch(newMigrationSrc, /CREATE TABLE (IF NOT EXISTS )?public\.carrier_sync_runs/i)
  assert.match(newMigrationSrc, /ALTER TABLE public\.carrier_import_records/)
  assert.match(newMigrationSrc, /ALTER TABLE public\.carrier_sync_runs/)
})

test('carrier_import_records gets exactly the expected new apply columns', () => {
  for (const column of [
    'customer_apply_action',
    'policy_apply_action',
    'selected_individual_client_id',
    'selected_company_id',
    'selected_policy_id',
    'approved_policy_changes',
    'apply_status',
    'apply_error',
    'applied_at',
  ]) {
    assert.match(newMigrationSrc, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`), `missing column ${column}`)
  }
})

test('carrier_sync_runs gets exactly the expected new run-level apply columns', () => {
  for (const column of ['apply_status', 'apply_started_at', 'applied_at', 'applied_by']) {
    assert.match(newMigrationSrc, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`), `missing column ${column}`)
  }
})

test('customer_apply_action / policy_apply_action / apply_status enums are enforced with named CHECK constraints', () => {
  assert.match(newMigrationSrc, /carrier_import_records_customer_apply_action_check/)
  assert.match(newMigrationSrc, /'link_existing_individual', 'link_existing_company',\s*\n\s*'create_individual', 'create_company', 'no_customer_change'/)
  assert.match(newMigrationSrc, /carrier_import_records_policy_apply_action_check/)
  assert.match(newMigrationSrc, /'link_existing_policy', 'create_policy', 'update_existing_policy', 'no_policy_change'/)
  assert.match(newMigrationSrc, /carrier_import_records_apply_status_check/)
  assert.match(newMigrationSrc, /carrier_sync_runs_apply_status_check/)
})

test('a trigger blocks deleting a carrier_sync_runs row once any of its records has apply_status = applied', () => {
  assert.match(newMigrationSrc, /CREATE TRIGGER carrier_sync_runs_block_delete_if_applied/)
  assert.match(newMigrationSrc, /BEFORE DELETE ON public\.carrier_sync_runs/)
  assert.match(newMigrationSrc, /apply_status = 'applied'/)
})

test('apply_carrier_import_record RPC exists, is atomic (plpgsql, one function body), and is NOT SECURITY DEFINER', () => {
  assert.match(newMigrationSrc, /CREATE OR REPLACE FUNCTION public\.apply_carrier_import_record/)
  assert.match(newMigrationSrc, /LANGUAGE plpgsql/)
  assert.doesNotMatch(newMigrationSrc, /apply_carrier_import_record[\s\S]{0,600}SECURITY DEFINER/)
})

test('apply_carrier_import_record is granted to service_role only — never anon/authenticated/PUBLIC', () => {
  assert.match(newMigrationSrc, /REVOKE ALL ON FUNCTION public\.apply_carrier_import_record\([^)]*\) FROM PUBLIC/)
  assert.match(newMigrationSrc, /REVOKE ALL ON FUNCTION public\.apply_carrier_import_record\([^)]*\) FROM anon, authenticated/)
  assert.match(newMigrationSrc, /GRANT EXECUTE ON FUNCTION public\.apply_carrier_import_record\([^)]*\) TO service_role/)
})

test('apply_carrier_import_record locks the record row before reading its apply status — the idempotency/race-safety guarantee', () => {
  assert.match(newMigrationSrc, /FOR UPDATE;\s*\n\s*IF NOT FOUND THEN\s*\n\s*RAISE EXCEPTION 'apply_carrier_import_record: carrier_import_record/)
})

test('apply_carrier_import_record returns already_applied without mutating anything when apply_status is already applied', () => {
  const idx = newMigrationSrc.indexOf("IF v_record.apply_status = 'applied' THEN")
  assert.ok(idx !== -1)
  const nextIdx = newMigrationSrc.indexOf('RETURN;', idx)
  const block = newMigrationSrc.slice(idx, nextIdx)
  assert.match(block, /'already_applied'/)
  assert.doesNotMatch(block, /INSERT INTO|UPDATE public\./)
})

test('apply_carrier_import_record refuses a record that is not accepted', () => {
  assert.match(newMigrationSrc, /IF v_record\.decision_status <> 'accepted' THEN\s*\n\s*RAISE EXCEPTION/)
})

test('apply_carrier_import_record refuses a record missing an explicit apply action', () => {
  assert.match(newMigrationSrc, /IF v_record\.customer_apply_action IS NULL OR v_record\.policy_apply_action IS NULL THEN\s*\n\s*RAISE EXCEPTION/)
})

test('owner-consistency check blocks linking/updating an existing policy whose owner does not match the resolved customer', () => {
  assert.match(newMigrationSrc, /owner mismatch/)
  assert.match(newMigrationSrc, /v_policy\.individual_client_id::text = v_individual_id::text/)
  assert.match(newMigrationSrc, /v_policy\.company_id = v_company_id/)
})

test('update_existing_policy requires a non-empty approved_policy_changes, and only approved fields are ever written', () => {
  assert.match(newMigrationSrc, /update_existing_policy requires approved_policy_changes/)
  assert.match(newMigrationSrc, /COALESCE\(NULLIF\(v_record\.approved_policy_changes->>'policyNumber', ''\), policy_number\)/)
})

test('create_policy defaults insuredValue to 0 and type to health, and requires insurer/policyNumber/startDate/endDate', () => {
  assert.match(newMigrationSrc, /create_policy is missing a required field/)
  assert.match(newMigrationSrc, /COALESCE\(NULLIF\(p_new_policy->>'type', ''\), 'health'\)/)
  assert.match(newMigrationSrc, /COALESCE\(\(p_new_policy->>'insuredValue'\)::numeric, 0\)/)
})

test('create_individual requires a full name; create_company requires a name AND a NIF', () => {
  assert.match(newMigrationSrc, /create_individual requires a full name/)
  assert.match(newMigrationSrc, /create_company requires a name/)
  assert.match(newMigrationSrc, /create_company requires a NIF/)
})

test('external client identity conflict (different owner already linked) rolls back the whole row', () => {
  assert.match(newMigrationSrc, /already linked to a different CRM customer/)
})

test('external policy identity conflict (different policy already linked) rolls back the whole row', () => {
  assert.match(newMigrationSrc, /already linked to a different CRM policy/)
})

test('the external policy number normalization is precomputed by the caller (p_external_policy_number_normalized), never reimplemented in SQL', () => {
  assert.match(newMigrationSrc, /p_external_policy_number_normalized text DEFAULT NULL/)
  assert.doesNotMatch(newMigrationSrc, /regexp_replace\(v_record\.external_policy_number/)
})

test('the migration never adds an nib/iban column or writes one in an INSERT column list — only mentions the words while documenting that they are deliberately excluded', () => {
  assert.doesNotMatch(newMigrationSrc, /ADD COLUMN IF NOT EXISTS (nib|iban)\b/i)
  assert.doesNotMatch(newMigrationSrc, /INSERT INTO[\s\S]{0,300}\b(nib|iban)\b/i)
})

// ── BLOCKER 1 FIX — policy owner NULL semantics (not '' sentinel) ────

test('BLOCKER FIX: the migration no longer uses COALESCE(v_company_id, \'\') anywhere', () => {
  assert.doesNotMatch(newMigrationSrc, /COALESCE\(v_company_id,\s*''\)/)
})

test('BLOCKER FIX: create_policy inserts the bare v_company_id (NULL when individual-owned) as the company_id value, not an empty-string sentinel', () => {
  const idx = newMigrationSrc.indexOf("WHEN 'create_policy' THEN")
  assert.ok(idx !== -1)
  const insertIdx = newMigrationSrc.indexOf('INSERT INTO public.policies', idx)
  const valuesIdx = newMigrationSrc.indexOf('VALUES (', insertIdx)
  const afterValues = newMigrationSrc.slice(valuesIdx, valuesIdx + 1200)
  // The VALUES list must supply v_policy_id, then (after the
  // explanatory comment) v_company_id bare — possibly NULL — then
  // v_individual_id — never wrapped in a COALESCE(..., '') that would
  // turn a NULL company into ''.
  assert.match(afterValues, /v_policy_id,[\s\S]*?\n\s*v_company_id,\s*\n\s*v_individual_id,/)
  assert.doesNotMatch(afterValues, /COALESCE\(v_company_id/)
})

test('BLOCKER FIX: the policies.company_id foreign-key / NULL-semantics rationale is documented at the insert site', () => {
  assert.match(newMigrationSrc, /policies\.company_id is a foreign key to companies\(id\)/)
  assert.match(newMigrationSrc, /individual-owned policy MUST store NULL here, never ''/)
})

test('OWNER XOR PRESERVED: v_individual_id and v_company_id remain mutually exclusive going into the policies INSERT — create_policy still refuses when neither is resolved', () => {
  assert.match(newMigrationSrc, /IF v_individual_id IS NULL AND v_company_id IS NULL THEN\s*\n\s*RAISE EXCEPTION 'apply_carrier_import_record: create_policy requires a resolved customer'/)
})

// ── HARDENING 2 FIX — collision-resistant generated ids ──────────────

test('HARDENING FIX: new company/policy ids use gen_random_uuid(), never epoch-millis, for newly created Block 4 rows', () => {
  assert.match(newMigrationSrc, /v_company_id := 'comp_' \|\| replace\(gen_random_uuid\(\)::text, '-', ''\);/)
  assert.match(newMigrationSrc, /v_policy_id := 'pol_' \|\| replace\(gen_random_uuid\(\)::text, '-', ''\);/)
  assert.doesNotMatch(newMigrationSrc, /floor\(extract\(epoch FROM clock_timestamp\(\)\)/)
})

test('HARDENING FIX: the existing comp_/pol_ text-id PREFIX convention is preserved — only the suffix generation changed', () => {
  assert.match(newMigrationSrc, /'comp_' \|\|/)
  assert.match(newMigrationSrc, /'pol_' \|\|/)
})

// ── HARDENING 3 FIX — approved_policy_changes key allowlist (SQL side) ─

test('HARDENING FIX: apply_carrier_import_record rejects any approved_policy_changes key outside the allowlist', () => {
  assert.match(newMigrationSrc, /jsonb_object_keys\(v_record\.approved_policy_changes\)/)
  assert.match(newMigrationSrc, /WHERE key NOT IN \('policyNumber', 'startDate', 'endDate', 'annualPremium', 'status'\)/)
  assert.match(newMigrationSrc, /approved_policy_changes contains an unsupported key/)
})

test('HARDENING FIX: the SQL-side key check runs before the UPDATE that applies the changes', () => {
  const checkIdx = newMigrationSrc.indexOf('approved_policy_changes contains an unsupported key')
  const updateIdx = newMigrationSrc.indexOf('UPDATE public.policies SET')
  assert.ok(checkIdx !== -1 && updateIdx !== -1)
  assert.ok(checkIdx < updateIdx)
})
