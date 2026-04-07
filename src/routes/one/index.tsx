import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/one/')({
  component: OneLanding,
  ssr: false,
  head: () => ({ meta: [{ title: 'Adler One — Os seus seguros, num só lugar' }] }),
})

const navy = '#0A1628'
const gold  = '#C9A84C'
const f     = (w: number, s: string): React.CSSProperties =>
  ({ fontFamily: "'Montserrat', sans-serif", fontWeight: w, fontSize: s })

function OneLanding() {
  return (
    <div style={{ fontFamily: "'Montserrat', sans-serif", overflowX: 'hidden' }}>

      {/* ── Nav ── */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: navy, padding: '0 1.5rem', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 8px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ ...f(700, '1rem'), color: gold, letterSpacing: '0.06em' }}>ADLER</span>
          <span style={{ ...f(300, '1rem'), color: 'rgba(255,255,255,0.85)', letterSpacing: '0.14em', marginLeft: 4 }}>ONE</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link to="/one/login" style={{ ...f(500, '0.8rem'), color: 'rgba(255,255,255,0.7)', textDecoration: 'none', letterSpacing: '0.03em' }}>
            Entrar
          </Link>
          <Link to="/one/login" style={{ ...f(700, '0.78rem'), color: navy, background: gold, padding: '0.45rem 1.1rem', borderRadius: 4, textDecoration: 'none', letterSpacing: '0.04em' }}>
            Criar Conta
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{ background: `linear-gradient(160deg, ${navy} 0%, #112240 100%)`, padding: '5rem 1.5rem 6rem', textAlign: 'center' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <div style={{ display: 'inline-block', background: 'rgba(201,168,76,0.15)', border: `1px solid ${gold}`, borderRadius: 20, padding: '0.3rem 1rem', marginBottom: '1.5rem' }}>
            <span style={{ ...f(600, '0.72rem'), color: gold, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Gratuito para clientes Adler &amp; Rochefort
            </span>
          </div>
          <h1 style={{ ...f(800, 'clamp(2rem, 5vw, 3.2rem)'), color: '#fff', margin: '0 0 1.25rem', lineHeight: 1.15, letterSpacing: '-0.01em' }}>
            Todos os seus seguros,<br />
            <span style={{ color: gold }}>num só lugar.</span>
          </h1>
          <p style={{ ...f(400, 'clamp(1rem, 2.5vw, 1.15rem)'), color: 'rgba(255,255,255,0.65)', margin: '0 auto 2.5rem', maxWidth: 520, lineHeight: 1.7 }}>
            Consulte as suas apólices, receba alertas de renovação e aceda a documentos — a qualquer hora, em qualquer dispositivo.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link
              to="/one/login"
              style={{ ...f(700, '0.9rem'), background: gold, color: navy, padding: '0.85rem 2rem', borderRadius: 6, textDecoration: 'none', letterSpacing: '0.04em', boxShadow: `0 4px 24px rgba(201,168,76,0.35)` }}
            >
              Criar Conta Gratuita
            </Link>
            <Link
              to="/one/login"
              style={{ ...f(500, '0.88rem'), color: 'rgba(255,255,255,0.75)', padding: '0.85rem 1.5rem', borderRadius: 6, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.2)', letterSpacing: '0.02em' }}
            >
              Já tenho conta →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section style={{ background: '#fff', padding: '5rem 1.5rem' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <h2 style={{ ...f(700, 'clamp(1.4rem, 3vw, 1.9rem)'), color: navy, textAlign: 'center', margin: '0 0 3rem', letterSpacing: '-0.01em' }}>
            Tudo o que precisa, sempre disponível
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem' }}>
            {[
              {
                icon: '📋',
                title: 'Apólices centralizadas',
                desc: 'Veja todas as suas apólices activas num só sítio. Detalhes, coberturas e datas de renovação ao alcance de um clique.',
              },
              {
                icon: '⏰',
                title: 'Alertas de renovação',
                desc: 'Nunca mais perca uma renovação. Saiba com antecedência quando as suas apólices expiram e tome decisões a tempo.',
              },
              {
                icon: '🔒',
                title: 'Documentos seguros',
                desc: 'Aceda às suas apólices, certificados e declarações de seguro a qualquer hora, em qualquer dispositivo.',
              },
            ].map((f) => (
              <div
                key={f.title}
                style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: '2rem 1.5rem' }}
              >
                <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>{f.icon}</div>
                <h3 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '1rem', color: navy, margin: '0 0 0.6rem', letterSpacing: '0.01em' }}>{f.title}</h3>
                <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 400, fontSize: '0.85rem', color: '#64748B', margin: 0, lineHeight: 1.65 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Como funciona ── */}
      <section style={{ background: '#F4F6FA', padding: '5rem 1.5rem' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 'clamp(1.4rem, 3vw, 1.9rem)', color: navy, textAlign: 'center', margin: '0 0 3rem', letterSpacing: '-0.01em' }}>
            Como funciona
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {[
              { n: '1', title: 'Cria a tua conta', desc: 'Regista-te com o email associado ao teu perfil de cliente Adler & Rochefort. É gratuito e demora menos de 1 minuto.' },
              { n: '2', title: 'O teu mediador liga as tuas apólices', desc: 'A nossa equipa associa automaticamente as tuas apólices existentes ao teu perfil. Não precisas de fazer nada.' },
              { n: '3', title: 'Geres tudo numa só app', desc: 'Consulta apólices, acompanha sinistros, descarrega documentos e recebe alertas — tudo num único portal seguro.' },
            ].map((step) => (
              <div key={step.n} style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: '1.5rem' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: navy, color: gold, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Montserrat', sans-serif", fontWeight: 800, fontSize: '1rem', flexShrink: 0 }}>
                  {step.n}
                </div>
                <div>
                  <h3 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.95rem', color: navy, margin: '0 0 0.35rem' }}>{step.title}</h3>
                  <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 400, fontSize: '0.84rem', color: '#64748B', margin: 0, lineHeight: 1.65 }}>{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA final ── */}
      <section style={{ background: navy, padding: '5rem 1.5rem', textAlign: 'center' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 800, fontSize: 'clamp(1.6rem, 4vw, 2.2rem)', color: '#fff', margin: '0 0 1rem', lineHeight: 1.2 }}>
            Começa agora,<br /><span style={{ color: gold }}>é gratuito.</span>
          </h2>
          <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 400, fontSize: '0.95rem', color: 'rgba(255,255,255,0.6)', margin: '0 0 2rem', lineHeight: 1.7 }}>
            Disponível para todos os clientes Adler &amp; Rochefort. Sem mensalidade, sem cartão de crédito.
          </p>
          <Link
            to="/one/login"
            style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.95rem', background: gold, color: navy, padding: '1rem 2.5rem', borderRadius: 6, textDecoration: 'none', display: 'inline-block', letterSpacing: '0.04em', boxShadow: `0 4px 24px rgba(201,168,76,0.4)` }}
          >
            Criar Conta Gratuita →
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ background: '#060F1E', padding: '2rem 1.5rem', textAlign: 'center' }}>
        <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 400, fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', margin: 0, letterSpacing: '0.04em' }}>
          © {new Date().getFullYear()} Adler &amp; Rochefort · Mediadores de Seguros ·{' '}
          <a href="https://adlerrochefort.com" style={{ color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }} target="_blank" rel="noopener noreferrer">
            adlerrochefort.com
          </a>
        </p>
      </footer>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;600;700;800&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
      `}</style>
    </div>
  )
}
