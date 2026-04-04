import { createFileRoute, Link } from '@tanstack/react-router'
import { useIdentity } from '@/lib/identity-context'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

function LandingPage() {
  const { user, ready } = useIdentity()

  return (
    <div className="min-h-screen bg-white text-primary">
      {/* Header / Nav */}
      <header className="flex items-center justify-between" style={{ padding: '1.25rem 2.5rem', borderBottom: '1.5px solid #111111' }}>
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="Adler & Rochefort" style={{ height: '52px', width: 'auto' }} />
          <div>
            <h1 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '1.1rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' as const, color: '#111111' }}>
              Adler<span style={{ color: '#C8961A' }}>.</span>Pro
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Link
            to="/contact"
            style={{
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 600,
              fontSize: '0.85rem',
              padding: '0.7rem 1.1rem',
              background: '#C8961A',
              color: '#ffffff',
              borderRadius: '2px',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            Entrar em Contacto
          </Link>
          {ready && user ? (
            <Link
              to="/dashboard"
              style={{
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 600,
                fontSize: '0.85rem',
                padding: '0.7rem 1.75rem',
                background: '#111111',
                color: '#ffffff',
                borderRadius: '2px',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              Aceder ao Portal
            </Link>
          ) : (
            <Link
              to="/login"
              style={{
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 600,
                fontSize: '0.85rem',
                padding: '0.7rem 1.75rem',
                background: 'transparent',
                color: '#111111',
                border: '1.5px solid #111111',
                borderRadius: '2px',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              Login
            </Link>
          )}
        </div>
      </header>

      {/* Hero */}
      <section style={{ padding: '5rem 2.5rem 4rem' }}>
        <div className="max-w-4xl">
          <p style={{
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 600,
            fontSize: '0.70rem',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.14em',
            color: '#C8961A',
            marginBottom: '1rem',
          }}>
            Portal do Cliente Empresarial
          </p>
          <h2 style={{
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 700,
            fontSize: '4rem',
            lineHeight: 1.0,
            letterSpacing: '-0.03em',
            color: '#111111',
            marginBottom: '1.5rem',
          }}>
            Simplifique a gestão de riscos empresariais.
          </h2>
          <p style={{
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 300,
            fontSize: '1rem',
            lineHeight: 1.8,
            color: '#555555',
            maxWidth: '40rem',
            marginBottom: '2.5rem',
          }}>
            Centralize o controlo do seu programa de seguros com um portal orientado para
            operações: portfólio de apólices, comparativo de cotações por IA, análise de
            risco de parceiros, consulta de matrículas e alertas críticos.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Link
              to={ready && user ? '/dashboard' : '/login'}
              style={{
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 600,
                fontSize: '0.85rem',
                padding: '0.7rem 1.75rem',
                background: '#C8961A',
                color: '#ffffff',
                borderRadius: '2px',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              Aceder ao Portal
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
            <Link
              to="/contact"
              style={{
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 600,
                fontSize: '0.85rem',
                padding: '0.7rem 1.75rem',
                background: 'transparent',
                color: '#111111',
                border: '1.5px solid #111111',
                borderRadius: '2px',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              Entrar em Contacto
            </Link>
          </div>
        </div>
      </section>

      {/* Metrics Strip */}
      <section style={{
        borderTop: '1.5px solid #111111',
        borderBottom: '1.5px solid #111111',
        background: '#ffffff',
      }}>
        <div className="grid grid-cols-2 lg:grid-cols-4">
          <MetricItem value="8" label="Módulos Operacionais" />
          <MetricItem value="3" label="Fluxos com IA Aplicada" />
          <MetricItem value="24/7" label="Acesso ao Portal" />
          <MetricItem value="1" label="Vista Integrada de Risco" isLast />
        </div>
      </section>

      {/* Features - Two Column */}
      <section style={{ padding: '0' }}>
        <div className="grid md:grid-cols-2" style={{ borderBottom: '1px solid #eeeeee' }}>
          {/* Left column */}
          <div style={{ padding: '4rem 3rem 4rem 2.5rem', borderRight: '1px solid #eeeeee' }}>
            <p style={{
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 600,
              fontSize: '0.70rem',
              textTransform: 'uppercase' as const,
              letterSpacing: '0.14em',
              color: '#C8961A',
              marginBottom: '1rem',
            }}>
              Funcionalidades
            </p>
            <h2 style={{
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 700,
              fontSize: '1.75rem',
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
              color: '#111111',
              marginBottom: '2rem',
            }}>
              Funcionalidades alinhadas com o portal do cliente
            </h2>
            <p style={{
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 300,
              fontSize: '1rem',
              lineHeight: 1.8,
              color: '#555555',
              marginBottom: '2rem',
            }}>
              Concebido para equipas que precisam de monitorizar apólices, riscos e alertas num único ambiente operacional.
            </p>
            <ul className="space-y-3">
              <FeatureListItem text="Painel com KPIs de apólices ativas, prémios anuais e renovações próximas" />
              <FeatureListItem text="Gestão de apólices com filtros, edição e extração automática de dados por IA" />
              <FeatureListItem text="Comparativo de até 3 cotações com relatório detalhado gerado por IA" />
              <FeatureListItem text="Análise de risco de parceiros por NIF, consulta de matrículas e alertas meteorológicos" />
            </ul>
          </div>

          {/* Right column - Cards */}
          <div style={{ padding: '4rem 2.5rem 4rem 3rem' }}>
            <div className="space-y-3">
              <FeatureCard
                icon="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                title="Portfólio de Apólices"
                status="Disponível"
                statusType="active"
              />
              <FeatureCard
                icon="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                title="Comparativo IA"
                status="Disponível"
                statusType="active"
              />
              <FeatureCard
                icon="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                title="Risco de Parceiros"
                status="Disponível"
                statusType="active"
              />
              <FeatureCard
                icon="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
                title="Alertas de Tempo"
                status="Disponível"
                statusType="active"
              />
            </div>
          </div>
        </div>
      </section>

      {/* CTA Block */}
      <section style={{
        background: '#111111',
        padding: '4rem 2.5rem',
        borderRadius: '4px',
        margin: '3rem 2.5rem',
      }}>
        <div className="text-center max-w-2xl mx-auto">
          <h2 style={{
            fontFamily: "'Montserrat', serif",
            fontWeight: 700,
            fontSize: '2rem',
            color: '#ffffff',
            marginBottom: '1rem',
          }}>
            Pronto para começar?
          </h2>
          <p style={{
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 300,
            fontSize: '1rem',
            lineHeight: 1.8,
            color: '#999999',
            marginBottom: '2rem',
          }}>
            Entre no portal para consultar dados operacionais, acompanhar riscos e tomar decisões com base em informação atualizada.
          </p>
          <Link
            to={ready && user ? '/dashboard' : '/login'}
            style={{
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 600,
              fontSize: '0.85rem',
              padding: '0.7rem 1.75rem',
              background: '#ffffff',
              color: '#111111',
              borderRadius: '2px',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            Aceder ao Portal
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        padding: '2.5rem',
        borderTop: '1px solid #eeeeee',
        textAlign: 'center',
      }}>
        <div className="flex items-center justify-center gap-6 mb-4">
          <Link to="/contact" style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.78rem', color: '#666666', textDecoration: 'none' }}>
            Contacto
          </Link>
          <Link to="/terms-and-conditions" style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.78rem', color: '#666666', textDecoration: 'none' }}>
            Termos e Condições
          </Link>
          <Link to="/privacy-policy" style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: '0.78rem', color: '#666666', textDecoration: 'none' }}>
            Política de Privacidade
          </Link>
        </div>
        <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 400, fontSize: '0.78rem', color: '#bbbbbb' }}>
          Adler & Rochefort é uma marca comercial da Ownizo Unipessoal LDA.
        </p>
        <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 400, fontSize: '0.78rem', color: '#bbbbbb', marginTop: '0.5rem' }}>
          Ownizo Unipessoal Lda está registada na Autoridade de Supervisão de Seguros e Fundos de Pensões (ASF) com o n.º 425591790/3.
        </p>
      </footer>
    </div>
  )
}

function MetricItem({ value, label, isLast }: { value: string; label: string; isLast?: boolean }) {
  return (
    <div style={{
      padding: '1.75rem 0 1.75rem 1.5rem',
      borderRight: isLast ? 'none' : '1px solid #eeeeee',
    }}>
      <p style={{
        fontFamily: "'Montserrat', sans-serif",
        fontWeight: 700,
        fontSize: '2rem',
        color: '#111111',
      }}>
        {value}
      </p>
      <p style={{
        fontFamily: "'Montserrat', sans-serif",
        fontWeight: 300,
        fontSize: '0.78rem',
        color: '#888888',
      }}>
        {label}
      </p>
    </div>
  )
}

function FeatureListItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span style={{
        width: '5px',
        height: '5px',
        borderRadius: '50%',
        background: '#C8961A',
        marginTop: '0.55rem',
        flexShrink: 0,
      }} />
      <span style={{
        fontFamily: "'Montserrat', sans-serif",
        fontWeight: 400,
        fontSize: '0.875rem',
        color: '#444444',
      }}>
        {text}
      </span>
    </li>
  )
}

function FeatureCard({
  icon,
  title,
  status,
  statusType,
}: {
  icon: string
  title: string
  status: string
  statusType: 'active' | 'review'
}) {
  const badgeStyles = statusType === 'active'
    ? { background: '#EAF3DE', color: '#3B6D11' }
    : { background: '#FAEEDA', color: '#854F0B' }

  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid #eeeeee',
      borderRadius: '4px',
      padding: '1rem 1.25rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '1rem',
    }}>
      <div className="flex items-center gap-3">
        <svg className="w-5 h-5" style={{ color: '#111111' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
        <span style={{
          fontFamily: "'Montserrat', sans-serif",
          fontWeight: 600,
          fontSize: '0.85rem',
          color: '#111111',
        }}>
          {title}
        </span>
      </div>
      <span style={{
        fontSize: '0.70rem',
        fontWeight: 600,
        padding: '0.2rem 0.6rem',
        borderRadius: '2px',
        ...badgeStyles,
      }}>
        {status}
      </span>
    </div>
  )
}
