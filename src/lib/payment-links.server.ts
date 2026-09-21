import Stripe from 'stripe'
import { createHash } from 'node:crypto'
import type { validatePaymentLinkInput } from './payment-link-validation.ts'
import { assertPremiumSession, checkoutStatus, paymentResult } from './premium-payment-status.ts'
import type { PremiumPayment } from './premium-payment-status.ts'
import { premiumPaymentsStore } from './premium-payments-store.server.ts'
import type { PremiumPaymentStore } from './premium-payments-store.server.ts'

export type PremiumStripe = Pick<Stripe, 'checkout' | 'products' | 'customers'>

export function premiumStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('Stripe Checkout is not configured.')
  return new Stripe(key)
}

/** Re-read Stripe on every CAS retry: delayed/out-of-order events cannot roll back payment. */
export async function reconcilePremiumPayment(stripe: PremiumStripe, store: PremiumPaymentStore, paymentId: string, sessionId: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await store.get(paymentId)
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] })
    assertPremiumSession(session, current)
    const status = current.status === 'paid' ? 'paid' : checkoutStatus(session)
    const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null
    const saved = await store.update(current, {
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: intentId,
      checkout_url: session.url ?? current.checkout_url,
      status,
      paid_at: current.paid_at ?? (status === 'paid' ? new Date().toISOString() : null),
    })
    if (saved) return saved
  }
  throw new Error('Concurrent payment update. Please retry.')
}

export async function createPremiumCheckoutWithClient(
  stripe: PremiumStripe, store: PremiumPaymentStore, product: string,
  data: ReturnType<typeof validatePaymentLinkInput>, adminId: string, requestOrigin: string,
) {
  const origin = new URL(requestOrigin).origin
  if (!/^https?:\/\//.test(origin)) throw new Error('Invalid application origin.')
  const configuredProduct = await stripe.products.retrieve(product)
  if ('deleted' in configuredProduct || !configuredProduct.active) throw new Error('Insurance Premium product is unavailable.')
  const requestKey = `insurance-premium:${adminId}:${data.requestId}`
  const fingerprint = createHash('sha256').update(JSON.stringify({ data, product, origin })).digest('hex')
  const payment = await store.reserve({
    request_key: requestKey, request_fingerprint: fingerprint,
    customer_name: data.customerName, customer_email: data.customerEmail,
    amount_cents: data.amountCents, currency: 'eur', insurer: data.insurer,
    payment_methods: data.paymentMethods, policy_reference: data.policyReference, created_by: adminId, livemode: configuredProduct.livemode,
  })
  if (payment.request_fingerprint !== fingerprint || payment.livemode !== configuredProduct.livemode) {
    throw new Error('This request identifier has already been used for different payment details.')
  }
  if (payment.stripe_checkout_session_id) {
    return paymentResult(await reconcilePremiumPayment(stripe, store, payment.id, payment.stripe_checkout_session_id))
  }
  // Stripe retains keys for >=24 hours. Never recreate an uncertain operation after that window.
  if (Date.now() - Date.parse(payment.created_at) > 23 * 60 * 60 * 1000) {
    throw new Error('This creation attempt is too old to retry safely. Reconcile it in Stripe before creating another link.')
  }
  const metadata = {
    purpose: 'insurance_premium', premium_payment_id: payment.id, created_by: adminId,
    customer_name: data.customerName, customer_email: data.customerEmail,
    insurer: data.insurer, policy_reference: data.policyReference,
  }
  let customer: Stripe.Customer | undefined
  for await (const existing of stripe.customers.list({ email: data.customerEmail, limit: 100 })) {
    if (existing.email === data.customerEmail && existing.livemode === payment.livemode) {
      customer = existing
      break
    }
  }
  customer ??= await stripe.customers.create({
    name: data.customerName,
    email: data.customerEmail,
    metadata: {
      purpose: 'insurance_premium_customer',
      customer_name: data.customerName,
      customer_email: data.customerEmail,
    },
  }, { idempotencyKey: `${requestKey}:customer` })
  const session = await stripe.checkout.sessions.create({
    mode: 'payment', currency: 'eur', ui_mode: 'hosted_page',
    // Apple Pay and Google Pay are available through card when eligible.
    payment_method_types: data.paymentMethods,
    ...(data.paymentMethods.includes('card') ? { wallet_options: { link: { display: 'never' as const } } } : {}),
    ...(data.paymentMethods.includes('customer_balance') ? { payment_method_options: {
      customer_balance: {
        funding_type: 'bank_transfer',
        bank_transfer: {
          type: 'eu_bank_transfer',
          eu_bank_transfer: {
            country: 'IE',
          },
        },
      },
    } } : {}),
    line_items: [{ price_data: { currency: 'eur', unit_amount: data.amountCents, product_data: {
      name: 'Insurance Premium',
      description: `Client: ${data.customerName}\nEmail: ${data.customerEmail}\nInsurer: ${data.insurer}\nPolicy: ${data.policyReference}`,
    } }, quantity: 1, adjustable_quantity: { enabled: false } }],
    customer: customer.id,
    adaptive_pricing: { enabled: false },
    automatic_tax: { enabled: false },
    invoice_creation: { enabled: false },
    allow_promotion_codes: false,
    submit_type: 'pay',
    // Stable for retries; eight letters identify this integration in Stripe reporting.
    integration_identifier: 'adler_insurance_premium_wqkzmtva',
    metadata, payment_intent_data: { metadata },
    success_url: `${origin}/admin/payment-links?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/admin/payment-links?cancelled=1`,
  }, { idempotencyKey: `${requestKey}:checkout` })
  if (!session.url) throw new Error('Stripe did not return a hosted Checkout URL.')
  // Reconciliation also handles a webhook that arrived before this response.
  return paymentResult(await reconcilePremiumPayment(stripe, store, payment.id, session.id))
}

export async function createStripePremiumLink(data: ReturnType<typeof validatePaymentLinkInput>, adminId: string, origin: string) {
  const product = process.env.STRIPE_INSURANCE_PREMIUM_PRODUCT_ID
  if (!product || !/^prod_[a-zA-Z0-9]+$/.test(product)) throw new Error('Stripe Checkout is not configured.')
  try {
    return await createPremiumCheckoutWithClient(premiumStripe(), premiumPaymentsStore, product, data, adminId, origin)
  } catch {
    // No raw SDK/database errors, headers, or secrets are serialized to the browser.
    throw new Error('Unable to create Checkout. Check the configuration and retry with the same details. For an attempt older than 23 hours, reconcile it in Stripe before creating another link.')
  }
}

export async function getPremiumPaymentStatus(sessionId: string) {
  try {
    const payment: PremiumPayment = await premiumPaymentsStore.bySession(sessionId)
    return paymentResult(await reconcilePremiumPayment(premiumStripe(), premiumPaymentsStore, payment.id, sessionId))
  } catch {
    throw new Error('Unable to retrieve payment status. Please retry.')
  }
}
