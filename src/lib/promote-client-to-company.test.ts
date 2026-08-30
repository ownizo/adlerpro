import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * promote-client-to-company.test.ts — prova, por inspeção do código-fonte
 * real (migration SQL + server-fns.ts + data.ts), que a correção do bug de
 * perda de histórico em adminPromoteToCompany (CRM3 audit, 2026-08-30) tem
 * exatamente a forma exigida:
 *   - todo o child record (policies, claims, documents, client_notes,
 *     client_tasks, sales_opportunities, website_leads) é re-parentado
 *     ANTES do individual_clients ser apagado
 *   - a operação inteira acontece dentro de uma única chamada RPC (uma
 *     transação implícita do Postgres) em vez de uma sequência de updates
 *     client-side independentes
 *   - website_leads passa a suportar company_id com o mesmo padrão XOR de
 *     client_notes/client_tasks/sales_opportunities
 *   - a nova função só pode ser chamada pelo service_role
 *   - adminPromoteToCompany continua admin-only e preserva a lógica de
 *     resolução de company existente por NIF (exact match, sem fuzzy)
 *   - o helper antigo deleteIndividualClientRelations (que apaga, não
 *     re-parenta) deixou de ser usado na promoção
 *
 * Tal como em sales-opportunities-security.test.ts: não existe neste
 * ambiente uma instância Postgres real, por isso este ficheiro não pode
 * executar a função e verificar o resultado em runtime — prova que o SQL e
 * o TypeScript escritos dizem exatamente o que têm de dizer.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationSql = readFileSync(
  join(__dirname, '../../migrations/20260830_fix_promote_client_to_company.sql'),
  'utf8',
)
const serverFnsSrc = readFileSync(join(__dirname, 'server-fns.ts'), 'utf8')
const dataSrc = readFileSync(join(__dirname, 'data.ts'), 'utf8')

function extractServerFnBlock(name: string): string {
  const marker = `export const ${name} = createServerFn`
  const startIdx = serverFnsSrc.indexOf(marker)
  assert.ok(startIdx !== -1, `server function "${name}" not found in server-fns.ts`)
  const nextExportIdx = serverFnsSrc.indexOf('\nexport ', startIdx + marker.length)
  return serverFnsSrc.slice(startIdx, nextExportIdx === -1 ? undefined : nextExportIdx)
}

function extractSqlFunctionBody(): string {
  const marker = 'CREATE OR REPLACE FUNCTION public.promote_individual_client_to_company_relations'
  const startIdx = migrationSql.indexOf(marker)
  assert.ok(startIdx !== -1, 'promote_individual_client_to_company_relations not found in migration')
  const endIdx = migrationSql.indexOf('\n$$;', startIdx)
  assert.ok(endIdx !== -1, 'could not find end of function body ($$;)')
  return migrationSql.slice(startIdx, endIdx)
}

const REPARENTED_TABLES = [
  'policies',
  'claims',
  'documents',
  'client_notes',
  'client_tasks',
  'sales_opportunities',
  'website_leads',
] as const

test('TRANSACTIONAL: re-parenting happens inside a single SQL function (one implicit transaction), not client-side', () => {
  const block = extractServerFnBlock('adminPromoteToCompany')
  assert.match(
    block,
    /db\.promoteIndividualClientToCompanyRelations\(/,
    'adminPromoteToCompany must delegate re-parenting + delete to the atomic RPC wrapper',
  )
  assert.doesNotMatch(
    block,
    /\.from\('individual_clients'\)\s*\.\s*delete\(\)/,
    'adminPromoteToCompany must not delete individual_clients directly — the delete must happen ' +
      'inside promote_individual_client_to_company_relations, after every child table is re-parented',
  )
  assert.doesNotMatch(
    block,
    /db\.deleteIndividualClientRelations/,
    'promotion must not use deleteIndividualClientRelations — that helper deletes CRM history ' +
      '(claims, policies), which is correct for "delete client" but wrong for "promote client"',
  )
})

test('SQL FUNCTION: re-parents every affected table (sets company_id, clears individual_client_id)', () => {
  const body = extractSqlFunctionBody()
  for (const table of REPARENTED_TABLES) {
    const re = new RegExp(
      `UPDATE public\\.${table}\\s+SET company_id = p_company_id, individual_client_id = NULL\\s+WHERE individual_client_id::text = p_client_id`,
    )
    assert.match(body, re, `missing re-parenting UPDATE for public.${table}`)
  }
})

test('SQL FUNCTION: individual_clients is deleted only after every re-parenting UPDATE, never before', () => {
  const body = extractSqlFunctionBody()
  const deleteIdx = body.indexOf('DELETE FROM public.individual_clients')
  assert.ok(deleteIdx !== -1, 'DELETE FROM public.individual_clients not found')

  for (const table of REPARENTED_TABLES) {
    const updateIdx = body.indexOf(`UPDATE public.${table}\n`)
    assert.ok(updateIdx !== -1, `UPDATE for public.${table} not found`)
    assert.ok(
      updateIdx < deleteIdx,
      `UPDATE public.${table} must appear before DELETE FROM public.individual_clients (found at ${updateIdx} vs ${deleteIdx})`,
    )
  }
})

test('SQL FUNCTION: guards against a non-existent destination company or source client before touching any row', () => {
  const body = extractSqlFunctionBody()
  assert.match(body, /NOT EXISTS \(SELECT 1 FROM public\.companies WHERE id = p_company_id\)/)
  assert.match(body, /NOT EXISTS \(SELECT 1 FROM public\.individual_clients WHERE id::text = p_client_id\)/)
  // Both guards must appear before the first UPDATE, so an invalid call
  // raises before any row is modified.
  const firstGuardIdx = body.indexOf('RAISE EXCEPTION')
  const firstUpdateIdx = body.indexOf('UPDATE public.policies')
  assert.ok(firstGuardIdx !== -1 && firstGuardIdx < firstUpdateIdx, 'guards must run before any UPDATE')
})

test('ROLLBACK: no explicit COMMIT/nested transaction control inside the function body (a single call is already one atomic transaction)', () => {
  const body = extractSqlFunctionBody()
  assert.doesNotMatch(body, /\bCOMMIT\b/i)
  assert.doesNotMatch(body, /\bBEGIN\s+TRANSACTION\b/i)
})

test('SECURITY: promote_individual_client_to_company_relations is revoked from PUBLIC/anon/authenticated and granted only to service_role', () => {
  assert.match(
    migrationSql,
    /REVOKE ALL ON FUNCTION public\.promote_individual_client_to_company_relations\(text, text\) FROM PUBLIC;/,
  )
  assert.match(
    migrationSql,
    /REVOKE ALL ON FUNCTION public\.promote_individual_client_to_company_relations\(text, text\) FROM anon, authenticated;/,
  )
  assert.match(
    migrationSql,
    /GRANT EXECUTE ON FUNCTION public\.promote_individual_client_to_company_relations\(text, text\) TO service_role;/,
  )
})

test('SECURITY: the function is not SECURITY DEFINER (no RLS-bypass exposure to control)', () => {
  const body = extractSqlFunctionBody()
  assert.doesNotMatch(body, /SECURITY DEFINER/)
})

test('SECURITY: adminPromoteToCompany still requires admin role, not just an authenticated session', () => {
  const block = extractServerFnBlock('adminPromoteToCompany')
  assert.match(block, /requireAuthMiddleware/)
  assert.match(block, /requireRoleMiddleware\('admin'\)/)
})

test('EXISTING COMPANY MATCH: NIF lookup stays an exact match, no fuzzy matching introduced', () => {
  const block = extractServerFnBlock('adminPromoteToCompany')
  assert.match(block, /\.from\('companies'\)\.select\('id'\)\.eq\('nif', nif\)\.maybeSingle\(\)/)
  assert.doesNotMatch(block, /ilike|similarity|levenshtein|soundex/i)
})

test('WEBSITE_LEADS: gains nullable individual_client_id + company_id with the same XOR pattern as client_notes/client_tasks/sales_opportunities', () => {
  assert.match(migrationSql, /ALTER COLUMN individual_client_id DROP NOT NULL/)
  assert.match(
    migrationSql,
    /ADD COLUMN IF NOT EXISTS company_id text REFERENCES public\.companies\(id\) ON DELETE CASCADE/,
  )
  assert.match(migrationSql, /CONSTRAINT website_leads_scope_xor CHECK/)
  assert.match(migrationSql, /\(NULLIF\(company_id, ''\) IS NOT NULL\)\s*<>\s*\(individual_client_id IS NOT NULL\)/)
})

test('WEBSITE_LEADS: history is never deleted by this fix — no DELETE FROM website_leads anywhere in the migration', () => {
  assert.doesNotMatch(migrationSql, /DELETE FROM (public\.)?website_leads/)
})

test('DOCUMENTS: individual_client_id is explicitly cleared, so ownership is never left ambiguous (both columns set) after promotion', () => {
  const body = extractSqlFunctionBody()
  assert.match(
    body,
    /UPDATE public\.documents\s+SET company_id = p_company_id, individual_client_id = NULL/,
  )
})

test('WebsiteLead type: individualClientId is now optional and companyId is a valid alternative owner', () => {
  const typesSrc = readFileSync(join(__dirname, 'types.ts'), 'utf8')
  const startIdx = typesSrc.indexOf('export interface WebsiteLead')
  assert.ok(startIdx !== -1, 'WebsiteLead interface not found')
  const endIdx = typesSrc.indexOf('}', startIdx)
  const block = typesSrc.slice(startIdx, endIdx)
  assert.match(block, /companyId\?:\s*string/)
  assert.match(block, /individualClientId\?:\s*string/)
})

test('DATA LAYER: promoteIndividualClientToCompanyRelations calls the RPC by exact name with clientId/companyId params', () => {
  const startIdx = dataSrc.indexOf('export async function promoteIndividualClientToCompanyRelations')
  assert.ok(startIdx !== -1, 'promoteIndividualClientToCompanyRelations not found in data.ts')
  const endIdx = dataSrc.indexOf('\nexport ', startIdx + 10)
  const block = dataSrc.slice(startIdx, endIdx === -1 ? undefined : endIdx)
  assert.match(block, /'promote_individual_client_to_company_relations'/)
  assert.match(block, /p_client_id:\s*clientId/)
  assert.match(block, /p_company_id:\s*companyId/)
})
