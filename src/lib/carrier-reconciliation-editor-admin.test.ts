import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * carrier-reconciliation-editor-admin.test.ts — Reconciliation Editor
 * hardening: proves, by inspecting the actual source of
 * data.ts/server-fns.ts, that the new manual "existing policy" selector
 * data path (listPoliciesForOwner / adminListPoliciesForOwner):
 *   - is admin-only, never just an authenticated session;
 *   - requires exactly one of individualClientId/companyId (never both,
 *     never neither — no accidental "list everything" fallback);
 *   - is read-only (no insert/update/delete);
 *   - never calls getPolicies() with no argument on the path a caller
 *     actually reaches (the only unguarded call would return every
 *     policy in the system — see requirement "No client-side direct
 *     unrestricted policy query").
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

test('SECURITY: adminListPoliciesForOwner requires admin role, never just an authenticated session', () => {
  const block = extractServerFnBlock('adminListPoliciesForOwner')
  assert.match(block, /requireAuthMiddleware/)
  assert.match(block, /requireRoleMiddleware\('admin'\)/)
})

test('adminListPoliciesForOwner delegates straight to db.listPoliciesForOwner — no separate unguarded query in the server function itself', () => {
  const block = extractServerFnBlock('adminListPoliciesForOwner')
  assert.match(block, /db\.listPoliciesForOwner\(data\)/)
  assert.doesNotMatch(block, /\.from\('policies'\)/)
})

test('listPoliciesForOwner requires exactly one of individualClientId/companyId — never both, never neither', () => {
  const block = extractDataFnBlock('listPoliciesForOwner')
  assert.match(block, /if \(!individualClientId && !companyId\)/)
  assert.match(block, /if \(individualClientId && companyId\)/)
})

test('listPoliciesForOwner is read-only — no insert/update/delete anywhere in it', () => {
  const block = extractDataFnBlock('listPoliciesForOwner')
  assert.doesNotMatch(block, /\.insert\(|\.update\(|\.delete\(/)
})

test('listPoliciesForOwner never calls getPolicies() with no argument — only ever with a truthy, already-XOR-validated companyId, or the dedicated by-individual query', () => {
  const block = extractDataFnBlock('listPoliciesForOwner')
  assert.doesNotMatch(block, /getPolicies\(\)/)
  assert.match(block, /getPoliciesByIndividualClientId\(individualClientId\)/)
  assert.match(block, /getPolicies\(companyId\)/)
})

test('listPoliciesForOwner only returns the minimal review-safe fields (PolicyOwnerOptionSummary shape) — never the full Policy row', () => {
  const block = extractDataFnBlock('listPoliciesForOwner')
  assert.doesNotMatch(block, /notesInternal|emergencyContacts|documentKey|commissionValue|commissionPercentage/)
})
