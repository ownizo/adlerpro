import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * carrier-reconciliation-review.test.ts — CRM3 Block 2 hardening: prova,
 * por inspeção do código-fonte real (data.ts + types.ts + admin.tsx), que:
 *   - getCarrierImportRecordReview resolve individual/company/policy
 *     candidates só a partir de matched_*_id, nunca inventa um candidato
 *     quando o id está ausente ou o registo já não existe
 *   - os tipos de summary só expõem os campos "review-safe" pedidos — nunca
 *     notas/tarefas/oportunidades/sinistros/documentos/metadados de auth
 *   - o aviso de duplicado de Policy expõe uma ação "Review existing
 *     policy" tal como Person/Company já expõem "Review existing record"
 *   - vários candidatos de policy nunca são reduzidos silenciosamente ao
 *     primeiro (candidateIds[0]) — todo o array é processado
 *
 * Tal como nos outros ficheiros desta série: não existe neste ambiente uma
 * instância Postgres real, por isso prova que o código escrito diz
 * exatamente o que tem de dizer, não que a BD o confirma em runtime.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataSrc = readFileSync(join(__dirname, 'data.ts'), 'utf8')
const typesSrc = readFileSync(join(__dirname, 'types.ts'), 'utf8')
const adminSrc = readFileSync(join(__dirname, '../routes/admin.tsx'), 'utf8')

function extractDataFnBlock(name: string): string {
  const marker = `export async function ${name}(`
  const startIdx = dataSrc.indexOf(marker)
  assert.ok(startIdx !== -1, `data function "${name}" not found in data.ts`)
  const nextExportIdx = dataSrc.indexOf('\nexport ', startIdx + marker.length)
  return dataSrc.slice(startIdx, nextExportIdx === -1 ? undefined : nextExportIdx)
}

function extractInterfaceBlock(src: string, name: string): string {
  const marker = `export interface ${name} {`
  const startIdx = src.indexOf(marker)
  assert.ok(startIdx !== -1, `interface "${name}" not found`)
  const endIdx = src.indexOf('\n}', startIdx)
  return src.slice(startIdx, endIdx)
}

// ── candidate summary resolution ─────────────────────────────────────────

const reviewFnBlock = extractDataFnBlock('getCarrierImportRecordReview')

test('INDIVIDUAL candidate summary: resolved only when matchedIndividualClientId is present, via getIndividualClient', () => {
  assert.match(reviewFnBlock, /if \(record\.matchedIndividualClientId\)/)
  assert.match(reviewFnBlock, /getIndividualClient\(record\.matchedIndividualClientId\)/)
  for (const field of ['fullName', 'email', 'phone', 'nif', 'address']) {
    assert.match(reviewFnBlock, new RegExp(`${field}:\\s*client\\.${field}`), `individualCandidate missing field ${field}`)
  }
})

test('COMPANY candidate summary: resolved only when matchedCompanyId is present, via getCompany', () => {
  assert.match(reviewFnBlock, /if \(record\.matchedCompanyId\)/)
  assert.match(reviewFnBlock, /getCompany\(record\.matchedCompanyId\)/)
  for (const field of ['name', 'nif', 'contactName', 'contactEmail', 'contactPhone', 'address']) {
    assert.match(reviewFnBlock, new RegExp(`${field}:\\s*company\\.${field}`), `companyCandidate missing field ${field}`)
  }
})

test('POLICY candidate summary: resolved only when matchedPolicyId is present, via getPolicy, including a cheaply-resolved owner label', () => {
  assert.match(reviewFnBlock, /if \(record\.matchedPolicyId\)/)
  assert.match(reviewFnBlock, /getPolicy\(record\.matchedPolicyId\)/)
  for (const field of ['policyNumber', 'insurer', 'startDate', 'endDate', 'annualPremium']) {
    assert.match(reviewFnBlock, new RegExp(`${field}:\\s*policy\\.${field}`), `policyCandidate missing field ${field}`)
  }
  assert.match(reviewFnBlock, /policyType:\s*policy\.type/)
  // Owner label — resolved from whichever owner id the policy already has,
  // never guessed.
  assert.match(reviewFnBlock, /if \(policy\.companyId\)/)
  assert.match(reviewFnBlock, /getIndividualClient\(policy\.individualClientId\)/)
})

test('MISSING CANDIDATE: no fabricated data — each candidate starts undefined and is only ever assigned inside its own guard', () => {
  assert.match(reviewFnBlock, /let individualCandidate: CarrierIndividualCandidateSummary \| undefined\n/)
  assert.match(reviewFnBlock, /let companyCandidate: CarrierCompanyCandidateSummary \| undefined\n/)
  assert.match(reviewFnBlock, /let policyCandidate: CarrierPolicyCandidateSummary \| undefined\n/)
  // No default/placeholder object literal assigned before or outside the
  // matched_*_id guards (e.g. no "= { id: '', ... }" fallback anywhere).
  assert.doesNotMatch(reviewFnBlock, /=\s*\{\s*id:\s*['"]/)
})

test('MISSING RECORD: the whole review resolves to undefined, not a half-built object, when the record itself does not exist', () => {
  assert.match(reviewFnBlock, /if \(!record\) return undefined/)
})

// ── review-safe field allowlist ──────────────────────────────────────────

const FORBIDDEN_FIELD_RE = /authUserId|password|secret|apiKey|notes|clientNotes|tasks|clientTasks|opportunit|claims|documents|medical|diagnos|metadata/i

test('SENSITIVE FIELDS EXCLUDED: candidate summary types never expose auth metadata, secrets, or unrelated notes/tasks/opportunities/claims/documents', () => {
  for (const name of ['CarrierIndividualCandidateSummary', 'CarrierCompanyCandidateSummary', 'CarrierPolicyCandidateSummary']) {
    const block = extractInterfaceBlock(typesSrc, name)
    assert.doesNotMatch(block, FORBIDDEN_FIELD_RE, `${name} exposes a forbidden field`)
  }
})

test('SENSITIVE FIELDS EXCLUDED: the resolver function itself never touches client_notes/client_tasks/sales_opportunities/claims/documents tables', () => {
  assert.doesNotMatch(reviewFnBlock, /client_notes|client_tasks|sales_opportunities|'claims'|'documents'/i)
})

test('CarrierImportRecordReview shape: record + three optional candidates, nothing else', () => {
  const block = extractInterfaceBlock(typesSrc, 'CarrierImportRecordReview')
  assert.match(block, /record: CarrierImportRecord/)
  assert.match(block, /individualCandidate\?: CarrierIndividualCandidateSummary/)
  assert.match(block, /companyCandidate\?: CarrierCompanyCandidateSummary/)
  assert.match(block, /policyCandidate\?: CarrierPolicyCandidateSummary/)
})

// ── server function / route wiring ───────────────────────────────────────

test('SERVER-FN: adminGetCarrierImportRecordReview is admin-only and the route never queries Supabase directly', () => {
  const marker = 'export const adminGetCarrierImportRecordReview = createServerFn'
  const serverFnsSrc = readFileSync(join(__dirname, 'server-fns.ts'), 'utf8')
  const startIdx = serverFnsSrc.indexOf(marker)
  assert.ok(startIdx !== -1, 'adminGetCarrierImportRecordReview not found in server-fns.ts')
  const block = serverFnsSrc.slice(startIdx, serverFnsSrc.indexOf('\nexport ', startIdx + marker.length))
  assert.match(block, /requireAuthMiddleware/)
  assert.match(block, /requireRoleMiddleware\('admin'\)/)
  assert.match(block, /db\.getCarrierImportRecordReview/)

  const runDetailRouteSrc = readFileSync(join(__dirname, '../routes/admin.carrier-integrations.runs.$id.tsx'), 'utf8')
  assert.match(runDetailRouteSrc, /adminGetCarrierImportRecordReview/)
  assert.doesNotMatch(runDetailRouteSrc, /@supabase|createClient\(/, 'the run-detail route must not talk to Supabase directly')
})

// ── Policy duplicate review UX ───────────────────────────────────────────

function extractPolicyDialogBlock(): string {
  const marker = '{pendingPolicyCreate && ('
  const startIdx = adminSrc.indexOf(marker)
  assert.ok(startIdx !== -1, 'Policy DuplicateWarningDialog usage not found')
  const closeMarker = '\n                )}'
  const endIdx = adminSrc.indexOf(closeMarker, startIdx)
  assert.ok(endIdx !== -1, 'could not find the end of the Policy DuplicateWarningDialog block')
  return adminSrc.slice(startIdx, endIdx)
}

test('POLICY REVIEW ACTION: the Policy duplicate-warning dialog exposes a "Review existing policy" action', () => {
  const block = extractPolicyDialogBlock()
  assert.match(block, /reviewLabel="Review existing policy"/)
  assert.match(block, /onReviewCandidates=/)
})

test('MULTIPLE POLICY CANDIDATES SAFE: the review handler processes every candidate id, never just candidateIds[0]', () => {
  const block = extractPolicyDialogBlock()
  assert.match(block, /candidateIds\s*\n?\s*\.map\(/, 'must map over the full candidateIds array')
  assert.doesNotMatch(block, /candidateIds\[0\]/, 'must never pick "the first candidate" as authoritative')
})

test('MULTIPLE POLICY CANDIDATES SAFE: continuing to create is unaffected by the review action — same adminCreatePolicy call as before', () => {
  const block = extractPolicyDialogBlock()
  assert.match(block, /adminCreatePolicy\(\{ data \}\)/)
})

test('DuplicateWarningDialog: onReview (Person/Company single-target) is untouched by the new onReviewCandidates prop', () => {
  const marker = 'function DuplicateWarningDialog('
  const startIdx = adminSrc.indexOf(marker)
  const endIdx = adminSrc.indexOf('\n}\n', startIdx)
  const block = adminSrc.slice(startIdx, endIdx)
  assert.match(block, /onReview\?\s*:\s*\(candidateId: string\) => void/)
  assert.match(block, /onClick=\{\(\) => onReview\(warning\.candidateIds\[0\]!\)\}/)
  assert.match(block, /onReviewCandidates\?\s*:\s*\(candidateIds: string\[\]\) => void/)
})
