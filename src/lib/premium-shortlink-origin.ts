/** Called server-side when constructing the admin response; never trust a Host header. */
export function shortPaymentUrl(code: string, configured = process.env.PAYMENT_SHORTLINK_ORIGIN): string {
  const url = new URL(configured || 'https://admin.adlerrochefort.com')
  const local = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Invalid payment short-link origin.')
  }
  if (!/^[A-Za-z0-9_-]{16}$/.test(code)) throw new Error('Invalid payment short code.')
  return `${url.origin}/p/${code}`
}
