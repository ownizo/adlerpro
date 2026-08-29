import type { Company, Policy, Claim, Document as DocType, IndividualClient } from '@/lib/types'
import { CLAIM_STATUS_LABELS, POLICY_TYPE_LABELS } from '@/lib/types'
import { formatDate } from '@/lib/utils'
import { ClientNotes } from './ClientNotes'
import { ClientTasks } from './ClientTasks'
import { WebsiteLeads } from './WebsiteLeads'
import { SalesOpportunitiesSection } from './SalesOpportunitiesSection'
import { getDocumentUrl } from '@/lib/server-fns'

type Subject =
  | { kind: 'company'; company: Company }
  | { kind: 'individual'; client: IndividualClient }

interface Props {
  subject: Subject
  policies: Policy[]
  claims: Claim[]
  documents: DocType[]
}

type TimelineEntry = {
  date: string
  label: string
  kind: 'policy' | 'claim' | 'document'
}

function buildClientTimeline(
  subjectPolicies: Policy[],
  subjectClaims: Claim[],
  subjectDocs: DocType[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...subjectPolicies.map((p) => ({
      date: p.createdAt,
      label: `Apólice criada — ${POLICY_TYPE_LABELS[p.type] ?? p.type} · ${p.policyNumber}`,
      kind: 'policy' as const,
    })),
    ...subjectClaims.map((c) => ({
      date: c.createdAt,
      label: `Sinistro — ${c.title}`,
      kind: 'claim' as const,
    })),
    ...subjectDocs.map((d) => ({
      date: d.uploadedAt,
      label: `Documento — ${d.name} (${d.category})`,
      kind: 'document' as const,
    })),
  ]
  return entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

const KIND_DOT: Record<TimelineEntry['kind'], string> = {
  policy: 'bg-blue-400',
  claim: 'bg-red-400',
  document: 'bg-gold-400',
}

export function ClientProfilePanel({ subject, policies, claims, documents }: Props) {
  let subjectPolicies: Policy[]
  let subjectClaims: Claim[]
  let subjectDocs: DocType[]

  if (subject.kind === 'company') {
    const id = subject.company.id
    subjectPolicies = policies.filter((p) => p.companyId === id)
    subjectClaims = claims.filter((c) => c.companyId === id)
    subjectDocs = documents.filter((d) => d.companyId === id)
  } else {
    const id = subject.client.id
    subjectPolicies = policies.filter((p) => p.individualClientId === id)
    subjectClaims = claims.filter((c) => c.individualClientId === id)
    subjectDocs = documents.filter((d) => d.individualClientId === id)
  }

  const timeline = buildClientTimeline(subjectPolicies, subjectClaims, subjectDocs)
  const activePolicies = subjectPolicies.filter((p) => p.status === 'active').length
  const openClaims = subjectClaims.filter((c) => c.status !== 'paid' && c.status !== 'denied').length

  return (
    <div className="mt-6 pt-6 border-t border-navy-200 space-y-6">
      {/* Resumo rápido — "o que é preciso saber já", sem repetir os detalhes
          que já aparecem nas secções abaixo. Ver requisito "client summary". */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-navy-500">
        <span><strong className="text-navy-700 font-semibold">{activePolicies}</strong> apólices ativas</span>
        <span><strong className="text-navy-700 font-semibold">{openClaims}</strong> sinistros abertos</span>
        <span><strong className="text-navy-700 font-semibold">{subjectDocs.length}</strong> documentos</span>
      </div>

      {/* Sinistros */}
      <div>
        <h4 className="text-sm font-semibold text-navy-700 mb-3">
          Sinistros do cliente ({subjectClaims.length})
        </h4>
        {subjectClaims.length === 0 ? (
          <p className="text-sm text-navy-400">Sem sinistros registados.</p>
        ) : (
          <div className="grid gap-2">
            {subjectClaims.map((c) => (
              <div
                key={c.id}
                className="bg-white rounded-[4px] border border-navy-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2"
              >
                <div>
                  <p className="text-sm font-medium text-navy-700">{c.title}</p>
                  <p className="text-xs text-navy-500">{formatDate(c.claimDate)}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-navy-100 text-navy-600">
                  {CLAIM_STATUS_LABELS[c.status]}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Documentos */}
      <div>
        <h4 className="text-sm font-semibold text-navy-700 mb-3">
          Documentos do cliente ({subjectDocs.length})
        </h4>
        {subjectDocs.length === 0 ? (
          <p className="text-sm text-navy-400">Sem documentos carregados.</p>
        ) : (
          <div className="grid gap-2">
            {subjectDocs.map((d) => (
              <div
                key={d.id}
                className="bg-white rounded-[4px] border border-navy-200 px-4 py-3 flex items-center justify-between gap-2"
              >
                <div>
                  <p className="text-sm text-navy-700">{d.name}</p>
                  <span className="text-xs text-navy-500">{d.category} · {formatDate(d.uploadedAt)}</span>
                </div>
                <button
                  type="button"
                  className="text-xs font-medium text-blue-600 hover:text-blue-800"
                  onClick={async () => {
                    const { url } = await getDocumentUrl({ data: { storagePath: d.storagePath } })
                    window.open(url, '_blank', 'noopener,noreferrer')
                  }}
                >
                  Abrir
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cronologia (fontes Postgres) */}
      <div>
        <h4 className="text-sm font-semibold text-navy-700 mb-3">
          Cronologia ({timeline.length} eventos)
        </h4>
        {timeline.length === 0 ? (
          <p className="text-sm text-navy-400">Sem eventos registados.</p>
        ) : (
          <div className="relative pl-4 space-y-2">
            {timeline.map((entry, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${KIND_DOT[entry.kind]}`} />
                <div>
                  <p className="text-sm text-navy-700">{entry.label}</p>
                  <p className="text-xs text-navy-400">{formatDate(entry.date)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pedidos do Website — só para clientes particulares (é a origem deste histórico) */}
      {subject.kind === 'individual' && <WebsiteLeads individualClientId={subject.client.id} />}

      {/* Oportunidades — CRM comercial (backoffice only) */}
      <SalesOpportunitiesSection
        companyId={subject.kind === 'company' ? subject.company.id : undefined}
        individualClientId={subject.kind === 'individual' ? subject.client.id : undefined}
        clientName={subject.kind === 'company' ? subject.company.name : subject.client.fullName}
      />

      {/* Tarefas */}
      <ClientTasks
        companyId={subject.kind === 'company' ? subject.company.id : undefined}
        individualClientId={subject.kind === 'individual' ? subject.client.id : undefined}
      />

      {/* Notas */}
      <ClientNotes
        companyId={subject.kind === 'company' ? subject.company.id : undefined}
        individualClientId={subject.kind === 'individual' ? subject.client.id : undefined}
      />
    </div>
  )
}
