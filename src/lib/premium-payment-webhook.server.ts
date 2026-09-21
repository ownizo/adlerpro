import type { PremiumPayment } from './premium-payment-status.ts'
import type Stripe from 'stripe'
import { premiumStripe, reconcilePremiumPayment } from './payment-links.server.ts'
import { premiumPaymentsStore } from './premium-payments-store.server.ts'
import type { PremiumPaymentStore } from './premium-payments-store.server.ts'

const eventTypes = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.processing',
])

export async function processPremiumEvent(event: Stripe.Event, stripe: Stripe, store: PremiumPaymentStore, notify: (payment: PremiumPayment) => Promise<void>) {
  if (!eventTypes.has(event.type)) return
  const object = event.data.object as Stripe.Checkout.Session | Stripe.PaymentIntent
  const paymentId = object.metadata?.premium_payment_id
  // Ignore payments belonging to other integrations, including legacy Payment Links.
  if (object.metadata?.purpose !== 'insurance_premium' || !paymentId) return
  const payment = await store.get(paymentId)
  if (event.livemode !== payment.livemode) throw new Error('Payment environment mismatch.')
  let sessionId: string
  if (object.object === 'checkout.session') {
    sessionId = object.id
  } else {
    if (payment.stripe_payment_intent_id && payment.stripe_payment_intent_id !== object.id) throw new Error('PaymentIntent mismatch.')
    const sessions = await stripe.checkout.sessions.list({ payment_intent: object.id, limit: 1 })
    if (!sessions.data[0]) throw new Error('Checkout not yet available. Retry event.')
    sessionId = sessions.data[0].id
  }
  // Never trust the event snapshot for status: events may be retried or arrive out of order.
  const reconciled = await reconcilePremiumPayment(stripe, store, payment.id, sessionId)
  await notify(reconciled)
}

export async function handlePremiumWebhookWithDependencies(request: Request, stripe: Stripe, secret: string, store: PremiumPaymentStore, notify: (payment: PremiumPayment) => Promise<void> = async () => {}) {
  if (!secret) return new Response('Webhook is not configured.', { status: 503 })
  const signature = request.headers.get('stripe-signature')
  if (!signature) return new Response('Missing Stripe signature.', { status: 400 })
  let event: Stripe.Event
  try {
    // Preserve the raw body: parsing JSON before signature verification is unsafe.
    event = stripe.webhooks.constructEvent(await request.text(), signature, secret)
  } catch {
    return new Response('Invalid Stripe signature.', { status: 400 })
  }
  try {
    await processPremiumEvent(event, stripe, store, notify)
    return Response.json({ received: true })
  } catch {
    // Non-2xx makes Stripe retry failed persistence/API calls. Do not leak request data.
    return new Response('Payment update unavailable. Retry later.', { status: 500 })
  }
}

export async function handlePremiumWebhook(request: Request) {
  try {
    const { notifyPremiumPayment } = await import('./premium-payment-notifications.server.ts')
    return await handlePremiumWebhookWithDependencies(request, premiumStripe(), process.env.STRIPE_WEBHOOK_SECRET ?? '', premiumPaymentsStore, notifyPremiumPayment)
  } catch {
    return new Response('Webhook is not configured.', { status: 503 })
  }
}
