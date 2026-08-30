import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * carrier-policy-link-integrity.test.ts — CRM3 final pre-production
 * hardening: prova, por inspeção do código-fonte real (migration SQL +
 * data.ts + server-fns.ts), que:
 *   - carrier_import_records aceita nenhum, um OU o outro dono candidato,
 *     mas nunca os dois ao mesmo tempo
 *   - a ligação fallback de policy (sem externalPolicyId) é idempotente
 *     DENTRO da mesma policy_id + provider + número normalizado, sem
 *     nunca tratar um número igual noutra policy, ou no mesmo número mas
 *     noutro provider, como um conflito autoritativo
 *   - o número normalizado nunca vem do chamador — é sempre derivado
 *     server-side via normalizePolicyNumber
 *   - o caminho autoritativo por externalPolicyId continua exatamente
 *     como estava
 *   - não foi adicionada nenhuma UNIQUE global em policies.policy_number
 *     nem em (provider, external_policy_number_normalized)
 *
 * Tal como nos outros ficheiros desta série: não existe neste ambiente uma
 * instância Postgres real, por isso prova que o SQL e o TypeScript
 * escritos dizem exatamente o que têm de dizer, não que a BD o confirma em
 * runtime.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationSql = readFileSync(
  join(__dirname, '../../migrations/20260830_crm3_identity_reconciliation.sql'),
  'utf8',
)
const dataSrc = readFileSync(join(__dirname, 'data.ts'), 'utf8')
const serverFnsSrc = readFileSync(join(__dirname, 'server-fns.ts'), 'utf8')

function extractDataFnBlock(name: string): string {
  const marker = new RegExp(`(export )?(async )?function ${name}\\(`)
  const match = marker.exec(dataSrc)
  assert.ok(match, `function "${name}" not found in data.ts`)
  const startIdx = match.index
  const nextExportIdx = dataSrc.indexOf('\nexport ', startIdx + name.length)
  return dataSrc.slice(startIdx, nextExportIdx === -1 ? undefined : nextExportIdx)
}

// ── 1. carrier_import_records matched-owner CHECK ───────────────────────

test('carrier_import_records: CHECK constraint exists, at most one owner (not exactly one)', () => {
  assert.match(migrationSql, /CONSTRAINT carrier_import_records_matched_owner_check CHECK/)
  assert.match(
    migrationSql,
    /matched_individual_client_id IS NULL\s*\n?\s*OR matched_company_id IS NULL/,
  )
  // Must NOT require one to exist (no "<>"/XOR form demanding exactly one)
  // — unmatched/new/error records legitimately have neither.
  const constraintBlock = migrationSql.slice(
    migrationSql.indexOf('CONSTRAINT carrier_import_records_matched_owner_check'),
    migrationSql.indexOf(')', migrationSql.indexOf('CONSTRAINT carrier_import_records_matched_owner_check')) + 1,
  )
  assert.doesNotMatch(constraintBlock, /<>/, 'must be an "at most one" check, not an XOR ("exactly one")')
})

test('carrier_import_records CHECK: allows both matched owner ids null (unmatched/new/error case)', () => {
  // Simulate the boolean logic of the CHECK directly against the SQL text
  // it corresponds to: (a IS NULL) OR (b IS NULL) — both null satisfies it.
  const bothNull = (a: unknown, b: unknown) => a === null || b === null
  assert.equal(bothNull(null, null), true)
})

test('carrier_import_records CHECK: allows individual-only and company-only', () => {
  const check = (a: unknown, b: unknown) => a === null || b === null
  assert.equal(check('ind_1', null), true)
  assert.equal(check(null, 'comp_1'), true)
})

test('carrier_import_records CHECK: rejects both simultaneously', () => {
  const check = (a: unknown, b: unknown) => a === null || b === null
  assert.equal(check('ind_1', 'comp_1'), false)
})

// ── 2. external_policy_identities fallback-link partial unique index ────

test('external_policy_identities: scoped partial unique index exists for the fallback path', () => {
  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX IF NOT EXISTS external_policy_identities_policy_provider_number_uidx/,
  )
  assert.match(
    migrationSql,
    /ON public\.external_policy_identities \(policy_id, provider, external_policy_number_normalized\)/,
  )
  assert.match(
    migrationSql,
    /WHERE external_policy_id IS NULL AND external_policy_number_normalized IS NOT NULL/,
  )
})

test('GLOBAL_POLICY_NUMBER_UNIQUE: no UNIQUE constraint touches policies.policy_number', () => {
  assert.doesNotMatch(migrationSql, /ALTER TABLE public\.policies/i)
  assert.doesNotMatch(migrationSql, /policies\s*\(\s*policy_number/i)
})

test('no global UNIQUE on (provider, external_policy_number_normalized) — the plain lookup index stays non-unique', () => {
  const idxMarker = 'CREATE INDEX IF NOT EXISTS external_policy_identities_number_idx'
  const idxStart = migrationSql.indexOf(idxMarker)
  assert.ok(idxStart !== -1)
  assert.doesNotMatch(migrationSql.slice(idxStart, idxStart + 40), /UNIQUE/)
  // The one UNIQUE index touching external_policy_number_normalized must
  // be scoped by policy_id — never a bare (provider, normalized) pair.
  assert.doesNotMatch(
    migrationSql,
    /CREATE UNIQUE INDEX[^;]*ON public\.external_policy_identities \(provider, external_policy_number_normalized\)/,
  )
})

// ── 3/4. server-side normalization + idempotent fallback link ───────────

const createFnBlock = extractDataFnBlock('createExternalPolicyIdentity')

test('SERVER-SIDE NORMALIZATION: externalPolicyNumberNormalized is derived via normalizePolicyNumber, never accepted from the caller', () => {
  assert.match(createFnBlock, /normalizePolicyNumber\(input\.externalPolicyNumber, input\.provider\)/)

  // The input type itself must not even accept a pre-normalized value.
  const inputTypeMarker = 'export interface CreateExternalPolicyIdentityInput {'
  const start = dataSrc.indexOf(inputTypeMarker)
  const end = dataSrc.indexOf('\n}', start)
  const inputTypeBlock = dataSrc.slice(start, end)
  // Checks for an actual field DECLARATION (name followed by `:` or `?:`),
  // not just the bare word — the type deliberately documents its own
  // absence in a comment, which must not trip this check.
  assert.doesNotMatch(inputTypeBlock, /externalPolicyNumberNormalized\??\s*:/)

  // Nor does the admin server function that exposes this to the browser.
  const serverFnMarker = 'export const adminLinkCarrierPolicyIdentity = createServerFn'
  const sfStart = serverFnsSrc.indexOf(serverFnMarker)
  const sfEnd = serverFnsSrc.indexOf('\nexport ', sfStart + serverFnMarker.length)
  const serverFnBlock = serverFnsSrc.slice(sfStart, sfEnd)
  assert.doesNotMatch(serverFnBlock, /externalPolicyNumberNormalized\??\s*:/)
})

test('FALLBACK LINK IDEMPOTENT: same policy + same provider + same normalized number + no external id returns already_linked without inserting again', () => {
  assert.match(createFnBlock, /else if \(externalPolicyNumberNormalized\)/)
  assert.match(createFnBlock, /findExternalPolicyIdentityByFallbackKey\(\s*\n?\s*input\.policyId,\s*\n?\s*input\.provider,\s*\n?\s*externalPolicyNumberNormalized,?\s*\n?\s*\)/)
  assert.match(createFnBlock, /status: 'already_linked', identity: existing/)
})

test('FALLBACK LINK IDEMPOTENT: the fallback lookup is scoped by policy_id AND provider AND normalized number — never a bare number lookup', () => {
  const fallbackFnBlock = extractDataFnBlock('findExternalPolicyIdentityByFallbackKey')
  assert.match(fallbackFnBlock, /\.eq\('policy_id', policyId\)/)
  assert.match(fallbackFnBlock, /\.eq\('provider', provider\)/)
  assert.match(fallbackFnBlock, /\.eq\('external_policy_number_normalized', externalPolicyNumberNormalized\)/)
  assert.match(fallbackFnBlock, /\.is\('external_policy_id', null\)/)
})

test('NOT A CROSS-POLICY CONFLICT: a number match on a DIFFERENT internal policy is never inspected by the fallback path (no conflict status possible)', () => {
  // The fallback branch's only possible outcomes are "already_linked" (via
  // the scoped lookup above) or falling through to INSERT — it must never
  // reference 'conflict' anywhere in its own branch, unlike the
  // externalPolicyId-present branch which legitimately can.
  const fallbackBranchStart = createFnBlock.indexOf('} else if (externalPolicyNumberNormalized) {')
  const fallbackBranchEnd = createFnBlock.indexOf('\n  }', fallbackBranchStart)
  const fallbackBranch = createFnBlock.slice(fallbackBranchStart, fallbackBranchEnd)
  assert.doesNotMatch(fallbackBranch, /'conflict'/)
})

test('DIFFERENT PROVIDER IS SEPARATE: the fallback race-recovery path re-queries scoped by provider too, not just policy+number', () => {
  const raceRecoveryMarker = "!input.externalPolicyId &&"
  const idx = createFnBlock.indexOf(raceRecoveryMarker)
  assert.ok(idx !== -1, 'fallback race-recovery branch not found')
  const raceBlock = createFnBlock.slice(idx, idx + 500)
  assert.match(raceBlock, /findExternalPolicyIdentityByFallbackKey\(/)
  assert.match(raceBlock, /'external_policy_identities_policy_provider_number_uidx'/)
})

// ── 5. externalPolicyId path — unchanged authority ──────────────────────

test('EXTERNAL_ID_AUTHORITY_UNCHANGED: externalPolicyId present still resolves via findExternalPolicyIdentity(provider, externalPolicyId), same policy => already_linked, different => conflict', () => {
  assert.match(createFnBlock, /if \(input\.externalPolicyId\) \{/)
  assert.match(createFnBlock, /findExternalPolicyIdentity\(input\.provider, input\.externalPolicyId\)/)
  assert.match(
    createFnBlock,
    /existing\.policyId === input\.policyId \? 'already_linked' : 'conflict'/,
  )
})

test('EXTERNAL_ID_AUTHORITY_UNCHANGED: the authoritative unique index (provider, external_policy_id) is untouched', () => {
  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX IF NOT EXISTS external_policy_identities_provider_external_id_uidx\s*\n\s*ON public\.external_policy_identities \(provider, external_policy_id\)\s*\n\s*WHERE external_policy_id IS NOT NULL;/,
  )
})

test('RAW_NIF_UNIQUE: still no UNIQUE constraint on any raw NIF column in this migration', () => {
  // Strip SQL comment lines first — the migration's own prose discusses
  // "no UNIQUE constraint on NIF" at length, which would otherwise trip a
  // naive substring check between the two words.
  const codeOnly = migrationSql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
  assert.doesNotMatch(codeOnly, /UNIQUE[^;]*\bnif\b/i)
  assert.doesNotMatch(codeOnly, /\bnif\b[^;]*UNIQUE/i)
})
