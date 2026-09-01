import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * carrier-duplicate-participant-fix.test.ts — pre-existing bug found
 * while preparing the policy_id-ambiguity hotfix (migrations/
 * 20260831_crm3_policy_id_ambiguity_fix.sql): the
 * add_policyholder_to_existing_client path in the apply_carrier_import_record
 * wrapper contained TWO `CASE r.selected_policyholder_mode` resolution
 * blocks. The first ran before policy resolution and, for
 * create_individual/create_company, unconditionally INSERTed a brand new
 * individual_clients/companies row — whose id (participant_ind/
 * participant_company) was then thrown away and re-resolved from scratch
 * by the second, canonical block (existing-selection reuse, external
 * identity reuse, create-only-if-still-unresolved, retry persistence,
 * policy_participants insertion, external identity linking). Every
 * create_individual/create_company apply therefore left behind an orphan
 * person/company row never referenced by any policy_participants or
 * external_client_identities row.
 *
 * This directly affected the real production MGEN row for 75846 / Bella
 * Feigina (add_policyholder_to_existing_client, selected_policyholder_mode
 * = create_individual, against a policy owned by Ilya).
 *
 * FIX: the first block's create_individual/create_company INSERTs (and
 * its redundant existing_individual/existing_company re-validation) were
 * removed; only the mode-shape validation that must run before policy
 * resolution (mode not null, mode is one of the four known values) was
 * kept. The second, canonical block remains the sole place that ever
 * creates or resolves the participant.
 *
 * No live Postgres in this sandbox — these tests prove the migration's
 * SQL text has the shape it must have, not that it executes without
 * error.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, '..', '..', 'migrations')
const migrationPath = join(migrationsDir, '20260831_crm3_policy_id_ambiguity_fix.sql')
const src = readFileSync(migrationPath, 'utf8')

// Isolate the apply_carrier_import_record WRAPPER body only (not
// apply_carrier_import_record_block4, which has its own, unrelated
// create_individual/create_company path for a different customer_apply_action
// and is untouched by this fix). The literal '(' right after the name
// excludes the `_block4(` sibling.
const wrapperStartIdx = src.indexOf('CREATE OR REPLACE FUNCTION public.apply_carrier_import_record(')
assert.ok(wrapperStartIdx !== -1, 'apply_carrier_import_record wrapper not found')
const wrapper = src.slice(wrapperStartIdx)

// ── root cause / single authoritative resolution path ─────────────────

test('DUPLICATE-PARTICIPANT FIX: the wrapper contains exactly ONE `CASE r.selected_policyholder_mode` resolution block (previously two)', () => {
  const matches = [...wrapper.matchAll(/CASE r\.selected_policyholder_mode/g)]
  assert.equal(matches.length, 1, 'expected exactly one CASE r.selected_policyholder_mode in the wrapper')
})

test('DUPLICATE-PARTICIPANT FIX: exactly ONE create-individual INSERT path for participant creation in the wrapper', () => {
  const matches = [...wrapper.matchAll(/INSERT INTO public\.individual_clients/g)]
  assert.equal(matches.length, 1, 'expected exactly one INSERT INTO public.individual_clients in the wrapper')
})

test('DUPLICATE-PARTICIPANT FIX (create_company guard): exactly ONE create-company INSERT path for participant creation in the wrapper', () => {
  const matches = [...wrapper.matchAll(/INSERT INTO public\.companies/g)]
  assert.equal(matches.length, 1, 'expected exactly one INSERT INTO public.companies in the wrapper')
})

test('the early add_policyholder_to_existing_client block (before policy resolution) no longer creates or resolves the participant', () => {
  const earlyBlockStart = wrapper.indexOf("IF r.customer_apply_action = 'add_policyholder_to_existing_client' THEN")
  const policyResolutionStart = wrapper.indexOf("IF r.policy_apply_action = 'create_policy' THEN")
  assert.ok(earlyBlockStart !== -1 && policyResolutionStart !== -1 && earlyBlockStart < policyResolutionStart)
  const earlyBlock = wrapper.slice(earlyBlockStart, policyResolutionStart)
  assert.doesNotMatch(earlyBlock, /INSERT INTO public\.individual_clients/)
  assert.doesNotMatch(earlyBlock, /INSERT INTO public\.companies/)
  assert.doesNotMatch(earlyBlock, /participant_ind\s*:=/)
  assert.doesNotMatch(earlyBlock, /participant_company\s*:=/)
  // Only the mode-shape guard remains here.
  assert.match(earlyBlock, /IF r\.selected_policyholder_mode IS NULL THEN/)
})

test('the canonical resolution block (after policy resolution) is the one and only place participant_ind/participant_company get assigned a real value', () => {
  const policyResolutionStart = wrapper.indexOf("IF r.policy_apply_action = 'create_policy' THEN")
  const canonicalBlock = wrapper.slice(policyResolutionStart)
  assert.match(canonicalBlock, /CASE r\.selected_policyholder_mode/)
  assert.match(canonicalBlock, /participant_ind := r\.selected_policyholder_individual_client_id;/)
  assert.match(canonicalBlock, /RETURNING id INTO participant_ind;/)
})

// ── create_individual: single-insert + retry-persistence guarantee ────

test('CREATE_INDIVIDUAL: the create only runs when participant_ind is still unresolved (existing-selection and external-identity reuse both checked first)', () => {
  assert.match(
    wrapper,
    /WHEN 'create_individual' THEN\s*\n\s*IF r\.selected_policyholder_individual_client_id IS NOT NULL THEN[\s\S]*?ELSIF normalized_external_client_id IS NOT NULL THEN[\s\S]*?IF participant_ind IS NULL THEN[\s\S]*?INSERT INTO public\.individual_clients[\s\S]*?RETURNING id INTO participant_ind;\s*\n\s*END IF;/,
  )
})

test('CREATE_INDIVIDUAL retry persistence: the resolved participant id is written back onto r.selected_policyholder_individual_client_id for the same-request UPDATE, and the row UPDATE persists it as selected_policyholder_individual_client_id', () => {
  assert.match(wrapper, /r\.selected_policyholder_individual_client_id := participant_ind;/)
  assert.match(
    wrapper,
    /selected_policyholder_individual_client_id = CASE\s*\n\s*WHEN r\.selected_policyholder_mode IN \('existing_individual', 'create_individual'\) THEN participant_ind/,
  )
})

// ── create_company: same guarantee ─────────────────────────────────────

test('CREATE_COMPANY: the create only runs when participant_company is still unresolved (existing-selection and external-identity reuse both checked first)', () => {
  assert.match(
    wrapper,
    /WHEN 'create_company' THEN\s*\n\s*IF r\.selected_policyholder_company_id IS NOT NULL THEN[\s\S]*?ELSIF normalized_external_client_id IS NOT NULL THEN[\s\S]*?IF participant_company IS NULL THEN[\s\S]*?INSERT INTO public\.companies[\s\S]*?END IF;/,
  )
})

test('CREATE_COMPANY retry persistence: the resolved participant id is written back onto r.selected_policyholder_company_id, and the row UPDATE persists it as selected_policyholder_company_id', () => {
  assert.match(wrapper, /r\.selected_policyholder_company_id := participant_company;/)
  assert.match(
    wrapper,
    /selected_policyholder_company_id = CASE\s*\n\s*WHEN r\.selected_policyholder_mode IN \('existing_company', 'create_company'\) THEN participant_company/,
  )
})

// ── Bella/Ilya regression: existing policy owned by Ilya,
//    add_policyholder_to_existing_client + create_individual Bella +
//    update_existing_policy ─────────────────────────────────────────────

test('BELLA/ILYA REGRESSION: owner_ind is captured from the LOCKED policy row (Ilya) only in the add_policyholder_to_existing_client branch, never from participant_ind/participant_company', () => {
  assert.match(
    wrapper,
    /ELSE\s*\n\s*owner_ind := p\.individual_client_id;\s*\n\s*owner_company := NULLIF\(BTRIM\(p\.company_id\), ''\);\s*\n\s*END IF;/,
  )
  // owner_ind/owner_company are never assigned from participant_ind/participant_company anywhere.
  assert.doesNotMatch(wrapper, /owner_ind\s*:=\s*participant_ind/)
  assert.doesNotMatch(wrapper, /owner_company\s*:=\s*participant_company/)
})

test('BELLA/ILYA REGRESSION: no owner reparenting — update_existing_policy\'s UPDATE only ever touches the approved-field allowlist, never individual_client_id/company_id', () => {
  const updateStmt = wrapper.match(/UPDATE public\.policies SET policy_number=[\s\S]*?WHERE id=pid;/)
  assert.ok(updateStmt, 'update_existing_policy UPDATE statement not found')
  assert.doesNotMatch(updateStmt![0], /\bindividual_client_id\s*=/)
  assert.doesNotMatch(updateStmt![0], /\bcompany_id\s*=/)
})

test('BELLA/ILYA REGRESSION: the final carrier_import_records UPDATE persists owner_ind/owner_company (Ilya) as the customer, and participant_ind (Bella) only as the policyholder participant — never merged together', () => {
  assert.match(
    wrapper,
    /SET selected_individual_client_id = COALESCE\(owner_ind, selected_individual_client_id\),\s*\n\s*selected_company_id = COALESCE\(owner_company, selected_company_id\),/,
  )
  // participant_ind never feeds selected_individual_client_id / selected_company_id.
  assert.doesNotMatch(wrapper, /selected_individual_client_id = .*participant_ind/)
  assert.doesNotMatch(wrapper, /selected_company_id = .*participant_company/)
})

test('BELLA/ILYA REGRESSION: Bella becomes the policyholder participant via a single policy_participants INSERT keyed on participant_ind/participant_company', () => {
  assert.match(
    wrapper,
    /INSERT INTO public\.policy_participants AS ins_pp \(policy_id, individual_client_id, company_id, role, provider, external_client_id, source\)\s*\n\s*VALUES \(pid, participant_ind, participant_company, 'policyholder', r\.provider, normalized_external_client_id, 'carrier_import'\)/,
  )
  const inserts = [...wrapper.matchAll(/INSERT INTO public\.policy_participants/g)]
  assert.equal(inserts.length, 1, 'expected exactly one policy_participants INSERT (idempotent, ON CONFLICT DO NOTHING)')
})
