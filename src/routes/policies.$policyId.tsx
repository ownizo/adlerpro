import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import {
  fetchPolicy,
  fetchDocuments,
  fetchClaims,
  fetchCompanyUsers,
  fetchAlerts,
} from '@/lib/server-fns'
import { formatCurrency, formatDate } from '@/lib/utils'
import { CLAIM_STATUS_LABELS, POLICY_TYPE_LABELS, type Alert, type Claim, type Document } from '@/lib/types'
import { getServerUser } from '@/lib/auth'

export const Route = createFileRoute('/policies/$policyId')({
  beforeLoad: async () => {
    const user = await getServerUser()
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  loader: async ({ params }) => {
    const [policy, documents, claims, companyUsers, alerts] = await Promise.all([
      fetchPolicy({ data: params.policyId }),
      fetchDocuments(),
      fetchClaims(),
      fetchCompanyUsers(),
      fetchAlerts(),
    ])

    if (!policy) {
      throw redirect({ to: '/policies' })
    }

    return {
      policy,
      documents,
      claims,
      companyUsers,
      alerts,
    }
  },
  component: PolicyDetailPage,
})

const policyStatusLabel: Record<string, string> = {
  active: 'Ativa',
  expiring: 'A expirar',
  expired: 'Expirada',
  cancelled: 'Cancelada',
}

const policyStatusStyle: Record<string, { bg: string; color: string }> = {
  active: { bg: '#EAF3DE', color: '#3B6D11' },
  expiring: { bg: '#FAEEDA', color: '#854F0B' },
  expired: { bg: '#FEE2E2', color: '#991B1B' },
  cancelled: { bg: '#F3F4F6', color: '#6B7280' },
}

const paymentFrequencyLabel: Record<string, string> = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
}

function daysUntil(dateStr: string): number {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function renewalStatus(days: number): string {
  if (days < 0) return 'Renovação ultrapassada'
  if (days <= 30) return 'Renovação urgente'
  if (days <= 90) return 'Renovação próxima'
  return 'Sem urgência de renovação'
}

function isPolicyRelatedAlert(alert: Alert, policyNumber: string, insurer: string): boolean {
  const haystack = `${alert.title} ${alert.message}`.toLowerCase()
  return haystack.includes(policyNumber.toLowerCase()) || haystack.includes(insurer.toLowerCase()) || alert.type === 'renewal'
}

function PolicyDetailPage() {
  const { policy, documents, claims, companyUsers, alerts } = Route.useLoaderData()
  const daysToEnd = daysUntil(policy.endDate)
  const statusStyle = policyStatusStyle[policy.status] || policyStatusStyle.cancelled

  const policyDocuments = documents.filter(
    (doc) => doc.policyId === policy.id || (!!policy.documentKey && doc.blobKey === policy.documentKey)
  )

  const mainDocument: Document | null = policy.documentKey
    ? policyDocuments.find((doc) => doc.blobKey === policy.documentKey) || null
    : null

  const relatedClaims = claims
    .filter((claim) => claim.policyId === policy.id)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))

  const relatedAlerts = alerts
    .filter((alert) => isPolicyRelatedAlert(alert, policy.policyNumber, policy.insurer))
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 5)

  const importantDocumentMissing = !mainDocument && policyDocuments.length === 0

  const quickRecommendations: string[] = []
  if (daysToEnd >= 0 && daysToEnd <= 60) {
    quickRecommendations.push('Iniciar revisão da renovação e validar o capital seguro antes do vencimento.')
  }
  if (importantDocumentMissing) {
    quickRecommendations.push('Solicitar cópia da apólice e condições para centralizar a documentação no Pro.')
  }
  if (relatedClaims.some((claim) => !['approved', 'denied', 'paid'].includes(claim.status))) {
    quickRecommendations.push('Acompanhar os sinistros em aberto e atualizar documentação pendente com prioridade.')
  }
  if (quickRecommendations.length === 0) {
    quickRecommendations.push('Situação estável. Recomendação: manter documentação atualizada e rever cobertura trimestralmente.')
  }

  const history = [
    {
      date: policy.createdAt,
      title: 'Apólice registada no Pro',
      detail: `${POLICY_TYPE_LABELS[policy.type] || policy.type} — ${policy.policyNumber}`,
    },
    ...policyDocuments.slice(0, 4).map((doc) => ({
      date: doc.uploadedAt,
      title: 'Documento carregado',
      detail: doc.name,
    })),
    ...relatedClaims.slice(0, 4).map((claim: Claim) => ({
      date: claim.claimDate,
      title: 'Atualização de sinistro',
      detail: `${claim.title} · ${CLAIM_STATUS_LABELS[claim.status] || claim.status}`,
    })),
    ...relatedAlerts.slice(0, 3).map((alert) => ({
      date: alert.createdAt,
      title: 'Alerta associado',
      detail: alert.title,
    })),
  ]
    .sort((a, b) => +new Date(b.date) - +new Date(a.date))
    .slice(0, 8)

  const hasSharedAccess = companyUsers.length > 1

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <Link
              to="/policies"
              style={{
                fontFamily: "'Montserrat', sans-serif",
                fontSize: '0.78rem',
                color: '#777777',
                textDecoration: 'none',
                display: 'inline-flex',
                marginBottom: '0.6rem',
              }}
            >
              ← Voltar a apólices
            </Link>
            <h1 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '1.4rem', fontWeight: 700, color: '#111111', margin: 0 }}>
              Detalhe da Apólice
            </h1>
            <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.84rem', color: '#777777', margin: '0.2rem 0 0' }}>
              Vista executiva para consulta rápida de cobertura, documentos e ações.
            </p>
          </div>
        </div>

        <section style={{ background: '#ffffff', border: '1px solid #ececec', borderRadius: '6px', overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.2rem', borderBottom: '1px solid #efefef', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', margin: 0, color: '#999999', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Cabeçalho executivo
              </p>
              <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '1rem', fontWeight: 700, margin: '0.2rem 0 0', color: '#111111' }}>
                {POLICY_TYPE_LABELS[policy.type] || policy.type} · {policy.insurer}
              </p>
            </div>
            <span
              style={{
                fontFamily: "'Montserrat', sans-serif",
                fontSize: '0.72rem',
                fontWeight: 700,
                borderRadius: '999px',
                padding: '0.2rem 0.65rem',
                background: statusStyle.bg,
                color: statusStyle.color,
              }}
            >
              {policyStatusLabel[policy.status] || policy.status}
            </span>
          </div>

          <div style={{ padding: '1rem 1.2rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
              <ExecutiveField label="N.º Apólice" value={policy.policyNumber || '—'} />
              <ExecutiveField label="Início" value={formatDate(policy.startDate)} />
              <ExecutiveField label="Fim" value={formatDate(policy.endDate)} />
              <ExecutiveField label="Renovação" value={policy.renewalDate ? formatDate(policy.renewalDate) : formatDate(policy.endDate)} />
              <ExecutiveField label="Prémio" value={formatCurrency(policy.annualPremium)} />
              <ExecutiveField label="Fracionamento" value={paymentFrequencyLabel[policy.paymentFrequency || ''] || 'Anual'} />
              <ExecutiveField label="Status renovação" value={renewalStatus(daysToEnd)} />
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <a href="#documentos" style={ctaStyle('#111111', '#ffffff', '#111111')}>Ver documentos</a>
              <a href="mailto:insurance@adlerrochefort.com" style={ctaStyle('#ffffff', '#333333', '#dddddd')}>Contactar apoio/corretor</a>
              <Link to="/claims" style={ctaStyle('#fff7ed', '#9a3412', '#fed7aa')}>Reportar sinistro</Link>
              {hasSharedAccess ? (
                <a href="#utilizadores" style={ctaStyle('#f8fafc', '#334155', '#e2e8f0')}>Ver acessos partilhados</a>
              ) : null}
            </div>
          </div>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }} className="policy-detail-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <SectionCard title="Resumo da cobertura" subtitle="Cobertura principal, garantias e pontos de atenção em linguagem direta.">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '0.9rem' }}>
                <ExecutiveField label="Capital seguro" value={policy.insuredValue > 0 ? formatCurrency(policy.insuredValue) : 'Não indicado'} />
                <ExecutiveField label="Franquia" value={policy.deductible ? formatCurrency(policy.deductible) : 'Não indicada'} />
                <ExecutiveField label="Estado da vigência" value={daysToEnd >= 0 ? `${daysToEnd} dias para fim` : 'Fora de vigência'} />
              </div>

              <SimpleList
                title="Principais garantias"
                items={policy.coverages && policy.coverages.length > 0 ? policy.coverages : ['Não existem garantias detalhadas na ficha desta apólice.']}
                color="#166534"
                marker="✓"
              />
              <SimpleList
                title="Limitações e pontos importantes"
                items={policy.exclusions && policy.exclusions.length > 0 ? policy.exclusions : ['Sem exclusões detalhadas na informação atualmente disponível.']}
                color="#991b1b"
                marker="!"
              />
            </SectionCard>

            <SectionCard title="Documentos" subtitle="Consulta e download da documentação associada à apólice.">
              <div id="documentos" />
              {importantDocumentMissing && (
                <div style={{ marginBottom: '0.8rem', background: '#fff7ed', color: '#9a3412', border: '1px solid #fed7aa', borderRadius: '4px', padding: '0.6rem 0.75rem', fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem' }}>
                  Documento principal da apólice em falta. Recomendado solicitar cópia ao apoio/corretor.
                </div>
              )}

              {mainDocument && (
                <DocumentRow
                  name={mainDocument.name}
                  meta={`Documento principal · ${formatDate(mainDocument.uploadedAt)}`}
                  href={`/api/download-document?key=${encodeURIComponent(mainDocument.blobKey)}`}
                  recent
                />
              )}

              {policyDocuments.filter((doc) => !mainDocument || doc.id !== mainDocument.id).length === 0 ? (
                <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem', color: '#888888', margin: 0 }}>
                  Sem documentos adicionais associados a esta apólice.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {policyDocuments
                    .filter((doc) => !mainDocument || doc.id !== mainDocument.id)
                    .slice(0, 8)
                    .map((doc, index) => (
                      <DocumentRow
                        key={doc.id}
                        name={doc.name}
                        meta={`${formatDate(doc.uploadedAt)} · ${(doc.size / 1024).toFixed(1)} KB`}
                        href={`/api/download-document?key=${encodeURIComponent(doc.blobKey)}`}
                        recent={index === 0}
                      />
                    ))}
                </div>
              )}
            </SectionCard>

            <SectionCard title="Histórico resumido" subtitle="Eventos visíveis ao cliente relacionados com esta apólice.">
              {history.length === 0 ? (
                <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem', color: '#888888', margin: 0 }}>
                  Sem histórico disponível.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  {history.map((item, index) => (
                    <div key={`${item.title}-${index}`} style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-start' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '999px', background: '#C8961A', marginTop: '0.28rem', flexShrink: 0 }} />
                      <div>
                        <p style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem', fontWeight: 600, color: '#222222' }}>{item.title}</p>
                        <p style={{ margin: '0.15rem 0 0', fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#777777' }}>
                          {item.detail} · {formatDate(item.date)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <SectionCard title="Utilizadores com acesso" subtitle="Visibilidade de partilha desta apólice no ambiente cliente.">
              <div id="utilizadores" />
              <p style={{ margin: '0 0 0.7rem', fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem', color: '#666666' }}>
                {hasSharedAccess
                  ? `Apólice partilhada com ${companyUsers.length} utilizadores.`
                  : 'Acesso individual (sem partilha ativa).'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {companyUsers.slice(0, 8).map((user) => (
                  <div key={user.id} style={{ border: '1px solid #eeeeee', borderRadius: '4px', padding: '0.55rem 0.6rem' }}>
                    <p style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem', fontWeight: 600, color: '#222222' }}>{user.name}</p>
                    <p style={{ margin: '0.12rem 0 0', fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', color: '#777777' }}>
                      {user.email} · {user.role}
                    </p>
                  </div>
                ))}
              </div>
              <p style={{ margin: '0.7rem 0 0', fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', color: '#999999' }}>
                Gestão de permissões indisponível nesta vista cliente (modo leitura).
              </p>
            </SectionCard>

            <SectionCard title="Alertas e próximos passos" subtitle="Ações recomendadas para decisão rápida.">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginBottom: '0.8rem' }}>
                {quickRecommendations.map((item, index) => (
                  <div key={index} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                    <span style={{ color: '#C8961A', fontWeight: 700, fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem' }}>•</span>
                    <p style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem', color: '#444444' }}>{item}</p>
                  </div>
                ))}
              </div>

              {relatedClaims.length > 0 && (
                <div style={{ marginBottom: '0.8rem' }}>
                  <p style={{ margin: '0 0 0.4rem', fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', fontWeight: 700, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Sinistros associados
                  </p>
                  {relatedClaims.slice(0, 3).map((claim) => (
                    <p key={claim.id} style={{ margin: '0.2rem 0', fontFamily: "'Montserrat', sans-serif", fontSize: '0.76rem', color: '#666666' }}>
                      {claim.title} · {CLAIM_STATUS_LABELS[claim.status] || claim.status}
                    </p>
                  ))}
                </div>
              )}

              {relatedAlerts.length > 0 ? (
                <div>
                  <p style={{ margin: '0 0 0.4rem', fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', fontWeight: 700, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Alertas relacionados
                  </p>
                  {relatedAlerts.map((alert) => (
                    <p key={alert.id} style={{ margin: '0.2rem 0', fontFamily: "'Montserrat', sans-serif", fontSize: '0.76rem', color: '#666666' }}>
                      {alert.title} · {formatDate(alert.createdAt)}
                    </p>
                  ))}
                </div>
              ) : (
                <p style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem', color: '#888888' }}>
                  Sem alertas críticos associados neste momento.
                </p>
              )}
            </SectionCard>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 1024px) {
          .policy-detail-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </AppLayout>
  )
}

function ExecutiveField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid #efefef', borderRadius: '4px', padding: '0.55rem 0.6rem', background: '#fcfcfc' }}>
      <p style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontSize: '0.66rem', color: '#999999', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </p>
      <p style={{ margin: '0.18rem 0 0', fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem', color: '#222222', fontWeight: 600 }}>
        {value}
      </p>
    </div>
  )
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <section style={{ background: '#ffffff', border: '1px solid #ececec', borderRadius: '6px', padding: '1rem 1.05rem' }}>
      <h2 style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontSize: '0.95rem', fontWeight: 700, color: '#111111' }}>{title}</h2>
      <p style={{ margin: '0.2rem 0 0.9rem', fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#888888' }}>{subtitle}</p>
      {children}
    </section>
  )
}

function SimpleList({ title, items, color, marker }: { title: string; items: string[]; color: string; marker: string }) {
  return (
    <div style={{ marginBottom: '0.8rem' }}>
      <p style={{ margin: '0 0 0.4rem', fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {title}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.32rem' }}>
        {items.map((item, index) => (
          <div key={index} style={{ display: 'flex', gap: '0.45rem', alignItems: 'flex-start' }}>
            <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', color, fontWeight: 700 }}>{marker}</span>
            <p style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem', color: '#444444' }}>{item}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function DocumentRow({ name, meta, href, recent = false }: { name: string; meta: string; href: string; recent?: boolean }) {
  return (
    <div style={{ border: '1px solid #eeeeee', borderRadius: '4px', padding: '0.6rem 0.7rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem' }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem', fontWeight: 600, color: '#222222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
          {recent ? <span style={{ marginLeft: '0.4rem', fontSize: '0.66rem', color: '#C8961A' }}>Mais recente</span> : null}
        </p>
        <p style={{ margin: '0.15rem 0 0', fontFamily: "'Montserrat', sans-serif", fontSize: '0.72rem', color: '#777777' }}>{meta}</p>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.74rem', fontWeight: 700, textDecoration: 'none', color: '#111111', border: '1px solid #dddddd', borderRadius: '4px', padding: '0.3rem 0.6rem', whiteSpace: 'nowrap' }}
      >
        Download
      </a>
    </div>
  )
}

function ctaStyle(background: string, color: string, borderColor: string): React.CSSProperties {
  return {
    fontFamily: "'Montserrat', sans-serif",
    fontSize: '0.75rem',
    fontWeight: 700,
    background,
    color,
    border: `1px solid ${borderColor}`,
    borderRadius: '4px',
    padding: '0.45rem 0.75rem',
    textDecoration: 'none',
  }
}
