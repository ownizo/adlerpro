export interface PaymentLinkInput {
  customerName: string
  customerEmail: string
  amount: string
  insurer: string
  policyReference: string
  requestId: string
}

/** Decimal strings only: never round a floating-point premium. */
export function eurToCents(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{1,6}(?:[.,]\d{1,2})?$/.test(value.trim())) {
    throw new Error('Enter an amount such as 1248.36, without thousands separators.')
  }
  const [whole, fraction = ''] = value.trim().replace(',', '.').split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (cents <= 0 || cents > 99999999) throw new Error('Amount must be greater than zero and at most €999,999.99.')
  return cents
}

export function validatePaymentLinkInput(input: unknown) {
  if (!input || typeof input !== 'object') throw new Error('Payment details are required.')
  const data = input as Record<string, unknown>
  function field(key: string, label: string, max = 500) {
    const value = data[key]
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new Error(`${label} is required and must contain at most ${max} characters without control characters.`)
    }
    return value.trim()
  }
  const customerName = field('customerName', 'Client name', 200)
  if (!/\p{L}/u.test(customerName)) throw new Error('Enter a valid client name.')
  const customerEmail = field('customerEmail', 'Client email', 254)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) throw new Error('Enter a valid client email.')
  const requestId = field('requestId', 'Request identifier', 36)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new Error('Invalid request identifier.')
  return { customerName, customerEmail, insurer: field('insurer', 'Insurer'), policyReference: field('policyReference', 'Policy reference'), amountCents: eurToCents(data.amount), requestId }
}
