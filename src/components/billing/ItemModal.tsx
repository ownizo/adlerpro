import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createIXItem, updateIXItem } from '@/lib/server-fns'
import type { IXItem } from '@/lib/invoicexpress'
import { font, labelStyle, inputStyle, btnPrimary, btnSecondary } from './styles'

export function ItemModal({
  existing,
  onClose,
  onSuccess,
}: {
  existing?: IXItem | null
  onClose: () => void
  onSuccess: () => void
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<Partial<IXItem>>(existing ?? { name: '', description: '', unit_price: 0, unit: 'unit' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    setSaving(true)
    setError('')
    try {
      let result: any
      if (existing && (existing as any).id) {
        result = await updateIXItem({ id: (existing as any).id, item: form })
      } else {
        result = await createIXItem({ item: form })
      }
      if (result && !result.ok) throw new Error(result.error)
      onSuccess()
      onClose()
    } catch (e: any) {
      setError(e.message || t('billing.errors.itemFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={onClose} />
      <div style={{ position: 'relative', background: 'var(--color-base)', borderRadius: '8px', width: '95%', maxWidth: '500px', maxHeight: '90vh', overflow: 'auto', padding: '2rem', fontFamily: font }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 1.5rem', color: 'var(--color-primary)' }}>
          {existing ? t('billing.form.editItem') : t('billing.form.newItem')}
        </h3>
        {error && <div style={{ background: 'var(--status-danger-bg)', color: 'var(--status-danger-text)', padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.8rem', marginBottom: '1rem' }}>{error}</div>}
        <div style={{ display: 'grid', gap: '1rem', marginBottom: '1.5rem' }}>
          <div><label style={labelStyle}>{t('billing.columns.name')} *</label><input value={form.name ?? ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={inputStyle} /></div>
          <div><label style={labelStyle}>{t('billing.columns.description')}</label><textarea value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} style={{ ...inputStyle, minHeight: '50px' }} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div><label style={labelStyle}>{t('billing.columns.unitPrice')} *</label><input type="number" step="0.01" value={form.unit_price ?? ''} onChange={(e) => setForm((f) => ({ ...f, unit_price: parseFloat(e.target.value) || 0 }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>{t('billing.columns.unit')}</label><input value={form.unit ?? ''} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} style={inputStyle} /></div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <button onClick={onClose} style={btnSecondary}>{t('billing.form.cancel')}</button>
          <button onClick={handleSubmit} disabled={saving} style={btnPrimary}>{saving ? t('common.saving') : t('billing.form.save')}</button>
        </div>
      </div>
    </div>
  )
}
