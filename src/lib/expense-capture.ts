// Phone capture links for expenses — shared helpers (browser-safe except hashToken).

export const CAPTURE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
export const CAPTURE_DAILY_LIMIT = 60
export const CAPTURE_EXPIRY_OPTIONS = [
  { days: 30, label: '30 dias' },
  { days: 90, label: '3 meses' },
  { days: 365, label: '1 ano' },
] as const

export function isCaptureToken(value: unknown): value is string {
  return typeof value === 'string' && CAPTURE_TOKEN_PATTERN.test(value)
}

export function captureUrl(origin: string, token: string): string {
  return `${new URL(origin).origin}/despesa/${token}`
}
