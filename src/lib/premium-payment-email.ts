import { PAYMENT_METHOD_LABELS } from './payment-link-validation.ts'
import { shortPaymentUrl } from './premium-shortlink-origin.ts'
import type { PremiumPayment } from './premium-payment-status.ts'

export type NotificationStatus = Exclude<PremiumPayment['status'], 'created'>
export type NotificationAudience = 'customer' | 'internal'
export interface PremiumEmail {
  from: string
  to: string[]
  replyTo: string
  subject: string
  text: string
  html: string
}
const subjects: Record<NotificationStatus, [string, string]> = {
  pending: ['Your payment is pending confirmation', 'Premium payment pending confirmation'],
  paid: ['Your payment has been confirmed', 'Premium payment confirmed'],
  failed: ['Your payment could not be completed', 'Premium payment failed'],
  expired: ['Your payment link has expired', 'Premium payment link expired'],
}
const messages: Record<NotificationStatus, string> = {
  pending: 'Your payment is pending confirmation. It has not yet been confirmed as paid. Please do not submit another payment while confirmation is pending.',
  paid: 'Your insurance premium payment has been confirmed. Thank you for your payment.',
  failed: 'Your payment could not be completed. Please contact insurance@adlerrochefort.com before arranging another payment.',
  expired: 'The Checkout Session expired without confirmed payment. Please review the payment before issuing a new link.',
}
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

export function premiumPaymentEmail(payment: PremiumPayment, status: NotificationStatus, audience: NotificationAudience, from: string): PremiumEmail {
  const amount = `${(payment.amount_cents / 100).toFixed(2)} EUR`
  // Configured methods are not proof of the actual method used.
  const methods = payment.payment_methods.map(method => PAYMENT_METHOD_LABELS[method]).join(' · ')
  const text = [
    'Adler & Rochefort',
    payment.livemode ? '' : 'TEST MODE — this is a test payment notification.',
    messages[status], '',
    `Amount: ${amount}`, 'Currency: EUR', `Client: ${payment.customer_name}`, `Email: ${payment.customer_email}`,
    `Insurer: ${payment.insurer}`, `Policy: ${payment.policy_reference}`,
    `Payment methods offered: ${methods}`, `Status: ${status === 'paid' ? 'Paid' : status[0].toUpperCase() + status.slice(1)}`,
    ...(status === 'pending' ? [`Payment link: ${shortPaymentUrl(payment.short_code)}`] : []), '',
    'Bank Transfer and SEPA Direct Debit may take time to confirm. Only a confirmed payment notification indicates successful settlement.',
    'For any questions, please contact insurance@adlerrochefort.com.',
  ].join('\n')
  return {
    from, to: [audience === 'customer' ? payment.customer_email : 'insurance@adlerrochefort.com'],
    replyTo: 'insurance@adlerrochefort.com',
    subject: `${payment.livemode ? '' : '[TEST] '}${subjects[status][audience === 'customer' ? 0 : 1]}`,
    text, html: `<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#18283b">${escape(text).replace(/\n/g, '<br>')}</div>`,
  }
}
