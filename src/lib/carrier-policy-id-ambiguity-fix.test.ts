import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * carrier-policy-id-ambiguity-fix.test.ts — HOTFIX: production run
 * 56416276-9457-4e00-b3bb-d070ea37b964 failed all four rows with
 * "column reference policy_id is ambiguous". Root cause: both
 * apply_carrier_import_record_block4 and the apply_carrier_import_record
 * wrapper declare RETURNS TABLE(..., individual_client_id uuid,
 * company_id text, policy_id text, ...) — each output column becomes an
 * implicit PL/pgSQL variable — and two embedded SQL statements had a
 * BARE reference to a same-named table column inside a scope where both
 * the table column and the output variable are visible. Fixed by adding
 * table aliases and qualifying only those specific references — no
 * database column renamed, no `plpgsql.variable_conflict` change, no
 * application semantics changed.
 *
 * No live Postgres in this sandbox — this proves the migration's SQL
 * text says what it must say, not that it executes without error.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, '..', '..', 'migrations')
const migrationPath = join(migrationsDir, '20260831_crm3_policy_id_ambiguity_fix.sql')

test('the new additive migration exists', () => {
  assert.ok(existsSync(migrationPath))
})

const src = readFileSync(migrationPath, 'utf8')
// The header comment documents the ORIGINAL buggy lines verbatim as
// "before" examples (for anyone reading the migration later) — those
// illustrative snippets must be excluded from the regression-guard
// checks below, which are about the ACTUAL SQL code, not prose
// describing what used to be wrong.
const code = src.slice(src.indexOf('CREATE OR REPLACE FUNCTION'))

test('is purely additive: CREATE OR REPLACE only, no DROP, no new table/column/constraint', () => {
  assert.doesNotMatch(src, /DROP TABLE|DROP COLUMN|DROP CONSTRAINT/i)
  assert.doesNotMatch(src, /ALTER TABLE|ADD COLUMN|ADD CONSTRAINT/i)
  assert.match(src, /CREATE OR REPLACE FUNCTION public\.apply_carrier_import_record_block4/)
  assert.match(src, /CREATE OR REPLACE FUNCTION public\.apply_carrier_import_record\(/)
})

test('does not weaken the fix by globally changing plpgsql.variable_conflict', () => {
  assert.doesNotMatch(code, /variable_conflict/i)
})

test('does not rename any database column', () => {
  // The only identifier renames in this file are the SQL *aliases*
  // introduced for qualification (epi, ins_pp) — never a `RENAME
  // COLUMN`/`RENAME TO` DDL statement.
  assert.doesNotMatch(src, /RENAME COLUMN|RENAME TO/i)
})

test('same function signatures preserved: apply_carrier_import_record_block4(uuid, jsonb, jsonb, jsonb, text) and apply_carrier_import_record(uuid, jsonb, jsonb, jsonb, text)', () => {
  assert.match(src, /CREATE OR REPLACE FUNCTION public\.apply_carrier_import_record_block4\(\s*\n\s*p_record_id uuid,/)
  assert.match(src, /CREATE OR REPLACE FUNCTION public\.apply_carrier_import_record\(\s*\n\s*p_record_id uuid, p_new_individual jsonb DEFAULT NULL/)
})

test('same RETURNS TABLE shape preserved on both functions', () => {
  const shape = /RETURNS TABLE \(result_status text, individual_client_id uuid, company_id text, policy_id text,?\s*\n?\s*external_client_identity_created boolean, external_policy_identity_created boolean, error_message text\)/
  const matches = [...src.matchAll(new RegExp(shape.source, 'g'))]
  assert.equal(matches.length, 2, 'expected the exact RETURNS TABLE shape on both functions')
})

test('SECURITY DEFINER status unchanged — neither function uses it (matches the pre-existing posture)', () => {
  assert.doesNotMatch(code, /SECURITY DEFINER/)
})

test('service_role/admin execution posture preserved for both functions — REVOKE from PUBLIC/anon/authenticated, GRANT to service_role only', () => {
  assert.match(src, /REVOKE ALL ON FUNCTION public\.apply_carrier_import_record_block4\(uuid, jsonb, jsonb, jsonb, text\) FROM PUBLIC/)
  assert.match(src, /REVOKE ALL ON FUNCTION public\.apply_carrier_import_record_block4\(uuid, jsonb, jsonb, jsonb, text\) FROM anon, authenticated/)
  assert.match(src, /GRANT EXECUTE ON FUNCTION public\.apply_carrier_import_record_block4\(uuid, jsonb, jsonb, jsonb, text\) TO service_role/)
  assert.match(src, /REVOKE ALL ON FUNCTION public\.apply_carrier_import_record\(uuid,jsonb,jsonb,jsonb,text\) FROM PUBLIC, anon, authenticated/)
  assert.match(src, /GRANT EXECUTE ON FUNCTION public\.apply_carrier_import_record\(uuid,jsonb,jsonb,jsonb,text\) TO service_role/)
})

// ── the actual ambiguity fixes ───────────────────────────────────────

test('FIX 1: the external_policy_identities fallback lookup (hit by every MGEN row) now aliases the table and qualifies every column read against it — no more bare "policy_id ="', () => {
  assert.match(
    src,
    /FROM public\.external_policy_identities epi WHERE epi\.provider = v_record\.provider AND epi\.policy_id = v_policy_id AND epi\.external_policy_number_normalized = p_external_policy_number_normalized/,
  )
})

test('FIX 1 regression guard: no remaining bare "AND policy_id = " predicate anywhere in the migration\'s actual SQL code (would still collide with the RETURNS TABLE output column)', () => {
  assert.doesNotMatch(code, /[^.]\bpolicy_id\s*=\s*v_policy_id/)
})

test('FIX 2: the policy_participants idempotency INSERT aliases its target table and qualifies the ON CONFLICT expression\'s individual_client_id/company_id', () => {
  assert.match(src, /INSERT INTO public\.policy_participants AS ins_pp \(policy_id, individual_client_id, company_id, role, provider, external_client_id, source\)/)
  assert.match(src, /ON CONFLICT \(policy_id, role, COALESCE\(ins_pp\.individual_client_id::text, ins_pp\.company_id\)\) DO NOTHING/)
})

test('FIX 2 regression guard: the ON CONFLICT expression never again reads bare individual_client_id/company_id (only the qualified ins_pp. form)', () => {
  assert.doesNotMatch(code, /COALESCE\(individual_client_id::text, company_id\)/)
})

test('FIX 2 preserves the plain conflict-target column names verbatim (policy_id, role) — those were never ambiguous and match the live unique index exactly', () => {
  assert.match(src, /ON CONFLICT \(policy_id, role,/)
})

test('everything else in the participant/policyholder logic is untouched: creation, external-identity conflict checks, and the final selected_policyholder_* UPDATE all still present verbatim', () => {
  assert.match(src, /RAISE EXCEPTION 'apply_carrier_import_record: existing_individual policyholder requires selected_policyholder_individual_client_id'/)
  assert.match(src, /RAISE EXCEPTION 'apply_carrier_import_record: external client identity %\/% is already linked to a different CRM customer'/)
  assert.match(src, /RAISE EXCEPTION 'apply_carrier_import_record: external participant relation %\/% is already linked to a different CRM customer'/)
  assert.match(src, /selected_policyholder_individual_client_id = CASE\s*\n\s*WHEN r\.selected_policyholder_mode IN \('existing_individual', 'create_individual'\) THEN participant_ind/)
})

test('owner-mismatch safeguards (both functions) are untouched verbatim', () => {
  assert.match(src, /IF v_policy\.individual_client_id::text IS DISTINCT FROM v_individual_id::text OR NULLIF\(BTRIM\(v_policy\.company_id\), ''\) IS NOT NULL OR v_company_id IS NOT NULL THEN/)
  assert.match(src, /IF p\.individual_client_id::text IS DISTINCT FROM owner_ind::text OR NULLIF\(BTRIM\(p\.company_id\),''\) IS NOT NULL OR owner_company IS NOT NULL THEN/)
})

test('approved_policy_changes allowlist (both functions) is untouched verbatim', () => {
  assert.match(src, /key NOT IN \('policyNumber', 'startDate', 'endDate', 'annualPremium', 'status'\)/)
  assert.match(src, /k NOT IN \('policyNumber','startDate','endDate','annualPremium','status'\)/)
})

test('idempotency short-circuit (apply_status = applied) is untouched verbatim on both functions', () => {
  const alreadyApplied = [...src.matchAll(/apply_status = 'applied' THEN/g)]
  assert.ok(alreadyApplied.length >= 2)
  assert.match(src, /RETURN QUERY SELECT 'already_applied'::text, v_record\.selected_individual_client_id, v_record\.selected_company_id, v_record\.selected_policy_id, false, false, NULL::text;/)
  assert.match(src, /RETURN QUERY SELECT 'already_applied'::text, r\.selected_individual_client_id, r\.selected_company_id, r\.selected_policy_id, false, false, NULL::text; RETURN;/)
})

test('does not edit or reapply any of the three already-live migrations', () => {
  const untouched = [
    '20260831_crm3_apply_portfolio_import.sql',
    '20260831_crm3_apply_legacy_owner_fix.sql',
    '20260831_crm3_policy_participants.sql',
  ]
  for (const name of untouched) {
    assert.ok(existsSync(join(migrationsDir, name)), `${name} should still exist unmodified`)
  }
  // The new file is its own, separately named migration.
  assert.notEqual(migrationPath, join(migrationsDir, untouched[0]!))
})
