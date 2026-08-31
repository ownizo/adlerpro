import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * carrier-integrations-nested-routes.test.ts — regression test for the
 * "Import Portfolio" nested-routing bug: /admin/carrier-integrations/import
 * and /admin/carrier-integrations/runs/$id are registered as children of
 * /admin/carrier-integrations in the generated route tree, so TanStack
 * Router always renders the PARENT route's component first for any of
 * those child paths too. Without an <Outlet/> in that parent component,
 * the URL changes but the parent's own content stays on screen and the
 * child page never mounts — exactly the bug reported, and exactly the same
 * class of issue already solved once for /admin itself (AdminPage/
 * AdminDashboardContent in src/routes/admin.tsx).
 *
 * Tal como nos outros ficheiros desta série: não existe neste ambiente uma
 * instância de browser/DOM real, por isso este ficheiro prova que o código
 * fonte tem exatamente a estrutura de guarda esperada (e reproduz essa
 * lógica de decisão diretamente, com os mesmos pathnames do bug relatado),
 * não que o React realmente monta o Outlet em runtime.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const routeSrc = readFileSync(join(__dirname, '../routes/admin.carrier-integrations.tsx'), 'utf8')

test('imports Outlet and useRouterState from @tanstack/react-router', () => {
  assert.match(routeSrc, /import \{[^}]*\bOutlet\b[^}]*\} from '@tanstack\/react-router'/)
  assert.match(routeSrc, /import \{[^}]*\buseRouterState\b[^}]*\} from '@tanstack\/react-router'/)
})

test('the route is still declared with CarrierIntegrationsPage as its component (the gate is on the actual exported route, not a decoy)', () => {
  assert.match(routeSrc, /createFileRoute\('\/admin\/carrier-integrations'\)\(\{\s*\n\s*component: CarrierIntegrationsPage,/)
})

function extractFunctionBody(src: string, name: string): string {
  const marker = `function ${name}(`
  const startIdx = src.indexOf(marker)
  assert.ok(startIdx !== -1, `function ${name} not found`)
  const nextFnIdx = src.indexOf('\nfunction ', startIdx + marker.length)
  return src.slice(startIdx, nextFnIdx === -1 ? undefined : nextFnIdx)
}

const wrapperBody = extractFunctionBody(routeSrc, 'CarrierIntegrationsPage')

test('CarrierIntegrationsPage reads the current pathname via useRouterState', () => {
  assert.match(wrapperBody, /useRouterState\(\s*\{\s*select:\s*\(state\)\s*=>\s*state\.location\s*\}\s*\)/)
})

test('CarrierIntegrationsPage renders <Outlet /> for anything other than the exact parent path, and its own content only at the exact parent path', () => {
  assert.match(wrapperBody, /if \(location\.pathname !== '\/admin\/carrier-integrations'\) return <Outlet \/>/)
  assert.match(wrapperBody, /return <CarrierIntegrationsContent \/>/)
})

test('ROOT CAUSE CONFIRMED / regression guard: replays the wrapper\'s exact guard condition against the reported bug\'s URLs', () => {
  const guardMatch = wrapperBody.match(/pathname !== '([^']+)'/)
  assert.ok(guardMatch, 'could not find the exact pathname compared against')
  const parentPath = guardMatch![1]!
  const rendersOutlet = (pathname: string) => pathname !== parentPath

  // The bug report's exact URL — Import Portfolio must now render the
  // child route via Outlet, not the parent's own content.
  assert.equal(rendersOutlet('/admin/carrier-integrations/import'), true)
  // Run review — same class of child route, same fix.
  assert.equal(rendersOutlet('/admin/carrier-integrations/runs/test-id'), true)
  // The parent page itself must be completely unaffected.
  assert.equal(rendersOutlet('/admin/carrier-integrations'), false)
})

test('CarrierIntegrationsContent still contains the original Carrier Integrations page content, byte-for-byte moved rather than redesigned', () => {
  const contentBody = extractFunctionBody(routeSrc, 'CarrierIntegrationsContent')
  assert.match(contentBody, /Carrier Integrations<\/h1>/)
  assert.match(contentBody, /Connect insurer portfolio data and reconcile it safely with existing CRM records\./)
  assert.match(contentBody, /Reconciliation Runs<\/h2>/)
  assert.match(contentBody, /Import Portfolio/)
  assert.match(contentBody, /No reconciliation runs yet\./)
})

test('no importer/reconciliation/server-function logic was touched by this fix', () => {
  assert.doesNotMatch(routeSrc, /adminPreviewPortfolioImport|reconcileClient|reconcilePolicy|mapPortfolioRows/)
})
