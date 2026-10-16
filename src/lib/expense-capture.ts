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

/**
 * Normalises a phone number to international digits for wa.me.
 * Portuguese 9-digit numbers get +351; "00" prefixes become international.
 */
export function normaliseWhatsAppNumber(input: string): string {
  let digits = input.trim().replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) digits = digits.slice(1)
  else if (digits.startsWith('00')) digits = digits.slice(2)
  else if (/^[29]\d{8}$/.test(digits)) digits = `351${digits}`
  digits = digits.replace(/\D/g, '')
  if (!/^\d{8,15}$/.test(digits)) throw new Error('Número de telefone inválido. Use o formato internacional, ex.: +351 912 345 678.')
  return digits
}

export function captureUrl(origin: string, token: string): string {
  return `${new URL(origin).origin}/despesa/${token}`
}

export function whatsAppShareUrl(phoneDigits: string, link: string): string {
  const text = [
    'Adler & Rochefort — registo de despesas',
    '',
    'Toque no link para fotografar uma fatura. A fatura é lida automaticamente e arquivada no backoffice.',
    'Pode usar este link sempre que precisar.',
    '',
    link,
  ].join('\n')
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(text)}`
}
