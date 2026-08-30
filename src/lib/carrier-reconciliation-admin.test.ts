import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * carrier-reconciliation-admin.test.ts — CRM3 Block 2: prova, por inspeção
 * do código-fonte real (server-fns.ts + data.ts), que o workflow de admin de
 * reconciliação de carriers tem exatamente a forma exigida:
 *   - todas as server functions são admin-only
 *   - a ligação de identidade de cliente exige XOR individualClientId/companyId
 *   - conflito é devolvido (nunca move silenciosamente) quando uma
 *     identidade externa já pertence a outro dono
 *   - o mesmo para a ligação de identidade de apólice
 *   - Accept/Reject/Ignore só tocam no registo de staging — nunca criam,
 *     atualizam ou apagam individual_clients/companies/policies
 *
 * Tal como nos outros ficheiros de segurança desta série (ex.:
 * sales-opportunities-security.test.ts, promote-client-to-company.test.ts):
 * não existe neste ambiente uma instância Postgres real, por isso este
 * ficheiro prova que o TypeScript escrito diz exatamente o que tem de dizer,
 * não que a BD o aplica em runtime.
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

const CARRIER_SERVER_FN_NAMES = [
  'adminListCarrierSyncRuns',
  'adminGetCarrierSyncRun',
  'adminListCarrierImportRecords',
  'adminGetCarrierImportRecord',
  'adminLinkCarrierClientIdentity',
  'adminLinkCarrierPolicyIdentity',
  'adminAcceptCarrierImportDecision',
  'adminRejectCarrierImportDecision',
  'adminIgnoreCarrierImportDecision',
]

test('SECURITY: every carrier-reconciliation server function requires admin role, never just an authenticated session', () => {
  for (const name of CARRIER_SERVER_FN_NAMES) {
    const block = extractServerFnBlock(name)
    assert.match(block, /requireAuthMiddleware/, `${name} is missing requireAuthMiddleware`)
    assert.match(block, /requireRoleMiddleware\('admin'\)/, `${name} is missing requireRoleMiddleware('admin')`)
  }
})

test('DATA LAYER: createExternalClientIdentity requires exactly one of individualClientId/companyId (XOR)', () => {
  const block = extractDataFnBlock('createExternalClientIdentity')
  assert.match(block, /hasIndividual === hasCompany/, 'must reject both-set and neither-set the same way (XOR)')
  assert.match(block, /throw new Error/)
})

test('DATA LAYER: createExternalClientIdentity returns a conflict (never silently re-links) when the identity belongs to a different owner', () => {
  const block = extractDataFnBlock('createExternalClientIdentity')
  assert.match(block, /'conflict'/)
  assert.match(block, /'already_linked'/)
  // The conflict/already_linked decision must come from comparing against
  // the EXISTING row's actual owner, not from blindly overwriting it.
  assert.match(block, /sameOwnerAs/)
  assert.doesNotMatch(block, /\.update\(/, 'must never UPDATE an existing external_client_identities row to move its owner')
})

test('DATA LAYER: createExternalPolicyIdentity returns a conflict when (provider, externalPolicyId) belongs to a different policy', () => {
  const block = extractDataFnBlock('createExternalPolicyIdentity')
  assert.match(block, /'conflict'/)
  assert.match(block, /'already_linked'/)
  assert.match(block, /existing\.policyId === input\.policyId/)
  assert.doesNotMatch(block, /\.update\(/, 'must never UPDATE an existing external_policy_identities row to move its owner')
})

test('DATA LAYER: createExternalPolicyIdentity never treats policy number alone as authoritative identity', () => {
  const block = extractDataFnBlock('createExternalPolicyIdentity')
  // The conflict-check branch must be gated on externalPolicyId, not on
  // externalPolicyNumber.
  assert.match(block, /if \(input\.externalPolicyId\) \{/)
})

test('DATA LAYER: updateCarrierImportDecision only ever writes to carrier_import_records, never to individual_clients/companies/policies', () => {
  const block = extractDataFnBlock('updateCarrierImportDecision')
  assert.match(block, /\.from\('carrier_import_records'\)/)
  assert.doesNotMatch(block, /\.from\('individual_clients'\)/)
  assert.doesNotMatch(block, /\.from\('companies'\)/)
  assert.doesNotMatch(block, /\.from\('policies'\)/)
  assert.doesNotMatch(block, /\.insert\(/, 'a decision update must never INSERT a new row anywhere')
  assert.doesNotMatch(block, /\.delete\(/, 'a decision update must never DELETE anything')
})

test('DATA LAYER: accepted sets decided_at, rejected/ignored do not touch CRM ownership fields', () => {
  const block = extractDataFnBlock('updateCarrierImportDecision')
  assert.match(block, /decisionStatus === 'accepted'[\s\S]{0,40}decided_at = now/)
  assert.doesNotMatch(block, /matched_individual_client_id\s*[:=]/, 'must never set matched_* fields from a decision update')
  assert.doesNotMatch(block, /matched_company_id\s*[:=]/)
  assert.doesNotMatch(block, /matched_policy_id\s*[:=]/)
})

test('DATA LAYER: ignoring a decision only touches match_status fields that were still unresolved, never an already-exact/linked one', () => {
  const block = extractDataFnBlock('updateCarrierImportDecision')
  assert.match(block, /UNRESOLVED_CARRIER_MATCH_STATUSES/)
  const constDecl = dataSrc.match(/const UNRESOLVED_CARRIER_MATCH_STATUSES:[^\n]*\[([^\]]*)\]/)
  assert.ok(constDecl, 'UNRESOLVED_CARRIER_MATCH_STATUSES constant not found')
  assert.doesNotMatch(constDecl![1]!, /'exact'|'linked'/, 'exact/linked must never be treated as "unresolved"')
})

test('SERVER-FN: adminLinkCarrierClientIdentity and adminLinkCarrierPolicyIdentity are separate, deliberate actions — never called from the Accept handler', () => {
  const acceptBlock = extractServerFnBlock('adminAcceptCarrierImportDecision')
  assert.doesNotMatch(acceptBlock, /createExternalClientIdentity|createExternalPolicyIdentity/, 'Accept must never automatically link an external identity')
  assert.doesNotMatch(acceptBlock, /createIndividualClient|createCompany|createPolicy/, 'Accept must never create a CRM record')
})

test('SERVER-FN: reject/ignore handlers never create, update, or delete CRM client/company/policy records', () => {
  for (const name of ['adminRejectCarrierImportDecision', 'adminIgnoreCarrierImportDecision']) {
    const block = extractServerFnBlock(name)
    assert.doesNotMatch(block, /createIndividualClient|createCompany|createPolicy|updateIndividualClient|updateCompany|updatePolicy|deleteIndividualClient|deleteCompany|deletePolicy/)
  }
})

test('SERVER-FN: no carrier server function calls an external HTTP/carrier API or references credentials/secrets', () => {
  for (const name of CARRIER_SERVER_FN_NAMES) {
    const block = extractServerFnBlock(name)
    assert.doesNotMatch(block, /fetch\(|axios|https?:\/\//i)
    assert.doesNotMatch(block, /apiKey|api_key|clientSecret|client_secret|password/i)
  }
})
