import { createServerFn } from '@tanstack/react-start'
import { requireAuthMiddleware, requireRoleMiddleware } from '@/middleware/identity'

const ACCOUNT_NAME = process.env.INVOICEXPRESS_ACCOUNT || 'ownizounipessoall-1'
const API_KEY = process.env.INVOICEXPRESS_API_KEY || ''

function apiUrl(path: string): string {
  return `https://${ACCOUNT_NAME}.app.invoicexpress.com${path}?api_key=${API_KEY}`
}

async function ixFetch(path: string, options: RequestInit = {}) {
  const url = apiUrl(path)
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`InvoiceXpress API error ${res.status}: ${text}`)
  }
  // Some endpoints return empty body (204, etc.)
  const contentType = res.headers.get('content-type')
  if (contentType?.includes('application/json')) {
    return res.json()
  }
  return null
}

// ─── Invoices ──────────────────────────────────────────────

export const ixListInvoices = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { page?: number; perPage?: number; filter?: string }) => d)
  .handler(async ({ data }) => {
    const page = data.page ?? 1
    const perPage = data.perPage ?? 25
    let path = `/invoices.json?page=${page}&per_page=${perPage}`
    if (data.filter) path += `&filter=${encodeURIComponent(data.filter)}`
    const url = `https://${ACCOUNT_NAME}.app.invoicexpress.com${path}&api_key=${API_KEY}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`InvoiceXpress error ${res.status}: ${await res.text()}`)
    return res.json()
  })

export const ixGetInvoice = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    return ixFetch(`/invoices/${data.id}.json`)
  })

export const ixCreateInvoice = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { invoice: any }) => d)
  .handler(async ({ data }) => {
    return ixFetch('/invoices.json', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  })

export const ixUpdateInvoice = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string; invoice: any }) => d)
  .handler(async ({ data }) => {
    return ixFetch(`/invoices/${data.id}.json`, {
      method: 'PUT',
      body: JSON.stringify({ invoice: data.invoice }),
    })
  })

export const ixChangeInvoiceState = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string; state: string }) => d)
  .handler(async ({ data }) => {
    return ixFetch(`/invoices/${data.id}/change-state.json`, {
      method: 'PUT',
      body: JSON.stringify({ invoice: { state: data.state } }),
    })
  })

export const ixSendInvoiceEmail = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string; email: string; subject?: string; body?: string }) => d)
  .handler(async ({ data }) => {
    return ixFetch(`/invoices/${data.id}/email-document.json`, {
      method: 'PUT',
      body: JSON.stringify({
        message: {
          client: { email: data.email },
          subject: data.subject || '',
          body: data.body || '',
        },
      }),
    })
  })

export const ixGetInvoicePdf = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const result = await ixFetch(`/invoices/${data.id}.json`)
    // The PDF URL is in the output object
    return { pdfUrl: result?.invoice?.permalink }
  })

// ─── Credit Notes ──────────────────────────────────────────

export const ixListCreditNotes = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { page?: number }) => d)
  .handler(async ({ data }) => {
    const page = data.page ?? 1
    const url = `https://${ACCOUNT_NAME}.app.invoicexpress.com/credit_notes.json?page=${page}&per_page=25&api_key=${API_KEY}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`InvoiceXpress error ${res.status}: ${await res.text()}`)
    return res.json()
  })

export const ixCreateCreditNote = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { credit_note: any }) => d)
  .handler(async ({ data }) => {
    return ixFetch('/credit_notes.json', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  })

// ─── Receipts ──────────────────────────────────────────────

export const ixListReceipts = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { page?: number }) => d)
  .handler(async ({ data }) => {
    const page = data.page ?? 1
    const url = `https://${ACCOUNT_NAME}.app.invoicexpress.com/receipts.json?page=${page}&per_page=25&api_key=${API_KEY}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`InvoiceXpress error ${res.status}: ${await res.text()}`)
    return res.json()
  })

export const ixCreateReceipt = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { receipt: any }) => d)
  .handler(async ({ data }) => {
    return ixFetch('/receipts.json', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  })

// ─── Debit Notes ───────────────────────────────────────────

export const ixListDebitNotes = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { page?: number }) => d)
  .handler(async ({ data }) => {
    const page = data.page ?? 1
    const url = `https://${ACCOUNT_NAME}.app.invoicexpress.com/debit_notes.json?page=${page}&per_page=25&api_key=${API_KEY}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`InvoiceXpress error ${res.status}: ${await res.text()}`)
    return res.json()
  })

// ─── Clients ───────────────────────────────────────────────

export const ixListClients = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { page?: number }) => d)
  .handler(async ({ data }) => {
    const page = data.page ?? 1
    const url = `https://${ACCOUNT_NAME}.app.invoicexpress.com/clients.json?page=${page}&per_page=25&api_key=${API_KEY}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`InvoiceXpress error ${res.status}: ${await res.text()}`)
    return res.json()
  })

export const ixGetClient = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    return ixFetch(`/clients/${data.id}.json`)
  })

export const ixCreateClient = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { client: any }) => d)
  .handler(async ({ data }) => {
    return ixFetch('/clients.json', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  })

export const ixUpdateClient = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string; client: any }) => d)
  .handler(async ({ data }) => {
    return ixFetch(`/clients/${data.id}.json`, {
      method: 'PUT',
      body: JSON.stringify({ client: data.client }),
    })
  })

// ─── Items / Products ──────────────────────────────────────

export const ixListItems = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { page?: number }) => d)
  .handler(async ({ data }) => {
    const page = data.page ?? 1
    const url = `https://${ACCOUNT_NAME}.app.invoicexpress.com/items.json?page=${page}&per_page=25&api_key=${API_KEY}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`InvoiceXpress error ${res.status}: ${await res.text()}`)
    return res.json()
  })

export const ixCreateItem = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { item: any }) => d)
  .handler(async ({ data }) => {
    return ixFetch('/items.json', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  })

export const ixUpdateItem = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string; item: any }) => d)
  .handler(async ({ data }) => {
    return ixFetch(`/items/${data.id}.json`, {
      method: 'PUT',
      body: JSON.stringify({ item: data.item }),
    })
  })

// ─── Sequences ─────────────────────────────────────────────

export const ixListSequences = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .handler(async () => {
    return ixFetch('/sequences.json')
  })

// ─── Taxes ─────────────────────────────────────────────────

export const ixListTaxes = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .handler(async () => {
    return ixFetch('/taxes.json')
  })

// ─── Account Info ──────────────────────────────────────────

export const ixGetAccountInfo = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .handler(async () => {
    return ixFetch('/users/accounts.json')
  })

// ─── Guides (Guias de Transporte) ──────────────────────────

export const ixListGuides = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { page?: number }) => d)
  .handler(async ({ data }) => {
    const page = data.page ?? 1
    const url = `https://${ACCOUNT_NAME}.app.invoicexpress.com/guides.json?page=${page}&per_page=25&api_key=${API_KEY}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`InvoiceXpress error ${res.status}: ${await res.text()}`)
    return res.json()
  })

// ─── Simplified Invoices ───────────────────────────────────

export const ixListSimplifiedInvoices = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { page?: number }) => d)
  .handler(async ({ data }) => {
    const page = data.page ?? 1
    const url = `https://${ACCOUNT_NAME}.app.invoicexpress.com/simplified_invoices.json?page=${page}&per_page=25&api_key=${API_KEY}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`InvoiceXpress error ${res.status}: ${await res.text()}`)
    return res.json()
  })

export const ixCreateSimplifiedInvoice = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { simplified_invoice: any }) => d)
  .handler(async ({ data }) => {
    return ixFetch('/simplified_invoices.json', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  })

// ─── Invoice-Receipt (Fatura-Recibo) ───────────────────────

export const ixListInvoiceReceipts = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { page?: number }) => d)
  .handler(async ({ data }) => {
    const page = data.page ?? 1
    const url = `https://${ACCOUNT_NAME}.app.invoicexpress.com/invoice_receipts.json?page=${page}&per_page=25&api_key=${API_KEY}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`InvoiceXpress error ${res.status}: ${await res.text()}`)
    return res.json()
  })

export const ixCreateInvoiceReceipt = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { invoice_receipt: any }) => d)
  .handler(async ({ data }) => {
    return ixFetch('/invoice_receipts.json', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  })

// ─── Estimates / Quotes (Orçamentos) ───────────────────────

export const ixListEstimates = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { page?: number }) => d)
  .handler(async ({ data }) => {
    const page = data.page ?? 1
    const url = `https://${ACCOUNT_NAME}.app.invoicexpress.com/estimates.json?page=${page}&per_page=25&api_key=${API_KEY}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`InvoiceXpress error ${res.status}: ${await res.text()}`)
    return res.json()
  })

export const ixCreateEstimate = createServerFn({ method: 'POST' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { estimate: any }) => d)
  .handler(async ({ data }) => {
    return ixFetch('/estimates.json', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  })

// ─── SAF-T Export ──────────────────────────────────────────

export const ixExportSaft = createServerFn({ method: 'GET' })
  .middleware([requireAuthMiddleware, requireRoleMiddleware('admin')])
  .inputValidator((d: { year: number }) => d)
  .handler(async ({ data }) => {
    return ixFetch(`/api/saft/export.json?year=${data.year}`)
  })
