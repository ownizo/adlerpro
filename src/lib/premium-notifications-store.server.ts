import { supabaseAdmin } from './supabase-admin.ts'
import type { PremiumPayment } from './premium-payment-status.ts'
import type { NotificationAudience, NotificationStatus, PremiumEmail } from './premium-payment-email.ts'

export interface PremiumNotification {
  id: string
  payment_id: string
  status: NotificationStatus
  audience: NotificationAudience
  payment_snapshot: PremiumPayment
  first_attempt_at: string | null
  delivery_payload: PremiumEmail | null
  sent_at: string | null
  skipped_at: string | null
}
export interface PremiumNotificationStore {
  currentStatus(paymentId: string): Promise<PremiumPayment['status']>
  list(paymentId: string): Promise<PremiumNotification[]>
  prepare(notification: PremiumNotification, payload: PremiumEmail): Promise<PremiumNotification>
  sent(id: string, providerId: string): Promise<void>
  skip(id: string): Promise<void>
}
export const premiumNotificationStore: PremiumNotificationStore = {
  async currentStatus(paymentId) {
    const result = await supabaseAdmin.from('premium_payments').select('status').eq('id', paymentId).single()
    if (result.error || !result.data) throw new Error('Notification storage unavailable.')
    return result.data.status as PremiumPayment['status']
  },
  async list(paymentId) {
    const result = await supabaseAdmin.from('premium_payment_notifications').select('*')
      .eq('payment_id', paymentId).is('sent_at', null).is('skipped_at', null).order('created_at').order('id')
    if (result.error) throw new Error('Notification storage unavailable.')
    return result.data as PremiumNotification[]
  },
  async prepare(notification, payload) {
    // Only one concurrent request chooses the immutable payload and retry-window start.
    const result = await supabaseAdmin.from('premium_payment_notifications')
      .update({ first_attempt_at: new Date().toISOString(), delivery_payload: payload })
      .eq('id', notification.id).is('first_attempt_at', null).is('sent_at', null).is('skipped_at', null)
    if (result.error) throw new Error('Notification storage unavailable.')
    const current = await supabaseAdmin.from('premium_payment_notifications').select('*').eq('id', notification.id).single()
    if (current.error || !current.data) throw new Error('Notification storage unavailable.')
    return current.data as PremiumNotification
  },
  async sent(id, providerId) {
    const result = await supabaseAdmin.from('premium_payment_notifications')
      .update({ sent_at: new Date().toISOString(), provider_id: providerId }).eq('id', id).is('sent_at', null)
    if (result.error) throw new Error('Notification storage unavailable.')
  },
  async skip(id) {
    const result = await supabaseAdmin.from('premium_payment_notifications')
      .update({ skipped_at: new Date().toISOString() }).eq('id', id).is('sent_at', null)
    if (result.error) throw new Error('Notification storage unavailable.')
  },
}
