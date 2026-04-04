import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/privacy-policy')({
  component: PrivacyPolicyPage,
})

function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white px-4 py-12">
      <article className="max-w-4xl mx-auto prose prose-slate max-w-none">
        <h1>Política de Privacidade</h1>
        <p><strong>Última atualização:</strong> 2 de abril de 2026</p>

        <p>
          A presente Política de Privacidade descreve como a <strong>Ownizo Unipessoal LDA</strong>, titular da marca comercial
          <strong> Adler &amp; Rochefort</strong>, trata dados pessoais no âmbito do seu SaaS.
        </p>

        <h2>1. Responsável pelo Tratamento</h2>
        <p><strong>Empresa:</strong> Ownizo Unipessoal LDA</p>
        <p><strong>NIF:</strong> 517169029</p>
        <p><strong>Morada:</strong> Av. do Atlântico 16, Escritório 5.07, 1990-019 Lisboa</p>
        <p><strong>Email:</strong> <a href="mailto:insurance@adlerrochefort.com">insurance@adlerrochefort.com</a></p>
        <p><strong>Telefone:</strong> <a href="tel:+351928226570">+351 928 226 570</a></p>

        <h2>2. Dados Tratados</h2>
        <p>
          Podem ser tratados dados de identificação e contacto (nome, empresa, email, telefone), dados de autenticação,
          bem como dados relativos a apólices, cotações e documentos carregados pelo cliente.
        </p>

        <h2>3. Finalidades</h2>
        <p>Os dados são tratados para:</p>
        <ul>
          <li>prestar o serviço subscrito na plataforma;</li>
          <li>analisar, organizar e apresentar informação de seguros empresariais;</li>
          <li>melhorar funcionalidades, segurança e suporte;</li>
          <li>enviar comunicações relacionadas com propostas de seguros no contexto do serviço.</li>
        </ul>

        <h2>4. Base Jurídica</h2>
        <p>
          O tratamento assenta na execução do contrato de prestação de serviços, no interesse legítimo da melhoria
          e segurança da plataforma, e no consentimento quando legalmente exigido.
        </p>

        <h2>5. Partilha e Subcontratantes</h2>
        <p>
          A plataforma poderá recorrer a prestadores tecnológicos, incluindo plataformas de Inteligência Artificial,
          para processar informação necessária à execução do serviço.
        </p>

        <h2>6. Conservação</h2>
        <p>
          Os dados são conservados pelo período necessário ao cumprimento das finalidades e obrigações legais aplicáveis.
        </p>

        <h2>7. Direitos dos Titulares</h2>
        <p>
          O titular pode solicitar acesso, retificação, apagamento, limitação, portabilidade e oposição, nos termos da lei,
          através de <a href="mailto:insurance@adlerrochefort.com">insurance@adlerrochefort.com</a>.
        </p>

        <h2>8. Segurança</h2>
        <p>
          São adotadas medidas técnicas e organizativas adequadas para proteção dos dados, sem prejuízo dos riscos inerentes
          à transmissão eletrónica de informação.
        </p>

        <h2>9. Alterações à Política</h2>
        <p>
          Esta política pode ser atualizada. A versão em vigor será sempre publicada nesta página.
        </p>

        <p className="mt-10">
          <Link to="/" className="text-gold-700 hover:text-gold-800">Voltar à página inicial</Link>
        </p>
      </article>
    </div>
  )
}
