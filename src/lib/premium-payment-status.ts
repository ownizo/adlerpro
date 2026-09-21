import type { PremiumPaymentMethod } from './payment-link-validation.ts'
import { shortPaymentUrl } from './premium-shortlink-origin.ts'
import type Stripe from 'stripe'

export type PremiumPaymentStatus = 'created' | 'pending' | 'paid' | 'failed' | 'expired'

export interface PremiumPayment {
  id: string
  request_key: string
  request_fingerprint: string
  stripe_checkout_session_id: string | null
  stripe_payment_intent_id: string | null
  checkout_url: string | null
  short_code: string
  payment_methods: PremiumPaymentMethod[]
  customer_name: string
  customer_email: string
  amount_cents: number
  currency: 'eur'
  insurer: string
  policy_reference: string
  status: PremiumPaymentStatus
  livemode: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  paid_at: string | null
  version: number
}

export function checkoutStatus(session: Stripe.Checkout.Session): PremiumPaymentStatus {
  const intent = typeof session.payment_intent === 'object' ? session.payment_intent : null
  if (session.payment_status === 'paid' || intent?.status === 'succeeded') return 'paid'
  // Completion is not settlement for bank debits or cash-based payment methods.
  if (intent?.status === 'processing') return 'pending'
  if (intent?.status === 'canceled') return 'failed'
  if (session.status === 'expired') return 'expired'
  if (intent?.status === 'requires_payment_method' && intent.last_payment_error) return 'failed'
  if (intent?.status === 'requires_action' && intent.next_action?.type === 'display_bank_transfer_instructions') return 'pending'
  if (session.status === 'complete') return 'pending'
  return 'created'
}

export function assertPremiumSession(session: Stripe.Checkout.Session, payment: PremiumPayment) {
  const intent = typeof session.payment_intent === 'object' ? session.payment_intent : null
  if (session.mode !== 'payment' || session.currency !== 'eur' || session.amount_total !== payment.amount_cents
    || session.amount_subtotal !== payment.amount_cents || session.livemode !== payment.livemode
    || session.metadata?.purpose !== 'insurance_premium' || session.metadata?.premium_payment_id !== payment.id
    || (payment.stripe_checkout_session_id && payment.stripe_checkout_session_id !== session.id)
    || (session.total_details?.amount_tax ?? 0) !== 0 || (session.total_details?.amount_discount ?? 0) !== 0
    || (session.total_details?.amount_shipping ?? 0) !== 0) {
    throw new Error('Checkout does not match the reserved premium.')
  }
  if (intent && (intent.currency !== 'eur' || intent.amount !== payment.amount_cents
    || intent.livemode !== payment.livemode || intent.metadata.premium_payment_id !== payment.id
    || (intent.status === 'succeeded' && intent.amount_received !== payment.amount_cents))) {
    throw new Error('PaymentIntent does not match the reserved premium.')
  }
  const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : intent?.id ?? null
  if (payment.stripe_payment_intent_id && payment.stripe_payment_intent_id !== intentId) {
    throw new Error('PaymentIntent identifier mismatch.')
  }
}

export function paymentResult(payment: PremiumPayment) {
  return {
    sessionId: payment.stripe_checkout_session_id,
    shortCode: payment.short_code,
    shortUrl: shortPaymentUrl(payment.short_code),
    paymentMethods: payment.payment_methods,
    amountCents: payment.amount_cents,
    insurer: payment.insurer,
    policyReference: payment.policy_reference,
    livemode: payment.livemode,
    status: payment.status,
  }
}
