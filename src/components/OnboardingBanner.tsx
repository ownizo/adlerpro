import { Link } from '@tanstack/react-router'

interface OnboardingBannerProps {
  hasPolicies: boolean
  hasProfile: boolean
  onDismiss: () => void
}

export function OnboardingBanner({ hasPolicies, hasProfile, onDismiss }: OnboardingBannerProps) {
  const steps = [
    {
      id: 1,
      label: 'Bem-vindo',
      description: 'Acesso ao portal activado',
      done: true,
      link: null,
    },
    {
      id: 2,
      label: 'Complete o perfil',
      description: 'Adicione os seus dados de contacto',
      done: hasProfile,
      link: '/profile',
    },
    {
      id: 3,
      label: 'Adicione uma apólice',
      description: 'Carregue a sua primeira apólice via IA',
      done: hasPolicies,
      link: '/policies',
    },
    {
      id: 4,
      label: 'Compare cotações',
      description: 'Analise e compare propostas de seguro',
      done: false,
      link: '/quotes-comparison',
    },
  ]

  const completedCount = steps.filter((s) => s.done).length
  const progressPct = Math.round((completedCount / steps.length) * 100)

  // Se tudo estiver completo, não mostrar
  if (completedCount === steps.length) return null

  return (
    <div
      style={{
        background: '#111111',
        borderRadius: '4px',
        padding: '1.25rem 1.5rem',
        marginBottom: '1.5rem',
        position: 'relative',
      }}
    >
      <button
        onClick={onDismiss}
        style={{
          position: 'absolute',
          top: '0.75rem',
          right: '0.75rem',
          background: 'none',
          border: 'none',
          color: '#666666',
          cursor: 'pointer',
          fontSize: '1.1rem',
          lineHeight: 1,
          padding: '0.25rem',
        }}
        title="Fechar"
      >
        ×
      </button>

      <div style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
          <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.9rem', color: '#ffffff', margin: 0 }}>
            Configure o seu portal — {completedCount}/{steps.length} passos concluídos
          </p>
          <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#C8961A', fontWeight: 600 }}>
            {progressPct}%
          </span>
        </div>
        {/* Progress bar */}
        <div style={{ height: '4px', background: '#333333', borderRadius: '2px', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${progressPct}%`,
              background: '#C8961A',
              borderRadius: '2px',
              transition: 'width 0.4s ease',
            }}
          />
        </div>
      </div>

      {/* Steps */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {steps.map((step) => (
          <div
            key={step.id}
            style={{
              flex: '1 1 140px',
              background: step.done ? '#1a1a1a' : '#1a1a1a',
              border: step.done ? '1px solid #2a2a2a' : '1px solid #333333',
              borderRadius: '4px',
              padding: '0.65rem 0.85rem',
              opacity: step.done ? 0.6 : 1,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
              <div
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: step.done ? '#C8961A' : '#333333',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {step.done ? (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2.5 2.5L8 3" stroke="#111111" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.6rem', color: '#888888', fontWeight: 700 }}>
                    {step.id}
                  </span>
                )}
              </div>
              <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', fontWeight: 600, color: step.done ? '#888888' : '#ffffff' }}>
                {step.label}
              </span>
            </div>
            <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.65rem', color: '#666666', margin: 0, lineHeight: 1.4 }}>
              {step.description}
            </p>
            {!step.done && step.link && (
              <Link
                to={step.link as any}
                style={{
                  display: 'inline-block',
                  marginTop: '0.4rem',
                  fontFamily: "'Montserrat', sans-serif",
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  color: '#C8961A',
                  textDecoration: 'none',
                  letterSpacing: '0.04em',
                }}
              >
                Ir agora →
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
