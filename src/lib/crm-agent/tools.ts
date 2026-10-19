// Tools exposed to Claude through the CRM connector (/api/mcp).
//
// Design rules:
//  - No tool deletes anything. Mistakes are fixed with update tools.
//  - Every write is logged in crm_activity (actor "claude").
//  - Emails are stored as metadata + a short snippet only (no bodies, no
//    attachments) — health questionnaires and similar never land here.
//  - Results are compact JSON so Claude can reason over them cheaply.

import { recordExternalResult, getVisibilitySummary, internalSecret } from '../ai-visibility.server.ts'
import { ENGINES, type Engine } from '../ai-visibility.ts'
import { sb, lisbonDate, addDays, isDate, cleanSearch, normalizeEmail, normalizePolicyNumber, logActivity, ToolError } from './core.ts'

type Json = Record<string, unknown>
type Schema = { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }

export type CrmTool = {
  name: string
  title: string
  description: string
  inputSchema: Schema
  readOnly: boolean
  handler: (args: Json) => Promise<unknown>
}

const ACTOR = 'claude'
const OPEN_STAGES = ['new', 'contacted', 'needs_analysis', 'quoted', 'negotiation']
const STAGES = [...OPEN_STAGES, 'won', 'lost']
const POLICY_TYPES = ['property', 'liability', 'workers_comp', 'auto', 'health', 'life', 'cyber', 'directors_officers', 'business_interruption', 'other']
const POLICY_STATUS = ['active', 'expiring', 'expired', 'cancelled']
const OPP_SOURCES = ['website', 'referral', 'phone', 'email', 'whatsapp', 'google', 'meta', 'partner', 'existing_client', 'manual', 'other']
const EMAIL_CATEGORIES = ['client', 'lead', 'insurer', 'accounting', 'other']

const str = (v: unknown, max = 500): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined)
const int = (v: unknown, def: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(num(v) ?? def)))

const ownerProps = {
  individual_client_id: { type: 'string', description: 'UUID of the person (individual client).' },
  company_id: { type: 'string', description: 'ID of the company client.' },
}

function owner(args: Json, required = true): { individual_client_id: string | null; company_id: string | null } {
  const ic = str(args.individual_client_id, 64) ?? null
  const co = str(args.company_id, 64) ?? null
  if (ic && co) throw new ToolError('Give either individual_client_id or company_id, not both.')
  if (required && !ic && !co) throw new ToolError('individual_client_id or company_id is required.')
  return { individual_client_id: ic, company_id: co }
}

async function q<T = Json>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new ToolError(error.message)
  return data as T
}

async function clientNames(ids: { ic: string[]; co: string[] }) {
  const out = new Map<string, string>()
  const ic = [...new Set(ids.ic.filter(Boolean))]
  const co = [...new Set(ids.co.filter(Boolean))]
  if (ic.length) for (const r of await q<Json[]>(sb().from('individual_clients').select('id, full_name').in('id', ic))) out.set(String(r.id), String(r.full_name))
  if (co.length) for (const r of await q<Json[]>(sb().from('companies').select('id, name').in('id', co))) out.set(String(r.id), String(r.name))
  return out
}

function withClient<T extends Json>(rows: T[], names: Map<string, string>) {
  return rows.map((r) => ({ ...r, client: names.get(String(r.individual_client_id ?? '')) ?? names.get(String(r.company_id ?? '')) ?? null }))
}

async function namesFor(rows: Json[]) {
  return clientNames({ ic: rows.map((r) => String(r.individual_client_id ?? '')), co: rows.map((r) => String(r.company_id ?? '')) })
}

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

async function todayOverview(args: Json) {
  const today = lisbonDate()
  const leadHours = int(args.lead_hours, 36, 1, 24 * 14)
  const since = new Date(Date.now() - leadHours * 3600_000).toISOString()
  const renewalDays = int(args.renewal_days, 60, 1, 365)

  const [tasks, leads, opps, renewals, emails, expensesReview] = await Promise.all([
    q<Json[]>(sb().from('client_tasks').select('id, title, description, due_date, priority, source, individual_client_id, company_id, policy_id, opportunity_id')
      .eq('status', 'pending').lte('due_date', addDays(today, 3)).order('due_date').order('priority').limit(100)),
    q<Json[]>(sb().from('website_leads').select('id, received_at, form_name, product, market, source_url, individual_client_id, company_id')
      .gte('received_at', since).order('received_at', { ascending: false }).limit(50)),
    q<Json[]>(sb().from('sales_opportunities').select('id, title, stage, product, market, source, estimated_annual_premium, next_follow_up_at, created_at, updated_at, individual_client_id, company_id, website_lead_id')
      .in('stage', OPEN_STAGES).order('created_at', { ascending: false }).limit(200)),
    q<Json[]>(sb().from('policies').select('id, type, product, insurer, policy_number, end_date, renewal_date, annual_premium, individual_client_id, company_id')
      .in('status', ['active', 'expiring']).gte('end_date', today).lte('end_date', addDays(today, renewalDays)).order('end_date').limit(100)),
    q<Json[]>(sb().from('crm_emails').select('id, gmail_thread_id, from_address, subject, snippet, sent_at, category, individual_client_id, company_id, opportunity_id')
      .eq('needs_reply', true).order('sent_at').limit(50)),
    q<Json[]>(sb().from('company_expenses').select('id').eq('status', 'review')),
  ])

  const endOfToday = `${addDays(today, 1)}T00:00:00Z`
  const followUps = opps.filter((o) => o.next_follow_up_at && String(o.next_follow_up_at) < endOfToday)
  const uncontacted = opps.filter((o) => o.stage === 'new')
  const names = await namesFor([...tasks, ...leads, ...opps, ...renewals, ...emails])
  const oppByLead = new Map(opps.filter((o) => o.website_lead_id).map((o) => [String(o.website_lead_id), o]))

  return {
    today,
    tasks: {
      overdue: withClient(tasks.filter((t) => String(t.due_date) < today), names),
      today: withClient(tasks.filter((t) => t.due_date === today), names),
      next_3_days: withClient(tasks.filter((t) => String(t.due_date) > today), names),
    },
    new_leads: withClient(leads, names).map((l) => {
      const o = oppByLead.get(String(l.id))
      return { ...l, opportunity_id: o?.id ?? null, opportunity_stage: o?.stage ?? null }
    }),
    opportunities_not_contacted: withClient(uncontacted, names).slice(0, 50),
    follow_ups_due: withClient(followUps, names),
    renewals: withClient(renewals, names),
    emails_awaiting_reply: withClient(emails, names),
    expenses_to_review: expensesReview.length,
    pipeline_open_count: opps.length,
  }
}

async function search(args: Json) {
  const raw = str(args.query, 120)
  if (!raw) throw new ToolError('query is required')
  const s = cleanSearch(raw)
  const like = `%${s}%`
  const [people, companies, policies, opps] = await Promise.all([
    q<Json[]>(sb().from('individual_clients').select('id, full_name, email, phone, nif, status').or(`full_name.ilike.${like},email.ilike.${like},nif.ilike.${like},phone.ilike.${like}`).limit(15)),
    q<Json[]>(sb().from('companies').select('id, name, nif, contact_name, contact_email, contact_phone').or(`name.ilike.${like},nif.ilike.${like},contact_email.ilike.${like},contact_name.ilike.${like}`).limit(10)),
    q<Json[]>(sb().from('policies').select('id, type, insurer, policy_number, status, end_date, individual_client_id, company_id').or(`policy_number.ilike.${like},insurer.ilike.${like},description.ilike.${like}`).limit(15)),
    q<Json[]>(sb().from('sales_opportunities').select('id, title, stage, product, individual_client_id, company_id').ilike('title', like).limit(15)),
  ])
  const names = await namesFor([...policies, ...opps])
  return { people, companies, policies: withClient(policies, names), opportunities: withClient(opps, names) }
}

async function getClient(args: Json) {
  const o = owner(args)
  const isPerson = !!o.individual_client_id
  const id = (o.individual_client_id ?? o.company_id) as string
  const col = isPerson ? 'individual_client_id' : 'company_id'
  const profile = await q<Json | null>(isPerson
    ? sb().from('individual_clients').select('id, full_name, email, phone, nif, address, date_of_birth, status, marketing_opt_out, created_at').eq('id', id).maybeSingle()
    : sb().from('companies').select('id, name, nif, sector, contact_name, contact_email, contact_phone, address, status, created_at').eq('id', id).maybeSingle())
  if (!profile) throw new ToolError('Client not found')
  const [policies, opportunities, tasks, notes, emails, leads] = await Promise.all([
    q<Json[]>(sb().from('policies').select('id, type, product, insurer, policy_number, status, start_date, end_date, renewal_date, annual_premium, payment_frequency, commission_percentage, commission_value').eq(col, id).order('end_date')),
    q<Json[]>(sb().from('sales_opportunities').select('id, title, stage, product, market, source, estimated_annual_premium, next_follow_up_at, lost_reason, created_at, closed_at').eq(col, id).order('created_at', { ascending: false })),
    q<Json[]>(sb().from('client_tasks').select('id, title, description, due_date, status, priority, source, done_at').eq(col, id).order('due_date', { ascending: false }).limit(30)),
    q<Json[]>(sb().from('client_notes').select('id, body, category, author_name, created_at').eq(col, id).order('created_at', { ascending: false }).limit(20)),
    q<Json[]>(sb().from('crm_emails').select('id, gmail_thread_id, direction, from_address, subject, snippet, sent_at, category, needs_reply').eq(col, id).order('sent_at', { ascending: false }).limit(25)),
    q<Json[]>(sb().from('website_leads').select('id, received_at, form_name, product, source_url').eq(col, id).order('received_at', { ascending: false }).limit(10)),
  ])
  return { kind: isPerson ? 'person' : 'company', profile, policies, opportunities, tasks, notes, emails, website_leads: leads }
}

async function listOpportunities(args: Json) {
  const stage = str(args.stage, 30)
  const product = str(args.product, 60)
  let query = sb().from('sales_opportunities').select('id, title, stage, product, market, source, estimated_annual_premium, next_follow_up_at, created_at, updated_at, individual_client_id, company_id')
  if (stage === 'open' || !stage) query = query.in('stage', OPEN_STAGES)
  else if (STAGES.includes(stage)) query = query.eq('stage', stage)
  else if (stage !== 'all') throw new ToolError(`stage must be one of open, all, ${STAGES.join(', ')}`)
  if (product) query = query.ilike('product', `%${cleanSearch(product)}%`)
  const rows = await q<Json[]>(query.order('created_at', { ascending: false }).limit(int(args.limit, 50, 1, 300)))
  return withClient(rows, await namesFor(rows))
}

async function listTasks(args: Json) {
  const today = lisbonDate()
  const scope = str(args.scope, 20) ?? 'open'
  let query = sb().from('client_tasks').select('id, title, description, due_date, status, priority, source, individual_client_id, company_id, policy_id, opportunity_id, done_at')
  if (scope === 'done') query = query.eq('status', 'done').order('done_at', { ascending: false })
  else {
    query = query.eq('status', 'pending')
    if (scope === 'overdue') query = query.lt('due_date', today)
    else if (scope === 'today') query = query.lte('due_date', today)
    else if (scope === 'week') query = query.lte('due_date', addDays(today, 7))
    query = query.order('due_date').order('priority')
  }
  const rows = await q<Json[]>(query.limit(int(args.limit, 100, 1, 500)))
  return { today, tasks: withClient(rows, await namesFor(rows)) }
}

async function listRenewals(args: Json) {
  const today = lisbonDate()
  const rows = await q<Json[]>(sb().from('policies').select('id, type, product, insurer, policy_number, status, end_date, renewal_date, annual_premium, payment_frequency, individual_client_id, company_id')
    .in('status', ['active', 'expiring']).gte('end_date', addDays(today, -int(args.past_days, 0, 0, 60))).lte('end_date', addDays(today, int(args.days, 90, 1, 400))).order('end_date'))
  return withClient(rows, await namesFor(rows))
}

async function listPolicies(args: Json) {
  let query = sb().from('policies').select('id, type, product, insurer, policy_number, status, start_date, end_date, annual_premium, payment_frequency, commission_percentage, commission_value, individual_client_id, company_id')
  const insurer = str(args.insurer, 80)
  if (insurer) query = query.ilike('insurer', `%${cleanSearch(insurer)}%`)
  const type = str(args.type, 40)
  if (type) query = query.eq('type', type)
  const status = str(args.status, 20)
  if (status) query = query.eq('status', status)
  const rows = await q<Json[]>(query.order('insurer').order('policy_number').limit(int(args.limit, 200, 1, 1000)))
  const out = withClient(rows, await namesFor(rows))
  const totals = { count: out.length, annual_premium: 0, commission: 0 }
  for (const r of rows) { totals.annual_premium += Number(r.annual_premium) || 0; totals.commission += Number(r.commission_value) || 0 }
  return { totals, policies: out }
}

function monthRange(args: Json): { from: string; to: string } {
  const month = str(args.month, 7)
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const from = `${month}-01`
    const [y, m] = month.split('-').map(Number)
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
    return { from, to: addDays(next, -1) }
  }
  const from = isDate(args.from) ? args.from : `${lisbonDate().slice(0, 7)}-01`
  const to = isDate(args.to) ? args.to : lisbonDate()
  return { from, to }
}

async function expensesReport(args: Json) {
  const { from, to } = monthRange(args)
  const rows = await q<Json[]>(sb().from('company_expenses').select('id, status, supplier_name, supplier_nif, invoice_number, invoice_date, reference_month, category, description, net_amount, vat_amount, total_amount, payment_method, file_name')
    .gte('invoice_date', from).lte('invoice_date', to).order('invoice_date'))
  const byCategory: Record<string, { count: number; net: number; vat: number; total: number }> = {}
  const totals = { count: 0, net: 0, vat: 0, total: 0 }
  for (const r of rows) {
    const c = String(r.category ?? 'other')
    byCategory[c] ??= { count: 0, net: 0, vat: 0, total: 0 }
    for (const t of [byCategory[c], totals]) {
      t.count++; t.net += Number(r.net_amount) || 0; t.vat += Number(r.vat_amount) || 0; t.total += Number(r.total_amount) || 0
    }
  }
  const pending = rows.filter((r) => r.status !== 'confirmed').map((r) => ({ id: r.id, status: r.status, supplier: r.supplier_name, date: r.invoice_date, total: r.total_amount }))
  return { from, to, totals, by_category: byCategory, not_confirmed: pending, expenses: args.include_lines ? rows : undefined }
}

async function commissionsReport(args: Json) {
  const { from, to } = monthRange(args)
  const insurer = str(args.insurer, 80)
  let pq = sb().from('policies').select('id, insurer, policy_number, type, annual_premium, payment_frequency, commission_percentage, commission_value, status, start_date, end_date, individual_client_id, company_id').in('status', ['active', 'expiring'])
  if (insurer) pq = pq.ilike('insurer', `%${cleanSearch(insurer)}%`)
  const policies = await q<Json[]>(pq)
  const received = await q<Json[]>(sb().from('commissions').select('id, policy_id, amount, percentage, period_start, period_end, status, notes, created_at')
    .gte('period_end', from).lte('period_start', to))
  const polIds = new Set(policies.map((p) => String(p.id)))
  const rec = received.filter((r) => !insurer || polIds.has(String(r.policy_id)))
  const byInsurer: Record<string, { policies: number; annual_premium: number; expected_annual_commission: number; received_in_period: number }> = {}
  for (const p of policies) {
    const k = String(p.insurer ?? '').trim() || '—'
    byInsurer[k] ??= { policies: 0, annual_premium: 0, expected_annual_commission: 0, received_in_period: 0 }
    byInsurer[k].policies++
    byInsurer[k].annual_premium += Number(p.annual_premium) || 0
    byInsurer[k].expected_annual_commission += Number(p.commission_value) || 0
  }
  const insurerByPolicy = new Map(policies.map((p) => [String(p.id), String(p.insurer ?? '').trim() || '—']))
  for (const r of rec) {
    const k = insurerByPolicy.get(String(r.policy_id)) ?? '—'
    byInsurer[k] ??= { policies: 0, annual_premium: 0, expected_annual_commission: 0, received_in_period: 0 }
    byInsurer[k].received_in_period += Number(r.amount) || 0
  }
  return { from, to, by_insurer: byInsurer, commissions_recorded: rec, note: 'expected_annual_commission comes from commission_value on each active policy (annual).' }
}

async function recentActivity(args: Json) {
  return q<Json[]>(sb().from('crm_activity').select('created_at, actor, action, entity, entity_id, summary').order('created_at', { ascending: false }).limit(int(args.limit, 30, 1, 200)))
}

// ---------------------------------------------------------------------------
// Write tools
// ---------------------------------------------------------------------------

async function upsertPerson(args: Json) {
  const id = str(args.individual_client_id, 64)
  const fields: Json = {}
  const full_name = str(args.full_name, 200); if (full_name) fields.full_name = full_name
  const email = str(args.email, 200); if (email) fields.email = normalizeEmail(email)
  const phone = str(args.phone, 60); if (phone) fields.phone = phone
  const nif = str(args.nif, 30); if (nif) fields.nif = nif.replace(/\s+/g, '')
  const address = str(args.address, 400); if (address) fields.address = address
  if (isDate(args.date_of_birth)) fields.date_of_birth = args.date_of_birth
  if (typeof args.marketing_opt_out === 'boolean') fields.marketing_opt_out = args.marketing_opt_out

  if (id) {
    fields.updated_at = new Date().toISOString()
    const row = await q<Json>(sb().from('individual_clients').update(fields).eq('id', id).select('id, full_name, email').single())
    await logActivity(ACTOR, 'update_person', 'individual_client', id, `Atualizou ${row.full_name}: ${Object.keys(fields).filter((k) => k !== 'updated_at').join(', ')}`)
    return { updated: true, person: row }
  }
  if (!fields.full_name || !fields.email) throw new ToolError('full_name and email are required to create a person (or pass individual_client_id to update).')
  // dedupe by email, then NIF
  const byEmail = await q<Json[]>(sb().from('individual_clients').select('id, full_name, email, nif').eq('email', fields.email as string).limit(1))
  const existing = byEmail[0] ?? (fields.nif ? (await q<Json[]>(sb().from('individual_clients').select('id, full_name, email, nif').eq('nif', fields.nif as string).limit(1)))[0] : undefined)
  if (existing) return { created: false, existing: true, person: existing, hint: 'Already exists — use individual_client_id to update it.' }
  const row = await q<Json>(sb().from('individual_clients').insert(fields).select('id, full_name, email').single())
  await logActivity(ACTOR, 'create_person', 'individual_client', String(row.id), `Criou cliente ${row.full_name}`)
  return { created: true, person: row }
}

async function upsertCompany(args: Json) {
  const id = str(args.company_id, 64)
  const map: Array<[string, number]> = [['name', 200], ['nif', 30], ['sector', 120], ['contact_name', 200], ['contact_email', 200], ['contact_phone', 60], ['address', 400]]
  const fields: Json = {}
  for (const [k, max] of map) { const v = str(args[k], max); if (v) fields[k] = k === 'contact_email' ? normalizeEmail(v) : v }
  if (id) {
    fields.updated_at = new Date().toISOString()
    const row = await q<Json>(sb().from('companies').update(fields).eq('id', id).select('id, name').single())
    await logActivity(ACTOR, 'update_company', 'company', id, `Atualizou empresa ${row.name}`)
    return { updated: true, company: row }
  }
  if (!fields.name || !fields.nif) throw new ToolError('name and nif are required to create a company.')
  const dup = await q<Json[]>(sb().from('companies').select('id, name, nif').eq('nif', fields.nif as string).limit(1))
  if (dup[0]) return { created: false, existing: true, company: dup[0] }
  const row = await q<Json>(sb().from('companies').insert({
    id: `comp_${Date.now()}`,
    sector: '', contact_name: '', contact_email: '', contact_phone: '', address: '',
    ...fields,
  }).select('id, name').single())
  await logActivity(ACTOR, 'create_company', 'company', String(row.id), `Criou empresa ${row.name}`)
  return { created: true, company: row }
}

async function createLead(args: Json) {
  const email = str(args.email, 200)
  const full_name = str(args.full_name, 200)
  if (!email || !full_name) throw new ToolError('full_name and email are required')
  const { data, error } = await (sb().rpc as any)('find_or_create_individual_client_by_email', {
    p_email: normalizeEmail(email), p_full_name: full_name, p_phone: str(args.phone, 60) ?? null,
  }).single()
  if (error) throw new ToolError(error.message)
  const clientId = (data as { client_id: string; created: boolean }).client_id
  const source = str(args.source, 30) ?? 'email'
  if (!OPP_SOURCES.includes(source)) throw new ToolError(`source must be one of ${OPP_SOURCES.join(', ')}`)
  const product = str(args.product, 60) ?? 'general'
  const market = str(args.market, 2) === 'ES' ? 'ES' : 'PT'
  const opp = await q<Json>(sb().from('sales_opportunities').insert({
    individual_client_id: clientId,
    title: str(args.title, 200) ?? `${product} — ${full_name}`,
    product, market, source, stage: 'new',
    source_detail: str(args.summary, 500) ?? null,
    estimated_annual_premium: num(args.estimated_annual_premium) ?? null,
  }).select('id, title, stage').single())
  const due = isDate(args.reply_by) ? args.reply_by : lisbonDate()
  await sb().from('client_tasks').insert({
    id: crypto.randomUUID(), individual_client_id: clientId, opportunity_id: opp.id,
    title: `Responder a ${full_name} — ${product}`, due_date: due, status: 'pending', source: 'lead', priority: 1, created_by: ACTOR,
  })
  await logActivity(ACTOR, 'create_lead', 'sales_opportunity', String(opp.id), `Nova lead ${full_name} (${product}, ${source})`)
  return { client_id: clientId, client_created: (data as { created: boolean }).created, opportunity: opp }
}

async function createOpportunity(args: Json) {
  const o = owner(args)
  const title = str(args.title, 200)
  if (!title) throw new ToolError('title is required')
  const source = str(args.source, 30) ?? 'manual'
  if (!OPP_SOURCES.includes(source)) throw new ToolError(`source must be one of ${OPP_SOURCES.join(', ')}`)
  const stage = str(args.stage, 30) ?? 'new'
  if (!STAGES.includes(stage)) throw new ToolError(`stage must be one of ${STAGES.join(', ')}`)
  const row = await q<Json>(sb().from('sales_opportunities').insert({
    ...o, title, stage, source,
    product: str(args.product, 60) ?? null,
    market: str(args.market, 2) === 'ES' ? 'ES' : 'PT',
    estimated_annual_premium: num(args.estimated_annual_premium) ?? null,
    estimated_revenue: num(args.estimated_revenue) ?? null,
    expected_close_date: isDate(args.expected_close_date) ? args.expected_close_date : null,
  }).select('id, title, stage').single())
  await logActivity(ACTOR, 'create_opportunity', 'sales_opportunity', String(row.id), `Criou oportunidade "${title}"`)
  return row
}

async function updateOpportunity(args: Json) {
  const id = str(args.opportunity_id, 64)
  if (!id) throw new ToolError('opportunity_id is required')
  const current = await q<Json | null>(sb().from('sales_opportunities').select('id, title, stage, individual_client_id, company_id').eq('id', id).maybeSingle())
  if (!current) throw new ToolError('Opportunity not found')
  const now = new Date().toISOString()
  const fields: Json = { updated_at: now }
  const stage = str(args.stage, 30)
  if (stage) {
    if (!STAGES.includes(stage)) throw new ToolError(`stage must be one of ${STAGES.join(', ')}`)
    fields.stage = stage
    fields.closed_at = stage === 'won' || stage === 'lost' ? now : null
    if (stage === 'lost') fields.lost_reason = str(args.lost_reason, 300) ?? null
  }
  const title = str(args.title, 200); if (title) fields.title = title
  const product = str(args.product, 60); if (product) fields.product = product
  const prem = num(args.estimated_annual_premium); if (prem !== undefined) fields.estimated_annual_premium = prem
  const rev = num(args.estimated_revenue); if (rev !== undefined) fields.estimated_revenue = rev
  if (isDate(args.expected_close_date)) fields.expected_close_date = args.expected_close_date
  if (isDate(args.next_follow_up)) fields.next_follow_up_at = `${args.next_follow_up}T09:00:00Z`
  await q(sb().from('sales_opportunities').update(fields).eq('id', id))

  if (isDate(args.next_follow_up)) {
    const existing = await q<Json[]>(sb().from('client_tasks').select('id').eq('opportunity_id', id).eq('status', 'pending').eq('source', 'opportunity').limit(1))
    if (existing[0]) await q(sb().from('client_tasks').update({ due_date: args.next_follow_up }).eq('id', existing[0].id as string))
    else await q(sb().from('client_tasks').insert({
      id: crypto.randomUUID(), individual_client_id: current.individual_client_id ?? null, company_id: current.company_id ?? null,
      opportunity_id: id, title: str(args.follow_up_title, 200) ?? `Follow-up — ${current.title}`, due_date: args.next_follow_up,
      status: 'pending', source: 'opportunity', priority: 2, created_by: ACTOR,
    }))
  }
  if (stage === 'won' || stage === 'lost') {
    await sb().from('client_tasks').update({ status: 'done', done_at: now }).eq('opportunity_id', id).eq('status', 'pending')
  }
  await logActivity(ACTOR, 'update_opportunity', 'sales_opportunity', id, `"${current.title}": ${Object.keys(fields).filter((k) => k !== 'updated_at').join(', ')}${stage ? ` → ${stage}` : ''}`)
  return { updated: true, id, ...fields }
}

async function addNote(args: Json) {
  const o = owner(args)
  const body = str(args.body, 4000)
  if (!body) throw new ToolError('body is required')
  const row = await q<Json>(sb().from('client_notes').insert({
    id: crypto.randomUUID(), ...o, body, category: str(args.category, 40) ?? null, author_name: 'Claude',
  }).select('id, created_at').single())
  await logActivity(ACTOR, 'add_note', 'client_note', String(row.id), body.slice(0, 120))
  return row
}

async function createTask(args: Json) {
  const o = owner(args, false)
  const title = str(args.title, 200)
  if (!title) throw new ToolError('title is required')
  const due = isDate(args.due_date) ? args.due_date : lisbonDate()
  const source = str(args.source, 20) ?? 'claude'
  if (!['manual', 'renewal', 'opportunity', 'claude', 'email', 'lead', 'accounting'].includes(source)) throw new ToolError('invalid source')
  const priority = int(args.priority, 2, 1, 3)
  const row = await q<Json>(sb().from('client_tasks').insert({
    id: crypto.randomUUID(), ...o, title, description: str(args.description, 2000) ?? null, due_date: due,
    status: 'pending', source, priority, created_by: ACTOR,
    policy_id: str(args.policy_id, 64) ?? null, opportunity_id: str(args.opportunity_id, 64) ?? null,
  }).select('id, title, due_date, priority').single())
  await logActivity(ACTOR, 'create_task', 'client_task', String(row.id), `${title} (${due})`)
  return row
}

async function updateTask(args: Json) {
  const id = str(args.task_id, 64)
  if (!id) throw new ToolError('task_id is required')
  const fields: Json = {}
  const status = str(args.status, 10)
  if (status) {
    if (!['pending', 'done'].includes(status)) throw new ToolError('status must be pending or done')
    fields.status = status
    fields.done_at = status === 'done' ? new Date().toISOString() : null
  }
  if (isDate(args.due_date)) fields.due_date = args.due_date
  const title = str(args.title, 200); if (title) fields.title = title
  const description = str(args.description, 2000); if (description) fields.description = description
  if (args.priority !== undefined) fields.priority = int(args.priority, 2, 1, 3)
  if (!Object.keys(fields).length) throw new ToolError('Nothing to update')
  const row = await q<Json>(sb().from('client_tasks').update(fields).eq('id', id).select('id, title, status, due_date').single())
  await logActivity(ACTOR, 'update_task', 'client_task', id, `${row.title}: ${Object.keys(fields).join(', ')}`)
  return row
}

async function resolveOwnerByHints(args: Json) {
  const o = owner(args, false)
  if (o.individual_client_id || o.company_id) return o
  const nif = str(args.policyholder_nif, 30)?.replace(/\s+/g, '')
  const email = str(args.policyholder_email, 200)
  if (nif) {
    const p = await q<Json[]>(sb().from('individual_clients').select('id').eq('nif', nif).limit(1))
    if (p[0]) return { individual_client_id: String(p[0].id), company_id: null }
    const c = await q<Json[]>(sb().from('companies').select('id').eq('nif', nif).limit(1))
    if (c[0]) return { individual_client_id: null, company_id: String(c[0].id) }
  }
  if (email) {
    const p = await q<Json[]>(sb().from('individual_clients').select('id').eq('email', normalizeEmail(email)).limit(1))
    if (p[0]) return { individual_client_id: String(p[0].id), company_id: null }
  }
  throw new ToolError('Policyholder not found — create the person/company first (upsert_person / upsert_company) or pass its id.')
}

async function upsertPolicy(args: Json) {
  const insurer = str(args.insurer, 120)
  const policyNumber = str(args.policy_number, 80)
  if (!insurer || !policyNumber) throw new ToolError('insurer and policy_number are required')
  const fields: Json = {}
  const type = str(args.type, 40); if (type) { if (!POLICY_TYPES.includes(type)) throw new ToolError(`type must be one of ${POLICY_TYPES.join(', ')}`); fields.type = type }
  const status = str(args.status, 20); if (status) { if (!POLICY_STATUS.includes(status)) throw new ToolError(`status must be one of ${POLICY_STATUS.join(', ')}`); fields.status = status }
  for (const k of ['product', 'payment_frequency', 'description'] as const) { const v = str(args[k], 400); if (v) fields[k] = v }
  for (const k of ['start_date', 'end_date', 'renewal_date'] as const) if (isDate(args[k])) fields[k] = args[k]
  for (const k of ['annual_premium', 'insured_value', 'deductible', 'commission_percentage', 'commission_value'] as const) { const v = num(args[k]); if (v !== undefined) fields[k] = v }
  if (fields.commission_value === undefined && typeof fields.annual_premium === 'number' && typeof fields.commission_percentage === 'number') {
    fields.commission_value = Math.round((fields.annual_premium as number) * (fields.commission_percentage as number)) / 100
  }

  // match existing by insurer + normalised policy number
  const norm = normalizePolicyNumber(policyNumber)
  const candidates = await q<Json[]>(sb().from('policies').select('id, insurer, policy_number').ilike('insurer', `%${cleanSearch(insurer.split(' ')[0])}%`))
  const existing = candidates.find((c) => normalizePolicyNumber(String(c.policy_number)) === norm)
  if (existing) {
    const own = owner(args, false)
    if (own.individual_client_id || own.company_id) Object.assign(fields, { individual_client_id: own.individual_client_id, company_id: own.company_id ?? '' })
    fields.updated_at = new Date().toISOString()
    await q(sb().from('policies').update(fields).eq('id', existing.id as string))
    await logActivity(ACTOR, 'update_policy', 'policy', String(existing.id), `${insurer} ${policyNumber}: ${Object.keys(fields).filter((k) => k !== 'updated_at').join(', ')}`)
    return { created: false, updated: true, policy_id: existing.id }
  }
  const own = await resolveOwnerByHints(args)
  for (const k of ['type', 'start_date', 'end_date'] as const) if (!fields[k]) throw new ToolError(`${k} is required to create a policy`)
  const id = `pol_${Date.now()}${Math.floor(Math.random() * 900 + 100)}`
  await q(sb().from('policies').insert({
    id, insurer, policy_number: policyNumber.trim(),
    individual_client_id: own.individual_client_id, company_id: own.company_id ?? '',
    description: (fields.description as string) ?? '', annual_premium: 0, insured_value: 0, status: 'active',
    ...fields,
  }))
  await logActivity(ACTOR, 'create_policy', 'policy', id, `${insurer} ${policyNumber}`)
  return { created: true, policy_id: id }
}

async function logEmail(args: Json) {
  const messageId = str(args.gmail_message_id, 200)
  if (!messageId) throw new ToolError('gmail_message_id is required')
  const direction = str(args.direction, 3)
  if (direction !== 'in' && direction !== 'out') throw new ToolError('direction must be in or out')
  if (!str(args.sent_at, 40) || Number.isNaN(Date.parse(String(args.sent_at)))) throw new ToolError('sent_at (ISO date-time) is required')
  const category = str(args.category, 20)
  if (category && !EMAIL_CATEGORIES.includes(category)) throw new ToolError(`category must be one of ${EMAIL_CATEGORIES.join(', ')}`)
  const from = str(args.from_address, 200)?.toLowerCase() ?? null
  const to = Array.isArray(args.to_addresses) ? (args.to_addresses as unknown[]).map((x) => String(x).toLowerCase().slice(0, 200)).slice(0, 20) : []

  let own = owner(args, false)
  if (!own.individual_client_id && !own.company_id) {
    const counterpart = direction === 'in' ? from : to[0]
    const addr = counterpart?.match(/[^<\s]+@[^>\s]+/)?.[0]
    if (addr) {
      const p = await q<Json[]>(sb().from('individual_clients').select('id').eq('email', addr).limit(1))
      if (p[0]) own = { individual_client_id: String(p[0].id), company_id: null }
      else {
        const c = await q<Json[]>(sb().from('companies').select('id').or(`contact_email.eq.${addr},access_email.eq.${addr}`).limit(1))
        if (c[0]) own = { individual_client_id: null, company_id: String(c[0].id) }
      }
    }
  }
  const row = {
    gmail_message_id: messageId,
    gmail_thread_id: str(args.gmail_thread_id, 200) ?? null,
    direction, from_address: from, to_addresses: to,
    subject: str(args.subject, 300) ?? null,
    snippet: str(args.snippet, 600) ?? null,
    sent_at: new Date(String(args.sent_at)).toISOString(),
    category: category ?? null,
    needs_reply: direction === 'in' ? args.needs_reply === true : false,
    ...own,
    opportunity_id: str(args.opportunity_id, 64) ?? null,
    policy_id: str(args.policy_id, 64) ?? null,
  }
  const saved = await q<Json>(sb().from('crm_emails').upsert(row, { onConflict: 'gmail_message_id' }).select('id, individual_client_id, company_id').single())
  // replying closes the "awaiting reply" flag on that thread
  if (direction === 'out' && row.gmail_thread_id) {
    await sb().from('crm_emails').update({ needs_reply: false, replied_at: row.sent_at }).eq('gmail_thread_id', row.gmail_thread_id).eq('needs_reply', true)
  }
  return { saved: true, id: saved.id, linked_to: saved.individual_client_id ?? saved.company_id ?? null }
}

async function markEmailReplied(args: Json) {
  const thread = str(args.gmail_thread_id, 200)
  if (!thread) throw new ToolError('gmail_thread_id is required')
  await q(sb().from('crm_emails').update({ needs_reply: false, replied_at: new Date().toISOString() }).eq('gmail_thread_id', thread).eq('needs_reply', true))
  return { ok: true }
}

async function recordCommission(args: Json) {
  let policyId = str(args.policy_id, 64)
  if (!policyId) {
    const insurer = str(args.insurer, 120)
    const number = str(args.policy_number, 80)
    if (!insurer || !number) throw new ToolError('policy_id, or insurer + policy_number, is required')
    const norm = normalizePolicyNumber(number)
    const c = await q<Json[]>(sb().from('policies').select('id, policy_number').ilike('insurer', `%${cleanSearch(insurer.split(' ')[0])}%`))
    policyId = c.find((p) => normalizePolicyNumber(String(p.policy_number)) === norm)?.id as string | undefined
    if (!policyId) throw new ToolError(`Policy ${insurer} ${number} not found in the CRM`)
  }
  const amount = num(args.amount)
  if (amount === undefined) throw new ToolError('amount is required')
  const row = await q<Json>(sb().from('commissions').insert({
    id: crypto.randomUUID(), policy_id: policyId, amount,
    percentage: num(args.percentage) ?? null,
    period_start: isDate(args.period_start) ? args.period_start : null,
    period_end: isDate(args.period_end) ? args.period_end : null,
    status: str(args.status, 20) ?? 'received',
    notes: str(args.notes, 500) ?? null,
  }).select('id').single())
  await logActivity(ACTOR, 'record_commission', 'commission', String(row.id), `${amount} € (apólice ${policyId})`)
  return { recorded: true, id: row.id, policy_id: policyId }
}

async function recordAiVisibility(args: Json) {
  const prompt = str(args.prompt, 500)
  const engine = str(args.engine, 30) as Engine | undefined
  if (!prompt) throw new ToolError('prompt is required')
  if (!engine || !ENGINES.includes(engine)) throw new ToolError(`engine must be one of ${ENGINES.join(', ')}`)
  if (!isDate(args.run_day)) throw new ToolError('run_day (YYYY-MM-DD) is required')
  if (typeof args.mentioned !== 'boolean') throw new ToolError('mentioned (true/false) is required')
  const r = await recordExternalResult({
    prompt, engine, run_day: args.run_day, mentioned: args.mentioned,
    hubspot_prompt_id: num(args.hubspot_prompt_id),
    language: str(args.language, 5), market: str(args.market, 2),
    cited: args.cited === true, position: num(args.position) ?? null,
    competitors: Array.isArray(args.competitors) ? (args.competitors as unknown[]).map(String) : [],
    cited_urls: Array.isArray(args.cited_urls) ? (args.cited_urls as unknown[]).map(String) : [],
    excerpt: str(args.excerpt, 3000),
  })
  return { saved: true, ...r }
}

async function aiVisibilityReport(args: Json) {
  const days = [7, 30, 90].includes(Number(args.days)) ? Number(args.days) : 30
  const s = await getVisibilitySummary(days)
  return { ...s, prompts: s.prompts.map((p) => ({ ...p, latest: Object.fromEntries(Object.entries(p.latest).map(([k, v]) => [k, v ? { ...v, excerpt: v.excerpt?.slice(0, 400) ?? null } : v])) })) }
}

async function startAiVisibilityTest() {
  const base = process.env.URL || 'https://admin.adlerrochefort.com'
  const res = await fetch(`${base}/.netlify/functions/ai-visibility-run-background`, { method: 'POST', headers: { 'x-internal-secret': await internalSecret() } })
  if (res.status !== 202 && res.status !== 200) throw new ToolError(`Could not start the test (${res.status})`)
  await logActivity(ACTOR, 'start_ai_visibility_test', 'ai_vis', null, 'Teste de visibilidade no Claude iniciado')
  return { started: true, note: 'Runs every active prompt on Claude with web search; results appear in 5–10 minutes (ai_visibility_report).' }
}

// ---------------------------------------------------------------------------

export const CRM_TOOLS: CrmTool[] = [
  {
    name: 'today_overview', title: 'Today overview', readOnly: true,
    description: 'Daily brief: overdue/today/next-3-days tasks, new website leads (last lead_hours), opportunities not yet contacted, follow-ups due, renewals coming up, emails awaiting reply and expenses to review. Start here for "what do I have today?".',
    inputSchema: { type: 'object', properties: { lead_hours: { type: 'number', description: 'Look-back window for new leads (default 36).' }, renewal_days: { type: 'number', description: 'Renewals window in days (default 60).' } } },
    handler: todayOverview,
  },
  {
    name: 'search', title: 'Search CRM', readOnly: true,
    description: 'Find people, companies, policies and opportunities by name, email, NIF, phone, insurer or policy number.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    handler: search,
  },
  {
    name: 'get_client', title: 'Client file', readOnly: true,
    description: 'Full client file: profile, policies, opportunities, tasks, notes, logged emails and website leads.',
    inputSchema: { type: 'object', properties: ownerProps },
    handler: getClient,
  },
  {
    name: 'list_opportunities', title: 'List opportunities', readOnly: true,
    description: 'Pipeline opportunities. stage: "open" (default), "all" or one of new, contacted, needs_analysis, quoted, negotiation, won, lost.',
    inputSchema: { type: 'object', properties: { stage: { type: 'string' }, product: { type: 'string' }, limit: { type: 'number' } } },
    handler: listOpportunities,
  },
  {
    name: 'list_tasks', title: 'List tasks', readOnly: true,
    description: 'Tasks. scope: open (default, all pending), overdue, today (overdue + today), week, done.',
    inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['open', 'overdue', 'today', 'week', 'done'] }, limit: { type: 'number' } } },
    handler: listTasks,
  },
  {
    name: 'list_renewals', title: 'Upcoming renewals', readOnly: true,
    description: 'Active policies ending within `days` (default 90).',
    inputSchema: { type: 'object', properties: { days: { type: 'number' }, past_days: { type: 'number', description: 'Also include policies that ended up to N days ago.' } } },
    handler: listRenewals,
  },
  {
    name: 'list_policies', title: 'List policies', readOnly: true,
    description: 'Portfolio listing with totals (premium, commission). Filter by insurer, type, status.',
    inputSchema: { type: 'object', properties: { insurer: { type: 'string' }, type: { type: 'string', enum: POLICY_TYPES }, status: { type: 'string', enum: POLICY_STATUS }, limit: { type: 'number' } } },
    handler: listPolicies,
  },
  {
    name: 'expenses_report', title: 'Expenses report', readOnly: true,
    description: 'Company expenses (photographed/PDF invoices) for a month (YYYY-MM) or from/to range: totals, by category, and those not yet confirmed. include_lines=true returns every invoice.',
    inputSchema: { type: 'object', properties: { month: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, include_lines: { type: 'boolean' } } },
    handler: expensesReport,
  },
  {
    name: 'commissions_report', title: 'Commissions report', readOnly: true,
    description: 'Expected annual commission per insurer (from active policies) vs commissions recorded as received in the period (month YYYY-MM or from/to).',
    inputSchema: { type: 'object', properties: { month: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, insurer: { type: 'string' } } },
    handler: commissionsReport,
  },
  {
    name: 'recent_activity', title: 'Recent activity', readOnly: true,
    description: 'What was changed recently through this connector (audit log).',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
    handler: recentActivity,
  },
  {
    name: 'ai_visibility_report', title: 'AI visibility report', readOnly: true,
    description: 'How often AI assistants (Claude, ChatGPT, Gemini, Perplexity) mention Adler & Rochefort for the tracked prompts: visibility %, citations of the site, position, competitors and the latest answer per prompt and engine. days: 7, 30 (default) or 90.',
    inputSchema: { type: 'object', properties: { days: { type: 'number', enum: [7, 30, 90] } } },
    handler: aiVisibilityReport,
  },
  {
    name: 'record_ai_visibility', title: 'Record AI visibility result', readOnly: false,
    description: 'Save one AI-assistant answer measured elsewhere (e.g. HubSpot AEO runs for ChatGPT, Gemini, Perplexity) into the Visibilidade em IA module. One row per prompt × engine × day (re-sending the same day updates it). Unknown prompts are added as tracked prompts.',
    inputSchema: { type: 'object', properties: { prompt: { type: 'string' }, hubspot_prompt_id: { type: 'number' }, engine: { type: 'string', enum: ENGINES }, run_day: { type: 'string', description: 'YYYY-MM-DD' }, mentioned: { type: 'boolean' }, cited: { type: 'boolean', description: 'answer links to adlerrochefort.com' }, position: { type: 'number', description: 'rank of Adler & Rochefort among brands named (1 = first)' }, competitors: { type: 'array', items: { type: 'string' } }, cited_urls: { type: 'array', items: { type: 'string' } }, excerpt: { type: 'string', description: 'first part of the answer' }, language: { type: 'string' }, market: { type: 'string', enum: ['PT', 'ES'] } }, required: ['prompt', 'engine', 'run_day', 'mentioned'] },
    handler: recordAiVisibility,
  },
  {
    name: 'start_ai_visibility_test', title: 'Start AI visibility test', readOnly: false,
    description: 'Start a new run of every active tracked prompt on Claude (with web search) in the background. Results appear in ai_visibility_report after 5–10 minutes.',
    inputSchema: { type: 'object', properties: {} },
    handler: startAiVisibilityTest,
  },
  {
    name: 'upsert_person', title: 'Create or update person', readOnly: false,
    description: 'Create an individual client (full_name + email required; deduplicated by email then NIF) or update one by individual_client_id.',
    inputSchema: { type: 'object', properties: { individual_client_id: { type: 'string' }, full_name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, nif: { type: 'string' }, address: { type: 'string' }, date_of_birth: { type: 'string', description: 'YYYY-MM-DD' }, marketing_opt_out: { type: 'boolean' } } },
    handler: upsertPerson,
  },
  {
    name: 'upsert_company', title: 'Create or update company', readOnly: false,
    description: 'Create a company client (name + nif required; deduplicated by NIF) or update one by company_id.',
    inputSchema: { type: 'object', properties: { company_id: { type: 'string' }, name: { type: 'string' }, nif: { type: 'string' }, sector: { type: 'string' }, contact_name: { type: 'string' }, contact_email: { type: 'string' }, contact_phone: { type: 'string' }, address: { type: 'string' } } },
    handler: upsertCompany,
  },
  {
    name: 'create_lead', title: 'Create lead', readOnly: false,
    description: 'Register a lead that did not come through the website form (email, phone, WhatsApp, referral…): finds/creates the person by email, opens a "new" opportunity and a priority task to reply.',
    inputSchema: { type: 'object', properties: { full_name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, product: { type: 'string', description: 'e.g. health, international-health, home, auto, life, professional-liability' }, market: { type: 'string', enum: ['PT', 'ES'] }, source: { type: 'string', enum: OPP_SOURCES }, summary: { type: 'string', description: 'One-line summary of the request (no health details).' }, title: { type: 'string' }, estimated_annual_premium: { type: 'number' }, reply_by: { type: 'string', description: 'YYYY-MM-DD, default today' } }, required: ['full_name', 'email'] },
    handler: createLead,
  },
  {
    name: 'create_opportunity', title: 'Create opportunity', readOnly: false,
    description: 'Open a pipeline opportunity for an existing client.',
    inputSchema: { type: 'object', properties: { ...ownerProps, title: { type: 'string' }, product: { type: 'string' }, market: { type: 'string', enum: ['PT', 'ES'] }, source: { type: 'string', enum: OPP_SOURCES }, stage: { type: 'string', enum: STAGES }, estimated_annual_premium: { type: 'number' }, estimated_revenue: { type: 'number' }, expected_close_date: { type: 'string' } }, required: ['title'] },
    handler: createOpportunity,
  },
  {
    name: 'update_opportunity', title: 'Update opportunity', readOnly: false,
    description: 'Move stage (won/lost close it and finish its pending tasks; lost needs lost_reason), change premium/product/title, or set next_follow_up (YYYY-MM-DD) which creates/moves the follow-up task.',
    inputSchema: { type: 'object', properties: { opportunity_id: { type: 'string' }, stage: { type: 'string', enum: STAGES }, lost_reason: { type: 'string' }, title: { type: 'string' }, product: { type: 'string' }, estimated_annual_premium: { type: 'number' }, estimated_revenue: { type: 'number' }, expected_close_date: { type: 'string' }, next_follow_up: { type: 'string' }, follow_up_title: { type: 'string' } }, required: ['opportunity_id'] },
    handler: updateOpportunity,
  },
  {
    name: 'add_note', title: 'Add note', readOnly: false,
    description: 'Add a note to a client file (calls, decisions, context). Never put health details in notes.',
    inputSchema: { type: 'object', properties: { ...ownerProps, body: { type: 'string' }, category: { type: 'string' } }, required: ['body'] },
    handler: addNote,
  },
  {
    name: 'create_task', title: 'Create task', readOnly: false,
    description: 'Create a task (optionally linked to a client, policy or opportunity). Tasks without a client are general business tasks. priority 1 = urgent, 2 = normal, 3 = low.',
    inputSchema: { type: 'object', properties: { ...ownerProps, title: { type: 'string' }, description: { type: 'string' }, due_date: { type: 'string', description: 'YYYY-MM-DD, default today' }, priority: { type: 'number', enum: [1, 2, 3] }, source: { type: 'string', enum: ['claude', 'email', 'lead', 'accounting', 'manual', 'renewal', 'opportunity'] }, policy_id: { type: 'string' }, opportunity_id: { type: 'string' } }, required: ['title'] },
    handler: createTask,
  },
  {
    name: 'update_task', title: 'Update task', readOnly: false,
    description: 'Complete (status=done), reopen, reschedule (due_date), rename or reprioritise a task.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, status: { type: 'string', enum: ['pending', 'done'] }, due_date: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'number', enum: [1, 2, 3] } }, required: ['task_id'] },
    handler: updateTask,
  },
  {
    name: 'upsert_policy', title: 'Create or update policy', readOnly: false,
    description: 'Create or update a policy, matched by insurer + policy number. For new policies give type, start_date, end_date and the policyholder (individual_client_id/company_id, or policyholder_nif/policyholder_email to find them). commission_value is computed from premium × % when omitted. Use this to load insurer portfolio files row by row.',
    inputSchema: { type: 'object', properties: { ...ownerProps, policyholder_nif: { type: 'string' }, policyholder_email: { type: 'string' }, insurer: { type: 'string' }, policy_number: { type: 'string' }, type: { type: 'string', enum: POLICY_TYPES }, product: { type: 'string' }, status: { type: 'string', enum: POLICY_STATUS }, description: { type: 'string' }, start_date: { type: 'string' }, end_date: { type: 'string' }, renewal_date: { type: 'string' }, annual_premium: { type: 'number' }, insured_value: { type: 'number' }, deductible: { type: 'number' }, payment_frequency: { type: 'string', description: 'anual, semestral, trimestral, mensal' }, commission_percentage: { type: 'number' }, commission_value: { type: 'number' } }, required: ['insurer', 'policy_number'] },
    handler: upsertPolicy,
  },
  {
    name: 'log_email', title: 'Log email', readOnly: false,
    description: 'Record an email (metadata + short snippet only, never health details) in the client history. Auto-links to the client by email address. Mark needs_reply for incoming emails that need an answer; logging an outgoing email on the same thread clears it. Idempotent on gmail_message_id.',
    inputSchema: { type: 'object', properties: { ...ownerProps, gmail_message_id: { type: 'string' }, gmail_thread_id: { type: 'string' }, direction: { type: 'string', enum: ['in', 'out'] }, from_address: { type: 'string' }, to_addresses: { type: 'array', items: { type: 'string' } }, subject: { type: 'string' }, snippet: { type: 'string' }, sent_at: { type: 'string', description: 'ISO date-time' }, category: { type: 'string', enum: EMAIL_CATEGORIES }, needs_reply: { type: 'boolean' }, opportunity_id: { type: 'string' }, policy_id: { type: 'string' } }, required: ['gmail_message_id', 'direction', 'sent_at'] },
    handler: logEmail,
  },
  {
    name: 'mark_email_replied', title: 'Mark email replied', readOnly: false,
    description: 'Clear the "awaiting reply" flag for a Gmail thread.',
    inputSchema: { type: 'object', properties: { gmail_thread_id: { type: 'string' } }, required: ['gmail_thread_id'] },
    handler: markEmailReplied,
  },
  {
    name: 'record_commission', title: 'Record commission', readOnly: false,
    description: 'Record a commission received from an insurer (from a commission statement), by policy_id or insurer + policy_number.',
    inputSchema: { type: 'object', properties: { policy_id: { type: 'string' }, insurer: { type: 'string' }, policy_number: { type: 'string' }, amount: { type: 'number' }, percentage: { type: 'number' }, period_start: { type: 'string' }, period_end: { type: 'string' }, status: { type: 'string' }, notes: { type: 'string' } }, required: ['amount'] },
    handler: recordCommission,
  },
]

export const CRM_INSTRUCTIONS = `CRM of Adler & Rochefort (Ownizo Unipessoal Lda), an ASF-registered insurance agent (agente de seguros, not corretor) in Portugal and Spain run by Hugo Gonçalves. Clients: expats (international health, high-value homes), SMEs, hospitality.
How to work:
- Speak to Hugo in European Portuguese, professional tone. Client emails go in the client's language.
- Start a day with today_overview. Look a client up with search, then get_client.
- Email (Gmail) is the inbox: log relevant emails with log_email (metadata + short snippet only), create leads for new enquiries with create_lead, and prepare replies as Gmail drafts for Hugo to review — never send on his behalf unless he explicitly asks.
- In client emails never write that Hugo will check/confirm with the insurer.
- Policy analysis: rely only on what the documents say; do not invent coverage.
- Never store health information (diagnoses, medical questionnaires) in notes, tasks or email snippets.
- Nothing can be deleted through this connector; fix mistakes with the update tools.
- Load insurer portfolio files with upsert_person/upsert_company first, then upsert_policy for each row.`
