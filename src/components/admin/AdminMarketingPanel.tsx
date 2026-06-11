import { useEffect, useState } from 'react'
import { fetchMarketingCampaigns, fetchMarketingSends } from '@/lib/server-fns'

type Campaign = {
  id: string
  title: string
  subject: string
  template_key: string
  audience: string
  status: string
  created_at: string
  sent_at: string | null
  total_recipients: number | null
  total_sent: number | null
  total_errors: number | null
}

type Send = {
  recipient_email: string
  recipient_name: string | null
  recipient_type: string | null
  status: string
  error_message: string | null
  sent_at: string | null
}

const AUDIENCE_LABELS: Record<string, string> = {
  companies: 'Empresas',
  company_users: 'Utilizadores de empresa',
  individual_clients: 'Clientes particulares',
  all: 'Todos',
}

const TEMPLATE_LABELS: Record<string, string> = {
  feedback: 'Avaliação Google',
  renewal: 'Renovação',
  presentation: 'Apresentação',
  seasonal: 'Sazonal',
}

function CampaignStatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    draft:     { label: 'Rascunho',   cls: 'bg-navy-100 text-navy-500' },
    sending:   { label: 'A enviar…',  cls: 'bg-amber-100 text-amber-700 animate-pulse' },
    sent:      { label: 'Enviada',    cls: 'bg-green-100 text-green-700' },
    cancelled: { label: 'Cancelada',  cls: 'bg-red-100 text-red-600' },
  }
  const { label, cls } = cfg[status] ?? { label: status, cls: 'bg-navy-100 text-navy-500' }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>
      {label}
    </span>
  )
}

function SendStatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    pending: { label: 'Pendente', cls: 'bg-navy-100 text-navy-500' },
    sent:    { label: 'Enviado',  cls: 'bg-green-100 text-green-700' },
    error:   { label: 'Erro',     cls: 'bg-red-100 text-red-600' },
    skipped: { label: 'Ignorado', cls: 'bg-gray-100 text-gray-500' },
  }
  const { label, cls } = cfg[status] ?? { label: status, cls: 'bg-navy-100 text-navy-500' }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>
      {label}
    </span>
  )
}

function fmtDate(isoStr: string) {
  return new Date(isoStr).toLocaleDateString('pt-PT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

export function AdminMarketingPanel() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Detail expand state
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [sends, setSends] = useState<Send[]>([])
  const [sendsLoading, setSendsLoading] = useState(false)
  const [sendsError, setSendsError] = useState<string | null>(null)

  async function loadCampaigns() {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchMarketingCampaigns()
      setCampaigns(result)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar campanhas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadCampaigns() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    setSends([])
    setSendsLoading(true)
    setSendsError(null)
    try {
      const result = await fetchMarketingSends({ data: { campaignId: id } })
      setSends(result)
    } catch (err: unknown) {
      setSendsError(err instanceof Error ? err.message : 'Erro ao carregar destinatários')
    } finally {
      setSendsLoading(false)
    }
  }

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-navy-700">
          Campanhas de Email
          {!loading && campaigns.length > 0 && (
            <span className="ml-2 text-navy-500 font-normal text-base">
              ({campaigns.length})
            </span>
          )}
        </h2>
        <button
          className="px-3 py-1.5 rounded-[4px] text-sm font-medium border border-navy-300 text-navy-400 opacity-50 cursor-not-allowed"
          disabled
          title="Criar campanhas estará disponível em breve"
        >
          + Nova Campanha
        </button>
      </div>

      {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

      {/* ── Loading ── */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* ── Empty ── */}
      {!loading && campaigns.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-navy-500">Ainda não existem campanhas.</p>
          <button
            className="px-4 py-2 rounded-[4px] text-sm font-medium border border-navy-300 text-navy-400 opacity-50 cursor-not-allowed"
            disabled
            title="Criar campanhas estará disponível em breve"
          >
            + Nova Campanha
          </button>
        </div>
      )}

      {/* ── Campaign list ── */}
      {!loading && campaigns.length > 0 && (
        <div className="space-y-2">
          {campaigns.map((c) => {
            const isExpanded = expandedId === c.id
            return (
              <div
                key={c.id}
                className="bg-white rounded-[4px] border border-navy-200 overflow-hidden"
              >
                {/* ── Row ── */}
                <button
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-navy-50 transition-colors"
                  onClick={() => handleExpand(c.id)}
                  aria-expanded={isExpanded}
                >
                  {/* Chevron */}
                  <span
                    className={`flex-shrink-0 text-navy-300 text-[10px] transition-transform duration-150 ${
                      isExpanded ? 'rotate-90' : ''
                    }`}
                  >
                    ▶
                  </span>

                  {/* Title + subject */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-navy-700 truncate">{c.title}</p>
                    <p className="text-xs text-navy-400 truncate">{c.subject}</p>
                  </div>

                  {/* Audience pill */}
                  <span className="flex-shrink-0 text-xs bg-navy-50 text-navy-500 border border-navy-200 px-2 py-0.5 rounded hidden sm:inline">
                    {AUDIENCE_LABELS[c.audience] ?? c.audience}
                  </span>

                  {/* Template pill */}
                  <span className="flex-shrink-0 text-xs bg-navy-50 text-navy-500 border border-navy-200 px-2 py-0.5 rounded hidden sm:inline">
                    {TEMPLATE_LABELS[c.template_key] ?? c.template_key}
                  </span>

                  {/* Status badge */}
                  <CampaignStatusBadge status={c.status} />

                  {/* Created date */}
                  <span className="flex-shrink-0 text-xs text-navy-400 hidden md:inline whitespace-nowrap">
                    {fmtDate(c.created_at)}
                  </span>

                  {/* Sent/error stats — only when sent */}
                  {c.status === 'sent' && (
                    <span className="flex-shrink-0 text-xs text-navy-500 hidden md:inline whitespace-nowrap">
                      <span className="text-green-600 font-medium">✓ {c.total_sent ?? 0}</span>
                      {(c.total_errors ?? 0) > 0 && (
                        <span className="text-red-500 font-medium ml-1.5">✗ {c.total_errors}</span>
                      )}
                    </span>
                  )}
                </button>

                {/* ── Expanded detail ── */}
                {isExpanded && (
                  <div className="border-t border-navy-100 bg-navy-50 px-4 py-4">

                    {/* Meta summary */}
                    <div className="flex flex-wrap gap-x-6 gap-y-1 mb-3 text-xs text-navy-500">
                      <span><strong>Audiência:</strong> {AUDIENCE_LABELS[c.audience] ?? c.audience}</span>
                      <span><strong>Modelo:</strong> {TEMPLATE_LABELS[c.template_key] ?? c.template_key}</span>
                      {c.total_recipients != null && (
                        <span><strong>Destinatários:</strong> {c.total_recipients}</span>
                      )}
                      {c.sent_at && (
                        <span><strong>Enviada em:</strong> {fmtDate(c.sent_at)}</span>
                      )}
                    </div>

                    {/* Sends list */}
                    {sendsLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <div className="w-6 h-6 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : sendsError ? (
                      <p className="text-sm text-red-500">{sendsError}</p>
                    ) : sends.length === 0 ? (
                      <p className="text-sm text-navy-400">Sem destinatários registados.</p>
                    ) : (
                      <div>
                        <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-2">
                          Destinatários ({sends.length})
                        </p>
                        <div className="rounded border border-navy-200 bg-white overflow-hidden divide-y divide-navy-100">
                          {sends.map((s, i) => (
                            <div key={i} className="px-3 py-2 flex items-center gap-3 text-sm">
                              <div className="flex-1 min-w-0">
                                <span className="font-medium text-navy-700">{s.recipient_email}</span>
                                {s.recipient_name && (
                                  <span className="text-navy-400 ml-1.5 text-xs">
                                    {s.recipient_name}
                                  </span>
                                )}
                              </div>
                              <SendStatusBadge status={s.status} />
                              {s.sent_at && (
                                <span className="text-xs text-navy-400 hidden sm:inline whitespace-nowrap">
                                  {fmtDate(s.sent_at)}
                                </span>
                              )}
                              {s.error_message && (
                                <span
                                  className="text-xs text-red-500 truncate max-w-[200px]"
                                  title={s.error_message}
                                >
                                  {s.error_message}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
