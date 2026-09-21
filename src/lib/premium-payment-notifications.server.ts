import type { PremiumPayment } from './premium-payment-status.ts'
import { premiumPaymentEmail } from './premium-payment-email.ts'
import type { PremiumEmail } from './premium-payment-email.ts'
import { premiumNotificationStore } from './premium-notifications-store.server.ts'
import type { PremiumNotificationStore } from './premium-notifications-store.server.ts'

export type PremiumEmailSender = (payload: PremiumEmail, key: string) => Promise<string>

export async function dispatchPremiumNotifications(
  payment: PremiumPayment, store: PremiumNotificationStore, send: PremiumEmailSender,
  from: string, now = Date.now(),
) {
  let failed = false
  for (const notification of await store.list(payment.id)) {
    try {
      // Do not send stale pending/failure messages after a newer settlement state.
      if (notification.status !== await store.currentStatus(payment.id)) { await store.skip(notification.id); continue }
      const prepared = await store.prepare(notification, notification.delivery_payload
        ?? premiumPaymentEmail(notification.payment_snapshot, notification.status, notification.audience, from))
      if (prepared.sent_at || prepared.skipped_at) continue
      if (!prepared.first_attempt_at || !prepared.delivery_payload) throw new Error('Notification not prepared.')
      // Resend keys last 24h. Never blindly retry an ambiguous send beyond that horizon.
      if (now - Date.parse(prepared.first_attempt_at) >= 23 * 60 * 60 * 1000) {
        throw new Error('Notification requires manual provider reconciliation.')
      }
      const providerId = await send(prepared.delivery_payload, `premium-notification/${notification.id}`)
      await store.sent(notification.id, providerId)
    } catch { failed = true } // Still attempt the other audience if one recipient fails.
  }
  if (failed) throw new Error('Premium notification delivery incomplete. Retry or reconcile delivery.')
}

export async function notifyPremiumPayment(payment: PremiumPayment) {
  // Configuration failures must not start the provider's ambiguity/retry clock.
  if (!process.env.RESEND_API_KEY) {
    if ((await premiumNotificationStore.list(payment.id)).length) throw new Error('Premium email is not configured.')
    return
  }
  await dispatchPremiumNotifications(payment, premiumNotificationStore, async (payload, idempotencyKey) => {
    const { resendClient } = await import('./email/client.ts')
    const { data, error } = await resendClient.emails.send(payload, { idempotencyKey })
    if (error || !data?.id) throw new Error('Premium email delivery unavailable.')
    return data.id
  }, process.env.EMAIL_FROM ?? 'Adler & Rochefort <noreply@adlerrochefort.com>')
}
