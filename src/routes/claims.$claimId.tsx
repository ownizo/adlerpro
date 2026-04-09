import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { AppLayout } from '@/components/AppLayout'
import { fetchClaim, fetchDocuments, fetchPolicy } from '@/lib/server-fns'
import { formatCurrency, formatDate, formatFileSize } from '@/lib/utils'
import type { Claim, ClaimStatus, Document, Policy } from '@/lib/types'

export const Route = createFileRoute('/claims/$claimId')({
  component: ClaimDetailPage,
})

const STATE_LABELS: Record<ClaimStatus, string> = {
  submitted: 'A aguardar resposta',
  under_review: 'Em análise',
  documentation: 'A aguardar documentos',
  assessment: 'Em avaliação',
  approved: 'Resolvido com aprovação',
  denied: 'Encerrado sem aprovação',
  paid: 'Resolvido e pago',
}

function ClaimDetailPage() {
  const { claimId } = Route.useParams()

  const [claim, setClaim] = useState<Claim | undefined>()
  const [policy, setPolicy] = useState<Policy | undefined>()
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const claimData = await fetchClaim({ data: claimId })
        setClaim(claimData)

        if (!claimData) {
          setPolicy(undefined)
          setDocuments([])
          return
        }

        const [policyData, docs] = await Promise.all([
          fetchPolicy({ data: claimData.policyId }),
          fetchDocuments(),
        ])

        setPolicy(policyData)
        setDocuments(
          docs
            .filter((doc) => doc.policyId === claimData.policyId)
            .sort((a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt)),
        )
      } finally {
        setLoading(false)
      }
    }

    load().catch(() => setLoading(false))
  }, [claimId])

  const timeline = useMemo(() => {
    if (!claim) return []

    return [...(claim.steps || [])]
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
      .map((step, index) => ({
        id: `${step.status}-${step.date}-${index}`,
        date: step.date,
        title: STATE_LABELS[step.status],
        note: step.notes || defaultTimelineNote(step.status),
      }))
  }, [claim])

  const nextSteps = useMemo(() => {
    if (!claim) return []
    return getNextSteps(claim.status)
  }, [claim])

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gold-400 border-t-transparent" />
        </div>
      </AppLayout>
    )
  }

  if (!claim) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-3xl rounded-[4px] border border-navy-200 bg-white p-8 text-center">
          <h1 className="text-2xl font-bold text-navy-700">Sinistro não encontrado</h1>
          <p className="mt-2 text-sm text-navy-500">Este registo pode não existir ou já não estar disponível.</p>
          <a
            href="/claims"
            className="mt-6 inline-flex rounded-[2px] border border-navy-200 px-4 py-2 text-sm font-medium text-navy-600 hover:bg-navy-50"
          >
            Voltar à lista
          </a>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <a href="/claims" className="text-sm font-medium text-navy-600 hover:text-navy-700">
            ← Voltar aos sinistros
          </a>
          <div className="flex items-center gap-2 text-xs font-medium">
            <a href="#documentos" className="rounded border border-navy-200 px-3 py-1.5 text-navy-600 hover:bg-navy-50">Adicionar documento</a>
            <a href="/contact" className="rounded border border-navy-200 px-3 py-1.5 text-navy-600 hover:bg-navy-50">Contactar apoio</a>
          </div>
        </div>

        <section className="rounded-[4px] border border-navy-200 bg-white p-6">
          <p className="text-xs uppercase tracking-wide text-navy-500">Sinistro #{claim.id.slice(-8).toUpperCase()}</p>
          <div className="mt-2 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <h1 className="text-2xl font-bold text-navy-700">{claim.title}</h1>
              <p className="mt-2 text-sm text-navy-600">{claim.description}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <InfoItem label="Estado atual" value={STATE_LABELS[claim.status]} />
              <InfoItem label="Valor estimado" value={formatCurrency(claim.estimatedValue || 0)} />
              <InfoItem label="Data do incidente" value={formatDate(claim.incidentDate)} />
              <InfoItem label="Última atualização" value={formatDate(getLastUpdated(claim).toISOString())} />
              <InfoItem label="Apólice" value={policy ? policy.policyNumber : 'Sem apólice associada'} />
              <InfoItem label="Seguradora" value={policy ? policy.insurer : '—'} />
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <article className="rounded-[4px] border border-navy-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-navy-700">Timeline</h2>
            <div className="mt-4 space-y-4">
              {timeline.length === 0 ? (
                <p className="text-sm text-navy-500">Ainda não existem eventos registados.</p>
              ) : (
                timeline.map((event) => (
                  <div key={event.id} className="flex gap-3">
                    <div className="mt-1 h-2.5 w-2.5 rounded-full bg-gold-400" />
                    <div>
                      <p className="text-sm font-semibold text-navy-700">{event.title}</p>
                      <p className="text-xs text-navy-400">{formatDate(event.date)}</p>
                      <p className="mt-1 text-sm text-navy-600">{event.note}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="rounded-[4px] border border-navy-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-navy-700">Próximos passos</h2>
            <ol className="mt-4 space-y-3 text-sm text-navy-600">
              {nextSteps.map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-navy-100 text-xs font-semibold text-navy-700">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <h3 className="mt-8 text-sm font-semibold uppercase tracking-wide text-navy-500">Comunicação</h3>
            <div className="mt-3 rounded-[4px] border border-navy-100 bg-navy-50/40 p-4 text-sm text-navy-600">
              <p>
                A equipa de apoio está a acompanhar este sinistro. Para acelerar a resposta, mantenha os documentos atualizados e use o botão
                <span className="font-semibold text-navy-700"> Contactar apoio</span> se existir alguma mudança relevante.
              </p>
            </div>
          </article>
        </section>

        <section id="documentos" className="rounded-[4px] border border-navy-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-navy-700">Documentos</h2>
            <a href="/policies" className="text-sm font-medium text-navy-600 hover:text-navy-700">Adicionar documento na área de apólices</a>
          </div>
          <div className="mt-4 space-y-2">
            {documents.length === 0 ? (
              <p className="text-sm text-navy-500">Ainda não existem documentos associados a esta apólice/sinistro.</p>
            ) : (
              documents.slice(0, 8).map((doc) => (
                <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-navy-100 p-3">
                  <div>
                    <p className="text-sm font-medium text-navy-700">{doc.name}</p>
                    <p className="text-xs text-navy-400">{formatDate(doc.uploadedAt)} · {formatFileSize(doc.size)}</p>
                  </div>
                  <span className="rounded-full border border-navy-200 px-2 py-1 text-xs text-navy-500">{doc.category}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </AppLayout>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-navy-100 bg-navy-50/30 p-3">
      <p className="text-xs uppercase tracking-wide text-navy-500">{label}</p>
      <p className="mt-1 font-semibold text-navy-700">{value}</p>
    </div>
  )
}

function getLastUpdated(claim: Claim): Date {
  const latestStep = claim.steps
    ?.map((step) => Date.parse(step.date))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0]

  if (typeof latestStep === 'number') return new Date(latestStep)

  const claimDate = Date.parse(claim.claimDate)
  if (Number.isFinite(claimDate)) return new Date(claimDate)

  const createdAt = Date.parse(claim.createdAt)
  if (Number.isFinite(createdAt)) return new Date(createdAt)

  return new Date(0)
}

function defaultTimelineNote(status: ClaimStatus): string {
  if (status === 'submitted') return 'Participação recebida e em fila para validação inicial.'
  if (status === 'under_review') return 'A equipa está a rever a informação partilhada.'
  if (status === 'documentation') return 'Faltam documentos para avançar com a decisão.'
  if (status === 'assessment') return 'Análise de impacto em curso.'
  if (status === 'approved') return 'Decisão favorável comunicada ao cliente.'
  if (status === 'paid') return 'Processo concluído com pagamento efetuado.'
  return 'Processo encerrado sem aprovação.'
}

function getNextSteps(status: ClaimStatus): string[] {
  if (status === 'submitted') {
    return [
      'Aguardar validação inicial da equipa de apoio.',
      'Confirmar se todos os dados do incidente estão completos.',
      'Anexar documentos relevantes assim que possível.',
    ]
  }

  if (status === 'under_review' || status === 'assessment') {
    return [
      'Acompanhar atualizações na timeline desta página.',
      'Responder rapidamente a pedidos de esclarecimento.',
      'Manter o contacto de apoio ativo para acelerar decisão.',
    ]
  }

  if (status === 'documentation') {
    return [
      'Juntar os documentos em falta na área de apólices.',
      'Confirmar que os ficheiros estão legíveis.',
      'Avisar a equipa de apoio quando o envio estiver concluído.',
    ]
  }

  if (status === 'approved') {
    return [
      'Validar os detalhes finais enviados pela equipa.',
      'Aguardar confirmação da data de fecho do processo.',
      'Guardar documentação final para histórico interno.',
    ]
  }

  if (status === 'paid') {
    return [
      'Processo concluído. Rever impacto interno e medidas de prevenção.',
      'Guardar comprovativos e anexos para auditoria futura.',
      'Encerrar comunicação quando não houver pendências.',
    ]
  }

  return [
    'Processo encerrado. Se necessário, contactar apoio para revisão.',
    'Guardar os documentos relevantes para histórico interno.',
    'Avaliar medidas preventivas para reduzir novos incidentes.',
  ]
}
