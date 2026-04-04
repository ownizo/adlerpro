import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/terms-and-conditions')({
  component: TermsAndConditionsPage,
})

function TermsAndConditionsPage() {
  return (
    <div className="min-h-screen bg-white px-4 py-12">
      <article className="max-w-4xl mx-auto prose prose-slate max-w-none">
        <h1>Termos e Condições</h1>
        <p><strong>Última atualização:</strong> 2 de abril de 2026</p>

        <p>
          Estes Termos e Condições regulam a utilização do SaaS da marca comercial <strong>Adler &amp; Rochefort</strong>,
          operado por <strong>Ownizo Unipessoal LDA</strong> (NIF <strong>517169029</strong>), com sede em
          <strong> Av. do Atlântico 16, Escritório 5.07, 1990-019 Lisboa</strong>.
        </p>

        <h2>1. Identificação e Contactos</h2>
        <p>Email: <a href="mailto:insurance@adlerrochefort.com">insurance@adlerrochefort.com</a></p>
        <p>Telefone: <a href="tel:+351928226570">+351 928 226 570</a></p>

        <h2>2. Objeto do Serviço</h2>
        <p>
          O serviço disponibiliza funcionalidades de gestão e análise operacional de seguros empresariais,
          incluindo consulta de apólices, cotações e documentação associada.
        </p>

        <h2>3. Acesso e Conta de Utilizador</h2>
        <p>
          O utilizador é responsável pela confidencialidade das credenciais de acesso e por toda a atividade
          realizada na sua conta.
        </p>

        <h2>4. Consentimento Específico do Cliente</h2>
        <p>
          Ao utilizar o SaaS, o utilizador/cliente consente expressamente que a Ownizo Unipessoal LDA (Adler &amp; Rochefort)
          tenha acesso às apólices, cotações e documentos da empresa registada, bem como aos dados processados
          nas plataformas de Inteligência Artificial utilizadas neste SaaS.
        </p>
        <p>
          O utilizador/cliente consente ainda que a Ownizo Unipessoal LDA possa contactar a empresa registada com
          propostas de cotações de seguros, mesmo sem pedido prévio, como parte integrante do serviço de subscrição deste SaaS.
        </p>

        <h2>5. Utilização Permitida</h2>
        <p>
          É proibida qualquer utilização ilícita, abusiva, fraudulenta ou que comprometa a segurança, integridade
          e disponibilidade da plataforma.
        </p>

        <h2>6. Limitação de Responsabilidade</h2>
        <p>
          A informação apresentada pode depender de dados de terceiros. A Ownizo Unipessoal LDA envida esforços
          razoáveis para assegurar qualidade e atualidade, sem garantir ausência total de erros ou interrupções.
        </p>

        <h2>7. Alterações aos Termos</h2>
        <p>
          Estes termos podem ser atualizados a qualquer momento. A versão mais recente estará sempre disponível nesta página.
        </p>

        <h2>8. Lei Aplicável e Foro</h2>
        <p>
          Aplica-se a lei portuguesa. Para dirimir litígios, é competente o foro da comarca de Lisboa,
          salvo disposição legal imperativa em contrário.
        </p>

        <p className="mt-10">
          <Link to="/" className="text-gold-700 hover:text-gold-800">Voltar à página inicial</Link>
        </p>
      </article>
    </div>
  )
}
