// Prefixo base para chamadas à API do servidor (Netlify Functions).
// Em web (produção): '' — URLs relativas funcionam normalmente.
// Em Capacitor (app Android): 'https://your-site.netlify.app' via VITE_API_BASE_URL.
export const API_BASE: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}
