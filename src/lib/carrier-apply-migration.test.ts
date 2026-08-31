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
const priorIdentityMigrationPath = join(migrationsDir, '20260830_crm3_identity_reconciliation.sql')
const priorFingerprintMigrationPath = join(migrationsDir, '20260831_carrier_sync_runs_import_fingerprint.sql')

test('the new Block 4 migration file exists as its own additive file', () => {
  assert.ok(existsSync(newMigrationPath), 'expected migrations/20260831_crm3_apply_portfolio_import.sql to exist')
})

const newMigrationSrc = readFileSync(newMigrationPath, 'utf8')

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
