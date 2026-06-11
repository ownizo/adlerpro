import { useEffect, useState } from 'react'
import {
  adminTriggerMarketingSend,
  createMarketingCampaign,
  fetchMarketingCampaigns,
  fetchMarketingSends,
  previewMarketingAudience,
  searchIndividualClients,
} from '@/lib/server-fns'

// ─── Local type aliases (not exported from server-fns) ──────────────────────
type MarketingAudience = 'companies' | 'company_users' | 'individual_clients' | 'all'
type MarketingTemplateKey = 'feedback' | 'renewal' | 'presentation' | 'seasonal'

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

type WizardVars = {
  intro?: string
  googleUrl?: string
  ctaLabel?: string
  ctaUrl?: string
  bullets?: string[]
  headline?: string
  body?: string
  bannerColor?: string
}

type PreviewData = {
  totalRaw: number
  afterOptOut: number
  afterDedup: number
  sample: string[]
}

type SendResult = { totalRecipients: number; sent: number; errors: number }

// ─── Constants ────────────────────────────────────────────────────────────────
const AUDIENCE_OPTS: { value: MarketingAudience; label: string; desc: string }[] = [
  { value: 'companies',          label: 'Empresas',                desc: 'Contactos principais das empresas com email registado' },
  { value: 'company_users',      label: 'Utilizadores de empresa', desc: 'Utilizadores registados associados a empresas' },
  { value: 'individual_clients', label: 'Clientes particulares',   desc: 'Clientes individuais com email válido' },
  { value: 'all',                label: 'Todos',                   desc: 'União de todas as audiências acima' },
]

const TEMPLATE_OPTS: { value: MarketingTemplateKey; label: string; desc: string }[] = [
  { value: 'feedback',     label: 'Avaliação Google',        desc: 'Pede ao destinatário que deixe uma avaliação no Google' },
  { value: 'renewal',      label: 'Renovação',               desc: 'Lembra o cliente de renovar a sua apólice' },
  { value: 'presentation', label: 'Apresentação de serviço', desc: 'Apresenta os serviços da Adler & Rochefort' },
  { value: 'seasonal',     label: 'Sazonal / Newsletter',    desc: 'Mensagem sazonal ou boletim informativo' },
]

const AUDIENCE_LABELS: Record<string, string> = {
  companies: 'Empresas', company_users: 'Utilizadores de empresa',
  individual_clients: 'Clientes particulares', all: 'Todos',
}

const TEMPLATE_LABELS: Record<string, string> = {
  feedback: 'Avaliação Google', renewal: 'Renovação',
  presentation: 'Apresentação', seasonal: 'Sazonal',
}

const DEFAULT_BULLETS = [
  'Multirriscos Empresarial e Habitação',
  'Automóvel e Frotas',
  'Vida e Saúde',
  'Responsabilidade Civil',
  'Acidentes de Trabalho',
  'Cyber, Directors & Officers e Ramos Técnicos',
]

const STEP_TITLES = ['Definir', 'Modelo', 'Conteúdo', 'Pré-visualizar Audiência', 'Confirmar e Enviar']

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function buildTemplateVars(key: MarketingTemplateKey, v: WizardVars): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  const add = (k: string, val: string | undefined) => { if (val?.trim()) out[k] = val.trim() }
  if (key === 'feedback') { add('intro', v.intro); add('googleUrl', v.googleUrl); add('ctaLabel', v.ctaLabel) }
  else if (key === 'renewal') { add('intro', v.intro); add('ctaLabel', v.ctaLabel); add('ctaUrl', v.ctaUrl) }
  else if (key === 'presentation') {
    add('intro', v.intro); add('ctaLabel', v.ctaLabel); add('ctaUrl', v.ctaUrl)
    const bullets = (v.bullets ?? []).filter((b) => b.trim())
    if (bullets.length > 0) out['bullets'] = bullets
  } else if (key === 'seasonal') {
    add('headline', v.headline); add('body', v.body); add('bannerColor', v.bannerColor)
    add('ctaLabel', v.ctaLabel); add('ctaUrl', v.ctaUrl)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

// ─── Badge sub-components ─────────────────────────────────────────────────────
function CampaignStatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    draft:     { label: 'Rascunho',  cls: 'bg-navy-100 text-navy-500' },
    sending:   { label: 'A enviar…', cls: 'bg-amber-100 text-amber-700 animate-pulse' },
    sent:      { label: 'Enviada',   cls: 'bg-green-100 text-green-700' },
    cancelled: { label: 'Cancelada', cls: 'bg-red-100 text-red-600' },
  }
  const { label, cls } = cfg[status] ?? { label: status, cls: 'bg-navy-100 text-navy-500' }
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>{label}</span>
}

function SendStatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    pending: { label: 'Pendente', cls: 'bg-navy-100 text-navy-500' },
    sent:    { label: 'Enviado',  cls: 'bg-green-100 text-green-700' },
    error:   { label: 'Erro',     cls: 'bg-red-100 text-red-600' },
    skipped: { label: 'Ignorado', cls: 'bg-gray-100 text-gray-500' },
  }
  const { label, cls } = cfg[status] ?? { label: status, cls: 'bg-navy-100 text-navy-500' }
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>{label}</span>
}

// ─── MarketingWizard ──────────────────────────────────────────────────────────
function MarketingWizard({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState(1)

  // Step 1
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [audience, setAudience] = useState<MarketingAudience | ''>('')

  // Single-recipient mode (step 1)
  const [singleMode, setSingleMode] = useState(false)
  const [singleSearch, setSingleSearch] = useState('')
  const [singleResults, setSingleResults] = useState<Array<{ id: string; fullName: string; email: string }>>([])
  const [singleSearching, setSingleSearching] = useState(false)
  const [singleSelected, setSingleSelected] = useState<{ id: string; fullName: string; email: string } | null>(null)

  // Step 2
  const [templateKey, setTemplateKey] = useState<MarketingTemplateKey | ''>('')

  // Step 3
  const [vars, setVars] = useState<WizardVars>({})

  // Step 4
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // Step 5
  const [confirmText, setConfirmText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendResult, setSendResult] = useState<SendResult | null>(null)

  // Input styles
  const inp = 'w-full border border-navy-200 rounded-[4px] px-3 py-2 text-sm text-navy-700 focus:outline-none focus:ring-1 focus:ring-navy-400'
  const ta  = `${inp} resize-y min-h-[80px]`

  // Debounced search for single-recipient mode
  useEffect(() => {
    if (!singleMode || singleSearch.trim().length < 2) {
      setSingleResults([])
      setSingleSearching(false)
      return
    }
    setSingleSearching(true)
    const t = setTimeout(async () => {
      try {
        const results = await searchIndividualClients({ data: { query: singleSearch.trim() } })
        setSingleResults(results)
      } catch {
        setSingleResults([])
      } finally {
        setSingleSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [singleSearch, singleMode]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelectTemplate(key: MarketingTemplateKey) {
    setTemplateKey(key)
    if (key === 'presentation') {
      setVars((v) => ({ ...v, bullets: v.bullets ?? DEFAULT_BULLETS.slice() }))
    }
  }

  async function loadPreview() {
    if (singleMode && !singleSelected) return
    if (!singleMode && !audience) return
    setPreviewLoading(true)
    setPreviewError(null)
    setPreview(null)
    try {
      const r = await previewMarketingAudience({
        data: {
          audience: (singleMode ? 'individual_clients' : audience) as MarketingAudience,
          ...(singleMode && singleSelected ? { singleRecipientEmail: singleSelected.email } : {}),
        },
      })
      setPreview(r)
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : 'Erro ao pré-visualizar audiência')
    } finally {
      setPreviewLoading(false)
    }
  }

  useEffect(() => {
    if (step === 4) loadPreview()
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSend() {
    if (isSending || confirmText !== title) return
    setIsSending(true)
    setSendError(null)
    try {
      const { campaignId } = await createMarketingCampaign({
        data: {
          title: title.trim(),
          subject: subject.trim(),
          templateKey: templateKey as MarketingTemplateKey,
          audience: (singleMode ? 'individual_clients' : audience) as MarketingAudience,
          templateVars: buildTemplateVars(templateKey as MarketingTemplateKey, vars),
          ...(singleMode && singleSelected ? { singleRecipientEmail: singleSelected.email } : {}),
        },
      })
      const result = await adminTriggerMarketingSend({ data: { campaignId } })
      setSendResult(result)
    } catch (err: unknown) {
      setSendError(err instanceof Error ? err.message : 'Erro ao enviar campanha')
      setIsSending(false)
    }
  }

  // Bullet helpers for presentation
  function setBullet(i: number, val: string) {
    setVars((v) => { const b = (v.bullets ?? DEFAULT_BULLETS.slice()).slice(); b[i] = val; return { ...v, bullets: b } })
  }
  function addBullet() {
    setVars((v) => ({ ...v, bullets: [...(v.bullets ?? DEFAULT_BULLETS.slice()), ''] }))
  }
  function removeBullet(i: number) {
    setVars((v) => { const b = (v.bullets ?? DEFAULT_BULLETS.slice()).slice(); b.splice(i, 1); return { ...v, bullets: b } })
  }

  function canAdvance(): boolean {
    switch (step) {
      case 1:
        if (singleMode) return title.trim() !== '' && subject.trim() !== '' && singleSelected !== null
        return title.trim() !== '' && subject.trim() !== '' && audience !== ''
      case 2: return templateKey !== ''
      case 3: return true
      case 4: return !previewLoading && preview !== null && preview.afterDedup > 0
      default: return false
    }
  }

  function renderBody() {
    // Success state
    if (sendResult) {
      return (
        <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center text-green-600 text-2xl font-bold">✓</div>
          <p className="text-lg font-semibold text-navy-700">Campanha enviada!</p>
          <p className="text-sm text-navy-500">
            Enviados: <span className="font-semibold text-green-700">{sendResult.sent}</span>
            {sendResult.errors > 0 && <> · Erros: <span className="font-semibold text-red-600">{sendResult.errors}</span></>}
          </p>
          <button
            className="mt-4 px-5 py-2 bg-navy-700 text-white rounded-[4px] text-sm font-medium hover:bg-navy-800"
            onClick={onSuccess}
          >
            Fechar
          </button>
        </div>
      )
    }

    // Sending spinner
    if (isSending) {
      const n = preview?.afterDedup ?? 1
      return (
        <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
          <div className="w-10 h-10 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-navy-700">
            A enviar para {n} destinatário{n === 1 ? '' : 's'}…
          </p>
          <p className="text-xs text-navy-400">Pode demorar até 2 minutos. Não feche esta janela.</p>
        </div>
      )
    }

    switch (step) {
      // ── Step 1 ───────────────────────────────────────────────────────────────
      case 1:
        return (
          <div className="flex flex-col gap-5">
            <div>
              <label className="block text-xs font-semibold text-navy-600 mb-1">Título interno *</label>
              <input className={inp} value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="ex: Newsletter Junho 2026" maxLength={150} />
              <p className="text-xs text-navy-400 mt-1">Identificação interna — não aparece no email enviado.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-navy-600 mb-1">Assunto do email *</label>
              <input className={inp} value={subject} onChange={(e) => setSubject(e.target.value)}
                placeholder="ex: Proteja o que mais importa — fale connosco" maxLength={200} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-navy-600 mb-2">Destinatários *</label>

              {/* Mode toggle */}
              <div className="flex gap-1 p-1 bg-navy-100 rounded-[4px] mb-3">
                <button type="button"
                  className={`flex-1 text-xs font-semibold py-1.5 rounded-[4px] transition-colors ${!singleMode ? 'bg-white text-navy-700 shadow-sm' : 'text-navy-500 hover:text-navy-700'}`}
                  onClick={() => { setSingleMode(false); setSingleSelected(null); setSingleSearch(''); setSingleResults([]) }}
                >
                  Audiência de grupo
                </button>
                <button type="button"
                  className={`flex-1 text-xs font-semibold py-1.5 rounded-[4px] transition-colors ${singleMode ? 'bg-white text-navy-700 shadow-sm' : 'text-navy-500 hover:text-navy-700'}`}
                  onClick={() => { setSingleMode(true); setAudience('') }}
                >
                  Cliente específico
                </button>
              </div>

              {/* Group audience options */}
              {!singleMode && (
                <div className="flex flex-col gap-2">
                  {AUDIENCE_OPTS.map((opt) => (
                    <button key={opt.value} type="button"
                      className={`text-left px-3 py-2.5 rounded-[4px] border transition-colors ${
                        audience === opt.value
                          ? 'border-[#C9A84C] bg-amber-50 ring-1 ring-[#C9A84C]'
                          : 'border-navy-200 hover:border-navy-400'
                      }`}
                      onClick={() => setAudience(opt.value)}
                    >
                      <p className="text-sm font-semibold text-navy-700">{opt.label}</p>
                      <p className="text-xs text-navy-400 mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              )}

              {/* Single client selector */}
              {singleMode && (
                <div className="flex flex-col gap-2">
                  {singleSelected ? (
                    <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-[#C9A84C] rounded-[4px]">
                      <span className="text-green-600 font-bold flex-shrink-0">✓</span>
                      <span className="text-sm text-navy-700 flex-1 min-w-0 truncate">
                        {singleSelected.fullName && <span className="font-semibold">{singleSelected.fullName} </span>}
                        <span className="text-navy-500">&lt;{singleSelected.email}&gt;</span>
                      </span>
                      <button type="button"
                        className="text-navy-400 hover:text-red-500 text-sm flex-shrink-0 leading-none"
                        onClick={() => { setSingleSelected(null); setSingleSearch(''); setSingleResults([]) }}
                        title="Limpar seleção"
                      >✕</button>
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <input className={inp} value={singleSearch}
                          onChange={(e) => setSingleSearch(e.target.value)}
                          placeholder="Pesquisar por nome ou email…"
                          autoComplete="off"
                        />
                        {singleSearching && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <div className="w-4 h-4 border-2 border-gold-400 border-t-transparent rounded-full animate-spin" />
                          </div>
                        )}
                      </div>
                      {singleResults.length > 0 && (
                        <div className="border border-navy-200 rounded-[4px] bg-white divide-y divide-navy-100 max-h-48 overflow-y-auto shadow-sm">
                          {singleResults.map((r) => (
                            <button key={r.id} type="button"
                              className="w-full text-left px-3 py-2.5 hover:bg-navy-50 transition-colors"
                              onClick={() => { setSingleSelected(r); setSingleSearch(''); setSingleResults([]) }}
                            >
                              <p className="text-sm font-semibold text-navy-700">{r.fullName || '—'}</p>
                              <p className="text-xs text-navy-400">{r.email}</p>
                            </button>
                          ))}
                        </div>
                      )}
                      {!singleSearching && singleSearch.trim().length >= 2 && singleResults.length === 0 && (
                        <p className="text-xs text-navy-400 px-1">Nenhum cliente encontrado.</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )

      // ── Step 2 ───────────────────────────────────────────────────────────────
      case 2:
        return (
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold text-navy-600 mb-1">Escolha o modelo de email *</p>
            {TEMPLATE_OPTS.map((opt) => (
              <button key={opt.value} type="button"
                className={`text-left px-4 py-3 rounded-[4px] border transition-colors ${
                  templateKey === opt.value
                    ? 'border-[#C9A84C] bg-amber-50 ring-1 ring-[#C9A84C]'
                    : 'border-navy-200 hover:border-navy-400'
                }`}
                onClick={() => handleSelectTemplate(opt.value)}
              >
                <p className="text-sm font-semibold text-navy-700">{opt.label}</p>
                <p className="text-xs text-navy-400 mt-0.5">{opt.desc}</p>
              </button>
            ))}
          </div>
        )

      // ── Step 3 ───────────────────────────────────────────────────────────────
      case 3:
        return (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-navy-400">Todos os campos são opcionais — em branco usa o texto padrão mostrado como sugestão.</p>

            {templateKey === 'feedback' && (<>
              <div>
                <label className="block text-xs font-semibold text-navy-600 mb-1">Introdução</label>
                <textarea className={ta} value={vars.intro ?? ''} onChange={(e) => setVars((v) => ({ ...v, intro: e.target.value }))}
                  placeholder="Texto de introdução antes do botão de avaliação" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-navy-600 mb-1">URL Google Review</label>
                <input className={inp} value={vars.googleUrl ?? 'https://g.page/r/CXBg1laCXvghEBM/review'}
                  onChange={(e) => setVars((v) => ({ ...v, googleUrl: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-navy-600 mb-1">Texto do botão</label>
                <input className={inp} value={vars.ctaLabel ?? ''} onChange={(e) => setVars((v) => ({ ...v, ctaLabel: e.target.value }))}
                  placeholder="Deixar avaliação" />
              </div>
            </>)}

            {templateKey === 'renewal' && (<>
              <div>
                <label className="block text-xs font-semibold text-navy-600 mb-1">Introdução</label>
                <textarea className={ta} value={vars.intro ?? ''} onChange={(e) => setVars((v) => ({ ...v, intro: e.target.value }))}
                  placeholder="Texto sobre a renovação da apólice" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-navy-600 mb-1">Texto do botão</label>
                <input className={inp} value={vars.ctaLabel ?? ''} onChange={(e) => setVars((v) => ({ ...v, ctaLabel: e.target.value }))}
                  placeholder="Falar connosco" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-navy-600 mb-1">URL do botão</label>
                <input className={inp} value={vars.ctaUrl ?? ''} onChange={(e) => setVars((v) => ({ ...v, ctaUrl: e.target.value }))}
                  placeholder="mailto:insurance@adlerrochefort.com" />
              </div>
            </>)}

            {templateKey === 'presentation' && (<>
              <div>
                <label className="block text-xs font-semibold text-navy-600 mb-1">Introdução</label>
                <textarea className={ta} value={vars.intro ?? ''} onChange={(e) => setVars((v) => ({ ...v, intro: e.target.value }))}
                  placeholder="Texto de apresentação da empresa" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-navy-600 mb-1">Lista de serviços</label>
                {(vars.bullets ?? DEFAULT_BULLETS).map((b, i) => (
                  <div key={i} className="flex gap-2 mb-1.5">
                    <input className={`${inp} flex-1`} value={b} onChange={(e) => setBullet(i, e.target.value)}
                      placeholder={`Serviço ${i + 1}`} />
                    <button type="button" onClick={() => removeBullet(i)}
                      className="px-2 text-red-400 hover:text-red-600 text-lg leading-none flex-shrink-0" title="Remover">−</button>
                  </div>
                ))}
                <button type="button" onClick={addBullet}
                  className="mt-1 text-xs text-navy-600 border border-navy-200 px-2 py-1 rounded-[4px] hover:border-navy-400">
                  + Adicionar serviço
                </button>
              </div>
              <div>
                <label className="block text-xs font-semibold text-navy-600 mb-1">Texto do botão</label>
                <input className={inp} value={vars.ctaLabel ?? ''} onChange={(e) => setVars((v) => ({ ...v, ctaLabel: e.target.value }))}
                  placeholder="Conhecer os nossos serviços" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-navy-600 mb-1">URL do botão</label>
                <input className={inp} value={vars.ctaUrl ?? ''} onChange={(e) => setVars((v) => ({ ...v, ctaUrl: e.target.value }))}
                  placeholder="https://adlerrochefort.com" />
              </div>
            </>)}

            {templateKey === 'seasonal' && (<>
              <div>
                <label className="block text-xs font-semibold text-navy-600 mb-1">Título do banner</label>
                <input className={inp} value={vars.headline ?? ''} onChange={(e) => setVars((v) => ({ ...v, headline: e.target.value }))}
                  placeholder="ex: Boas Festas da Adler & Rochefort" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-navy-600 mb-1">Corpo (HTML aceite)</label>
                <textarea className={`${inp} resize-y min-h-[120px]`} value={vars.body ?? ''}
                  onChange={(e) => setVars((v) => ({ ...v, body: e.target.value }))}
                  placeholder="Conteúdo principal da newsletter…" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-navy-600 mb-1">Cor do banner</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={vars.bannerColor ?? '#1B2B4B'}
                    onChange={(e) => setVars((v) => ({ ...v, bannerColor: e.target.value }))}
                    className="h-8 w-10 rounded border border-navy-200 cursor-pointer p-0.5 flex-shrink-0" />
                  <input className={`${inp} flex-1`} value={vars.bannerColor ?? '#1B2B4B'}
                    onChange={(e) => setVars((v) => ({ ...v, bannerColor: e.target.value }))}
                    placeholder="#1B2B4B" maxLength={7} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-navy-600 mb-1">Texto do botão (opcional)</label>
                <input className={inp} value={vars.ctaLabel ?? ''} onChange={(e) => setVars((v) => ({ ...v, ctaLabel: e.target.value }))}
                  placeholder="ex: Visitar o nosso site" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-navy-600 mb-1">URL do botão (opcional)</label>
                <input className={inp} value={vars.ctaUrl ?? ''} onChange={(e) => setVars((v) => ({ ...v, ctaUrl: e.target.value }))}
                  placeholder="https://adlerrochefort.com" />
              </div>
            </>)}
          </div>
        )

      // ── Step 4 ───────────────────────────────────────────────────────────────
      case 4:
        return (
          <div className="flex flex-col gap-4">
            {previewLoading && (
              <div className="flex items-center justify-center py-10">
                <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {previewError && (
              <div className="flex flex-col items-center gap-3 py-8">
                <p className="text-sm text-red-500 text-center">{previewError}</p>
                <button onClick={loadPreview}
                  className="text-xs border border-navy-300 px-3 py-1.5 rounded-[4px] text-navy-600 hover:border-navy-500">
                  Tentar novamente
                </button>
              </div>
            )}
            {preview && (<>
              <div className="bg-white border border-navy-200 rounded-[4px] p-4 flex flex-col gap-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-navy-500">Total com email válido</span>
                  <span className="font-semibold text-navy-700">{preview.totalRaw}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-navy-500">Excluídos por opt-out</span>
                  <span className="font-semibold text-navy-700">{preview.totalRaw - preview.afterOptOut}</span>
                </div>
                <div className="flex justify-between border-t border-navy-100 pt-1.5 mt-0.5">
                  <span className="text-navy-600 font-semibold">Após remover duplicados</span>
                  <span className="font-bold text-navy-800">{preview.afterDedup}</span>
                </div>
              </div>

              {preview.afterDedup === 0 ? (
                <div className="bg-red-50 border border-red-200 rounded-[4px] p-3 text-sm text-red-700">
                  {singleMode
                    ? 'Este cliente tem opt-out de marketing activo ou não foi encontrado. Volte ao Passo 1 e selecione outro destinatário.'
                    : 'Não existem destinatários válidos para esta audiência. Volte ao Passo 1 e escolha outra audiência.'}
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-[4px] p-3 text-sm text-amber-800">
                  ⚠️ Vai enviar emails REAIS para <strong>{preview.afterDedup} destinatários</strong>. Confirme antes de continuar.
                </div>
              )}

              {preview.sample.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-1.5">
                    Amostra (primeiros {preview.sample.length})
                  </p>
                  <div className="bg-white border border-navy-200 rounded-[4px] divide-y divide-navy-100">
                    {preview.sample.map((email) => (
                      <div key={email} className="px-3 py-1.5 text-xs text-navy-600">{email}</div>
                    ))}
                  </div>
                </div>
              )}
            </>)}
          </div>
        )

      // ── Step 5 ───────────────────────────────────────────────────────────────
      case 5: {
        const z = preview?.afterDedup ?? 0
        const canSend = confirmText === title && !isSending
        const summaryRows: [string, string][] = [
          ['Título', title],
          ['Assunto', subject],
          singleMode && singleSelected
            ? ['Destinatário único', singleSelected.fullName ? `${singleSelected.fullName} <${singleSelected.email}>` : singleSelected.email]
            : ['Audiência', AUDIENCE_LABELS[audience] ?? audience],
          ['Modelo', TEMPLATE_LABELS[templateKey] ?? templateKey],
        ]
        return (
          <div className="flex flex-col gap-5">
            <div className="bg-white border border-navy-200 rounded-[4px] p-4 flex flex-col gap-2 text-sm">
              {summaryRows.map(([label, val]) => (
                <div key={label} className="flex justify-between gap-4">
                  <span className="text-navy-500 flex-shrink-0">{label}</span>
                  <span className="font-semibold text-navy-700 text-right">{val}</span>
                </div>
              ))}
              <div className="flex justify-between gap-4 border-t border-navy-100 pt-2 mt-0.5">
                <span className="text-navy-600 font-semibold flex-shrink-0">Destinatários</span>
                <span className="font-bold text-navy-800">{z}</span>
              </div>
            </div>

            {sendError && (
              <div className="bg-red-50 border border-red-200 rounded-[4px] p-3 text-sm text-red-700">
                {sendError}
                <p className="text-xs mt-1 text-red-500">A campanha pode ter ficado como rascunho — verifique o histórico.</p>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-navy-600 mb-1">
                Para confirmar, escreva o título da campanha exatamente:
              </label>
              <input className={inp} value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                placeholder={title} disabled={isSending} autoComplete="off" />
              {confirmText.length > 0 && confirmText !== title && (
                <p className="text-xs text-red-500 mt-1">O texto não coincide com o título.</p>
              )}
            </div>

            <button
              className={`w-full py-3 rounded-[4px] text-sm font-semibold transition-colors ${
                canSend ? 'bg-navy-700 text-white hover:bg-navy-800' : 'bg-navy-200 text-navy-400 cursor-not-allowed'
              }`}
              disabled={!canSend}
              onClick={handleSend}
            >
              Enviar campanha para {z} destinatários
            </button>
          </div>
        )
      }

      default: return null
    }
  }

  return (
    <>
      {/* Overlay — click closes unless sending */}
      <div className="fixed inset-0 z-[300] bg-black/40" onClick={isSending ? undefined : onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full sm:max-w-[520px] z-[301] bg-white shadow-xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-navy-100 flex-shrink-0">
          <div>
            <p className="text-xs text-navy-400 mb-0.5">Nova Campanha · Passo {step}/5</p>
            <h2 className="text-base font-semibold text-navy-700">{STEP_TITLES[step - 1]}</h2>
          </div>
          <button
            className="text-navy-400 hover:text-navy-700 text-xl leading-none disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={onClose} disabled={isSending} title="Cancelar"
          >✕</button>
        </div>

        {/* Progress bar */}
        <div className="flex h-1 bg-navy-100 flex-shrink-0">
          {[1, 2, 3, 4, 5].map((s) => (
            <div key={s} className={`flex-1 transition-colors duration-300 ${s <= step ? 'bg-[#C9A84C]' : ''}`} />
          ))}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">{renderBody()}</div>

        {/* Footer — hidden while sending or after success */}
        {!isSending && !sendResult && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-navy-100 flex-shrink-0">
            <button
              className="text-sm text-navy-500 hover:text-navy-700"
              onClick={() => (step > 1 ? setStep((s) => s - 1) : onClose())}
            >
              {step === 1 ? 'Cancelar' : '← Anterior'}
            </button>
            {step < 5 && (
              <button
                className={`px-4 py-2 rounded-[4px] text-sm font-medium transition-colors ${
                  canAdvance() ? 'bg-navy-700 text-white hover:bg-navy-800' : 'bg-navy-200 text-navy-400 cursor-not-allowed'
                }`}
                disabled={!canAdvance()}
                onClick={() => { if (canAdvance()) setStep((s) => s + 1) }}
              >
                Seguinte →
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}

// ─── AdminMarketingPanel ──────────────────────────────────────────────────────
export function AdminMarketingPanel() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [sends, setSends] = useState<Send[]>([])
  const [sendsLoading, setSendsLoading] = useState(false)
  const [sendsError, setSendsError] = useState<string | null>(null)

  const [wizardOpen, setWizardOpen] = useState(false)

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
    if (expandedId === id) { setExpandedId(null); return }
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

  function handleWizardSuccess() {
    setWizardOpen(false)
    loadCampaigns()
  }

  const newBtn = (small?: boolean) => (
    <button
      className={`rounded-[4px] text-sm font-medium bg-navy-700 text-white hover:bg-navy-800 transition-colors ${small ? 'px-3 py-1.5' : 'px-4 py-2'}`}
      onClick={() => setWizardOpen(true)}
    >
      + Nova Campanha
    </button>
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-navy-700">
          Campanhas de Email
          {!loading && campaigns.length > 0 && (
            <span className="ml-2 text-navy-500 font-normal text-base">({campaigns.length})</span>
          )}
        </h2>
        {newBtn(true)}
      </div>

      {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && campaigns.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-navy-500">Ainda não existem campanhas.</p>
          {newBtn()}
        </div>
      )}

      {!loading && campaigns.length > 0 && (
        <div className="space-y-2">
          {campaigns.map((c) => {
            const isExpanded = expandedId === c.id
            return (
              <div key={c.id} className="bg-white rounded-[4px] border border-navy-200 overflow-hidden">
                <button
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-navy-50 transition-colors"
                  onClick={() => handleExpand(c.id)}
                  aria-expanded={isExpanded}
                >
                  <span className={`flex-shrink-0 text-navy-300 text-[10px] transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-navy-700 truncate">{c.title}</p>
                    <p className="text-xs text-navy-400 truncate">{c.subject}</p>
                  </div>
                  <span className="flex-shrink-0 text-xs bg-navy-50 text-navy-500 border border-navy-200 px-2 py-0.5 rounded hidden sm:inline">
                    {AUDIENCE_LABELS[c.audience] ?? c.audience}
                  </span>
                  <span className="flex-shrink-0 text-xs bg-navy-50 text-navy-500 border border-navy-200 px-2 py-0.5 rounded hidden sm:inline">
                    {TEMPLATE_LABELS[c.template_key] ?? c.template_key}
                  </span>
                  <CampaignStatusBadge status={c.status} />
                  <span className="flex-shrink-0 text-xs text-navy-400 hidden md:inline whitespace-nowrap">{fmtDate(c.created_at)}</span>
                  {c.status === 'sent' && (
                    <span className="flex-shrink-0 text-xs hidden md:inline whitespace-nowrap">
                      <span className="text-green-600 font-medium">✓ {c.total_sent ?? 0}</span>
                      {(c.total_errors ?? 0) > 0 && <span className="text-red-500 font-medium ml-1.5">✗ {c.total_errors}</span>}
                    </span>
                  )}
                </button>

                {isExpanded && (
                  <div className="border-t border-navy-100 bg-navy-50 px-4 py-4">
                    <div className="flex flex-wrap gap-x-6 gap-y-1 mb-3 text-xs text-navy-500">
                      <span><strong>Audiência:</strong> {AUDIENCE_LABELS[c.audience] ?? c.audience}</span>
                      <span><strong>Modelo:</strong> {TEMPLATE_LABELS[c.template_key] ?? c.template_key}</span>
                      {c.total_recipients != null && <span><strong>Destinatários:</strong> {c.total_recipients}</span>}
                      {c.sent_at && <span><strong>Enviada em:</strong> {fmtDate(c.sent_at)}</span>}
                    </div>
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
                        <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-2">Destinatários ({sends.length})</p>
                        <div className="rounded border border-navy-200 bg-white overflow-hidden divide-y divide-navy-100">
                          {sends.map((s, i) => (
                            <div key={i} className="px-3 py-2 flex items-center gap-3 text-sm">
                              <div className="flex-1 min-w-0">
                                <span className="font-medium text-navy-700">{s.recipient_email}</span>
                                {s.recipient_name && <span className="text-navy-400 ml-1.5 text-xs">{s.recipient_name}</span>}
                              </div>
                              <SendStatusBadge status={s.status} />
                              {s.sent_at && <span className="text-xs text-navy-400 hidden sm:inline whitespace-nowrap">{fmtDate(s.sent_at)}</span>}
                              {s.error_message && (
                                <span className="text-xs text-red-500 truncate max-w-[200px]" title={s.error_message}>{s.error_message}</span>
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

      {wizardOpen && (
        <MarketingWizard onClose={() => setWizardOpen(false)} onSuccess={handleWizardSuccess} />
      )}
    </div>
  )
}
