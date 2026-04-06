import { createFileRoute, Link } from '@tanstack/react-router'
import { useIdentity } from '@/lib/identity-context'
import { useState, useEffect, useRef } from 'react'
import i18n from '@/lib/i18n'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

/* ───────── helpers ───────── */
const font = (w: number, s: string) =>
  ({ fontFamily: "'Montserrat', sans-serif", fontWeight: w, fontSize: s } as const)

const gold = '#C8961A'
const dark = '#111111'

function AnimatedCounter({ end, suffix = '' }: { end: number; suffix?: string }) {
  const [count, setCount] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          let start = 0
          const step = Math.max(1, Math.floor(end / 40))
          const timer = setInterval(() => {
            start += step
            if (start >= end) { setCount(end); clearInterval(timer) }
            else setCount(start)
          }, 30)
          observer.disconnect()
        }
      },
      { threshold: 0.3 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [end])
  return <span ref={ref}>{count}{suffix}</span>
}

/* ───────── main ───────── */
function LandingPage() {
  const { user, ready } = useIdentity()
  const portalLink = ready && user ? '/dashboard' : '/login'
  const [lang, setLang] = useState(i18n.language)
  const handleLang = (l: string) => { i18n.changeLanguage(l); setLang(l) }

  return (
    <div className="min-h-screen bg-white text-primary" style={{ overflowX: 'hidden' as const }}>

      {/* ══════════ HEADER ══════════ */}
      <header style={{
        padding: '1rem 2.5rem',
        borderBottom: `1.5px solid ${dark}`,
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        position: 'sticky' as const,
        top: 0,
        background: '#fff',
        zIndex: 50,
      }}>
        <div>
          <h1 style={{ ...font(700, '1.1rem'), letterSpacing: '0.04em', textTransform: 'uppercase' as const, color: dark, margin: 0 }}>
            Adler<span style={{ color: gold }}>.</span>Pro
          </h1>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <img src="/logo.png" alt="Adler & Rochefort" style={{ height: '56px', width: 'auto' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #dddddd', borderRadius: '4px', overflow: 'hidden', fontFamily: "'Montserrat', sans-serif" }}>
            {(['pt', 'en'] as const).map((l) => (
              <button
                key={l}
                onClick={() => handleLang(l)}
                style={{
                  background: lang === l ? '#111111' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0.25rem 0.6rem',
                  fontFamily: "'Montserrat', sans-serif",
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: lang === l ? '#ffffff' : '#888888',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <a href="#funcionalidades" style={{ ...font(600, '0.78rem'), color: '#555', textDecoration: 'none', padding: '0.5rem 0.75rem' }}>
            Funcionalidades
          </a>
          <a href="#vantagens" style={{ ...font(600, '0.78rem'), color: '#555', textDecoration: 'none', padding: '0.5rem 0.75rem' }}>
            Vantagens
          </a>
          <Link to="/contact" style={{ ...font(600, '0.82rem'), padding: '0.6rem 1rem', background: gold, color: '#fff', borderRadius: '2px', textDecoration: 'none' }}>
            Contacto
          </Link>
          <Link to={portalLink} style={{ ...font(600, '0.82rem'), padding: '0.6rem 1rem', background: dark, color: '#fff', borderRadius: '2px', textDecoration: 'none' }}>
            {ready && user ? 'Aceder ao Portal' : 'Login'}
          </Link>
        </div>
      </header>

      {/* ══════════ HERO ══════════ */}
      <section style={{ background: dark, padding: '6rem 2.5rem 5rem', position: 'relative' as const, overflow: 'hidden' as const }}>
        {/* Decorative circles */}
        <div style={{ position: 'absolute' as const, top: '-200px', right: '-200px', width: '600px', height: '600px', borderRadius: '50%', border: '1px solid #222', opacity: 0.4 }} />
        <div style={{ position: 'absolute' as const, bottom: '-150px', left: '-150px', width: '400px', height: '400px', borderRadius: '50%', border: '1px solid #1a1a1a', opacity: 0.3 }} />

        <div className="max-w-5xl mx-auto" style={{ position: 'relative' as const, zIndex: 1 }}>
          <div style={{ display: 'inline-block', background: gold, padding: '0.35rem 1rem', marginBottom: '1.5rem' }}>
            <span style={{ ...font(700, '0.7rem'), textTransform: 'uppercase' as const, letterSpacing: '0.12em', color: dark }}>
              Insurtech &mdash; Lançamento Nacional 2025
            </span>
          </div>

          <h2 style={{ ...font(700, 'clamp(2.5rem, 5vw, 4.5rem)'), lineHeight: 1.05, letterSpacing: '-0.03em', color: '#fff', marginBottom: '1.5rem', maxWidth: '48rem' }}>
            A gestão de seguros<br />
            empresariais nunca mais<br />
            será a <span style={{ color: gold }}>mesma.</span>
          </h2>

          <p style={{ ...font(300, '1.1rem'), lineHeight: 1.8, color: '#999', maxWidth: '36rem', marginBottom: '2.5rem' }}>
            O <strong style={{ color: '#fff', fontWeight: 600 }}>Adler Pro</strong> é o primeiro portal português de gestão de seguros empresariais
            com <strong style={{ color: gold, fontWeight: 600 }}>Inteligência Artificial</strong> integrada.
            Centraliza apólices, automatiza comparativos, gere sinistros e antecipa renovações &mdash; tudo numa única plataforma.
          </p>

          <div className="flex flex-col sm:flex-row gap-4">
            <Link to={portalLink} style={{ ...font(600, '0.9rem'), padding: '0.85rem 2rem', background: gold, color: '#fff', borderRadius: '2px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              Pedir Demonstração
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
            <a href="#funcionalidades" style={{ ...font(600, '0.9rem'), padding: '0.85rem 2rem', background: 'transparent', color: '#fff', border: '1.5px solid #333', borderRadius: '2px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
              Explorar Funcionalidades
            </a>
          </div>
        </div>
      </section>

      {/* ══════════ TRUST BAR ══════════ */}
      <section style={{ borderBottom: `1.5px solid ${dark}`, background: '#fafafa' }}>
        <div className="grid grid-cols-2 lg:grid-cols-4 max-w-6xl mx-auto">
          <TrustMetric value={<AnimatedCounter end={6} />} label="Módulos com IA Integrada" />
          <TrustMetric value={<AnimatedCounter end={100} suffix="%" />} label="Digital — Zero Papel" />
          <TrustMetric value="24/7" label="Acesso ao Portal" />
          <TrustMetric value={<AnimatedCounter end={90} suffix=" dias" />} label="Antecipação de Renovações" isLast />
        </div>
      </section>

      {/* ══════════ PROBLEMA / SOLUÇÃO ══════════ */}
      <section style={{ padding: '5rem 2.5rem' }}>
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-16">
            {/* Problema */}
            <div>
              <span style={{ ...font(700, '0.7rem'), textTransform: 'uppercase' as const, letterSpacing: '0.12em', color: '#CC2200' }}>
                O Problema
              </span>
              <h3 style={{ ...font(700, '1.75rem'), color: dark, marginTop: '0.75rem', marginBottom: '1.5rem', lineHeight: 1.2 }}>
                A gestão de seguros empresariais está presa ao passado.
              </h3>
              <div className="space-y-4">
                <ProblemItem text="Apólices dispersas por dezenas de emails e pastas" />
                <ProblemItem text="Renovações que passam despercebidas até ser tarde" />
                <ProblemItem text="Comparação de cotações feita manualmente em Excel" />
                <ProblemItem text="Sinistros sem acompanhamento estruturado" />
                <ProblemItem text="Nenhuma visibilidade sobre o risco de parceiros" />
                <ProblemItem text="Zero integração entre mediador e empresa" />
              </div>
            </div>
            {/* Solução */}
            <div>
              <span style={{ ...font(700, '0.7rem'), textTransform: 'uppercase' as const, letterSpacing: '0.12em', color: gold }}>
                A Solução
              </span>
              <h3 style={{ ...font(700, '1.75rem'), color: dark, marginTop: '0.75rem', marginBottom: '1.5rem', lineHeight: 1.2 }}>
                O Adler Pro transforma a forma como a sua empresa gere seguros.
              </h3>
              <div className="space-y-4">
                <SolutionItem text="Todas as apólices centralizadas num portal seguro e acessível" />
                <SolutionItem text="Alertas automáticos de renovação a 90, 60 e 30 dias" />
                <SolutionItem text="IA que lê, interpreta e compara cotações em segundos" />
                <SolutionItem text="Registo e acompanhamento de sinistros com timeline" />
                <SolutionItem text="Análise de risco de parceiros com dados do Registo Comercial" />
                <SolutionItem text="Portal dedicado que liga a empresa ao mediador" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ FUNCIONALIDADES ══════════ */}
      <section id="funcionalidades" style={{ background: '#fafafa', padding: '5rem 2.5rem', borderTop: '1px solid #eee', borderBottom: '1px solid #eee' }}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center" style={{ marginBottom: '3.5rem' }}>
            <span style={{ ...font(700, '0.7rem'), textTransform: 'uppercase' as const, letterSpacing: '0.12em', color: gold }}>
              Funcionalidades
            </span>
            <h2 style={{ ...font(700, '2.25rem'), color: dark, marginTop: '0.75rem', letterSpacing: '-0.02em' }}>
              Tudo o que a sua empresa precisa. Numa só plataforma.
            </h2>
            <p style={{ ...font(300, '1rem'), color: '#666', marginTop: '1rem', maxWidth: '36rem', marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.8 }}>
              Do portfólio de apólices à gestão de sinistros, cada módulo foi desenhado para resolver um problema real do dia-a-dia empresarial.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard
              icon="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              title="Portfólio de Apólices"
              desc="Centralize todas as apólices da sua empresa. Visualize coberturas, prémios, datas de renovação e documentos associados num único local."
              badge="IA"
            />
            <FeatureCard
              icon="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              title="Extracção Automática"
              desc="Carregue o PDF da apólice e a Inteligência Artificial extrai automaticamente todos os dados: seguradora, coberturas, prémios, datas e condições."
              badge="IA"
            />
            <FeatureCard
              icon="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              title="Comparativo Inteligente"
              desc="Compare até 3 cotações em simultâneo. A IA analisa coberturas, exclusões, franquias e preço, gerando um relatório detalhado com recomendação."
              badge="IA"
            />
            <FeatureCard
              icon="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              title="Gestão de Sinistros"
              desc="Registe e acompanhe sinistros de acidentes de trabalho, patrimoniais, frota, RC e mais. Timeline de progresso, filtros por tipo e exportação CSV."
            />
            <FeatureCard
              icon="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              title="Risco de Parceiros"
              desc="Analise o risco financeiro de parceiros e fornecedores com dados da Autoridade Tributária e do Registo Comercial. Capital social, sócios, alertas."
              badge="IA"
            />
            <FeatureCard
              icon="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
              title="Alertas Proactivos"
              desc="Receba alertas automáticos de renovação a 90, 60 e 30 dias por email. Alertas meteorológicos geolocalizados com ligação ao IPMA."
            />
          </div>
        </div>
      </section>

      {/* ══════════ IA SPOTLIGHT ══════════ */}
      <section style={{ background: dark, padding: '5rem 2.5rem' }}>
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <span style={{ ...font(700, '0.7rem'), textTransform: 'uppercase' as const, letterSpacing: '0.12em', color: gold }}>
                Inteligência Artificial
              </span>
              <h2 style={{ ...font(700, '2.25rem'), color: '#fff', marginTop: '0.75rem', marginBottom: '1.5rem', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                A IA que trabalha para a sua empresa.
              </h2>
              <p style={{ ...font(300, '1rem'), color: '#999', lineHeight: 1.8, marginBottom: '2rem' }}>
                O Adler Pro integra modelos avançados de Inteligência Artificial que automatizam tarefas que antes consumiam horas de trabalho administrativo.
                Não é um chatbot. É um motor de análise documental treinado para o contexto segurador.
              </p>
              <div className="space-y-4">
                <IAFeature title="Leitura de documentos" desc="Carregue um PDF ou imagem de apólice. A IA extrai seguradora, coberturas, prémios, datas e condições em segundos." />
                <IAFeature title="Comparação de cotações" desc="Envie até 3 cotações. A IA compara coberturas, exclusões e preço, e gera um relatório com recomendação fundamentada." />
                <IAFeature title="Análise de risco" desc="Introduza o NIF de um parceiro. A IA cruza dados do Registo Comercial e gera um perfil de risco financeiro." />
              </div>
            </div>
            <div style={{ background: '#1a1a1a', borderRadius: '8px', padding: '2.5rem', border: '1px solid #222' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#27AE60' }} />
                <span style={{ ...font(600, '0.75rem'), color: '#666', textTransform: 'uppercase' as const, letterSpacing: '0.1em' }}>IA Adler Pro — Em tempo real</span>
              </div>
              <div className="space-y-4">
                <AIStep step="01" label="Upload" desc="PDF da apólice carregado" />
                <AIStep step="02" label="Leitura" desc="IA a processar documento..." />
                <AIStep step="03" label="Extracção" desc="Seguradora: Zurich | Prémio: 3.200 EUR" />
                <AIStep step="04" label="Resultado" desc="Dados estruturados prontos a usar" />
              </div>
              <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#0d0d0d', borderRadius: '4px', border: '1px solid #2a2a2a' }}>
                <p style={{ ...font(600, '0.75rem'), color: gold }}>Tempo médio de processamento</p>
                <p style={{ ...font(700, '1.5rem'), color: '#fff' }}>{'< 8 segundos'}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ VANTAGENS ══════════ */}
      <section id="vantagens" style={{ padding: '5rem 2.5rem' }}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center" style={{ marginBottom: '3.5rem' }}>
            <span style={{ ...font(700, '0.7rem'), textTransform: 'uppercase' as const, letterSpacing: '0.12em', color: gold }}>
              Porquê o Adler Pro
            </span>
            <h2 style={{ ...font(700, '2.25rem'), color: dark, marginTop: '0.75rem', letterSpacing: '-0.02em' }}>
              A vantagem competitiva que faltava à sua empresa.
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <ComparisonCard
              title="Sem o Adler Pro"
              items={[
                'Apólices em emails e pastas partilhadas',
                'Renovações esquecidas ou feitas à pressa',
                'Cotações comparadas manualmente em Excel',
                'Sinistros acompanhados por telefone',
                'Nenhuma visibilidade sobre risco de parceiros',
                'Dependência total do mediador para qualquer consulta',
              ]}
              type="before"
            />
            <ComparisonCard
              title="Com o Adler Pro"
              items={[
                'Portfólio digital centralizado e acessível 24/7',
                'Alertas automáticos a 90, 60 e 30 dias por email',
                'Comparativo inteligente com relatório IA em segundos',
                'Gestão de sinistros com timeline e exportação',
                'Análise de risco com dados do Registo Comercial',
                'Portal dedicado com autonomia total para a empresa',
              ]}
              type="after"
            />
          </div>
        </div>
      </section>

      {/* ══════════ SECTORES ══════════ */}
      <section style={{ background: '#fafafa', padding: '5rem 2.5rem', borderTop: '1px solid #eee', borderBottom: '1px solid #eee' }}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center" style={{ marginBottom: '3rem' }}>
            <span style={{ ...font(700, '0.7rem'), textTransform: 'uppercase' as const, letterSpacing: '0.12em', color: gold }}>
              Para todas as empresas
            </span>
            <h2 style={{ ...font(700, '2.25rem'), color: dark, marginTop: '0.75rem', letterSpacing: '-0.02em' }}>
              Independentemente do sector, os seus seguros merecem gestão inteligente.
            </h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <SectorCard icon="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" label="Hotelaria" />
            <SectorCard icon="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" label="Imobiliário" />
            <SectorCard icon="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" label="Contabilidade" />
            <SectorCard icon="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" label="Indústria" />
            <SectorCard icon="M13 10V3L4 14h7v7l9-11h-7z" label="Energia" />
            <SectorCard icon="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" label="Serviços" />
          </div>

          <p className="text-center" style={{ ...font(300, '0.9rem'), color: '#888', marginTop: '2rem' }}>
            Construção, restauração, retalho, transportes, saúde, tecnologia &mdash; o Adler Pro adapta-se a qualquer sector empresarial.
          </p>
        </div>
      </section>

      {/* ══════════ POSICIONAMENTO INSURTECH ══════════ */}
      <section style={{ padding: '5rem 2.5rem' }}>
        <div className="max-w-4xl mx-auto text-center">
          <span style={{ ...font(700, '0.7rem'), textTransform: 'uppercase' as const, letterSpacing: '0.12em', color: gold }}>
            Quem somos
          </span>
          <h2 style={{ ...font(700, '2.25rem'), color: dark, marginTop: '0.75rem', marginBottom: '1.5rem', letterSpacing: '-0.02em' }}>
            A Adler & Rochefort é uma insurtech portuguesa.
          </h2>
          <p style={{ ...font(300, '1.05rem'), color: '#555', lineHeight: 1.8, marginBottom: '1rem', maxWidth: '40rem', marginLeft: 'auto', marginRight: 'auto' }}>
            Registada na <strong style={{ fontWeight: 600 }}>Autoridade de Supervisão de Seguros e Fundos de Pensões (ASF)</strong> com o n.º 425591790/3,
            a Adler & Rochefort combina a experiência de mediação de seguros com tecnologia de ponta para oferecer às empresas portuguesas
            uma experiência de gestão de risco que não existe no mercado.
          </p>
          <p style={{ ...font(300, '1.05rem'), color: '#555', lineHeight: 1.8, maxWidth: '40rem', marginLeft: 'auto', marginRight: 'auto' }}>
            O Adler Pro não é apenas uma ferramenta &mdash; é a materialização da nossa visão de que a protecção do património empresarial
            deve ser <strong style={{ fontWeight: 600, color: dark }}>transparente, inteligente e, acima de tudo, simples</strong>.
          </p>
        </div>
      </section>

      {/* ══════════ CTA FINAL ══════════ */}
      <section style={{ background: dark, padding: '5rem 2.5rem' }}>
        <div className="max-w-3xl mx-auto text-center">
          <img src="/logo.png" alt="Adler Pro" style={{ height: '80px', width: 'auto', margin: '0 auto 2rem' }} />
          <h2 style={{ ...font(700, '2.5rem'), color: '#fff', marginBottom: '1rem', letterSpacing: '-0.02em' }}>
            Pronto para transformar a gestão de seguros da sua empresa?
          </h2>
          <p style={{ ...font(300, '1.05rem'), color: '#999', lineHeight: 1.8, marginBottom: '2.5rem' }}>
            Peça uma demonstração gratuita e descubra como o Adler Pro pode simplificar as suas operações,
            reduzir o risco e poupar tempo à sua equipa.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/contact" style={{ ...font(600, '0.9rem'), padding: '0.85rem 2.5rem', background: gold, color: '#fff', borderRadius: '2px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              Pedir Demonstração Gratuita
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
            <a href="mailto:insurance@adlerrochefort.com" style={{ ...font(600, '0.9rem'), padding: '0.85rem 2.5rem', background: 'transparent', color: '#fff', border: '1.5px solid #333', borderRadius: '2px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
              insurance@adlerrochefort.com
            </a>
          </div>
        </div>
      </section>

      {/* ══════════ FOOTER ══════════ */}
      <footer style={{ padding: '2.5rem', borderTop: '1px solid #eee' }}>
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <Link to="/contact" style={{ ...font(600, '0.78rem'), color: '#666', textDecoration: 'none' }}>Contacto</Link>
              <Link to="/terms-and-conditions" style={{ ...font(600, '0.78rem'), color: '#666', textDecoration: 'none' }}>Termos e Condições</Link>
              <Link to="/privacy-policy" style={{ ...font(600, '0.78rem'), color: '#666', textDecoration: 'none' }}>Política de Privacidade</Link>
            </div>
            <div className="text-center md:text-right">
              <p style={{ ...font(400, '0.75rem'), color: '#bbb' }}>
                Adler & Rochefort é uma marca comercial da Ownizo Unipessoal LDA.
              </p>
              <p style={{ ...font(400, '0.75rem'), color: '#bbb', marginTop: '0.25rem' }}>
                Registada na ASF com o n.º 425591790/3.
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

/* ───────── sub-components ───────── */

function TrustMetric({ value, label, isLast }: { value: React.ReactNode; label: string; isLast?: boolean }) {
  return (
    <div style={{ padding: '1.75rem 1.5rem', borderRight: isLast ? 'none' : '1px solid #eee' }}>
      <p style={{ ...font(700, '2rem'), color: dark }}>{value}</p>
      <p style={{ ...font(300, '0.78rem'), color: '#888' }}>{label}</p>
    </div>
  )
}

function ProblemItem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3">
      <svg className="w-5 h-5 flex-shrink-0" style={{ color: '#CC2200', marginTop: '0.1rem' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
      <span style={{ ...font(400, '0.9rem'), color: '#555' }}>{text}</span>
    </div>
  )
}

function SolutionItem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3">
      <svg className="w-5 h-5 flex-shrink-0" style={{ color: '#27AE60', marginTop: '0.1rem' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      <span style={{ ...font(400, '0.9rem'), color: '#555' }}>{text}</span>
    </div>
  )
}

function FeatureCard({ icon, title, desc, badge }: { icon: string; title: string; desc: string; badge?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: '6px', padding: '2rem', transition: 'box-shadow 0.2s', position: 'relative' as const }}>
      {badge && (
        <span style={{ position: 'absolute' as const, top: '1rem', right: '1rem', ...font(700, '0.65rem'), background: gold, color: dark, padding: '0.2rem 0.5rem', borderRadius: '2px', letterSpacing: '0.05em' }}>
          {badge}
        </span>
      )}
      <div style={{ width: '40px', height: '40px', background: '#f5f5f5', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
        <svg className="w-5 h-5" style={{ color: dark }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
      </div>
      <h3 style={{ ...font(700, '1rem'), color: dark, marginBottom: '0.75rem' }}>{title}</h3>
      <p style={{ ...font(300, '0.875rem'), color: '#666', lineHeight: 1.7 }}>{desc}</p>
    </div>
  )
}

function IAFeature({ title, desc }: { title: string; desc: string }) {
  return (
    <div style={{ paddingLeft: '1rem', borderLeft: `2px solid ${gold}` }}>
      <p style={{ ...font(600, '0.9rem'), color: '#fff', marginBottom: '0.25rem' }}>{title}</p>
      <p style={{ ...font(300, '0.85rem'), color: '#888', lineHeight: 1.6 }}>{desc}</p>
    </div>
  )
}

function AIStep({ step, label, desc }: { step: string; label: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <span style={{ ...font(700, '0.7rem'), color: gold, background: '#222', padding: '0.25rem 0.5rem', borderRadius: '2px', flexShrink: 0 }}>{step}</span>
      <div>
        <p style={{ ...font(600, '0.8rem'), color: '#ccc' }}>{label}</p>
        <p style={{ ...font(300, '0.78rem'), color: '#666' }}>{desc}</p>
      </div>
    </div>
  )
}

function ComparisonCard({ title, items, type }: { title: string; items: string[]; type: 'before' | 'after' }) {
  const isBefore = type === 'before'
  return (
    <div style={{
      background: isBefore ? '#fafafa' : dark,
      border: isBefore ? '1px solid #eee' : `1px solid ${gold}`,
      borderRadius: '6px',
      padding: '2.5rem',
    }}>
      <h3 style={{ ...font(700, '1.25rem'), color: isBefore ? '#999' : gold, marginBottom: '1.5rem' }}>{title}</h3>
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-3">
            {isBefore ? (
              <svg className="w-4 h-4 flex-shrink-0" style={{ color: '#ccc', marginTop: '0.15rem' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-4 h-4 flex-shrink-0" style={{ color: gold, marginTop: '0.15rem' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
            <span style={{ ...font(400, '0.875rem'), color: isBefore ? '#888' : '#ccc', lineHeight: 1.5 }}>{item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SectorCard({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="text-center" style={{ padding: '1.5rem 1rem', background: '#fff', border: '1px solid #eee', borderRadius: '6px' }}>
      <div style={{ width: '40px', height: '40px', margin: '0 auto 0.75rem', background: '#f5f5f5', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg className="w-5 h-5" style={{ color: dark }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
      </div>
      <p style={{ ...font(600, '0.8rem'), color: dark }}>{label}</p>
    </div>
  )
}
