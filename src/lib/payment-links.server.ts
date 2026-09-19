import Stripe from 'stripe'
import type { validatePaymentLinkInput } from './payment-link-validation'

export async function createStripePremiumLink(data: ReturnType<typeof validatePaymentLinkInput>, adminId: string) {
  const key = process.env.STRIPE_SECRET_KEY
  const product = process.env.STRIPE_INSURANCE_PREMIUM_PRODUCT_ID
  if (!key || !product || !/^prod_[a-zA-Z0-9]+$/.test(product)) {
    throw new Error('Stripe Payment Links are not configured. Contact your administrator.')
  }
  return createPremiumLinkWithClient(new Stripe(key), product, data, adminId)
}

export async function createPremiumLinkWithClient(stripe: Pick<Stripe, 'prices' | 'paymentLinks'>, product: string, data: ReturnType<typeof validatePaymentLinkInput>, adminId: string) {
  const metadata = {
    purpose: 'insurance_premium',
    customer_name: data.customerName,
    customer_email: data.customerEmail,
    insurer: data.insurer,
    policy_reference: data.policyReference,
  }
  // Both steps reuse the same operation ID on retries, including partial failures.
  // Stripe rejects reuse with changed parameters instead of creating a second link.
  const operation = `insurance-premium:${adminId}:${data.requestId}`
  try {
    const price = await stripe.prices.create({
      currency: 'eur', unit_amount: data.amountCents, product, metadata,
    }, { idempotencyKey: `${operation}:price` })
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1, adjustable_quantity: { enabled: false } }],
      currency: 'eur',
      submit_type: 'pay',
      automatic_tax: { enabled: false },
      invoice_creation: { enabled: false },
      allow_promotion_codes: false,
      restrictions: { completed_sessions: { limit: 1 } },
      metadata,
      payment_intent_data: { metadata },
    }, { idempotencyKey: `${operation}:link` })
    const url = new URL(link.url)
    url.searchParams.set('prefilled_email', data.customerEmail)
    return { url: url.toString(), amountCents: data.amountCents, insurer: data.insurer, policyReference: data.policyReference, livemode: link.livemode }
  } catch {
    // Never serialize raw SDK errors, request headers, or credentials to the browser.
    throw new Error('Unable to create the Payment Link. Check the Stripe configuration and amount, then retry with the same details.')
  }
}
