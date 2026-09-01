import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * carrier-decision-status-safety.test.ts — HOTFIX: Charles's row (MGEN
 * 75849, carrier_import_records id 95295e7b-48e5-4428-b84c-40c2ec23e0cb)
 * was explicitly accepted, then had its apply action configured
 * (customer=existing Charles, policy=update_existing_policy against
 * pol_1787378670711, approved policyNumber/endDate/annualPremium) —
 * after saving, decision_status had become 'ignored'.
 *
 * INVESTIGATION FINDING: setCarrierImportRecordApplyActions (data.ts)
 * was ALREADY correct — its persisted update payload never includes
 * decisionStatus, confirmed below. adminIgnoreCarrierImportDecision is
 * called from exactly one place in the entire codebase: the "Ignore"
 * button in admin.carrier-integrations.runs.$id.tsx's review panel —
 * which renders in the SAME panel as, and stays fully live and
 * single-click during, apply-action editing (the "Apply action"
 * section only ever renders once decision_status='accepted'). The fix
 * is a confirm() guard on that one button — the same pattern this
 * codebase already uses everywhere else for a single click that fires
 * a real mutation (see admin.tsx) — not a change to the save path,
 * which was never the problem.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataSrc = readFileSync(join(__dirname, 'data.ts'), 'utf8')
const routeSrc = readFileSync(join(__dirname, '../routes/admin.carrier-integrations.runs.$id.tsx'), 'utf8')

function extractDataFnBlock(name: string): string {
  const marker = `export async function ${name}(`
  const startIdx = dataSrc.indexOf(marker)
  assert.ok(startIdx !== -1, `data function "${name}" not found in data.ts`)
  const nextExportIdx = dataSrc.indexOf('\nexport ', startIdx + marker.length)
  return dataSrc.slice(startIdx, nextExportIdx === -1 ? undefined : nextExportIdx)
}

// ── save function itself: confirmed already correct ────────────────

test('REGRESSION: setCarrierImportRecordApplyActions never persists decisionStatus/decision_status — saving/editing apply actions cannot mutate the decision', () => {
  const block = extractDataFnBlock('setCarrierImportRecordApplyActions')
  const updatesObjIdx = block.indexOf('const updates = objectToSnake({')
  assert.ok(updatesObjIdx !== -1, 'expected the persisted updates object literal')
  const updatesObjEnd = block.indexOf('})', updatesObjIdx)
  const updatesObjLiteral = block.slice(updatesObjIdx, updatesObjEnd)
  assert.doesNotMatch(updatesObjLiteral, /decisionStatus|decision_status/)
})

test('setCarrierImportRecordApplyActions never calls updateCarrierImportDecision or otherwise reaches the decision-mutating code path', () => {
  const block = extractDataFnBlock('setCarrierImportRecordApplyActions')
  assert.doesNotMatch(block, /updateCarrierImportDecision/)
})

// ── the actual UI path: the Ignore button, now confirm-guarded ─────

function extractIgnoreButtonBlock(): string {
  const idx = routeSrc.indexOf('adminIgnoreCarrierImportDecision({ data:')
  assert.ok(idx !== -1, 'Ignore button onClick not found')
  // Walk back to the start of this button's onClick handler.
  const onClickIdx = routeSrc.lastIndexOf('onClick={', idx)
  const buttonCloseIdx = routeSrc.indexOf('</button>', idx)
  return routeSrc.slice(onClickIdx, buttonCloseIdx)
}

test('HOTFIX: the Ignore button requires an explicit confirm() before it ever calls adminIgnoreCarrierImportDecision', () => {
  const block = extractIgnoreButtonBlock()
  const confirmIdx = block.indexOf('confirm(')
  const callIdx = block.indexOf('adminIgnoreCarrierImportDecision(')
  assert.ok(confirmIdx !== -1, 'missing confirm() guard on the Ignore button')
  assert.ok(callIdx !== -1)
  assert.ok(confirmIdx < callIdx, 'confirm() must run before the Ignore mutation fires')
  assert.match(block, /if \(!confirm\(/, 'must actually gate on the confirm result, not just call it')
})

test('adminIgnoreCarrierImportDecision is called from exactly one place in the whole app — the Ignore button itself', () => {
  assert.match(routeSrc, /import \{[^}]*\badminIgnoreCarrierImportDecision\b[^}]*\}/)
  const callSites = [...routeSrc.matchAll(/[^a-zA-Z]adminIgnoreCarrierImportDecision\(\{/g)]
  assert.equal(callSites.length, 1, `expected exactly one call site, found ${callSites.length}`)
})

// ── save/apply-action editing path never touches Ignore/Reject/Accept ─

function extractRouteFn(name: string): string {
  const marker = `async function ${name}(`
  const startIdx = routeSrc.indexOf(marker)
  assert.ok(startIdx !== -1, `${name} not found in the route file`)
  // Bracket-match the function body.
  let depth = 0
  let i = routeSrc.indexOf('{', startIdx)
  const bodyStart = i
  for (; i < routeSrc.length; i++) {
    if (routeSrc[i] === '{') depth++
    else if (routeSrc[i] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return routeSrc.slice(bodyStart, i + 1)
}

test('DEFENSIVE: saveApplyAction (manual policy selection/update, including Charles\'s update_existing_policy flow) never calls adminIgnoreCarrierImportDecision, adminRejectCarrierImportDecision, or adminAcceptCarrierImportDecision', () => {
  const block = extractRouteFn('saveApplyAction')
  assert.doesNotMatch(block, /adminIgnoreCarrierImportDecision|adminRejectCarrierImportDecision|adminAcceptCarrierImportDecision/)
  assert.match(block, /adminSetCarrierImportRecordApplyActions/)
})

test('DEFENSIVE: saveApplyAction never sets or references decisionStatus/decisionNote in its outgoing payload', () => {
  const block = extractRouteFn('saveApplyAction')
  const payloadIdx = block.indexOf('await adminSetCarrierImportRecordApplyActions({')
  assert.ok(payloadIdx !== -1)
  const payloadEnd = block.indexOf('})', payloadIdx)
  const payload = block.slice(payloadIdx, payloadEnd)
  assert.doesNotMatch(payload, /decisionStatus|decisionNote/)
})

// ── Accept/Reject remain single-click (scoped fix — Ignore only) ────

test('scope check: the fix is scoped to Ignore — Accept decision is unchanged (still a direct, single-click action, per the review\'s own instruction not to redesign)', () => {
  const acceptIdx = routeSrc.indexOf('adminAcceptCarrierImportDecision({ data:')
  assert.ok(acceptIdx !== -1)
  const onClickIdx = routeSrc.lastIndexOf('onClick={() =>', acceptIdx)
  const buttonSlice = routeSrc.slice(onClickIdx, acceptIdx + 40)
  assert.doesNotMatch(buttonSlice, /confirm\(/)
})
