import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * promote-client-to-company.test.ts — prova, por inspeção do código-fonte
 * real (migration SQL + server-fns.ts + data.ts), que a correção do bug de
 * perda de histórico em adminPromoteToCompany (CRM3 audit, 2026-08-30) tem
 * exatamente a forma exigida, incluindo a correção de transacionalidade
 * (review seguinte, mesmo dia): a promoção inteira — resolver/criar a
 * company, re-parentar tudo, apagar o individual_client — tem de acontecer
 * dentro de UMA única chamada RPC/transação, não só o re-parenting.
 *
 *   - server-fns.ts não faz nenhum INSERT/UPDATE/DELETE direto na promoção
 *     — a única mutação é a chamada RPC
 *   - a função SQL lê o individual_client de origem, resolve/cria a company,
 *     re-parenta todas as tabelas-filho e só depois apaga o cliente — tudo
 *     na mesma função, na ordem certa
 *   - a criação de company está dentro da função (rollback automático se
 *     algo falhar depois)
 *   - a resolução de company existente continua exact-match por NIF, sem
 *     fuzzy matching
 *   - existe proteção de concorrência (advisory lock) para NIFs iguais
 *   - a nova função só pode ser chamada pelo service_role
 *   - website_leads continua com o mesmo design (nullable + XOR)
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
  const marker = 'CREATE OR REPLACE FUNCTION public.promote_individual_client_to_company('
  const startIdx = migrationSql.indexOf(marker)
  assert.ok(startIdx !== -1, 'promote_individual_client_to_company not found in migration')
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

test('SERVER-FN: adminPromoteToCompany performs exactly one mutation — the atomic RPC call — and nothing else', () => {
  const block = extractServerFnBlock('adminPromoteToCompany')

  assert.match(
    block,
    /db\.promoteIndividualClientToCompany\(data\.clientId\)/,
    'adminPromoteToCompany must delegate the entire promotion to the atomic RPC wrapper',
  )

  // No direct company/individual_client mutation of any kind left in TS.
  assert.doesNotMatch(block, /\.from\('companies'\)\s*\.\s*insert\(/, 'must not INSERT companies in TypeScript')
  assert.doesNotMatch(block, /\.from\('companies'\)\s*\.\s*select\(/, 'must not look up companies in TypeScript')
  assert.doesNotMatch(
    block,
    /\.from\('individual_clients'\)\s*\.\s*(select|delete)\(/,
    'must not read or delete individual_clients in TypeScript — the RPC does both, atomically',
  )
  assert.doesNotMatch(
    block,
    /db\.deleteIndividualClientRelations/,
    'promotion must not use deleteIndividualClientRelations — that helper deletes CRM history ' +
      '(claims, policies), which is correct for "delete client" but wrong for "promote client"',
  )
  // The superseded relations-only RPC must not still be called anywhere.
  assert.doesNotMatch(
    block,
    /promoteIndividualClientToCompanyRelations/,
    'must call the fully atomic promoteIndividualClientToCompany, not the superseded relations-only version',
  )
})

test('SQL FUNCTION: fetches the source client itself, never trusts client/company fields passed by the caller', () => {
  const body = extractSqlFunctionBody()
  // Only p_client_id crosses the RPC boundary.
  assert.match(body, /CREATE OR REPLACE FUNCTION public\.promote_individual_client_to_company\(\s*p_client_id text\s*\)/)
  assert.match(body, /SELECT \* INTO v_client FROM public\.individual_clients WHERE id::text = p_client_id/)
})

test('SQL FUNCTION: resolves an existing company by exact NIF match, no fuzzy matching, only when NIF is non-empty', () => {
  const body = extractSqlFunctionBody()
  assert.match(body, /IF v_nif <> '' THEN/)
  assert.match(body, /WHERE nif = v_nif/)
  assert.doesNotMatch(body, /ilike|similarity|levenshtein|soundex/i)
})

test('SQL FUNCTION: creates the destination company only if none was resolved, using the client\'s own fields', () => {
  const body = extractSqlFunctionBody()
  assert.match(body, /IF v_company_id IS NULL THEN/)
  assert.match(body, /INSERT INTO public\.companies \(/)
  for (const field of ['name', 'nif', 'sector', 'contact_name', 'contact_email', 'contact_phone', 'address', 'created_at']) {
    assert.match(body, new RegExp(`\\b${field}\\b`), `company INSERT missing field ${field}`)
  }
})

test('SQL FUNCTION: company id follows the existing comp_<epoch-ms> convention (adminCreateCompany), not crypto.randomUUID()', () => {
  const body = extractSqlFunctionBody()
  assert.match(body, /'comp_'\s*\|\|/)
  assert.doesNotMatch(body, /gen_random_uuid\(\)\s*::text\s*(?:AS|,)?\s*v_company_id|v_company_id\s*:=\s*gen_random_uuid/)
})

test('SQL FUNCTION: re-parents every affected table (sets company_id, clears individual_client_id)', () => {
  const body = extractSqlFunctionBody()
  for (const table of REPARENTED_TABLES) {
    const re = new RegExp(
      `UPDATE public\\.${table}\\s+SET company_id = v_company_id, individual_client_id = NULL\\s+WHERE individual_client_id::text = p_client_id`,
    )
    assert.match(body, re, `missing re-parenting UPDATE for public.${table}`)
  }
})

test('SQL FUNCTION: company resolve/create happens before re-parenting, which happens before the source client delete', () => {
  const body = extractSqlFunctionBody()
  const nifCheckIdx = body.indexOf("IF v_nif <> '' THEN")
  const companyCreateIdx = body.indexOf('IF v_company_id IS NULL THEN')
  const firstReparentIdx = body.indexOf('UPDATE public.policies')
  const deleteIdx = body.indexOf('DELETE FROM public.individual_clients')

  assert.ok(nifCheckIdx !== -1 && companyCreateIdx !== -1 && firstReparentIdx !== -1 && deleteIdx !== -1)
  assert.ok(nifCheckIdx < companyCreateIdx, 'existing-company resolution must be attempted before company creation')
  assert.ok(companyCreateIdx < firstReparentIdx, 'company must be resolved/created before any re-parenting UPDATE')

  for (const table of REPARENTED_TABLES) {
    const updateIdx = body.indexOf(`UPDATE public.${table}\n`)
    assert.ok(updateIdx !== -1, `UPDATE for public.${table} not found`)
    assert.ok(
      updateIdx < deleteIdx,
      `UPDATE public.${table} must appear before DELETE FROM public.individual_clients (found at ${updateIdx} vs ${deleteIdx})`,
    )
  }
})

test('FULL TRANSACTIONALITY: company creation and every re-parenting UPDATE live in the SAME function body as the source-client DELETE', () => {
  const body = extractSqlFunctionBody()
  // A single function body with no nested BEGIN/COMMIT is, on its own,
  // one implicit Postgres transaction — so proving company creation, every
  // re-parenting UPDATE, and the final DELETE are all textually inside
  // this one CREATE FUNCTION...$$ ... $$ block (and that nothing splits it
  // into a separate transaction) is sufficient proof of atomicity here.
  assert.doesNotMatch(body, /\bCOMMIT\b/i)
  assert.doesNotMatch(body, /\bBEGIN\s+TRANSACTION\b/i)
  assert.match(body, /INSERT INTO public\.companies/)
  assert.match(body, /DELETE FROM public\.individual_clients/)
})

test('SQL FUNCTION: raises before touching any row when the client id is missing or the client does not exist', () => {
  const body = extractSqlFunctionBody()
  assert.match(body, /IF p_client_id IS NULL OR btrim\(p_client_id\) = '' THEN\s+RAISE EXCEPTION/)
  assert.match(body, /IF NOT FOUND THEN\s+RAISE EXCEPTION/)
  const firstGuardIdx = body.indexOf('RAISE EXCEPTION')
  const companyCreateIdx = body.indexOf('IF v_company_id IS NULL THEN')
  assert.ok(firstGuardIdx !== -1 && firstGuardIdx < companyCreateIdx, 'guards must run before company creation')
})

test('CONCURRENCY: an advisory lock keyed on the exact NIF serializes concurrent promotions for the same NIF', () => {
  const body = extractSqlFunctionBody()
  assert.match(body, /pg_advisory_xact_lock\(hashtextextended\(v_nif, 0\)\)/)
  // The lock must be taken before the existing-company SELECT, and only
  // inside the v_nif <> '' branch (no lock taken when NIF is empty).
  const nifBranchStart = body.indexOf("IF v_nif <> '' THEN")
  const lockIdx = body.indexOf('pg_advisory_xact_lock')
  const selectIdx = body.indexOf('SELECT id INTO v_company_id')
  assert.ok(nifBranchStart < lockIdx && lockIdx < selectIdx, 'lock must be taken before the existing-company lookup')
})

test('CONCURRENCY: no new UNIQUE constraint (or index) added on companies.nif', () => {
  // Checks actual SQL statements, not prose comments that merely discuss
  // the decision not to add one.
  assert.doesNotMatch(migrationSql, /ADD CONSTRAINT \S*\s+UNIQUE\s*\(\s*nif\s*\)/i)
  assert.doesNotMatch(migrationSql, /CREATE UNIQUE INDEX \S*\s+ON public\.companies\s*\(\s*nif\b/i)
})

test('SECURITY: promote_individual_client_to_company is revoked from PUBLIC/anon/authenticated and granted only to service_role', () => {
  assert.match(
    migrationSql,
    /REVOKE ALL ON FUNCTION public\.promote_individual_client_to_company\(text\) FROM PUBLIC;/,
  )
  assert.match(
    migrationSql,
    /REVOKE ALL ON FUNCTION public\.promote_individual_client_to_company\(text\) FROM anon, authenticated;/,
  )
  assert.match(
    migrationSql,
    /GRANT EXECUTE ON FUNCTION public\.promote_individual_client_to_company\(text\) TO service_role;/,
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
    /UPDATE public\.documents\s+SET company_id = v_company_id, individual_client_id = NULL/,
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

test('DATA LAYER: promoteIndividualClientToCompany calls the RPC by exact name with only the client id', () => {
  const startIdx = dataSrc.indexOf('export async function promoteIndividualClientToCompany(')
  assert.ok(startIdx !== -1, 'promoteIndividualClientToCompany not found in data.ts')
  const endIdx = dataSrc.indexOf('\nexport ', startIdx + 10)
  const block = dataSrc.slice(startIdx, endIdx === -1 ? undefined : endIdx)
  assert.match(block, /'promote_individual_client_to_company'/)
  assert.match(block, /p_client_id:\s*clientId/)
  // Confirms the RPC call carries no company data — resolution/creation is
  // entirely server-side (inside the SQL function), not client-supplied.
  assert.doesNotMatch(block, /p_company_id/)
})

test('DATA LAYER: the superseded relations-only wrapper no longer exists', () => {
  assert.doesNotMatch(dataSrc, /export async function promoteIndividualClientToCompanyRelations/)
})
