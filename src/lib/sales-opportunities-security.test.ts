import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * sales-opportunities-security.test.ts — prova, por inspeção do código-fonte
 * real (migration SQL + server-fns.ts), os requisitos de segurança do
 * pipeline comercial (CRM 2, fase 1):
 *   - sales_opportunities tem RLS ligado e as 4 políticas são admin-only
 *   - nenhuma política depende de individual_client_id/auth.uid()/
 *     is_company_member() (B2C e B2B nunca devem conseguir ler esta tabela)
 *   - toda a server function comercial exige requireRoleMiddleware('admin'),
 *     não só requireAuthMiddleware
 *
 * Não existe neste ambiente uma instância Postgres real com RLS a correr,
 * por isso este ficheiro não pode provar em runtime que um pedido
 * autenticado como B2C/B2B é de facto rejeitado pela BD — prova que a
 * política escrita na migration, e o middleware escrito no server-fn, dizem
 * exatamente o que têm de dizer. Ver "riscos" no relatório desta fase para
 * a limitação explícita.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationSql = readFileSync(join(__dirname, '../../migrations/20260829_sales_opportunities.sql'), 'utf8')
const serverFnsSrc = readFileSync(join(__dirname, 'server-fns.ts'), 'utf8')

test('RLS: sales_opportunities has row level security enabled', () => {
  assert.match(migrationSql, /ALTER TABLE public\.sales_opportunities ENABLE ROW LEVEL SECURITY/)
})

test('RLS: sales_opportunities has exactly SELECT/INSERT/UPDATE/DELETE policies, all gated by public.is_admin()', () => {
  const policyBlocks = migrationSql.match(/CREATE POLICY sales_opportunities_\w+[\s\S]*?;/g) ?? []
  assert.equal(policyBlocks.length, 4, `expected exactly 4 policies, found ${policyBlocks.length}`)

  const kinds = policyBlocks.map((block) => block.match(/FOR (SELECT|INSERT|UPDATE|DELETE)/)?.[1])
  assert.deepEqual(new Set(kinds), new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE']))

  for (const block of policyBlocks) {
    assert.match(block, /public\.is_admin\(\)/, `policy missing is_admin() check:\n${block}`)
  }
})

test('SECURITY: no client-facing predicate leaks into the sales_opportunities policies — B2C/B2B must never read this table', () => {
  const policySection = migrationSql.slice(migrationSql.indexOf('CREATE POLICY sales_opportunities_select'))
  assert.doesNotMatch(
    policySection,
    /individual_client_id\s*=/,
    'a policy scoped by individual_client_id would let a B2C client read their own opportunities',
  )
  assert.doesNotMatch(
    policySection,
    /auth\.uid\(\)/,
    'a policy based on auth.uid() would expose opportunities to any authenticated user',
  )
  assert.doesNotMatch(
    policySection,
    /is_company_member/i,
    'a company-member policy would expose opportunities to B2B company_users',
  )
})

test('XOR: sales_opportunities enforces exactly one of company_id/individual_client_id, same pattern as client_notes/client_tasks', () => {
  assert.match(migrationSql, /CONSTRAINT sales_opportunities_scope_xor CHECK/)
  assert.match(migrationSql, /\(NULLIF\(company_id, ''\) IS NOT NULL\)\s*<>\s*\(individual_client_id IS NOT NULL\)/)
})

test('IDEMPOTENCY: website_lead_id has a partial unique index (never two opportunities for the same website_lead)', () => {
  assert.match(migrationSql, /CREATE UNIQUE INDEX IF NOT EXISTS sales_opportunities_website_lead_id_uidx/)
  assert.match(migrationSql, /ON public\.sales_opportunities \(website_lead_id\) WHERE website_lead_id IS NOT NULL/)
})

test('DELETE BEHAVIOUR: website_lead deleted -> opportunity survives (SET NULL); client deleted -> opportunity follows (CASCADE)', () => {
  assert.match(
    migrationSql,
    /website_lead_id\s+uuid\s+REFERENCES public\.website_leads\(id\) ON DELETE SET NULL/,
  )
  assert.match(migrationSql, /company_id\s+text\s+REFERENCES public\.companies\(id\) ON DELETE CASCADE/)
  assert.match(
    migrationSql,
    /individual_client_id\s+uuid\s+REFERENCES public\.individual_clients\(id\) ON DELETE CASCADE/,
  )
})

test('client_tasks.source CHECK gains "opportunity" without dropping the existing manual/renewal values', () => {
  assert.match(migrationSql, /CHECK \(source IN \('manual', 'renewal', 'opportunity'\)\)/)
})

test('client_tasks gains a nullable opportunity_id FK with ON DELETE SET NULL and an index', () => {
  assert.match(
    migrationSql,
    /ADD COLUMN IF NOT EXISTS opportunity_id uuid REFERENCES public\.sales_opportunities\(id\) ON DELETE SET NULL/,
  )
  assert.match(migrationSql, /CREATE INDEX IF NOT EXISTS client_tasks_opportunity_id_idx/)
})

/**
 * REGRESSÃO — bug descoberto numa tentativa real de migration em produção
 * (2026-08-29): a constraint existente em produção,
 * "client_tasks_source_check", está normalizada pelo Postgres para
 * "source = ANY (ARRAY[...])" em vez da forma escrita "source IN (...)".
 * A versão anterior do bloco DO $$ procurava a constraint a substituir com
 * `pg_get_constraintdef(pgc.oid) ILIKE '%source%IN%'`, que não apanha essa
 * forma normalizada (não existe a substring "IN"). A DROP nunca corria, o
 * ADD CONSTRAINT seguinte falhava com 42710 (already exists), e a
 * transação inteira era revertida — sales_opportunities nunca chegava a
 * ser criada. Estes testes impedem a reintrodução dessa suposição textual.
 */
function extractSourceCheckDoBlock(): string {
  const marker = 'ALTER TABLE public.client_tasks\n  ADD CONSTRAINT client_tasks_source_check'
  const doStart = migrationSql.lastIndexOf('DO $$', migrationSql.indexOf(marker))
  assert.ok(doStart !== -1, 'could not locate the DO $$ block preceding the client_tasks_source_check ADD CONSTRAINT')
  const doEnd = migrationSql.indexOf('END $$;', doStart)
  assert.ok(doEnd !== -1, 'could not locate the end of the DO $$ block')
  return migrationSql.slice(doStart, doEnd + 'END $$;'.length)
}

test('REGRESSION: client_tasks source-constraint discovery is catalog-based (conkey + pg_attribute), not text matching on pg_get_constraintdef()', () => {
  const block = extractSourceCheckDoBlock()

  // A causa raiz do bug de produção: nunca voltar a confiar no texto
  // pretty-printed da definição da constraint para decidir o que fazer.
  assert.doesNotMatch(
    block,
    /pg_get_constraintdef/i,
    'must not inspect pg_get_constraintdef() text — Postgres normalizes CHECK definitions ' +
      '(e.g. "source = ANY (ARRAY[...])") differently from how they were written ("source IN (...)"), ' +
      'so text matching against it is unreliable',
  )
  assert.doesNotMatch(
    block,
    /ILIKE\s*'%[^']*IN[^']*%'/i,
    'must not pattern-match "IN" against constraint text — this is exactly the pattern that missed ' +
      'the production "source = ANY (ARRAY[...])" normalized form',
  )

  // A correção: identificar a constraint estruturalmente via catálogo.
  assert.match(block, /pg_attribute/, 'must resolve the "source" column via pg_attribute')
  assert.match(block, /attname\s*=\s*'source'/, 'must look up the attnum for the "source" column specifically')
  assert.match(
    block,
    /source_attnum\s*=\s*ANY\s*\(\s*pgc\.conkey\s*\)/,
    'must match constraints structurally via pg_constraint.conkey, not via textual definition',
  )

  // Continua com o mesmo âmbito estrito de sempre.
  assert.match(block, /nsp\.nspname\s*=\s*'public'/, 'must scope to schema public')
  assert.match(block, /rel\.relname\s*=\s*'client_tasks'/, 'must scope to table client_tasks')
  assert.match(block, /pgc\.contype\s*=\s*'c'/, 'must scope to CHECK constraints only')
})

test('REGRESSION: the source-constraint discovery never targets unrelated client_tasks CHECK constraints by name', () => {
  const block = extractSourceCheckDoBlock()
  assert.doesNotMatch(block, /client_tasks_scope_xor/, 'must not reference/drop the scope XOR constraint')
  assert.doesNotMatch(block, /client_tasks_status_check/, 'must not reference/drop the status constraint')
})

test('REGRESSION: the source-constraint block is safely re-runnable — it always drops-and-recreates by structural match, never assumes absence', () => {
  const block = extractSourceCheckDoBlock()
  // A garantia de idempotência: o loop de DROP não depende de o nome já
  // ser conhecido — encontra qualquer CHECK que dependa da coluna
  // "source" (incluindo o que ele próprio recriou numa corrida anterior)
  // e remove-o antes do ADD CONSTRAINT seguinte, portanto nunca pode
  // falhar com "constraint ... already exists".
  assert.match(block, /DROP CONSTRAINT %I/, 'must drop whatever constraint(s) it structurally finds before the ADD CONSTRAINT below')
})

const SALES_SERVER_FN_NAMES = [
  'fetchSalesOpportunities',
  'fetchSalesOpportunity',
  'fetchSalesOpportunitiesByOwner',
  'adminCreateSalesOpportunity',
  'adminUpdateSalesOpportunity',
  'adminUpdateSalesOpportunityStage',
  'adminDeleteSalesOpportunity',
  'fetchSalesPipelineStats',
  'adminCreateOpportunityFollowUpTask',
]

function extractServerFnBlock(name: string): string {
  const marker = `export const ${name} = createServerFn`
  const startIdx = serverFnsSrc.indexOf(marker)
  assert.ok(startIdx !== -1, `server function "${name}" not found in server-fns.ts`)
  const nextExportIdx = serverFnsSrc.indexOf('\nexport ', startIdx + marker.length)
  return serverFnsSrc.slice(startIdx, nextExportIdx === -1 ? undefined : nextExportIdx)
}

test('SECURITY: every sales-opportunity server function requires admin role, never just an authenticated session', () => {
  for (const name of SALES_SERVER_FN_NAMES) {
    const block = extractServerFnBlock(name)
    assert.match(block, /requireAuthMiddleware/, `${name} is missing requireAuthMiddleware`)
    assert.match(block, /requireRoleMiddleware\('admin'\)/, `${name} is missing requireRoleMiddleware('admin')`)
  }
})

test('SECURITY: none of the sales-opportunity server functions is exported with only requireAuthMiddleware', () => {
  for (const name of SALES_SERVER_FN_NAMES) {
    const block = extractServerFnBlock(name)
    const middlewareLine = block.match(/\.middleware\(\[([^\]]*)\]\)/)?.[1] ?? ''
    assert.match(middlewareLine, /requireRoleMiddleware\('admin'\)/, `${name}'s middleware array lacks the admin role check: [${middlewareLine}]`)
  }
})
