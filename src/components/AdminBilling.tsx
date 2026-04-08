import { useState, useEffect } from 'react'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  ixListInvoices,
  ixCreateInvoice,
  ixChangeInvoiceState,
  ixSendInvoiceEmail,
  ixGetInvoicePdf,
  ixListCreditNotes,
  ixCreateCreditNote,
  ixListReceipts,
  ixCreateReceipt,
  ixListClients,
  ixCreateClient,
  ixUpdateClient,
  ixListItems,
  ixCreateItem,
  ixListGuides,
  ixListEstimates,
  ixCreateEstimate,
  ixListInvoiceReceipts,
  ixCreateInvoiceReceipt,
  ixListSimplifiedInvoices,
  ixCreateSimplifiedInvoice,
  ixListDebitNotes,
  ixListSequences,
  ixListTaxes,
  ixExportSaft,
} from '@/lib/invoicexpress'

type SubTab = 'invoices' | 'credit_notes' | 'receipts' | 'invoice_receipts' | 'simplified' | 'debit_notes' | 'estimates' | 'guides' | 'clients' | 'items' | 'saft'

export function AdminBilling() {
  const [subTab, setSubTab] = useState<SubTab>('invoices')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const subTabs: { key: SubTab; label: string }[] = [
    { key: 'invoices', label: 'Faturas' },
    { key: 'invoice_receipts', label: 'Faturas-Recibo' },
    { key: 'simplified', label: 'Faturas Simplificadas' },
    { key: 'credit_notes', label: 'Notas de Crédito' },
    { key: 'debit_notes', label: 'Notas de Débito' },
    { key: 'receipts', label: 'Recibos' },
    { key: 'estimates', label: 'Orçamentos' },
    { key: 'guides', label: 'Guias' },
    { key: 'clients', label: 'Clientes IX' },
    { key: 'items', label: 'Artigos' },
    { key: 'saft', label: 'SAF-T' },
  ]

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-lg font-semibold text-navy-700">Faturação — InvoiceXpress</h2>
      </div>

      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-1 bg-navy-50 p-1 rounded-[2px] mb-6">
        {subTabs.map(t => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-[2px] transition-colors ${
              subTab === t.key ? 'bg-white text-navy-700 shadow-sm' : 'text-navy-500 hover:text-navy-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-[2px] mb-4">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Fechar</button>
        </div>
      )}

      {subTab === 'invoices' && <InvoicesPanel />}
      {subTab === 'invoice_receipts' && <InvoiceReceiptsPanel />}
      {subTab === 'simplified' && <SimplifiedInvoicesPanel />}
      {subTab === 'credit_notes' && <CreditNotesPanel />}
      {subTab === 'debit_notes' && <DebitNotesPanel />}
      {subTab === 'receipts' && <ReceiptsPanel />}
      {subTab === 'estimates' && <EstimatesPanel />}
      {subTab === 'guides' && <GuidesPanel />}
      {subTab === 'clients' && <ClientsPanel />}
      {subTab === 'items' && <ItemsPanel />}
      {subTab === 'saft' && <SaftPanel />}
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────

const cardCls = 'bg-white rounded-[4px] border border-navy-200 p-6'
const btnPrimary = 'px-4 py-2 bg-gold-400 text-navy-700 font-semibold rounded-[2px] hover:bg-gold-300 transition-colors text-sm'
const btnSecondary = 'px-3 py-1.5 border border-navy-200 text-navy-600 rounded-[2px] hover:bg-navy-50 transition-colors text-sm'
const inp = 'w-full px-3 py-2 border border-navy-200 rounded-[2px] text-sm focus:outline-none focus:ring-2 focus:ring-gold-400'
const lbl = 'block text-xs font-medium text-navy-600 mb-1'

function safeDateStr(d: any): string {
  if (!d) return '-'
  try { return formatDate(String(d)) } catch { return String(d) }
}

function safeAmount(v: any): string {
  const n = parseFloat(v)
  return isNaN(n) ? '-' : formatCurrency(n)
}

function statusBadge(status?: string) {
  if (!status) return null
  const colors: Record<string, string> = {
    draft: 'bg-navy-100 text-navy-600',
    sent: 'bg-blue-100 text-blue-700',
    final: 'bg-green-100 text-green-700',
    settled: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-600',
    deleted: 'bg-red-50 text-red-400',
    second_copy: 'bg-yellow-100 text-yellow-700',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] || 'bg-navy-50 text-navy-500'}`}>
      {status}
    </span>
  )
}

// ─── Invoices Panel ─────────────────────────────────────────

function InvoicesPanel() {
  const [invoices, setInvoices] = useState<any[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [sendingEmail, setSendingEmail] = useState<string | null>(null)
  const [emailForm, setEmailForm] = useState({ email: '', subject: '', body: '' })
  const [changingState, setChangingState] = useState<string | null>(null)
  const [stateValue, setStateValue] = useState('finalized')

  const load = async (p: number = page) => {
    setLoading(true)
    try {
      const res = await ixListInvoices({ data: { page: p, perPage: 25 } })
      const items = res?.invoices || res?.invoice || []
      setInvoices(Array.isArray(items) ? items : [items])
      setTotalPages(res?.pagination?.total_pages || 1)
    } catch (e: any) {
      console.error(e)
      setInvoices([])
    }
    setLoading(false)
  }

  useEffect(() => { load(1) }, [])

  const handleChangeState = async (id: string) => {
    try {
      await ixChangeInvoiceState({ data: { id, state: stateValue } })
      setChangingState(null)
      load()
    } catch (e: any) { alert(e.message) }
  }

  const handleSendEmail = async (id: string) => {
    try {
      await ixSendInvoiceEmail({ data: { id, ...emailForm } })
      setSendingEmail(null)
      setEmailForm({ email: '', subject: '', body: '' })
      alert('Email enviado!')
    } catch (e: any) { alert(e.message) }
  }

  const handleGetPdf = async (id: string) => {
    try {
      const res = await ixGetInvoicePdf({ data: { id } })
      if (res?.pdfUrl) window.open(res.pdfUrl, '_blank')
      else alert('PDF não disponível')
    } catch (e: any) { alert(e.message) }
  }

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-navy-500 uppercase tracking-wide">Faturas</h3>
        <div className="flex gap-2">
          <button onClick={() => load()} className={btnSecondary}>Atualizar</button>
          <button onClick={() => setShowCreate(!showCreate)} className={btnPrimary}>+ Nova Fatura</button>
        </div>
      </div>

      {showCreate && <CreateInvoiceForm onCreated={() => { setShowCreate(false); load() }} />}

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : invoices.length === 0 ? (
        <p className="text-sm text-navy-400">Nenhuma fatura encontrada.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-100">
                  <th className="text-left py-2 text-navy-500 font-medium">N.º</th>
                  <th className="text-left py-2 text-navy-500 font-medium">Cliente</th>
                  <th className="text-left py-2 text-navy-500 font-medium">Data</th>
                  <th className="text-right py-2 text-navy-500 font-medium">Total</th>
                  <th className="text-center py-2 text-navy-500 font-medium">Estado</th>
                  <th className="text-right py-2 text-navy-500 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv: any) => {
                  const i = inv?.invoice || inv
                  const id = String(i?.id || '')
                  return (
                    <tr key={id} className="border-b border-navy-50">
                      <td className="py-2 text-navy-700 font-mono text-xs">{i?.sequence_number || i?.inverted_sequence_number || '-'}</td>
                      <td className="py-2 text-navy-700">{i?.client?.name || '-'}</td>
                      <td className="py-2 text-navy-600">{safeDateStr(i?.date)}</td>
                      <td className="py-2 text-right text-navy-700 font-medium">{safeAmount(i?.total)}</td>
                      <td className="py-2 text-center">{statusBadge(i?.status)}</td>
                      <td className="py-2 text-right">
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => handleGetPdf(id)} className="text-xs text-blue-600 hover:underline">PDF</button>
                          <button onClick={() => setSendingEmail(sendingEmail === id ? null : id)} className="text-xs text-blue-600 hover:underline">Email</button>
                          <button onClick={() => setChangingState(changingState === id ? null : id)} className="text-xs text-blue-600 hover:underline">Estado</button>
                        </div>
                        {sendingEmail === id && (
                          <div className="mt-2 text-left space-y-2 p-3 bg-navy-50 rounded">
                            <input className={inp} placeholder="Email" value={emailForm.email} onChange={e => setEmailForm({ ...emailForm, email: e.target.value })} />
                            <input className={inp} placeholder="Assunto" value={emailForm.subject} onChange={e => setEmailForm({ ...emailForm, subject: e.target.value })} />
                            <textarea className={inp} placeholder="Mensagem" rows={2} value={emailForm.body} onChange={e => setEmailForm({ ...emailForm, body: e.target.value })} />
                            <button onClick={() => handleSendEmail(id)} className={btnPrimary}>Enviar</button>
                          </div>
                        )}
                        {changingState === id && (
                          <div className="mt-2 text-left flex gap-2 items-center p-3 bg-navy-50 rounded">
                            <select className={inp + ' w-auto'} value={stateValue} onChange={e => setStateValue(e.target.value)}>
                              <option value="finalized">Finalizar</option>
                              <option value="settled">Liquidar</option>
                              <option value="canceled">Cancelar</option>
                              <option value="second_copy">2.ª Via</option>
                            </select>
                            <button onClick={() => handleChangeState(id)} className={btnPrimary}>Alterar</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          <div className="flex items-center justify-center gap-2 mt-4">
            <button disabled={page <= 1} onClick={() => { setPage(p => p - 1); load(page - 1) }} className={btnSecondary}>Anterior</button>
            <span className="text-sm text-navy-500">Página {page} de {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => { setPage(p => p + 1); load(page + 1) }} className={btnSecondary}>Seguinte</button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Create Invoice Form ────────────────────────────────────

function CreateInvoiceForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    dueDate: '',
    clientName: '',
    clientCode: '',
    description: '',
    quantity: '1',
    unitPrice: '',
    tax: '23',
  })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async () => {
    setSaving(true)
    try {
      await ixCreateInvoice({
        data: {
          invoice: {
            date: form.date,
            due_date: form.dueDate || form.date,
            client: {
              name: form.clientName,
              code: form.clientCode || form.clientName,
            },
            items: [
              {
                name: form.description,
                description: form.description,
                unit_price: form.unitPrice,
                quantity: form.quantity,
                tax: { name: `IVA${form.tax}`, value: form.tax },
              },
            ],
          },
        },
      })
      onCreated()
    } catch (e: any) {
      alert(e.message)
    }
    setSaving(false)
  }

  return (
    <div className="bg-navy-50 border border-navy-200 rounded-[2px] p-4 mb-4">
      <h4 className="text-sm font-semibold text-navy-700 mb-3">Nova Fatura</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
        <div><label className={lbl}>Data</label><input type="date" className={inp} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
        <div><label className={lbl}>Data Vencimento</label><input type="date" className={inp} value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></div>
        <div><label className={lbl}>Nome do Cliente</label><input className={inp} value={form.clientName} onChange={e => setForm({ ...form, clientName: e.target.value })} /></div>
        <div><label className={lbl}>Código Cliente</label><input className={inp} value={form.clientCode} onChange={e => setForm({ ...form, clientCode: e.target.value })} placeholder="Opcional" /></div>
        <div><label className={lbl}>Descrição</label><input className={inp} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        <div><label className={lbl}>Quantidade</label><input type="number" className={inp} value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} /></div>
        <div><label className={lbl}>Preço Unitário (EUR)</label><input type="number" step="0.01" className={inp} value={form.unitPrice} onChange={e => setForm({ ...form, unitPrice: e.target.value })} /></div>
        <div><label className={lbl}>IVA (%)</label><select className={inp} value={form.tax} onChange={e => setForm({ ...form, tax: e.target.value })}>
          <option value="23">23%</option>
          <option value="13">13%</option>
          <option value="6">6%</option>
          <option value="0">Isento</option>
        </select></div>
      </div>
      <button onClick={handleSubmit} disabled={saving || !form.clientName || !form.unitPrice} className={btnPrimary}>
        {saving ? 'A criar...' : 'Criar Fatura'}
      </button>
    </div>
  )
}

// ─── Generic List Panels ────────────────────────────────────

function GenericDocPanel({
  title,
  fetchFn,
  dataKey,
  columns,
}: {
  title: string
  fetchFn: (args: { data: { page?: number } }) => Promise<any>
  dataKey: string
  columns: { key: string; label: string; align?: string; render?: (v: any, row: any) => any }[]
}) {
  const [items, setItems] = useState<any[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)

  const load = async (p: number = page) => {
    setLoading(true)
    try {
      const res = await fetchFn({ data: { page: p } })
      const raw = res?.[dataKey] || []
      setItems(Array.isArray(raw) ? raw : [raw])
      setTotalPages(res?.pagination?.total_pages || 1)
    } catch { setItems([]) }
    setLoading(false)
  }

  useEffect(() => { load(1) }, [])

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-navy-500 uppercase tracking-wide">{title}</h3>
        <button onClick={() => load()} className={btnSecondary}>Atualizar</button>
      </div>
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-navy-400">Sem registos.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-100">
                  {columns.map(c => (
                    <th key={c.key} className={`py-2 text-navy-500 font-medium ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'}`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item: any, idx: number) => {
                  const row = item?.[dataKey.replace(/s$/, '')] || item
                  return (
                    <tr key={row?.id || idx} className="border-b border-navy-50">
                      {columns.map(c => (
                        <td key={c.key} className={`py-2 ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''} text-navy-600`}>
                          {c.render ? c.render(row?.[c.key], row) : (row?.[c.key] ?? '-')}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-center gap-2 mt-4">
            <button disabled={page <= 1} onClick={() => { setPage(p => p - 1); load(page - 1) }} className={btnSecondary}>Anterior</button>
            <span className="text-sm text-navy-500">Página {page} de {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => { setPage(p => p + 1); load(page + 1) }} className={btnSecondary}>Seguinte</button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Concrete panels ───────────────────────────────────────

function CreditNotesPanel() {
  return <GenericDocPanel title="Notas de Crédito" fetchFn={ixListCreditNotes} dataKey="credit_notes" columns={[
    { key: 'sequence_number', label: 'N.º' },
    { key: 'date', label: 'Data', render: v => safeDateStr(v) },
    { key: 'total', label: 'Total', align: 'right', render: v => safeAmount(v) },
    { key: 'status', label: 'Estado', align: 'center', render: v => statusBadge(v) },
  ]} />
}

function DebitNotesPanel() {
  return <GenericDocPanel title="Notas de Débito" fetchFn={ixListDebitNotes} dataKey="debit_notes" columns={[
    { key: 'sequence_number', label: 'N.º' },
    { key: 'date', label: 'Data', render: v => safeDateStr(v) },
    { key: 'total', label: 'Total', align: 'right', render: v => safeAmount(v) },
    { key: 'status', label: 'Estado', align: 'center', render: v => statusBadge(v) },
  ]} />
}

function ReceiptsPanel() {
  return <GenericDocPanel title="Recibos" fetchFn={ixListReceipts} dataKey="receipts" columns={[
    { key: 'sequence_number', label: 'N.º' },
    { key: 'date', label: 'Data', render: v => safeDateStr(v) },
    { key: 'total', label: 'Total', align: 'right', render: v => safeAmount(v) },
    { key: 'status', label: 'Estado', align: 'center', render: v => statusBadge(v) },
  ]} />
}

function InvoiceReceiptsPanel() {
  return <GenericDocPanel title="Faturas-Recibo" fetchFn={ixListInvoiceReceipts} dataKey="invoice_receipts" columns={[
    { key: 'sequence_number', label: 'N.º' },
    { key: 'date', label: 'Data', render: v => safeDateStr(v) },
    { key: 'total', label: 'Total', align: 'right', render: v => safeAmount(v) },
    { key: 'status', label: 'Estado', align: 'center', render: v => statusBadge(v) },
  ]} />
}

function SimplifiedInvoicesPanel() {
  return <GenericDocPanel title="Faturas Simplificadas" fetchFn={ixListSimplifiedInvoices} dataKey="simplified_invoices" columns={[
    { key: 'sequence_number', label: 'N.º' },
    { key: 'date', label: 'Data', render: v => safeDateStr(v) },
    { key: 'total', label: 'Total', align: 'right', render: v => safeAmount(v) },
    { key: 'status', label: 'Estado', align: 'center', render: v => statusBadge(v) },
  ]} />
}

function EstimatesPanel() {
  return <GenericDocPanel title="Orçamentos" fetchFn={ixListEstimates} dataKey="estimates" columns={[
    { key: 'sequence_number', label: 'N.º' },
    { key: 'date', label: 'Data', render: v => safeDateStr(v) },
    { key: 'total', label: 'Total', align: 'right', render: v => safeAmount(v) },
    { key: 'status', label: 'Estado', align: 'center', render: v => statusBadge(v) },
  ]} />
}

function GuidesPanel() {
  return <GenericDocPanel title="Guias de Transporte" fetchFn={ixListGuides} dataKey="guides" columns={[
    { key: 'sequence_number', label: 'N.º' },
    { key: 'date', label: 'Data', render: v => safeDateStr(v) },
    { key: 'loaded_at', label: 'Carregado' },
    { key: 'status', label: 'Estado', align: 'center', render: v => statusBadge(v) },
  ]} />
}

// ─── Clients Panel ──────────────────────────────────────────

function ClientsPanel() {
  const [clients, setClients] = useState<any[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', code: '', email: '', phone: '', fiscal_id: '', address: '', city: '', postal_code: '', country: 'Portugal' })
  const [saving, setSaving] = useState(false)

  const load = async (p: number = page) => {
    setLoading(true)
    try {
      const res = await ixListClients({ data: { page: p } })
      const raw = res?.clients || []
      setClients(Array.isArray(raw) ? raw : [raw])
      setTotalPages(res?.pagination?.total_pages || 1)
    } catch { setClients([]) }
    setLoading(false)
  }

  useEffect(() => { load(1) }, [])

  const handleCreate = async () => {
    setSaving(true)
    try {
      await ixCreateClient({ data: { client: form } })
      setShowCreate(false)
      setForm({ name: '', code: '', email: '', phone: '', fiscal_id: '', address: '', city: '', postal_code: '', country: 'Portugal' })
      load()
    } catch (e: any) { alert(e.message) }
    setSaving(false)
  }

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-navy-500 uppercase tracking-wide">Clientes InvoiceXpress</h3>
        <div className="flex gap-2">
          <button onClick={() => load()} className={btnSecondary}>Atualizar</button>
          <button onClick={() => setShowCreate(!showCreate)} className={btnPrimary}>+ Novo Cliente</button>
        </div>
      </div>

      {showCreate && (
        <div className="bg-navy-50 border border-navy-200 rounded-[2px] p-4 mb-4">
          <h4 className="text-sm font-semibold text-navy-700 mb-3">Novo Cliente</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
            <div><label className={lbl}>Nome</label><input className={inp} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className={lbl}>Código</label><input className={inp} value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></div>
            <div><label className={lbl}>NIF</label><input className={inp} value={form.fiscal_id} onChange={e => setForm({ ...form, fiscal_id: e.target.value })} /></div>
            <div><label className={lbl}>Email</label><input className={inp} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            <div><label className={lbl}>Telefone</label><input className={inp} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            <div><label className={lbl}>Morada</label><input className={inp} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
            <div><label className={lbl}>Cidade</label><input className={inp} value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
            <div><label className={lbl}>Código Postal</label><input className={inp} value={form.postal_code} onChange={e => setForm({ ...form, postal_code: e.target.value })} /></div>
            <div><label className={lbl}>País</label><input className={inp} value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} /></div>
          </div>
          <button onClick={handleCreate} disabled={saving || !form.name} className={btnPrimary}>
            {saving ? 'A criar...' : 'Criar Cliente'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : clients.length === 0 ? (
        <p className="text-sm text-navy-400">Sem clientes.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-100">
                  <th className="text-left py-2 text-navy-500 font-medium">Nome</th>
                  <th className="text-left py-2 text-navy-500 font-medium">Código</th>
                  <th className="text-left py-2 text-navy-500 font-medium">NIF</th>
                  <th className="text-left py-2 text-navy-500 font-medium">Email</th>
                  <th className="text-left py-2 text-navy-500 font-medium">Telefone</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c: any, idx: number) => {
                  const cl = c?.client || c
                  return (
                    <tr key={cl?.id || idx} className="border-b border-navy-50">
                      <td className="py-2 text-navy-700 font-medium">{cl?.name || '-'}</td>
                      <td className="py-2 text-navy-600">{cl?.code || '-'}</td>
                      <td className="py-2 text-navy-600">{cl?.fiscal_id || '-'}</td>
                      <td className="py-2 text-navy-600">{cl?.email || '-'}</td>
                      <td className="py-2 text-navy-600">{cl?.phone || '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-center gap-2 mt-4">
            <button disabled={page <= 1} onClick={() => { setPage(p => p - 1); load(page - 1) }} className={btnSecondary}>Anterior</button>
            <span className="text-sm text-navy-500">Página {page} de {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => { setPage(p => p + 1); load(page + 1) }} className={btnSecondary}>Seguinte</button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Items Panel ────────────────────────────────────────────

function ItemsPanel() {
  const [items, setItems] = useState<any[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', unit_price: '', tax: '23' })
  const [saving, setSaving] = useState(false)

  const load = async (p: number = page) => {
    setLoading(true)
    try {
      const res = await ixListItems({ data: { page: p } })
      const raw = res?.items || []
      setItems(Array.isArray(raw) ? raw : [raw])
      setTotalPages(res?.pagination?.total_pages || 1)
    } catch { setItems([]) }
    setLoading(false)
  }

  useEffect(() => { load(1) }, [])

  const handleCreate = async () => {
    setSaving(true)
    try {
      await ixCreateItem({
        data: {
          item: {
            name: form.name,
            description: form.description,
            unit_price: form.unit_price,
            tax: { name: `IVA${form.tax}`, value: form.tax },
          },
        },
      })
      setShowCreate(false)
      setForm({ name: '', description: '', unit_price: '', tax: '23' })
      load()
    } catch (e: any) { alert(e.message) }
    setSaving(false)
  }

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-navy-500 uppercase tracking-wide">Artigos / Serviços</h3>
        <div className="flex gap-2">
          <button onClick={() => load()} className={btnSecondary}>Atualizar</button>
          <button onClick={() => setShowCreate(!showCreate)} className={btnPrimary}>+ Novo Artigo</button>
        </div>
      </div>

      {showCreate && (
        <div className="bg-navy-50 border border-navy-200 rounded-[2px] p-4 mb-4">
          <h4 className="text-sm font-semibold text-navy-700 mb-3">Novo Artigo</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div><label className={lbl}>Nome</label><input className={inp} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className={lbl}>Preço Unitário</label><input type="number" step="0.01" className={inp} value={form.unit_price} onChange={e => setForm({ ...form, unit_price: e.target.value })} /></div>
            <div className="sm:col-span-2"><label className={lbl}>Descrição</label><input className={inp} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <div><label className={lbl}>IVA (%)</label><select className={inp} value={form.tax} onChange={e => setForm({ ...form, tax: e.target.value })}>
              <option value="23">23%</option><option value="13">13%</option><option value="6">6%</option><option value="0">Isento</option>
            </select></div>
          </div>
          <button onClick={handleCreate} disabled={saving || !form.name} className={btnPrimary}>
            {saving ? 'A criar...' : 'Criar Artigo'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-navy-400">Sem artigos.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-100">
                  <th className="text-left py-2 text-navy-500 font-medium">Nome</th>
                  <th className="text-left py-2 text-navy-500 font-medium">Descrição</th>
                  <th className="text-right py-2 text-navy-500 font-medium">Preço</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item: any, idx: number) => {
                  const it = item?.item || item
                  return (
                    <tr key={it?.id || idx} className="border-b border-navy-50">
                      <td className="py-2 text-navy-700 font-medium">{it?.name || '-'}</td>
                      <td className="py-2 text-navy-600">{it?.description || '-'}</td>
                      <td className="py-2 text-right text-navy-700">{safeAmount(it?.unit_price)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-center gap-2 mt-4">
            <button disabled={page <= 1} onClick={() => { setPage(p => p - 1); load(page - 1) }} className={btnSecondary}>Anterior</button>
            <span className="text-sm text-navy-500">Página {page} de {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => { setPage(p => p + 1); load(page + 1) }} className={btnSecondary}>Seguinte</button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── SAF-T Panel ────────────────────────────────────────────

function SaftPanel() {
  const [year, setYear] = useState(new Date().getFullYear())
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [sequences, setSequences] = useState<any[]>([])
  const [taxes, setTaxes] = useState<any[]>([])
  const [loadingMeta, setLoadingMeta] = useState(true)

  useEffect(() => {
    Promise.all([
      ixListSequences().catch(() => null),
      ixListTaxes().catch(() => null),
    ]).then(([seqRes, taxRes]) => {
      setSequences(seqRes?.sequences || [])
      setTaxes(taxRes?.taxes || [])
      setLoadingMeta(false)
    })
  }, [])

  const handleExport = async () => {
    setLoading(true)
    try {
      const res = await ixExportSaft({ data: { year } })
      setResult(res)
    } catch (e: any) { alert(e.message) }
    setLoading(false)
  }

  return (
    <div className="space-y-6">
      <div className={cardCls}>
        <h3 className="text-sm font-semibold text-navy-500 uppercase tracking-wide mb-4">Exportação SAF-T</h3>
        <div className="flex items-center gap-3 mb-4">
          <label className={lbl + ' mb-0'}>Ano:</label>
          <input type="number" className={inp + ' w-24'} value={year} onChange={e => setYear(Number(e.target.value))} />
          <button onClick={handleExport} disabled={loading} className={btnPrimary}>
            {loading ? 'A exportar...' : 'Exportar SAF-T'}
          </button>
        </div>
        {result && (
          <pre className="bg-navy-50 p-3 rounded text-xs overflow-auto max-h-60">{JSON.stringify(result, null, 2)}</pre>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={cardCls}>
          <h3 className="text-sm font-semibold text-navy-500 uppercase tracking-wide mb-4">Séries de Documentos</h3>
          {loadingMeta ? (
            <div className="flex justify-center py-4"><div className="w-5 h-5 border-3 border-gold-400 border-t-transparent rounded-full animate-spin" /></div>
          ) : sequences.length === 0 ? (
            <p className="text-sm text-navy-400">Sem séries configuradas.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-100">
                  <th className="text-left py-2 text-navy-500 font-medium">Série</th>
                  <th className="text-left py-2 text-navy-500 font-medium">Tipo</th>
                  <th className="text-center py-2 text-navy-500 font-medium">Predefinida</th>
                </tr>
              </thead>
              <tbody>
                {sequences.map((s: any, i: number) => {
                  const seq = s?.sequence || s
                  return (
                    <tr key={seq?.id || i} className="border-b border-navy-50">
                      <td className="py-2 text-navy-700">{seq?.serie || seq?.name || '-'}</td>
                      <td className="py-2 text-navy-600">{seq?.document_type || '-'}</td>
                      <td className="py-2 text-center">{seq?.default_sequence ? 'Sim' : '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className={cardCls}>
          <h3 className="text-sm font-semibold text-navy-500 uppercase tracking-wide mb-4">Impostos Configurados</h3>
          {loadingMeta ? (
            <div className="flex justify-center py-4"><div className="w-5 h-5 border-3 border-gold-400 border-t-transparent rounded-full animate-spin" /></div>
          ) : taxes.length === 0 ? (
            <p className="text-sm text-navy-400">Sem impostos configurados.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-100">
                  <th className="text-left py-2 text-navy-500 font-medium">Nome</th>
                  <th className="text-right py-2 text-navy-500 font-medium">Valor (%)</th>
                  <th className="text-left py-2 text-navy-500 font-medium">Região</th>
                </tr>
              </thead>
              <tbody>
                {taxes.map((t: any, i: number) => {
                  const tax = t?.tax || t
                  return (
                    <tr key={tax?.id || i} className="border-b border-navy-50">
                      <td className="py-2 text-navy-700">{tax?.name || '-'}</td>
                      <td className="py-2 text-right text-navy-600">{tax?.value ?? '-'}%</td>
                      <td className="py-2 text-navy-600">{tax?.region || '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
