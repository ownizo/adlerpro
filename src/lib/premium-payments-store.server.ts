import { supabaseAdmin } from './supabase-admin.ts'
import type { PremiumPayment } from './premium-payment-status.ts'

type NewPayment = Pick<PremiumPayment, 'request_key' | 'request_fingerprint' | 'customer_name' | 'customer_email' | 'amount_cents' | 'currency' | 'insurer' | 'policy_reference' | 'livemode' | 'created_by'>
export type PaymentPatch = Pick<PremiumPayment, 'stripe_checkout_session_id' | 'stripe_payment_intent_id' | 'checkout_url' | 'status' | 'paid_at'>
export interface PremiumPaymentStore {
  reserve(payment: NewPayment): Promise<PremiumPayment>
  get(id: string): Promise<PremiumPayment>
  bySession(sessionId: string): Promise<PremiumPayment>
  update(current: PremiumPayment, patch: PaymentPatch): Promise<PremiumPayment | null>
}

function checked<T>(result: { data: T | null; error: unknown }): T {
  if (result.error || !result.data) throw new Error('Premium payment storage unavailable.')
  return result.data
}

// No browser grants: only the service-role client, behind admin auth / verified webhooks.
export const premiumPaymentsStore: PremiumPaymentStore = {
  async reserve(payment) {
    const result = await supabaseAdmin.from('premium_payments').upsert(payment, { onConflict: 'request_key', ignoreDuplicates: true })
    if (result.error) throw new Error('Premium payment storage unavailable.')
    return checked(await supabaseAdmin.from('premium_payments').select('*').eq('request_key', payment.request_key).single()) as PremiumPayment
  },
  async get(id) {
    return checked(await supabaseAdmin.from('premium_payments').select('*').eq('id', id).single()) as PremiumPayment
  },
  async bySession(sessionId) {
    return checked(await supabaseAdmin.from('premium_payments').select('*').eq('stripe_checkout_session_id', sessionId).single()) as PremiumPayment
  },
  async update(current, patch) {
    // Compare-and-swap prevents simultaneous webhook/return-page writes losing state.
    const result = await supabaseAdmin.from('premium_payments').update({ ...patch, version: current.version + 1, updated_at: new Date().toISOString() })
      .eq('id', current.id).eq('version', current.version).select('*').maybeSingle()
    if (result.error) throw new Error('Premium payment storage unavailable.')
    return result.data as PremiumPayment | null
  },
}
