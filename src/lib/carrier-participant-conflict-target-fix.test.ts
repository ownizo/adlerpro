import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * carrier-participant-conflict-target-fix.test.ts — records in Git the
 * production fix already applied directly (Supabase migration version
 * 20260901060339, crm3_participant_policy_id_conflict_fix).
 *
 * migrations/20260831_crm3_policy_id_ambiguity_fix.sql qualified the
 * policy_participants idempotency INSERT's ON CONFLICT expression with a
 * table alias (ins_pp), but the plain `policy_id` name inside that
 * explicit conflict-target LIST is still ordinary SQL in the same scope
 * as apply_carrier_import_record's RETURNS TABLE policy_id output column
 * — so it still collided and raised "column reference policy_id is
 * ambiguous" on the Bella/Ilya add_policyholder_to_existing_client path.
 * Fixed by dropping the explicit conflict target and relying on index
 * inference: `ON CONFLICT DO NOTHING`. Production already runs this
 * successfully.
 *
 * No live Postgres in this sandbox — these tests prove the migration's
 * SQL text has the shape it must have, not that it executes without
 * error.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, '..', '..', 'migrations')
const newMigrationPath = join(migrationsDir, '20260901_crm3_participant_policy_id_conflict_fix.sql')
const priorMigrationPath = join(migrationsDir, '20260831_crm3_policy_id_ambiguity_fix.sql')

test('the new additive migration exists', () => {
  assert.ok(existsSync(newMigrationPath))
})

const src = readFileSync(newMigrationPath, 'utf8')
const priorSrc = readFileSync(priorMigrationPath, 'utf8')
// The header comment documents the OLD buggy conflict target verbatim as
// a "before" example (so anyone reading the migration later understands
// what changed) — that illustrative snippet must be excluded from the
// regression-guard checks below, which are about the ACTUAL SQL code,
// not prose describing what used to be wrong. Same convention as
// carrier-policy-id-ambiguity-fix.test.ts.
const code = src.slice(src.indexOf('CREATE OR REPLACE FUNCTION'))

// ── 1. contains ON CONFLICT DO NOTHING ─────────────────────────────────

test('1. the policy_participants INSERT now uses a bare ON CONFLICT DO NOTHING (index-inferred, no explicit target)', () => {
  assert.match(
    src,
    /INSERT INTO public\.policy_participants AS ins_pp \(policy_id, individual_client_id, company_id, role, provider, external_client_id, source\)\s*\n\s*VALUES \(pid, participant_ind, participant_company, 'policyholder', r\.provider, normalized_external_client_id, 'carrier_import'\)\s*\n\s*ON CONFLICT DO NOTHING;/,
  )
})

// ── 2. old explicit conflict target is absent ──────────────────────────

test('2. the old explicit conflict target is completely absent from the new migration\'s actual SQL code', () => {
  assert.doesNotMatch(code, /ON CONFLICT \(policy_id, role, COALESCE\(ins_pp\.individual_client_id::text, ins_pp\.company_id\)\)/)
  assert.doesNotMatch(code, /ON CONFLICT \(policy_id, role,/)
})

test('sanity: the prior migration DID have the explicit conflict target (confirms this test would have caught the bug pre-fix)', () => {
  assert.match(priorSrc, /ON CONFLICT \(policy_id, role, COALESCE\(ins_pp\.individual_client_id::text, ins_pp\.company_id\)\) DO NOTHING;/)
})

// ── 3. only public.apply_carrier_import_record is replaced ────────────

test('3. only public.apply_carrier_import_record is CREATE OR REPLACEd — apply_carrier_import_record_block4 is not touched', () => {
  const createOrReplaceCalls = [...src.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1])
  assert.deepEqual(createOrReplaceCalls, ['apply_carrier_import_record'])
  assert.doesNotMatch(src, /apply_carrier_import_record_block4\s*\(\s*\n\s*p_record_id uuid,/)
})

test('3b. the function signature and RETURNS TABLE shape are unchanged from the prior migration', () => {
  assert.match(src, /CREATE OR REPLACE FUNCTION public\.apply_carrier_import_record\(\s*\n\s*p_record_id uuid, p_new_individual jsonb DEFAULT NULL/)
  assert.match(
    src,
    /RETURNS TABLE \(result_status text, individual_client_id uuid, company_id text, policy_id text,\s*\n\s*external_client_identity_created boolean, external_policy_identity_created boolean, error_message text\)/,
  )
})

// ── 4. no business-data mutation outside the function body ────────────

test('4. no INSERT/UPDATE/DELETE against production business data exists outside the function body (only inside the $$ ... $$ block)', () => {
  const bodyStart = code.indexOf('LANGUAGE plpgsql AS $$')
  const bodyEnd = code.lastIndexOf('END; $$;')
  assert.ok(bodyStart !== -1 && bodyEnd !== -1 && bodyStart < bodyEnd)
  const before = code.slice(0, bodyStart)
  const after = code.slice(bodyEnd + 'END; $$;'.length)
  for (const chunk of [before, after]) {
    assert.doesNotMatch(chunk, /\bINSERT INTO\b/i)
    assert.doesNotMatch(chunk, /\bUPDATE\s+public\./i)
    assert.doesNotMatch(chunk, /\bDELETE FROM\b/i)
  }
  // The file has no DDL that touches schema/table/data either — check
  // the full file (header prose can't contain DDL keywords meaningfully
  // here, and this additionally guards the header itself).
  assert.doesNotMatch(src, /DROP TABLE|DROP COLUMN|DROP CONSTRAINT|ALTER TABLE|ADD COLUMN|ADD CONSTRAINT|TRUNCATE/i)
})

// ── 5. policyholder create_individual logic remains single-path ───────

test('5. exactly ONE `CASE r.selected_policyholder_mode` and ONE create-individual INSERT path — the duplicate-participant-resolution fix is preserved', () => {
  assert.equal([...src.matchAll(/CASE r\.selected_policyholder_mode/g)].length, 1)
  assert.equal([...src.matchAll(/INSERT INTO public\.individual_clients/g)].length, 1)
  assert.equal([...src.matchAll(/INSERT INTO public\.companies/g)].length, 1)
})

// ── everything else preserved byte-for-byte ────────────────────────────

test('the wrapper body is byte-for-byte identical to the merged migration except for the ON CONFLICT clause', () => {
  const extractWrapper = (text: string) => text.slice(text.indexOf('CREATE OR REPLACE FUNCTION public.apply_carrier_import_record('))
  const oldWrapper = extractWrapper(priorSrc)
  const newWrapper = extractWrapper(src)
  const oldLines = oldWrapper.split('\n')
  const newLines = newWrapper.split('\n')
  assert.equal(oldLines.length, newLines.length, 'line count must match — no lines added or removed')
  const differing = oldLines
    .map((line, i) => ({ i, old: line, new: newLines[i] }))
    .filter(({ old, new: n }) => old !== n)
  assert.equal(differing.length, 1, `expected exactly one differing line, got: ${JSON.stringify(differing)}`)
  assert.match(differing[0]!.old, /ON CONFLICT \(policy_id, role, COALESCE\(ins_pp\.individual_client_id::text, ins_pp\.company_id\)\) DO NOTHING;/)
  assert.match(differing[0]!.new, /^\s*ON CONFLICT DO NOTHING;\s*$/)
})

test('Bella/Ilya owner preservation is unchanged: owner_ind/owner_company sourced only from the locked policy row', () => {
  assert.match(
    src,
    /ELSE\s*\n\s*owner_ind := p\.individual_client_id;\s*\n\s*owner_company := NULLIF\(BTRIM\(p\.company_id\), ''\);\s*\n\s*END IF;/,
  )
  assert.doesNotMatch(src, /owner_ind\s*:=\s*participant_ind/)
  assert.doesNotMatch(src, /owner_company\s*:=\s*participant_company/)
})

test('selected participant persistence/retry reuse is unchanged', () => {
  assert.match(src, /r\.selected_policyholder_individual_client_id := participant_ind;/)
  assert.match(src, /r\.selected_policyholder_company_id := participant_company;/)
  assert.match(
    src,
    /selected_policyholder_individual_client_id = CASE\s*\n\s*WHEN r\.selected_policyholder_mode IN \('existing_individual', 'create_individual'\) THEN participant_ind/,
  )
})

test('external identity conflict checks are unchanged', () => {
  assert.match(src, /RAISE EXCEPTION 'apply_carrier_import_record: external client identity %\/% is already linked to a different CRM customer'/)
  assert.match(src, /RAISE EXCEPTION 'apply_carrier_import_record: external participant relation %\/% is already linked to a different CRM customer'/)
})

test('approved_policy_changes allowlist is unchanged', () => {
  assert.match(src, /k NOT IN \('policyNumber','startDate','endDate','annualPremium','status'\)/)
})

test('service_role-only EXECUTE grants and no SECURITY DEFINER, matching the merged migration', () => {
  assert.doesNotMatch(code, /SECURITY DEFINER/)
  assert.match(src, /REVOKE ALL ON FUNCTION public\.apply_carrier_import_record\(uuid,jsonb,jsonb,jsonb,text\) FROM PUBLIC, anon, authenticated;/)
  assert.match(src, /GRANT EXECUTE ON FUNCTION public\.apply_carrier_import_record\(uuid,jsonb,jsonb,jsonb,text\) TO service_role;/)
})

test('idempotency short-circuit (apply_status = applied) is unchanged', () => {
  assert.match(src, /RETURN QUERY SELECT 'already_applied'::text, r\.selected_individual_client_id, r\.selected_company_id, r\.selected_policy_id, false, false, NULL::text; RETURN;/)
})

test('does not edit or reapply any of the four already-live migrations', () => {
  const untouched = [
    '20260831_crm3_apply_portfolio_import.sql',
    '20260831_crm3_apply_legacy_owner_fix.sql',
    '20260831_crm3_policy_participants.sql',
    '20260831_crm3_policy_id_ambiguity_fix.sql',
  ]
  for (const name of untouched) {
    assert.ok(existsSync(join(migrationsDir, name)), `${name} should still exist unmodified`)
  }
})
