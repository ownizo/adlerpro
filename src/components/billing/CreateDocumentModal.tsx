import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createIXInvoice,
  createIXSimplifiedInvoice,
  createIXInvoiceReceipt,
  createIXCreditNote,
  createIXDebitNote,
  createIXReceipt,
  createIXEstimate,
  createIXGuide,
} from '@/lib/server-fns'
import type { IXInvoiceItem } from '@/lib/invoicexpress'
import { font, labelStyle, inputStyle, btnPrimary, btnSecondary } from './styles'
import type { BillingTab } from './BillingTab'

interface DocFormData {
  date: string
  due_date: string
  reference: string
  observations: string
  client_name: string
  client_fiscal_id: string
  client_email: string
  items: Array<{ name: string; description: string; quantity: string; unit_price: string }>
  loaded_at: string
  address_from: string
  address_to: string
  invoice_id: string
  amount: string
  payment_mechanism: string
}

function emptyForm(): DocFormData {
  return {
    date: new Date().toISOString().split('T')[0]!,
    due_date: '',
    reference: '',
    observations: '',
    client_name: '',
    client_fiscal_id: '',
    client_email: '',
    items: [{ name: '', description: '', quantity: '1', unit_price: '0' }],
    loaded_at: '',
    address_from: '',
    address_to: '',
    invoice_id: '',
    amount: '',
    payment_mechanism: '',
  }
}

export function CreateDocumentModal({
  tab,
  onClose,
  onSuccess,
}: {
  tab: BillingTab
  onClose: () => void
  onSuccess: () => void
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<DocFormData>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (field: keyof DocFormData, value: string) => setForm((f) => ({ ...f, [field]: value }))

  const setItemField = (idx: number, field: string, value: string) => {
    setForm((f) => {
      const items = [...f.items]
      items[idx] = { ...items[idx]!, [field]: value }
      return { ...f, items }
    })
  }

  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { name: '', description: '', quantity: '1', unit_price: '0' }] }))
  const removeItem = (idx: number) => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))

  const buildItems = (): IXInvoiceItem[] =>
    form.items.filter((i) => i.name.trim()).map((i) => ({
      name: i.name,
      description: i.description || undefined,
      quantity: parseFloat(i.quantity) || 1,
      unit_price: parseFloat(i.unit_price) || 0,
    }))

  const buildClient = () => {
    if (!form.client_name.trim()) return undefined
    return {
      name: form.client_name,
      fiscal_id: form.client_fiscal_id || undefined,
      email: form.client_email || undefined,
    }
  }

  const handleSubmit = async () => {
    setSaving(true)
    setError('')
    try {
      const base: any = {
        date: form.date?.replace(/-/g, '/'),
        due_date: form.due_date ? form.due_date.replace(/-/g, '/') : undefined,
        reference: form.reference || undefined,
        observations: form.observations || undefined,
        client: buildClient(),
        items: buildItems(),
      }

      let result: any
      switch (tab) {
        case 'invoices':
          result = await createIXInvoice({ invoice: base })
          break
        case 'simplifiedInvoices':
          result = await createIXSimplifiedInvoice({ invoice: base })
          break
        case 'invoiceReceipts':
          result = await createIXInvoiceReceipt({ invoice: base })
          break
        case 'creditNotes':
          result = await createIXCreditNote({ note: base })
          break
        case 'debitNotes':
          result = await createIXDebitNote({ note: base })
          break
        case 'receipts':
          result = await createIXReceipt({
            receipt: {
              ...base,
              invoice_id: form.invoice_id ? Number(form.invoice_id) : undefined,
              amount: form.amount ? Number(form.amount) : undefined,
              payment_mechanism: form.payment_mechanism || undefined,
            },
          })
          break
        case 'estimates':
          result = await createIXEstimate({ estimate: base })
          break
        case 'guides':
          result = await createIXGuide({
            guide: {
              ...base,
              loaded_at: form.loaded_at?.replace(/-/g, '/') || undefined,
              address_from: form.address_from || undefined,
              address_to: form.address_to || undefined,
            },
          })
          break
        default:
          return
      }

      if (result && !result.ok) throw new Error(result.error)
      onSuccess()
      onClose()
    } catch (e: any) {
      setError(e.message || t('billing.errors.createFailed'))
    } finally {
      setSaving(false)
    }
  }

  const isGuide = tab === 'guides'
  const isReceipt = tab === 'receipts'
  const formTitle = t(`billing.form.new${tab.charAt(0).toUpperCase() + tab.slice(1).replace(/([A-Z])/g, ' $1').replace(/s$/, '').replace(/ /g, '')}` as any, t(`billing.actions.create`))

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={onClose} />
      <div style={{ position: 'relative', background: '#fff', borderRadius: '8px', width: '95%', maxWidth: '720px', maxHeight: '90vh', overflow: 'auto', padding: '2rem', fontFamily: font }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 1.5rem', color: '#111' }}>{formTitle}</h3>

        {error && <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.8rem', marginBottom: '1rem' }}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <label style={labelStyle}>{t('billing.form.date')}</label>
            <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t('billing.form.dueDate')}</label>
            <input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={labelStyle}>{t('billing.columns.client')}</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
            <input placeholder={t('billing.columns.name')} value={form.client_name} onChange={(e) => set('client_name', e.target.value)} style={inputStyle} />
            <input placeholder={t('billing.columns.fiscalId')} value={form.client_fiscal_id} onChange={(e) => set('client_fiscal_id', e.target.value)} style={inputStyle} />
            <input placeholder={t('billing.columns.email')} value={form.client_email} onChange={(e) => set('client_email', e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <label style={labelStyle}>{t('billing.form.reference')}</label>
            <input value={form.reference} onChange={(e) => set('reference', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t('billing.form.observations')}</label>
            <input value={form.observations} onChange={(e) => set('observations', e.target.value)} style={inputStyle} />
          </div>
        </div>

        {isGuide && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            <div>
              <label style={labelStyle}>{t('billing.form.loadedAt')}</label>
              <input type="date" value={form.loaded_at} onChange={(e) => set('loaded_at', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t('billing.form.addressFrom')}</label>
              <input value={form.address_from} onChange={(e) => set('address_from', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t('billing.form.addressTo')}</label>
              <input value={form.address_to} onChange={(e) => set('address_to', e.target.value)} style={inputStyle} />
            </div>
          </div>
        )}

        {isReceipt && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            <div>
              <label style={labelStyle}>{t('billing.form.invoiceId')}</label>
              <input value={form.invoice_id} onChange={(e) => set('invoice_id', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t('billing.form.amount')}</label>
              <input type="number" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t('billing.form.paymentMethod')}</label>
              <select value={form.payment_mechanism} onChange={(e) => set('payment_mechanism', e.target.value)} style={inputStyle}>
                <option value="">—</option>
                <option value="MB">Multibanco</option>
                <option value="CC">Credit Card</option>
                <option value="CD">Debit Card</option>
                <option value="CH">Cheque</option>
                <option value="CO">Collection</option>
                <option value="CS">Balance Compensation</option>
                <option value="DE">Electronic Money</option>
                <option value="LC">Commercial Bill</option>
                <option value="NU">Cash</option>
                <option value="OU">Other</option>
                <option value="PR">Barter</option>
                <option value="TB">Bank Transfer</option>
                <option value="TR">Meal Voucher</option>
              </select>
            </div>
          </div>
        )}

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={labelStyle}>Itens</label>
          {form.items.map((item, idx) => (
            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr auto', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
              <input placeholder={t('billing.columns.name')} value={item.name} onChange={(e) => setItemField(idx, 'name', e.target.value)} style={inputStyle} />
              <input placeholder={t('billing.columns.description')} value={item.description} onChange={(e) => setItemField(idx, 'description', e.target.value)} style={inputStyle} />
              <input type="number" placeholder={t('billing.columns.quantity')} value={item.quantity} onChange={(e) => setItemField(idx, 'quantity', e.target.value)} style={inputStyle} />
              <input type="number" step="0.01" placeholder={t('billing.columns.unitPrice')} value={item.unit_price} onChange={(e) => setItemField(idx, 'unit_price', e.target.value)} style={inputStyle} />
              {form.items.length > 1 && (
                <button type="button" onClick={() => removeItem(idx)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: '1.1rem', padding: '0.25rem' }}>
                  &times;
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={addItem} style={{ background: 'none', border: '1px dashed #ccc', borderRadius: '4px', padding: '0.4rem 1rem', fontSize: '0.75rem', color: '#666', cursor: 'pointer', fontFamily: font }}>
            {t('billing.form.addLine')}
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <button onClick={onClose} style={btnSecondary}>{t('billing.form.cancel')}</button>
          <button onClick={handleSubmit} disabled={saving} style={btnPrimary}>
            {saving ? t('common.saving') : t('billing.form.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
