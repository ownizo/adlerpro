/**
 * InvoiceXpress API client
 * Server-side only — uses process.env for secrets
 */

const BASE = () => {
  const account = process.env['INVOICEXPRESS_ACCOUNT']
  if (!account) throw new Error('INVOICEXPRESS_ACCOUNT not set')
  return `https://${account}.app.invoicexpress.com`
}

const API_KEY = () => {
  const key = process.env['INVOICEXPRESS_API_KEY']
  if (!key) throw new Error('INVOICEXPRESS_API_KEY not set')
  return key
}

function url(path: string, params: Record<string, string> = {}): string {
  const u = new URL(path, BASE())
  u.searchParams.set('api_key', API_KEY())
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') u.searchParams.set(k, v)
  }
  return u.toString()
}

async function request<T>(method: string, path: string, body?: unknown, params: Record<string, string> = {}): Promise<T> {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(url(path, params), opts)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`InvoiceXpress ${method} ${path}: ${res.status} ${text}`)
  }
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) return res.json() as Promise<T>
  if (ct.includes('application/pdf')) {
    const buf = await res.arrayBuffer()
    return { pdf: Buffer.from(buf).toString('base64'), contentType: 'application/pdf' } as T
  }
  return {} as T
}

// --------------- Types ---------------

export interface IXClient {
  id?: number
  name: string
  code?: string
  email?: string
  language?: string
  address?: string
  city?: string
  postal_code?: string
  country?: string
  fiscal_id?: string
  website?: string
  phone?: string
  fax?: string
  observations?: string
  send_options?: string
  payment_days?: number
  tax_exemption_code?: string
}

export interface IXItem {
  name: string
  description?: string
  unit_price: number
  quantity?: number
  unit?: string
  tax?: { name: string }
}

export interface IXInvoiceItem {
  name: string
  description?: string
  unit_price: number | string
  quantity: number | string
  tax?: { name: string }
  discount?: number
}

export interface IXDocumentBase {
  id?: number
  status?: string
  archived?: boolean
  type?: string
  sequence_number?: string
  inverted_sequence_number?: string
  date?: string
  due_date?: string
  reference?: string
  observations?: string
  retention?: string
  tax_exemption?: string
  mb_reference?: string
  total_before_taxes?: number
  taxes?: number
  total?: number
  currency_code?: string
  client?: IXClient
  items?: IXInvoiceItem[]
  sequence_id?: string
  sum_before_discount?: number
  discount?: number
  before_taxes?: number
  permalink?: string
}

export interface IXInvoice extends IXDocumentBase {}
export interface IXEstimate extends IXDocumentBase {}
export interface IXCreditNote extends IXDocumentBase {}
export interface IXDebitNote extends IXDocumentBase {}
export interface IXReceipt extends IXDocumentBase {
  invoice_id?: number
  amount?: number
  payment_mechanism?: string
}
export interface IXGuide extends IXDocumentBase {
  loaded_at?: string
  address_from?: string
  address_to?: string
  at_doc_code?: string
}

export interface IXSequence {
  id?: number
  serie?: string
  default_sequence?: number
  current_invoice_number?: number
}

export interface IXTax {
  id?: number
  name?: string
  value?: number
  region?: string
  default_tax?: number
}

export type IXDocState = 'finalized' | 'deleted' | 'canceled' | 'settled' | 'unsettled' | 'second_copy'

// --------------- Invoices ---------------

export async function listInvoices(page = 1, perPage = 25): Promise<{ invoices: IXInvoice[]; pagination: any }> {
  return request('GET', '/invoices.json', undefined, { page: String(page), per_page: String(perPage) })
}

export async function getInvoice(id: number): Promise<{ invoice: IXInvoice }> {
  return request('GET', `/invoices/${id}.json`)
}

export async function createInvoice(invoice: Partial<IXInvoice>): Promise<{ invoice: IXInvoice }> {
  return request('POST', '/invoices.json', { invoice })
}

export async function updateInvoice(id: number, invoice: Partial<IXInvoice>): Promise<{ invoice: IXInvoice }> {
  return request('PUT', `/invoices/${id}.json`, { invoice })
}

export async function changeInvoiceState(id: number, state: IXDocState): Promise<void> {
  await request('PUT', `/invoices/${id}/change-state.json`, { invoice: { state } })
}

export async function sendInvoiceByEmail(id: number, emailTo: string, subject?: string, body?: string): Promise<void> {
  await request('PUT', `/invoices/${id}/email-document.json`, {
    message: { client: { email: emailTo, save: 0 }, subject: subject ?? '', body: body ?? '' },
  })
}

export async function getInvoicePdf(id: number): Promise<{ pdf: string; contentType: string }> {
  return request('GET', `/invoices/${id}.json`, undefined, { output: 'pdf' }) as any
}

// --------------- Simplified Invoices ---------------

export async function listSimplifiedInvoices(page = 1, perPage = 25) {
  return request<{ simplified_invoices: IXInvoice[]; pagination: any }>('GET', '/simplified_invoices.json', undefined, { page: String(page), per_page: String(perPage) })
}

export async function createSimplifiedInvoice(invoice: Partial<IXInvoice>) {
  return request<{ simplified_invoice: IXInvoice }>('POST', '/simplified_invoices.json', { simplified_invoice: invoice })
}

// --------------- Invoice Receipts ---------------

export async function listInvoiceReceipts(page = 1, perPage = 25) {
  return request<{ invoice_receipts: IXInvoice[]; pagination: any }>('GET', '/invoice_receipts.json', undefined, { page: String(page), per_page: String(perPage) })
}

export async function createInvoiceReceipt(invoice: Partial<IXInvoice>) {
  return request<{ invoice_receipt: IXInvoice }>('POST', '/invoice_receipts.json', { invoice_receipt: invoice })
}

// --------------- Credit Notes ---------------

export async function listCreditNotes(page = 1, perPage = 25) {
  return request<{ credit_notes: IXCreditNote[]; pagination: any }>('GET', '/credit_notes.json', undefined, { page: String(page), per_page: String(perPage) })
}

export async function createCreditNote(note: Partial<IXCreditNote>) {
  return request<{ credit_note: IXCreditNote }>('POST', '/credit_notes.json', { credit_note: note })
}

export async function changeCreditNoteState(id: number, state: IXDocState) {
  await request('PUT', `/credit_notes/${id}/change-state.json`, { credit_note: { state } })
}

// --------------- Debit Notes ---------------

export async function listDebitNotes(page = 1, perPage = 25) {
  return request<{ debit_notes: IXDebitNote[]; pagination: any }>('GET', '/debit_notes.json', undefined, { page: String(page), per_page: String(perPage) })
}

export async function createDebitNote(note: Partial<IXDebitNote>) {
  return request<{ debit_note: IXDebitNote }>('POST', '/debit_notes.json', { debit_note: note })
}

export async function changeDebitNoteState(id: number, state: IXDocState) {
  await request('PUT', `/debit_notes/${id}/change-state.json`, { debit_note: { state } })
}

// --------------- Receipts ---------------

export async function listReceipts(page = 1, perPage = 25) {
  return request<{ receipts: IXReceipt[]; pagination: any }>('GET', '/receipts.json', undefined, { page: String(page), per_page: String(perPage) })
}

export async function createReceipt(receipt: Partial<IXReceipt>) {
  return request<{ receipt: IXReceipt }>('POST', '/receipts.json', { receipt })
}

export async function changeReceiptState(id: number, state: IXDocState) {
  await request('PUT', `/receipts/${id}/change-state.json`, { receipt: { state } })
}

// --------------- Estimates ---------------

export async function listEstimates(page = 1, perPage = 25) {
  return request<{ estimates: IXEstimate[]; pagination: any }>('GET', '/estimates.json', undefined, { page: String(page), per_page: String(perPage) })
}

export async function createEstimate(estimate: Partial<IXEstimate>) {
  return request<{ estimate: IXEstimate }>('POST', '/estimates.json', { estimate })
}

export async function changeEstimateState(id: number, state: 'finalized' | 'deleted' | 'canceled' | 'accepted' | 'refused') {
  await request('PUT', `/estimates/${id}/change-state.json`, { estimate: { state } })
}

export async function sendEstimateByEmail(id: number, emailTo: string, subject?: string, body?: string) {
  await request('PUT', `/estimates/${id}/email-document.json`, {
    message: { client: { email: emailTo, save: 0 }, subject: subject ?? '', body: body ?? '' },
  })
}

// --------------- Guides (Transport / Delivery / Shipping) ---------------

export async function listGuides(page = 1, perPage = 25) {
  return request<{ guides: IXGuide[]; pagination: any }>('GET', '/guides.json', undefined, { page: String(page), per_page: String(perPage) })
}

export async function createGuide(guide: Partial<IXGuide>) {
  return request<{ guide: IXGuide }>('POST', '/guides.json', { guide })
}

export async function changeGuideState(id: number, state: IXDocState) {
  await request('PUT', `/guides/${id}/change-state.json`, { guide: { state } })
}

// --------------- Clients ---------------

export async function listClients(page = 1, perPage = 25) {
  return request<{ clients: IXClient[]; pagination: any }>('GET', '/clients.json', undefined, { page: String(page), per_page: String(perPage) })
}

export async function getClient(id: number) {
  return request<{ client: IXClient }>('GET', `/clients/${id}.json`)
}

export async function createClient(client: Partial<IXClient>) {
  return request<{ client: IXClient }>('POST', '/clients.json', { client })
}

export async function updateClient(id: number, client: Partial<IXClient>) {
  return request<{ client: IXClient }>('PUT', `/clients/${id}.json`, { client })
}

// --------------- Items ---------------

export async function listItems(page = 1, perPage = 25) {
  return request<{ items: IXItem[]; pagination: any }>('GET', '/items.json', undefined, { page: String(page), per_page: String(perPage) })
}

export async function createItem(item: Partial<IXItem>) {
  return request<{ item: IXItem }>('POST', '/items.json', { item })
}

export async function updateItem(id: number, item: Partial<IXItem>) {
  return request<{ item: IXItem }>('PUT', `/items/${id}.json`, { item })
}

// --------------- Sequences ---------------

export async function listSequences() {
  return request<{ sequences: IXSequence[] }>('GET', '/sequences.json')
}

export async function createSequence(sequence: Partial<IXSequence>) {
  return request<{ sequence: IXSequence }>('POST', '/sequences.json', { sequence })
}

// --------------- Taxes ---------------

export async function listTaxes() {
  return request<{ taxes: IXTax[] }>('GET', '/taxes.json')
}

export async function createTax(tax: Partial<IXTax>) {
  return request<{ tax: IXTax }>('POST', '/taxes.json', { tax })
}

export async function updateTax(id: number, tax: Partial<IXTax>) {
  return request<{ tax: IXTax }>('PUT', `/taxes/${id}.json`, { tax })
}

// --------------- Account Info ---------------

export async function getAccountInfo() {
  return request<{ account: any }>('GET', '/users/api-token.json')
}
