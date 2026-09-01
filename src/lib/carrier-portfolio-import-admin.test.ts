import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { isValidCarrierProvider, CARRIER_PROVIDERS } from './carrier-providers.ts'

/**
 * carrier-portfolio-import-admin.test.ts — CRM3 Block 3 (Manual Portfolio
 * Import): prova, por inspeção do código-fonte real (server-fns.ts +
 * data.ts) e por execução direta (carrier-providers.ts), que:
 *   - o provider é validado contra o allowlist SERVER-SIDE antes de
 *     qualquer processamento, nunca confiado do browser
 *   - não existe NENHUM caminho de código que atualize o provider de uma
 *     carrier_sync_runs já criada — é estruturalmente imutável
 *   - o preview NUNCA cria nem atualiza individual_clients/companies/
 *     policies
 *   - a corrida usa carrier_sync_runs (mode='dry_run') e
 *     carrier_import_records exatamente como já existem, sem os
 *     redesenhar
 *   - a proteção de duplicado usa o fingerprint determinístico, nunca o
 *     nome do ficheiro
 *   - todas as funções admin exigem auth + role admin
 *
 * Tal como nos outros ficheiros desta série: não existe neste ambiente uma
 * instância Postgres real, por isso este ficheiro prova que o TypeScript
 * escrito diz exatamente o que tem de dizer, não que a BD o confirma em
 * runtime.
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

const PORTFOLIO_SERVER_FN_NAMES = ['adminPreviewPortfolioImport', 'adminCancelCarrierSyncRun']

// ── provider allowlist ────────────────────────────────────────────────

test('PROVIDER ALLOWLIST: exactly mgen/allianz/zurich/hiscox, nothing else', () => {
  assert.deepEqual([...CARRIER_PROVIDERS].sort(), ['allianz', 'hiscox', 'mgen', 'zurich'])
})

test('PROVIDER ALLOWLIST: isValidCarrierProvider accepts only allowlisted values, rejects everything else including case variants', () => {
  for (const id of CARRIER_PROVIDERS) assert.equal(isValidCarrierProvider(id), true)
  assert.equal(isValidCarrierProvider('MGEN'), false)
  assert.equal(isValidCarrierProvider('unknown_insurer'), false)
  assert.equal(isValidCarrierProvider(''), false)
  assert.equal(isValidCarrierProvider(null), false)
  assert.equal(isValidCarrierProvider(undefined), false)
  assert.equal(isValidCarrierProvider(123), false)
})

// ── provider required, validated server-side, never trusted blindly ────

test('PROVIDER REQUIRED: adminPreviewPortfolioImport validates the provider server-side, before any parsing, and never trusts the browser value', () => {
  const block = extractServerFnBlock('adminPreviewPortfolioImport')
  const validationIdx = block.indexOf('isValidCarrierProvider(data.provider)')
  const parseIdx = block.indexOf('parsePortfolioWorkbook(')
  assert.ok(validationIdx !== -1, 'must call isValidCarrierProvider on the browser-supplied value')
  assert.ok(parseIdx !== -1, 'must call parsePortfolioWorkbook')
  assert.ok(validationIdx < parseIdx, 'provider must be validated before the file is even parsed')
  assert.match(block, /return \{ status: 'invalid_provider' as const \}/)
})

test('SECURITY: every portfolio-import server function requires admin role, never just an authenticated session', () => {
  for (const name of PORTFOLIO_SERVER_FN_NAMES) {
    const block = extractServerFnBlock(name)
    assert.match(block, /requireAuthMiddleware/, `${name} is missing requireAuthMiddleware`)
    assert.match(block, /requireRoleMiddleware\('admin'\)/, `${name} is missing requireRoleMiddleware('admin')`)
  }
})

test('SECURITY: no service-role key, secret, or carrier credential is referenced in the import server functions', () => {
  for (const name of PORTFOLIO_SERVER_FN_NAMES) {
    const block = extractServerFnBlock(name)
    assert.doesNotMatch(block, /SUPABASE_SERVICE_ROLE_KEY|apiKey|api_key|clientSecret|client_secret|password/i)
  }
})

// ── provider immutable after run creation ───────────────────────────────

test('PROVIDER IMMUTABLE: no function anywhere in data.ts updates carrier_sync_runs.provider', () => {
  // Every .update( call on carrier_sync_runs, wherever it appears, must
  // never touch a `provider` field.
  const updateCalls = [...dataSrc.matchAll(/\.from\('carrier_sync_runs'\)[\s\S]{0,10}\.update\(([\s\S]{0,300}?)\)/g)]
  assert.ok(updateCalls.length > 0, 'expected at least one carrier_sync_runs update call (finalizeCarrierSyncRunCounts)')
  for (const match of updateCalls) {
    assert.doesNotMatch(match[1]!, /provider/, 'no update to carrier_sync_runs may touch provider')
  }
})

test('PROVIDER IMMUTABLE: the only two ways a carrier_sync_runs row is affected after creation are finalizing counts or deleting it — never re-creating/re-selecting a provider', () => {
  assert.match(dataSrc, /export async function finalizeCarrierSyncRunCounts/)
  assert.match(dataSrc, /export async function deleteCarrierSyncRun/)
  assert.doesNotMatch(dataSrc, /export async function updateCarrierSyncRun\(/)
  assert.doesNotMatch(dataSrc, /function.*[Uu]pdateProvider/)
})

test('PROVIDER IMMUTABLE: "Cancel import" deletes the run rather than mutating its provider', () => {
  const block = extractServerFnBlock('adminCancelCarrierSyncRun')
  assert.match(block, /db\.deleteCarrierSyncRun/)
  assert.doesNotMatch(block, /provider/)
})

// ── preview never mutates the CRM ───────────────────────────────────────

test('PREVIEW DOES NOT CREATE/UPDATE individual_clients/companies/policies: adminPreviewPortfolioImport never calls any of the existing create/update functions for those tables', () => {
  const block = extractServerFnBlock('adminPreviewPortfolioImport')
  assert.doesNotMatch(
    block,
    /createIndividualClient|updateIndividualClient|createCompany(?!User)|updateCompany|createPolicy|updatePolicy/,
  )
})

test('PREVIEW DOES NOT CREATE/UPDATE individual_clients/companies/policies: the underlying data-layer functions this server function calls never touch those tables either', () => {
  for (const fnName of ['createCarrierSyncRunForImport', 'stageCarrierImportRecords', 'finalizeCarrierSyncRunCounts']) {
    const marker = `export async function ${fnName}(`
    const startIdx = dataSrc.indexOf(marker)
    assert.ok(startIdx !== -1, `${fnName} not found in data.ts`)
    const nextExportIdx = dataSrc.indexOf('\nexport ', startIdx + marker.length)
    const block = dataSrc.slice(startIdx, nextExportIdx === -1 ? undefined : nextExportIdx)
    assert.doesNotMatch(block, /\.from\('individual_clients'\)/, `${fnName} must never touch individual_clients`)
    assert.doesNotMatch(block, /\.from\('companies'\)/, `${fnName} must never touch companies`)
    assert.doesNotMatch(block, /\.from\('policies'\)/, `${fnName} must never touch policies`)
  }
})

test('candidate-listing functions (listCandidateClients/listCandidatePolicies) only ever SELECT, never insert/update/delete', () => {
  for (const fnName of ['listCandidateClients', 'listCandidatePolicies', 'listExternalClientIdentities', 'listExternalPolicyIdentities']) {
    const marker = `export async function ${fnName}(`
    const startIdx = dataSrc.indexOf(marker)
    assert.ok(startIdx !== -1, `${fnName} not found in data.ts`)
    const nextExportIdx = dataSrc.indexOf('\nexport ', startIdx + marker.length)
    const block = dataSrc.slice(startIdx, nextExportIdx === -1 ? undefined : nextExportIdx)
    assert.doesNotMatch(block, /\.insert\(|\.update\(|\.delete\(/, `${fnName} must be read-only`)
  }
})

// ── uses the existing carrier_sync_runs / carrier_import_records tables ─

test('USES_CARRIER_SYNC_RUNS: createCarrierSyncRunForImport always sets mode to dry_run, never anything else', () => {
  const marker = 'export async function createCarrierSyncRunForImport('
  const startIdx = dataSrc.indexOf(marker)
  const nextExportIdx = dataSrc.indexOf('\nexport ', startIdx + marker.length)
  const block = dataSrc.slice(startIdx, nextExportIdx)
  assert.match(block, /mode: 'dry_run'/)
  assert.doesNotMatch(block, /mode: 'import'/)
})

test('USES_CARRIER_IMPORT_RECORDS: stageCarrierImportRecords writes to carrier_import_records with raw_payload set to the already-sanitized row content', () => {
  const marker = 'export async function stageCarrierImportRecords('
  const startIdx = dataSrc.indexOf(marker)
  const nextExportIdx = dataSrc.indexOf('\nexport ', startIdx + marker.length)
  const block = dataSrc.slice(startIdx, nextExportIdx)
  assert.match(block, /\.from\('carrier_import_records'\)/)
  assert.match(block, /rawPayload: m\.row\.sanitizedRaw/)
  assert.match(block, /decisionStatus: 'pending'/)
})

// ── duplicate-import fingerprint protection ─────────────────────────────

test('DUPLICATE_IMPORT_PROTECTION: createCarrierSyncRunForImport checks the fingerprint before inserting, and again on a race, never using the filename', () => {
  const marker = 'export async function createCarrierSyncRunForImport('
  const startIdx = dataSrc.indexOf(marker)
  const nextExportIdx = dataSrc.indexOf('\nexport ', startIdx + marker.length)
  const block = dataSrc.slice(startIdx, nextExportIdx)
  assert.match(block, /findCarrierSyncRunByFingerprint\(input\.importFingerprint\)/)
  assert.match(block, /'duplicate'/)
  assert.match(block, /carrier_sync_runs_import_fingerprint_uidx/)
  assert.doesNotMatch(block, /filename/i)
})

test('DUPLICATE_IMPORT_PROTECTION: the fingerprint is computed from provider + sanitized row content, not the filename', () => {
  const block = extractServerFnBlock('adminPreviewPortfolioImport')
  assert.match(block, /computeImportFingerprint\(provider, mapped\.rows\)/)
  // filename is only used for the extension/parsing check, never fed into
  // the fingerprint computation itself.
  const fingerprintCallIdx = block.indexOf('computeImportFingerprint(')
  const nearbyText = block.slice(Math.max(0, fingerprintCallIdx - 50), fingerprintCallIdx + 50)
  assert.doesNotMatch(nearbyText, /filename/)
})

// ── CSV upload support (fix/crm3-portfolio-csv-upload) ─────────────────
//
// Provider selection is untouched by adding CSV support: it's still the
// explicit `data.provider` value validated against the allowlist above
// (see "PROVIDER REQUIRED" test), never something derived from the
// uploaded file. These tests lock that specifically for the CSV case —
// no code path anywhere sniffs the filename or file content to guess
// "this looks like Allianz".

const routeSrc = readFileSync(join(__dirname, '../routes/admin.carrier-integrations.import.tsx'), 'utf8')
const excelWorkbookSrc = readFileSync(join(__dirname, 'carrier-excel-workbook.ts'), 'utf8')

test('CSV UPLOAD: the file picker accepts .xlsx, .xls and .csv', () => {
  assert.match(routeSrc, /accept="\.xlsx,\.xls,\.csv"/)
})

test('CSV UPLOAD: provider is never inferred from the filename or file content anywhere in the import pipeline', () => {
  // The only two places filename is read at all: the extension check in
  // parsePortfolioWorkbook, and passing it through to that function/the
  // duplicate-run filename-independent fingerprint check above. Neither
  // ever compares it against a provider name (e.g. "allianz"/"polres").
  //
  // Deliberately no `s` (dotall) flag: this must only catch an actual
  // same-line code comparison (e.g. `filename.includes('allianz')`), not
  // any file that happens to mention both words anywhere at all — e.g. a
  // doc comment on one line explaining a `filename` parameter, and a
  // completely unrelated comment several lines later citing the real
  // "POLRES.CSV" file by name for diagnostic clarity, must never trip
  // this guard; those are prose, not a filename-sniffing predicate.
  for (const src of [routeSrc, excelWorkbookSrc, extractServerFnBlock('adminPreviewPortfolioImport')]) {
    assert.doesNotMatch(src, /filename.*allianz|allianz.*filename/i)
    assert.doesNotMatch(src, /filename.*polres|polres.*filename/i)
  }
})

test('CSV UPLOAD: parsePortfolioWorkbook still requires an explicit, caller-supplied filename — extension is the only thing derived from it', () => {
  assert.match(excelWorkbookSrc, /isCsvFilename\(filename\)/)
  assert.match(excelWorkbookSrc, /Only \.xlsx, \.xls or \.csv files are accepted/)
})
