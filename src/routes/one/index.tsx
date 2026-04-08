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
      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: navy, padding: '0 1.5rem', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 8px rgba(0,0,0,0.3)' }}>
        {/* Left: ADLER ONE wordmark */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, minWidth: 100 }}>
          <span style={{ ...f(700, '0.95rem'), color: gold, letterSpacing: '0.06em' }}>ADLER</span>
          <span style={{ ...f(300, '0.95rem'), color: 'rgba(255,255,255,0.85)', letterSpacing: '0.14em', marginLeft: 3 }}>ONE</span>
        </div>
        {/* Centre: logo */}
        <a href="https://adlerrochefort.com" target="_blank" rel="noopener noreferrer" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
          <img src="/logo.png" alt="Adler & Rochefort" style={{ height: 40, width: 'auto', display: 'block', filter: 'brightness(0) invert(1)' }} />
        </a>
        {/* Right: auth links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 100, justifyContent: 'flex-end' }}>
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

      {/* ── Disclaimer ── */}
      <div style={{ background: '#0D1B2F', padding: '1.5rem', textAlign: 'center' }}>
        <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 400, fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', margin: '0 auto', maxWidth: 760, lineHeight: 1.65 }}>
          Ao criar conta, o utilizador aceita que a Adler &amp; Rochefort, marca comercial da Ownizo Unipessoal LDA, no exercício da sua actividade regulada pela ASF, aceda e trate os dados das suas apólices, documentos, contactos e datas de renovação, podendo contactá-lo com propostas de renovação ou melhoria de coberturas.
        </p>
      </div>

      {/* ── Footer ── */}
      <footer style={{ background: '#060F1E', padding: '3rem 1.5rem 2rem', color: 'rgba(255,255,255,0.45)', fontFamily: "'Montserrat', sans-serif" }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>

          {/* Top row: brand + contact */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '2rem', marginBottom: '2rem' }}>
            <div>
              <p style={{ fontWeight: 700, fontSize: '0.82rem', color: 'rgba(255,255,255,0.8)', margin: '0 0 0.4rem', letterSpacing: '0.04em' }}>
                Adler &amp; Rochefort
              </p>
              <p style={{ fontSize: '0.72rem', margin: '0 0 0.5rem', lineHeight: 1.6 }}>
                marca comercial da Ownizo Unipessoal LDA
              </p>
              <p style={{ fontSize: '0.7rem', margin: 0, lineHeight: 1.6 }}>
                Registada na ASF com o n.º <span style={{ color: 'rgba(255,255,255,0.6)' }}>425591790/3</span>
              </p>
            </div>

            <div>
              <p style={{ fontWeight: 600, fontSize: '0.72rem', color: 'rgba(255,255,255,0.6)', margin: '0 0 0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Contacto</p>
              <p style={{ fontSize: '0.72rem', margin: '0 0 0.3rem', lineHeight: 1.6 }}>
                <a href="mailto:insurance@adlerrochefort.com" style={{ color: 'rgba(255,255,255,0.55)', textDecoration: 'none' }}>
                  insurance@adlerrochefort.com
                </a>
              </p>
              <p style={{ fontSize: '0.72rem', margin: '0 0 0.3rem' }}>
                <a href="tel:+351928226570" style={{ color: 'rgba(255,255,255,0.55)', textDecoration: 'none' }}>
                  +351 928 226 570
                </a>
              </p>
              <p style={{ fontSize: '0.72rem', margin: 0 }}>
                Av. do Atlântico 16, Esc. 5.07<br />
                1990-019 Lisboa, Portugal
              </p>
            </div>

            <div>
              <p style={{ fontWeight: 600, fontSize: '0.72rem', color: 'rgba(255,255,255,0.6)', margin: '0 0 0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Legal</p>
              {[
                { label: 'Política de Privacidade', href: 'https://adlerrochefort.com/politica-de-privacidade' },
                { label: 'Termos e Condições',      href: 'https://adlerrochefort.com/termos-e-condicoes' },
                { label: 'Livro de Reclamações',    href: 'https://www.livroreclamacoes.pt/Inicio/' },
                { label: 'Canal de Denúncias ASF',  href: 'https://www.asf.com.pt/canal-de-den%C3%BAncias' },
              ].map(l => (
                <p key={l.label} style={{ fontSize: '0.72rem', margin: '0 0 0.3rem' }}>
                  <a href={l.href} target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255,255,255,0.55)', textDecoration: 'none' }}>
                    {l.label}
                  </a>
                </p>
              ))}
            </div>
          </div>

          {/* Bottom bar */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ fontSize: '0.68rem', margin: 0 }}>
              © {new Date().getFullYear()} Adler &amp; Rochefort · Mediadores de Seguros · Autorizado pela ASF
            </p>
            <a href="https://adlerrochefort.com" target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}>
              adlerrochefort.com →
            </a>
          </div>
        </div>
      </footer>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;600;700;800&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
      `}</style>
    </div>
  )
}
