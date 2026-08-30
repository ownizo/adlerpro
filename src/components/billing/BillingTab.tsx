import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
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
  changeIXInvoiceState,
  changeIXCreditNoteState,
  changeIXDebitNoteState,
  changeIXEstimateState,
  changeIXReceiptState,
  getIXInvoicePdf,
} from '@/lib/server-fns'
import type { IXClient, IXItem, IXDocState } from '@/lib/invoicexpress'
import { font, formatCurrency, formatDate, tableStyle, thStyle, tdStyle, btnPrimary, btnSecondary } from './styles'
import { CreateDocumentModal } from './CreateDocumentModal'
import { ClientModal } from './ClientModal'
import { ItemModal } from './ItemModal'
import { EmailModal } from './EmailModal'

export type BillingTab = 'invoices' | 'simplifiedInvoices' | 'invoiceReceipts' | 'creditNotes' | 'debitNotes' | 'receipts' | 'estimates' | 'guides' | 'clients' | 'items' | 'taxes'

const TABS: BillingTab[] = ['invoices', 'simplifiedInvoices', 'invoiceReceipts', 'creditNotes', 'debitNotes', 'receipts', 'estimates', 'guides', 'clients', 'items', 'taxes']

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

export function BillingTab() {
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
    loadData()
  }, [loadData])

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

  const summary = isDocTab
    ? {
        total: data.length,
        totalValue: data.reduce((s, d) => s + (d.total ?? 0), 0),
        pending: data.filter((d) => !d.status || d.status === 'draft').length,
        finalized: data.filter((d) => d.status === 'final' || d.status === 'finalized' || d.status === 'settled').length,
      }
    : null

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 200, background: '#065F46', color: '#fff', padding: '0.6rem 1.2rem', borderRadius: '8px', fontSize: '0.8rem', fontFamily: font, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontFamily: font, fontSize: '1.5rem', fontWeight: 700, color: '#111111', margin: '0 0 0.25rem' }}>{t('billing.title')}</h2>
        <p style={{ fontFamily: font, fontSize: '0.85rem', color: '#888888', margin: 0 }}>{t('billing.subtitle')}</p>
      </div>

      {/* Summary KPIs */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          {[
            { label: t('billing.summary.totalDocuments'), value: String(summary.total), color: '#111' },
            { label: t('billing.summary.totalValue'), value: formatCurrency(summary.totalValue), color: '#17243D' },
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
              color: tab === t_ ? '#17243D' : '#666',
              background: 'none',
              border: 'none',
              borderBottom: tab === t_ ? '2px solid #17243D' : '2px solid transparent',
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
                      <ActionBtn label={t('billing.actions.edit')} color="#17243D" onClick={() => setShowClientModal(c)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

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
                      <ActionBtn label={t('billing.actions.edit')} color="#17243D" onClick={() => setShowItemModal(item)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

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
    </div>
  )
}
