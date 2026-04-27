import { createFileRoute, Navigate } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useIdentity } from '@/lib/identity-context'
import { useTranslation } from 'react-i18next'
import { useState, useEffect, useCallback } from 'react'
import {
  fetchIXInvoices,
  fetchIXSimplifiedInvoices,
  fetchIXInvoiceReceipts,
  fetchIXCreditNotes,
  fetchIXDebitNotes,
  fetchIXReceipts,
  fetchIXEstimates,
  fetchIXGuides,
  fetchIXClients,
  fetchIXItems,
  fetchIXTaxes,
  createIXInvoice,
  createIXSimplifiedInvoice,
  createIXInvoiceReceipt,
  createIXCreditNote,
  createIXDebitNote,
  createIXReceipt,
  createIXEstimate,
  createIXGuide,
  createIXClient,
  updateIXClient,
  createIXItem,
  updateIXItem,
  changeIXInvoiceState,
  changeIXCreditNoteState,
  changeIXDebitNoteState,
  changeIXEstimateState,
  changeIXReceiptState,
  sendIXInvoiceEmail,
  sendIXEstimateEmail,
  getIXInvoicePdf,
} from '@/lib/server-fns'
import type {
  IXInvoice,
  IXCreditNote,
  IXDebitNote,
  IXReceipt,
  IXEstimate,
  IXGuide,
  IXClient,
  IXItem,
  IXTax,
  IXDocState,
  IXInvoiceItem,
} from '@/lib/invoicexpress'

export const Route = createFileRoute('/billing')({
  component: BillingPage,
})

const font = "'Montserrat', sans-serif"

type BillingTab = 'invoices' | 'simplifiedInvoices' | 'invoiceReceipts' | 'creditNotes' | 'debitNotes' | 'receipts' | 'estimates' | 'guides' | 'clients' | 'items' | 'taxes'

const TABS: BillingTab[] = ['invoices', 'simplifiedInvoices', 'invoiceReceipts', 'creditNotes', 'debitNotes', 'receipts', 'estimates', 'guides', 'clients', 'items', 'taxes']

function formatCurrency(v: number | undefined | null): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(v)
}

function formatDate(d: string | undefined | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('pt-PT')
  } catch {
    return d
  }
}

function StatusBadge({ status }: { status?: string }) {
  const { t } = useTranslation()
  const key = status?.toLowerCase() ?? 'draft'
  const colors: Record<string, { bg: string; text: string }> = {
    draft: { bg: '#F3F4F6', text: '#6B7280' },
    final: { bg: '#DBEAFE', text: '#1D4ED8' },
    finalized: { bg: '#DBEAFE', text: '#1D4ED8' },
    sent: { bg: '#E0E7FF', text: '#4338CA' },
    settled: { bg: '#D1FAE5', text: '#065F46' },
    unsettled: { bg: '#FEF3C7', text: '#92400E' },
    canceled: { bg: '#FEE2E2', text: '#991B1B' },
    cancelled: { bg: '#FEE2E2', text: '#991B1B' },
    deleted: { bg: '#F3F4F6', text: '#9CA3AF' },
    accepted: { bg: '#D1FAE5', text: '#065F46' },
    refused: { bg: '#FEE2E2', text: '#991B1B' },
    second_copy: { bg: '#EDE9FE', text: '#6D28D9' },
  }
  const c = colors[key] ?? colors.draft
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 600, fontFamily: font, background: c.bg, color: c.text }}>
      {t(`billing.statuses.${key}`, status ?? 'Draft')}
    </span>
  )
}

// ===== Create Document Modal =====

interface DocFormData {
  date: string
  due_date: string
  reference: string
  observations: string
  client_name: string
  client_fiscal_id: string
  client_email: string
  items: Array<{ name: string; description: string; quantity: string; unit_price: string }>
  // Guide fields
  loaded_at: string
  address_from: string
  address_to: string
  // Receipt fields
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

function CreateDocumentModal({
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
                <option value="CC">Cartão de Crédito</option>
                <option value="CD">Cartão de Débito</option>
                <option value="CH">Cheque</option>
                <option value="CO">Cobrança</option>
                <option value="CS">Compensação de saldos</option>
                <option value="DE">Dinheiro Eletrónico</option>
                <option value="LC">Letra Comercial</option>
                <option value="NU">Numerário</option>
                <option value="OU">Outros</option>
                <option value="PR">Permuta</option>
                <option value="TB">Transferência Bancária</option>
                <option value="TR">Ticket Restaurante</option>
              </select>
            </div>
          </div>
        )}

        {/* Line items */}
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

// ===== Create/Edit Client Modal =====

function ClientModal({
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

// ===== Create/Edit Item Modal =====

function ItemModal({
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
      <div style={{ position: 'relative', background: '#fff', borderRadius: '8px', width: '95%', maxWidth: '500px', maxHeight: '90vh', overflow: 'auto', padding: '2rem', fontFamily: font }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 1.5rem', color: '#111' }}>
          {existing ? t('billing.form.editItem') : t('billing.form.newItem')}
        </h3>
        {error && <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.8rem', marginBottom: '1rem' }}>{error}</div>}
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

// ===== Email Send Modal =====

function EmailModal({
  docId,
  docType,
  onClose,
}: {
  docId: number
  docType: 'invoice' | 'estimate'
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const handleSend = async () => {
    if (!email.trim()) return
    setSending(true)
    setError('')
    try {
      const fn = docType === 'invoice' ? sendIXInvoiceEmail : sendIXEstimateEmail
      const result = await fn({ id: docId, email, subject, body })
      if (result && !result.ok) throw new Error(result.error)
      setSent(true)
      setTimeout(onClose, 1500)
    } catch (e: any) {
      setError(e.message || t('billing.errors.emailFailed'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={onClose} />
      <div style={{ position: 'relative', background: '#fff', borderRadius: '8px', width: '95%', maxWidth: '480px', padding: '2rem', fontFamily: font }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 1.5rem', color: '#111' }}>{t('billing.actions.sendEmail')}</h3>
        {sent ? (
          <p style={{ color: '#065F46', fontWeight: 600, fontSize: '0.85rem' }}>{t('billing.success.emailSent')}</p>
        ) : (
          <>
            {error && <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.8rem', marginBottom: '1rem' }}>{error}</div>}
            <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <div><label style={labelStyle}>{t('billing.form.emailTo')} *</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} /></div>
              <div><label style={labelStyle}>{t('billing.form.emailSubject')}</label><input value={subject} onChange={(e) => setSubject(e.target.value)} style={inputStyle} /></div>
              <div><label style={labelStyle}>{t('billing.form.emailBody')}</label><textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ ...inputStyle, minHeight: '60px' }} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button onClick={onClose} style={btnSecondary}>{t('billing.form.cancel')}</button>
              <button onClick={handleSend} disabled={sending} style={btnPrimary}>{sending ? t('billing.form.sending') : t('billing.form.send')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ===== Main Page Component =====

function BillingPage() {
  const { user, ready } = useIdentity()
  const { t } = useTranslation()
  const [tab, setTab] = useState<BillingTab>('invoices')
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showClientModal, setShowClientModal] = useState<IXClient | null | false>(false)
  const [showItemModal, setShowItemModal] = useState<IXItem | null | false>(false)
  const [emailModal, setEmailModal] = useState<{ id: number; type: 'invoice' | 'estimate' } | null>(null)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      let result: any
      switch (tab) {
        case 'invoices': result = await fetchIXInvoices(); setData(result.ok ? result.invoices : []); break
        case 'simplifiedInvoices': result = await fetchIXSimplifiedInvoices(); setData(result.ok ? result.invoices : []); break
        case 'invoiceReceipts': result = await fetchIXInvoiceReceipts(); setData(result.ok ? result.invoices : []); break
        case 'creditNotes': result = await fetchIXCreditNotes(); setData(result.ok ? result.notes : []); break
        case 'debitNotes': result = await fetchIXDebitNotes(); setData(result.ok ? result.notes : []); break
        case 'receipts': result = await fetchIXReceipts(); setData(result.ok ? result.receipts : []); break
        case 'estimates': result = await fetchIXEstimates(); setData(result.ok ? result.estimates : []); break
        case 'guides': result = await fetchIXGuides(); setData(result.ok ? result.guides : []); break
        case 'clients': result = await fetchIXClients(); setData(result.ok ? result.clients : []); break
        case 'items': result = await fetchIXItems(); setData(result.ok ? result.items : []); break
        case 'taxes': result = await fetchIXTaxes(); setData(result.ok ? result.taxes : []); break
      }
      if (result && !result.ok) setError(result.error ?? t('billing.error'))
    } catch (e: any) {
      setError(e.message || t('billing.error'))
    } finally {
      setLoading(false)
    }
  }, [tab, t])

  useEffect(() => {
    if (ready && user) loadData()
  }, [ready, user, loadData])

  if (!ready) return <AppLayout><div style={{ fontFamily: font, color: '#999', padding: '3rem', textAlign: 'center' }}>{t('common.loading')}</div></AppLayout>
  if (!user) return <Navigate to="/login" />
  if (!user.roles?.includes('admin')) return <Navigate to="/dashboard" />

  const handleStateChange = async (id: number, state: IXDocState, tabType: string) => {
    const confirmMsg = state === 'finalized' ? t('billing.confirm.finalize') : state === 'canceled' ? t('billing.confirm.cancel') : state === 'deleted' ? t('billing.confirm.delete') : ''
    if (confirmMsg && !window.confirm(confirmMsg)) return
    try {
      let result: any
      switch (tabType) {
        case 'invoices':
        case 'simplifiedInvoices':
        case 'invoiceReceipts':
          result = await changeIXInvoiceState({ id, state }); break
        case 'creditNotes': result = await changeIXCreditNoteState({ id, state }); break
        case 'debitNotes': result = await changeIXDebitNoteState({ id, state }); break
        case 'receipts': result = await changeIXReceiptState({ id, state }); break
        case 'estimates': result = await changeIXEstimateState({ id, state: state as any }); break
      }
      if (result && !result.ok) throw new Error(result.error)
      showToast(t('billing.success.stateChanged'))
      loadData()
    } catch (e: any) {
      alert(e.message || t('billing.errors.stateChangeFailed'))
    }
  }

  const handlePdfDownload = async (id: number) => {
    try {
      const result = await getIXInvoicePdf({ id })
      if (result && !result.ok) throw new Error(result.error)
      if (result.pdf) {
        const link = document.createElement('a')
        link.href = `data:application/pdf;base64,${result.pdf}`
        link.download = `invoice-${id}.pdf`
        link.click()
      }
    } catch (e: any) {
      alert(e.message || t('billing.errors.pdfFailed'))
    }
  }

  const isDocTab = ['invoices', 'simplifiedInvoices', 'invoiceReceipts', 'creditNotes', 'debitNotes', 'receipts', 'estimates', 'guides'].includes(tab)

  // Summary KPIs for document tabs
  const summary = isDocTab
    ? {
        total: data.length,
        totalValue: data.reduce((s, d) => s + (d.total ?? 0), 0),
        pending: data.filter((d) => !d.status || d.status === 'draft').length,
        finalized: data.filter((d) => d.status === 'final' || d.status === 'finalized' || d.status === 'settled').length,
      }
    : null

  return (
    <AppLayout>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 200, background: '#065F46', color: '#fff', padding: '0.6rem 1.2rem', borderRadius: '8px', fontSize: '0.8rem', fontFamily: font, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
          {toast}
        </div>
      )}

      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontFamily: font, fontSize: '1.5rem', fontWeight: 700, color: '#111111', margin: '0 0 0.25rem' }}>{t('billing.title')}</h1>
          <p style={{ fontFamily: font, fontSize: '0.85rem', color: '#888888', margin: 0 }}>{t('billing.subtitle')}</p>
        </div>

        {/* Summary KPIs */}
        {summary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            {[
              { label: t('billing.summary.totalDocuments'), value: String(summary.total), color: '#111' },
              { label: t('billing.summary.totalValue'), value: formatCurrency(summary.totalValue), color: '#C8961A' },
              { label: t('billing.summary.pending'), value: String(summary.pending), color: '#92400E' },
              { label: t('billing.summary.finalized'), value: String(summary.finalized), color: '#065F46' },
            ].map((kpi) => (
              <div key={kpi.label} style={{ background: '#fff', border: '1px solid #eee', borderRadius: '8px', padding: '1rem 1.25rem' }}>
                <p style={{ fontFamily: font, fontSize: '0.7rem', fontWeight: 600, color: '#888', margin: '0 0 0.25rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{kpi.label}</p>
                <p style={{ fontFamily: font, fontSize: '1.3rem', fontWeight: 700, color: kpi.color, margin: 0 }}>{kpi.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginBottom: '1.5rem', borderBottom: '2px solid #eee', paddingBottom: '0' }}>
          {TABS.map((t_) => (
            <button
              key={t_}
              onClick={() => setTab(t_)}
              style={{
                fontFamily: font,
                fontSize: '0.72rem',
                fontWeight: tab === t_ ? 700 : 500,
                color: tab === t_ ? '#C8961A' : '#666',
                background: 'none',
                border: 'none',
                borderBottom: tab === t_ ? '2px solid #C8961A' : '2px solid transparent',
                padding: '0.6rem 0.9rem',
                cursor: 'pointer',
                transition: 'all 0.15s',
                marginBottom: '-2px',
              }}
            >
              {t(`billing.tabs.${t_}`)}
            </button>
          ))}
        </div>

        {/* Create button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
          {isDocTab && (
            <button onClick={() => setShowCreate(true)} style={btnPrimary}>
              {t('billing.actions.create')}
            </button>
          )}
          {tab === 'clients' && (
            <button onClick={() => setShowClientModal(null)} style={btnPrimary}>
              {t('billing.form.newClient')}
            </button>
          )}
          {tab === 'items' && (
            <button onClick={() => setShowItemModal(null)} style={btnPrimary}>
              {t('billing.form.newItem')}
            </button>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#999', fontFamily: font }}>{t('billing.loading')}</div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '3rem', fontFamily: font }}>
            <p style={{ color: '#991B1B', fontSize: '0.85rem' }}>{error}</p>
            <button onClick={loadData} style={{ ...btnSecondary, marginTop: '1rem' }}>{t('billing.retry')}</button>
          </div>
        ) : data.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#999', fontFamily: font, fontSize: '0.85rem' }}>
            {t(`billing.empty.${tab}`)}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            {/* Document tables */}
            {isDocTab && (
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>{t('billing.columns.id')}</th>
                    <th style={thStyle}>{t('billing.columns.number')}</th>
                    <th style={thStyle}>{t('billing.columns.date')}</th>
                    {tab !== 'guides' && <th style={thStyle}>{t('billing.columns.dueDate')}</th>}
                    <th style={thStyle}>{t('billing.columns.client')}</th>
                    <th style={thStyle}>{t('billing.columns.total')}</th>
                    <th style={thStyle}>{t('billing.columns.status')}</th>
                    <th style={thStyle}>{t('billing.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((doc: any) => (
                    <tr key={doc.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={tdStyle}>{doc.id}</td>
                      <td style={tdStyle}>{doc.sequence_number || doc.inverted_sequence_number || '—'}</td>
                      <td style={tdStyle}>{formatDate(doc.date)}</td>
                      {tab !== 'guides' && <td style={tdStyle}>{formatDate(doc.due_date)}</td>}
                      <td style={tdStyle}>{doc.client?.name || '—'}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{formatCurrency(doc.total)}</td>
                      <td style={tdStyle}><StatusBadge status={doc.status} /></td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                          {(!doc.status || doc.status === 'draft') && (
                            <ActionBtn label={t('billing.actions.finalize')} color="#1D4ED8" onClick={() => handleStateChange(doc.id, 'finalized', tab)} />
                          )}
                          {doc.status === 'final' && tab !== 'estimates' && (
                            <>
                              <ActionBtn label={t('billing.actions.settle')} color="#065F46" onClick={() => handleStateChange(doc.id, 'settled', tab)} />
                              <ActionBtn label={t('billing.actions.cancel')} color="#991B1B" onClick={() => handleStateChange(doc.id, 'canceled', tab)} />
                            </>
                          )}
                          {doc.status === 'settled' && (
                            <ActionBtn label={t('billing.actions.unsettle')} color="#92400E" onClick={() => handleStateChange(doc.id, 'unsettled', tab)} />
                          )}
                          {tab === 'estimates' && doc.status === 'final' && (
                            <>
                              <ActionBtn label={t('billing.actions.accept')} color="#065F46" onClick={() => handleStateChange(doc.id, 'accepted' as IXDocState, tab)} />
                              <ActionBtn label={t('billing.actions.refuse')} color="#991B1B" onClick={() => handleStateChange(doc.id, 'refused' as IXDocState, tab)} />
                            </>
                          )}
                          {(tab === 'invoices' || tab === 'invoiceReceipts' || tab === 'simplifiedInvoices') && doc.status !== 'draft' && (
                            <>
                              <ActionBtn label={t('billing.actions.sendEmail')} color="#4338CA" onClick={() => setEmailModal({ id: doc.id, type: 'invoice' })} />
                              <ActionBtn label="PDF" color="#666" onClick={() => handlePdfDownload(doc.id)} />
                            </>
                          )}
                          {tab === 'estimates' && doc.status !== 'draft' && (
                            <ActionBtn label={t('billing.actions.sendEmail')} color="#4338CA" onClick={() => setEmailModal({ id: doc.id, type: 'estimate' })} />
                          )}
                          {doc.permalink && (
                            <a href={doc.permalink} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.65rem', color: '#4338CA', textDecoration: 'underline', alignSelf: 'center' }}>
                              Link
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Clients table */}
            {tab === 'clients' && (
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>{t('billing.columns.id')}</th>
                    <th style={thStyle}>{t('billing.columns.name')}</th>
                    <th style={thStyle}>{t('billing.columns.code')}</th>
                    <th style={thStyle}>{t('billing.columns.email')}</th>
                    <th style={thStyle}>{t('billing.columns.fiscalId')}</th>
                    <th style={thStyle}>{t('billing.columns.phone')}</th>
                    <th style={thStyle}>{t('billing.columns.city')}</th>
                    <th style={thStyle}>{t('billing.columns.country')}</th>
                    <th style={thStyle}>{t('billing.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((c: any) => (
                    <tr key={c.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={tdStyle}>{c.id}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{c.name}</td>
                      <td style={tdStyle}>{c.code || '—'}</td>
                      <td style={tdStyle}>{c.email || '—'}</td>
                      <td style={tdStyle}>{c.fiscal_id || '—'}</td>
                      <td style={tdStyle}>{c.phone || '—'}</td>
                      <td style={tdStyle}>{c.city || '—'}</td>
                      <td style={tdStyle}>{c.country || '—'}</td>
                      <td style={tdStyle}>
                        <ActionBtn label={t('billing.actions.edit')} color="#C8961A" onClick={() => setShowClientModal(c)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Items table */}
            {tab === 'items' && (
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>{t('billing.columns.name')}</th>
                    <th style={thStyle}>{t('billing.columns.description')}</th>
                    <th style={thStyle}>{t('billing.columns.unitPrice')}</th>
                    <th style={thStyle}>{t('billing.columns.unit')}</th>
                    <th style={thStyle}>{t('billing.columns.tax')}</th>
                    <th style={thStyle}>{t('billing.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((item: any, idx: number) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{item.name}</td>
                      <td style={tdStyle}>{item.description || '—'}</td>
                      <td style={tdStyle}>{formatCurrency(item.unit_price)}</td>
                      <td style={tdStyle}>{item.unit || '—'}</td>
                      <td style={tdStyle}>{item.tax?.name || '—'}</td>
                      <td style={tdStyle}>
                        <ActionBtn label={t('billing.actions.edit')} color="#C8961A" onClick={() => setShowItemModal(item)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Taxes table */}
            {tab === 'taxes' && (
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>{t('billing.columns.id')}</th>
                    <th style={thStyle}>{t('billing.columns.taxName')}</th>
                    <th style={thStyle}>{t('billing.columns.taxValue')}</th>
                    <th style={thStyle}>{t('billing.columns.taxRegion')}</th>
                    <th style={thStyle}>{t('billing.columns.taxDefault')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((tax: any) => (
                    <tr key={tax.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={tdStyle}>{tax.id}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{tax.name}</td>
                      <td style={tdStyle}>{tax.value != null ? `${tax.value}%` : '—'}</td>
                      <td style={tdStyle}>{tax.region || '—'}</td>
                      <td style={tdStyle}>{tax.default_tax ? 'Sim' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreate && isDocTab && (
        <CreateDocumentModal tab={tab} onClose={() => setShowCreate(false)} onSuccess={() => { showToast(t('billing.success.created')); loadData() }} />
      )}
      {showClientModal !== false && (
        <ClientModal existing={showClientModal} onClose={() => setShowClientModal(false)} onSuccess={() => { showToast(showClientModal?.id ? t('billing.success.clientUpdated') : t('billing.success.clientCreated')); loadData() }} />
      )}
      {showItemModal !== false && (
        <ItemModal existing={showItemModal} onClose={() => setShowItemModal(false)} onSuccess={() => { showToast(showItemModal && (showItemModal as any).id ? t('billing.success.itemUpdated') : t('billing.success.itemCreated')); loadData() }} />
      )}
      {emailModal && (
        <EmailModal docId={emailModal.id} docType={emailModal.type} onClose={() => setEmailModal(null)} />
      )}
    </AppLayout>
  )
}

// ===== Action Button =====

function ActionBtn({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: font,
        fontSize: '0.62rem',
        fontWeight: 600,
        color,
        background: 'none',
        border: `1px solid ${color}30`,
        borderRadius: '4px',
        padding: '2px 8px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = `${color}10`)}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
    >
      {label}
    </button>
  )
}

// ===== Shared styles =====

const labelStyle: React.CSSProperties = {
  fontFamily: font,
  fontSize: '0.7rem',
  fontWeight: 600,
  color: '#555',
  display: 'block',
  marginBottom: '0.25rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}

const inputStyle: React.CSSProperties = {
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

const btnPrimary: React.CSSProperties = {
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

const btnSecondary: React.CSSProperties = {
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

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  background: '#fff',
  borderRadius: '8px',
  overflow: 'hidden',
  border: '1px solid #eee',
}

const thStyle: React.CSSProperties = {
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

const tdStyle: React.CSSProperties = {
  fontFamily: font,
  fontSize: '0.78rem',
  color: '#333',
  padding: '0.6rem 1rem',
  verticalAlign: 'middle',
}
