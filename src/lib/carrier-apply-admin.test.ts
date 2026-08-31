import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * carrier-apply-admin.test.ts — CRM3 Block 4: proves, by inspecting the
 * actual source of server-fns.ts/data.ts, that:
 *   - adminSetCarrierImportRecordApplyActions / adminApplyCarrierSyncRun
 *     both require admin (never just an authenticated session);
 *   - applyCarrierImportRecord is idempotent (checks apply_status early
 *     and returns without calling the RPC again);
 *   - deleteCarrierSyncRun blocks once any record is applied;
 *   - the apply RPC is called by name, and nothing bypasses it by
 *     calling the flaky createCompany/createPolicy/createIndividualClient
 *     wrappers from inside the apply path;
 *   - no service-role key/secret/carrier credential leaks into these
 *     functions.
 * As with the other CRM3 source-inspection tests in this codebase, there
 * is no live Postgres/Supabase in this sandbox — this proves the
 * TypeScript says what it must say, not that the database confirms it
 * at runtime.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const serverFnsSrc = readFileSync(join(__dirname, 'server-fns.ts'), 'utf8')
const dataSrc = readFileSync(join(__dirname, 'data.ts'), 'utf8')

function extractServerFnBlock(name: string): string {
  const marker = `export const ${name} = createServerFn`
  const startIdx = serverFnsSrc.indexOf(marker)
  assert.ok(startIdx !== -1, `server function "${name}" not found in server-fns.ts`)
  const nextExportIdx = serverFnsSrc.indexOf('\nexport ', startIdx + marker.length)
  return serverFnsSrc.slice(startIdx, nextExportIdx === -1 ? undefined : nextExportIdx)
}

function extractDataFnBlock(name: string): string {
  const marker = `export async function ${name}(`
  const startIdx = dataSrc.indexOf(marker)
  assert.ok(startIdx !== -1, `data function "${name}" not found in data.ts`)
  const nextExportIdx = dataSrc.indexOf('\nexport ', startIdx + marker.length)
  return dataSrc.slice(startIdx, nextExportIdx === -1 ? undefined : nextExportIdx)
}

const APPLY_SERVER_FN_NAMES = ['adminSetCarrierImportRecordApplyActions', 'adminApplyCarrierSyncRun']

// ── SECURITY: admin-only, no exceptions ─────────────────────────────

test('SECURITY: every Block 4 apply server function requires admin role, never just an authenticated session', () => {
  for (const name of APPLY_SERVER_FN_NAMES) {
    const block = extractServerFnBlock(name)
    assert.match(block, /requireAuthMiddleware/, `${name} is missing requireAuthMiddleware`)
    assert.match(block, /requireRoleMiddleware\('admin'\)/, `${name} is missing requireRoleMiddleware('admin')`)
  }
})

test('SECURITY: no service-role key, secret, or carrier credential is referenced in the apply server functions', () => {
  for (const name of APPLY_SERVER_FN_NAMES) {
    const block = extractServerFnBlock(name)
    assert.doesNotMatch(block, /SUPABASE_SERVICE_ROLE_KEY|apiKey|api_key|clientSecret|client_secret|password/i)
  }
})

test('adminSetCarrierImportRecordApplyActions delegates enum validation to db.setCarrierImportRecordApplyActions — never trusts the browser value directly', () => {
  const block = extractServerFnBlock('adminSetCarrierImportRecordApplyActions')
  assert.match(block, /db\.setCarrierImportRecordApplyActions/)
})

// ── ACCEPTED-ONLY, EXPLICIT-ACTION-ONLY GATE ────────────────────────

test('adminApplyCarrierSyncRun refuses to apply anything while any accepted record is unresolved', () => {
  const block = extractServerFnBlock('adminApplyCarrierSyncRun')
  assert.match(block, /computeRunApplyReadiness/)
  assert.match(block, /readiness\.unresolvedCount > 0/)
  assert.match(block, /still need an apply action/)
})

test('adminApplyCarrierSyncRun only ever applies records with decisionStatus === accepted', () => {
  const block = extractServerFnBlock('adminApplyCarrierSyncRun')
  assert.match(block, /r\.decisionStatus === 'accepted'/)
})

test('adminApplyCarrierSyncRun refuses a non-dry-run run, an already-applied run, and an already-applying run', () => {
  const block = extractServerFnBlock('adminApplyCarrierSyncRun')
  assert.match(block, /run\.mode !== 'dry_run'/)
  assert.match(block, /run\.applyStatus === 'applied'/)
  assert.match(block, /run\.applyStatus === 'applying'/)
})

test('adminApplyCarrierSyncRun processes accepted records ONE BY ONE (a loop, not one giant transaction) and represents partial failure', () => {
  const block = extractServerFnBlock('adminApplyCarrierSyncRun')
  assert.match(block, /for \(const record of acceptedRecords\)/)
  assert.match(block, /db\.applyCarrierImportRecord\(record\.id\)/)
  assert.match(block, /'partially_failed'/)
})

// ── IDEMPOTENCY / DOUBLE-APPLY SAFETY ───────────────────────────────

test('applyCarrierImportRecord checks apply_status === applied FIRST and returns already_applied WITHOUT calling the RPC', () => {
  const block = extractDataFnBlock('applyCarrierImportRecord')
  const alreadyAppliedIdx = block.indexOf("record.applyStatus === 'applied'")
  const rpcCallIdx = block.indexOf("'apply_carrier_import_record'")
  assert.ok(alreadyAppliedIdx !== -1, 'missing the already-applied short-circuit')
  assert.ok(rpcCallIdx !== -1, 'missing the RPC call')
  assert.ok(alreadyAppliedIdx < rpcCallIdx, 'the already-applied check must happen before the RPC is ever called')
  assert.match(block, /status: 'already_applied'/)
})

test('applyCarrierImportRecord refuses a row that is not isRowReadyToApply — never calls the RPC for an under-resolved row', () => {
  const block = extractDataFnBlock('applyCarrierImportRecord')
  const readyCheckIdx = block.indexOf('isRowReadyToApply(rowState)')
  const rpcCallIdx = block.indexOf("'apply_carrier_import_record'")
  assert.ok(readyCheckIdx !== -1)
  assert.ok(readyCheckIdx < rpcCallIdx)
})

test('the apply RPC is invoked by its exact name via supabase-js .rpc()', () => {
  const block = extractDataFnBlock('applyCarrierImportRecord')
  assert.match(block, /\.rpc as any\)\('apply_carrier_import_record'/)
})

// ── DOES NOT BYPASS THE ATOMIC RPC ──────────────────────────────────

test('applyCarrierImportRecord never calls createCompany/createPolicy/createIndividualClient directly — all mutation happens inside the one atomic RPC', () => {
  const block = extractDataFnBlock('applyCarrierImportRecord')
  assert.doesNotMatch(block, /\bcreateCompany\(|\bcreatePolicy\(|\bcreateIndividualClient\(/)
})

test('setCarrierImportRecordApplyActions never itself creates/updates individual_clients/companies/policies — it only persists the chosen action', () => {
  const block = extractDataFnBlock('setCarrierImportRecordApplyActions')
  assert.doesNotMatch(block, /\.from\('individual_clients'\)|\.from\('companies'\)|\.from\('policies'\)/)
  assert.doesNotMatch(block, /\bcreateCompany\(|\bcreatePolicy\(|\bcreateIndividualClient\(/)
})

test('setCarrierImportRecordApplyActions validates action enums server-side and rejects resolving actions on a non-accepted record', () => {
  const block = extractDataFnBlock('setCarrierImportRecordApplyActions')
  assert.match(block, /isValidCustomerApplyAction\(input\.customerApplyAction\)/)
  assert.match(block, /isValidPolicyApplyAction\(input\.policyApplyAction\)/)
  assert.match(block, /record\.decisionStatus !== 'accepted'/)
})

test('setCarrierImportRecordApplyActions pre-checks owner consistency for link_existing_policy/update_existing_policy before persisting', () => {
  const block = extractDataFnBlock('setCarrierImportRecordApplyActions')
  assert.match(block, /checkOwnerConsistency\(/)
})

// ── CANCEL/DELETE BLOCKED AFTER APPLY ───────────────────────────────

test('deleteCarrierSyncRun refuses to delete a run once any of its records has apply_status = applied', () => {
  const block = extractDataFnBlock('deleteCarrierSyncRun')
  assert.match(block, /apply_status', 'applied'/)
  assert.match(block, /cannot cancel a run that already has applied records/)
})

// ── AUDIT: apply never deletes the reconciliation record it applies ──

test('applyCarrierImportRecord never deletes a carrier_import_records row — apply is additive bookkeeping only', () => {
  const block = extractDataFnBlock('applyCarrierImportRecord')
  assert.doesNotMatch(block, /\.delete\(\)/)
})

test('setCarrierImportRecordApplyActions never deletes a carrier_import_records row', () => {
  const block = extractDataFnBlock('setCarrierImportRecordApplyActions')
  assert.doesNotMatch(block, /\.delete\(\)/)
})

// ── HARDENING 3 — approved_policy_changes key allowlist (TS side) ────

test('setCarrierImportRecordApplyActions rejects an approvedPolicyChanges value containing an unallowed key, BEFORE persisting anything', () => {
  const block = extractDataFnBlock('setCarrierImportRecordApplyActions')
  const checkIdx = block.indexOf('findInvalidApprovedPolicyChangeKeys(input.approvedPolicyChanges)')
  const updateCallIdx = block.indexOf(".from('carrier_import_records')")
  assert.ok(checkIdx !== -1, 'missing the key-allowlist check')
  assert.ok(updateCallIdx !== -1, 'missing the persisting update call')
  assert.ok(checkIdx < updateCallIdx, 'the key check must run before the record is persisted')
  assert.match(block, /unsupported key/)
})
