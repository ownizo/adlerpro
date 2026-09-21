import { premiumPaymentsStore } from './premium-payments-store.server.ts'
import type { PremiumPaymentStore } from './premium-payments-store.server.ts'

export function safeCheckoutUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !['checkout.adlerrochefort.com', 'checkout.stripe.com'].includes(url.hostname)) return null
    return url.href
  } catch { return null }
}

/** Public capability lookup. No Stripe calls, reconciliation, or status writes. */
export async function resolvePremiumShortLink(code: string, store: Pick<PremiumPaymentStore, 'byShortCode'> = premiumPaymentsStore) {
  const headers = {
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow', 'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  }
  function page(message: string, status: number) {
    return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Payment link · Adler &amp; Rochefort</title></head><body><main><h1>Adler &amp; Rochefort</h1><p>${message}</p></main></body></html>`, { status, headers })
  }
  try {
    const payment = /^[A-Za-z0-9_-]{16}$/.test(code) ? await store.byShortCode(code) : null
    if (!payment) return page('Payment link not found', 404)
    if (payment.status === 'paid') return page('This insurance premium has already been paid.', 200)
    if (payment.status === 'expired') return page('This payment link has expired. Please contact Adler &amp; Rochefort for a new payment link.', 410)
    const url = safeCheckoutUrl(payment.checkout_url)
    // Failed attempts are conservatively unavailable; only reconciliation can establish settlement.
    if (!['created', 'pending'].includes(payment.status) || !url || !payment.stripe_checkout_session_id) {
      return page('This payment link is unavailable. Please contact Adler &amp; Rochefort for assistance.', 410)
    }
    return new Response(null, { status: 302, headers: { ...headers, Location: url } })
  } catch {
    return page('This payment link is temporarily unavailable. Please try again later.', 503)
  }
}
