import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createIXClient, updateIXClient } from '@/lib/server-fns'
import type { IXClient } from '@/lib/invoicexpress'
import { font, labelStyle, inputStyle, btnPrimary, btnSecondary } from './styles'

export function ClientModal({
  existing,
  onClose,
  onSuccess,
}: {
  existing?: IXClient | null
  onClose: () => void
  onSuccess: () => void
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<Partial<IXClient>>(
    existing ?? { name: '', email: '', fiscal_id: '', phone: '', address: '', city: '', postal_code: '', country: 'Portugal', code: '', website: '', observations: '' }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (field: keyof IXClient, value: string) => setForm((f) => ({ ...f, [field]: value }))

  const handleSubmit = async () => {
    setSaving(true)
    setError('')
    try {
      let result: any
      if (existing?.id) {
        result = await updateIXClient({ id: existing.id, client: form })
      } else {
        result = await createIXClient({ client: form })
      }
      if (result && !result.ok) throw new Error(result.error)
      onSuccess()
      onClose()
    } catch (e: any) {
      setError(e.message || t('billing.errors.clientFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={onClose} />
      <div style={{ position: 'relative', background: '#fff', borderRadius: '8px', width: '95%', maxWidth: '600px', maxHeight: '90vh', overflow: 'auto', padding: '2rem', fontFamily: font }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 1.5rem', color: '#111' }}>
          {existing?.id ? t('billing.form.editClient') : t('billing.form.newClient')}
        </h3>
        {error && <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.8rem', marginBottom: '1rem' }}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <div><label style={labelStyle}>{t('billing.columns.name')} *</label><input value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>{t('billing.columns.code')}</label><input value={form.code ?? ''} onChange={(e) => set('code', e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>{t('billing.columns.email')}</label><input value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>{t('billing.columns.fiscalId')}</label><input value={form.fiscal_id ?? ''} onChange={(e) => set('fiscal_id', e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>{t('billing.columns.phone')}</label><input value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>{t('billing.columns.website')}</label><input value={form.website ?? ''} onChange={(e) => set('website', e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>{t('billing.columns.address')}</label><input value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>{t('billing.columns.city')}</label><input value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>{t('billing.columns.postalCode')}</label><input value={form.postal_code ?? ''} onChange={(e) => set('postal_code', e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>{t('billing.columns.country')}</label><input value={form.country ?? ''} onChange={(e) => set('country', e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>{t('billing.columns.paymentDays')}</label><input type="number" value={form.payment_days ?? ''} onChange={(e) => set('payment_days', e.target.value)} style={inputStyle} /></div>
        </div>
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={labelStyle}>{t('billing.columns.observations')}</label>
          <textarea value={form.observations ?? ''} onChange={(e) => setForm((f) => ({ ...f, observations: e.target.value }))} style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <button onClick={onClose} style={btnSecondary}>{t('billing.form.cancel')}</button>
          <button onClick={handleSubmit} disabled={saving} style={btnPrimary}>{saving ? t('common.saving') : t('billing.form.save')}</button>
        </div>
      </div>
    </div>
  )
}
