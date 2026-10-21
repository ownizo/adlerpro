/**
 * The status a client sees for a policy. The stored status is set by hand in
 * the backoffice and nothing moves it when the dates pass, so the portal
 * derives it from the end date: a live policy ending within 30 days shows
 * "Renewal due" and one whose end date has passed shows "Expired".
 * Cancelled and expired policies keep their stored status.
 */
export type PolicyStatus = 'active' | 'expiring' | 'expired' | 'cancelled'

export const RENEWAL_WINDOW_DAYS = 30

/** `today` and `endDate` are calendar days (YYYY-MM-DD). */
export function effectivePolicyStatus(status: PolicyStatus, endDate: string | undefined, today: string): PolicyStatus {
  if (status !== 'active' && status !== 'expiring') return status
  const end = /^\d{4}-\d{2}-\d{2}/.exec(endDate ?? '')?.[0]
  if (!end) return status
  if (end < today) return 'expired'
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000
  return days <= RENEWAL_WINDOW_DAYS ? 'expiring' : status
}

/** Today in Portugal (the agency's calendar), as YYYY-MM-DD. */
export function lisbonToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
