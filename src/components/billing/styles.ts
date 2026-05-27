import type { CSSProperties } from 'react'

export const font = "'Montserrat', sans-serif"

export function formatCurrency(v: number | undefined | null): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(v)
}

export function formatDate(d: string | undefined | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('pt-PT')
  } catch {
    return d
  }
}

export const labelStyle: CSSProperties = {
  fontFamily: font,
  fontSize: '0.7rem',
  fontWeight: 600,
  color: '#555',
  display: 'block',
  marginBottom: '0.25rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}

export const inputStyle: CSSProperties = {
  fontFamily: font,
  fontSize: '0.82rem',
  color: '#111',
  border: '1px solid #ddd',
  borderRadius: '6px',
  padding: '0.5rem 0.75rem',
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
}

export const btnPrimary: CSSProperties = {
  fontFamily: font,
  fontSize: '0.78rem',
  fontWeight: 600,
  color: '#fff',
  background: '#111',
  border: 'none',
  borderRadius: '6px',
  padding: '0.5rem 1.25rem',
  cursor: 'pointer',
}

export const btnSecondary: CSSProperties = {
  fontFamily: font,
  fontSize: '0.78rem',
  fontWeight: 600,
  color: '#666',
  background: '#f8f8f8',
  border: '1px solid #ddd',
  borderRadius: '6px',
  padding: '0.5rem 1.25rem',
  cursor: 'pointer',
}

export const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  background: '#fff',
  borderRadius: '8px',
  overflow: 'hidden',
  border: '1px solid #eee',
}

export const thStyle: CSSProperties = {
  fontFamily: font,
  fontSize: '0.65rem',
  fontWeight: 700,
  color: '#888',
  textAlign: 'left',
  padding: '0.75rem 1rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  borderBottom: '2px solid #eee',
  background: '#fafafa',
  whiteSpace: 'nowrap',
}

export const tdStyle: CSSProperties = {
  fontFamily: font,
  fontSize: '0.78rem',
  color: '#333',
  padding: '0.6rem 1rem',
  verticalAlign: 'middle',
}
