/**
 * /one/terms — English Terms & Conditions for the My Cover Vault client portal.
 *
 * Linked from the "Create account" consent checkbox on the My Cover Vault
 * login. Acceptance is recorded through the same `terms_accepted_at` mechanism
 * (stored on the auth user at sign-up), identical to the Portuguese portal —
 * only the language differs. Additive route; the Portuguese
 * /terms-and-conditions page is untouched.
 */
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/one/terms')({
  component: MyCoverVaultTerms,
  ssr: false,
  head: () => ({ meta: [{ title: 'Terms & Conditions — My Cover Vault' }] }),
})

const ink  = '#0A1628'
const body = '#3A4250'
const line = '#E6E8EC'

function MyCoverVaultTerms() {
  return (
    <div style={{ minHeight: '100vh', background: '#fff', fontFamily: "'Montserrat', sans-serif", color: body }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '3rem 1.5rem 4rem' }}>
        <a href="/one/login" style={{ color: ink, fontSize: '0.78rem', fontWeight: 600, textDecoration: 'none' }}>← Back to sign in</a>

        <h1 style={{ color: ink, fontWeight: 700, fontSize: '1.8rem', margin: '1.25rem 0 0.4rem', letterSpacing: '-0.01em' }}>
          Terms &amp; Conditions
        </h1>
        <p style={{ fontSize: '0.82rem', color: '#7A828E', margin: '0 0 2rem' }}>
          My Cover Vault · Client Portal — Last updated: 19 July 2026
        </p>

        <Section title="1. Who we are">
          My Cover Vault is a client portal operated under the trading name{' '}
          <strong>Adler &amp; Rochefort</strong>, a brand of <strong>Ownizo Unipessoal Lda.</strong>
          {' '}(tax no. 517169029), with its registered office at Av. do Atlântico 16, Office 5.07,
          1990-019 Lisbon, Portugal. Adler &amp; Rochefort is an insurance mediator authorised and
          registered with the Portuguese Insurance and Pension Funds Supervisory Authority (ASF)
          under registration no. <strong>425591790/3</strong>.
        </Section>

        <Section title="2. Purpose of the service">
          The portal lets you view your insurance policies, submit and follow claims, access your
          documents and manage your contact details. It is a convenience tool for existing clients
          of Adler &amp; Rochefort and does not itself constitute insurance advice or a contract of
          insurance.
        </Section>

        <Section title="3. Your account">
          You are responsible for keeping your login credentials confidential and for all activity
          carried out under your account. Register using the email address associated with your
          client profile so that your policies can be linked to your account.
        </Section>

        <Section title="4. Consent to data processing">
          By using the portal you expressly consent to Ownizo Unipessoal Lda. (Adler &amp; Rochefort)
          accessing and processing the data of your policies, documents, contacts, addresses, ages,
          premiums and renewal dates in the course of its insurance mediation activity, including
          within the artificial-intelligence tools used to operate this service. You agree to
          receive renewal proposals and quotes relating to the policies registered on the platform.
          Your data is processed in accordance with applicable data-protection law (GDPR).
        </Section>

        <Section title="5. Documents you upload">
          You are responsible for the documents and information you upload. Do not upload content
          you are not entitled to share. Uploaded files are stored securely and are accessible to
          you and to your Adler &amp; Rochefort broker for the purpose of managing your cover.
        </Section>

        <Section title="6. Availability">
          We aim to keep the portal available at all times but do not guarantee uninterrupted
          access. Features may change or be suspended for maintenance without prior notice.
        </Section>

        <Section title="7. Complaints & regulatory information">
          You may submit a complaint at any time through the Portuguese complaints book
          (Livro de Reclamações) at{' '}
          <a href="https://www.livroreclamacoes.pt/Inicio/" target="_blank" rel="noopener noreferrer" style={link}>
            livroreclamacoes.pt
          </a>. Adler &amp; Rochefort's registration may be verified with the ASF at{' '}
          <a href="https://www.asf.com.pt" target="_blank" rel="noopener noreferrer" style={link}>asf.com.pt</a>{' '}
          under registration no. 425591790/3. Reports may also be made via the{' '}
          <a href="https://www.asf.com.pt/canal-de-den%C3%BAncias" target="_blank" rel="noopener noreferrer" style={link}>
            ASF whistle-blowing channel
          </a>.
        </Section>

        <Section title="8. Contact">
          Email:{' '}
          <a href="mailto:insurance@adlerrochefort.com" style={link}>insurance@adlerrochefort.com</a>
          {' '}· Phone: <a href="tel:+351928226570" style={link}>+351 928 226 570</a>
        </Section>

        <p style={{ fontSize: '0.72rem', color: '#7A828E', marginTop: '2.5rem', lineHeight: 1.6 }}>
          Adler &amp; Rochefort · Ownizo Unipessoal Lda. · ASF reg. 425591790/3
        </p>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: `1px solid ${line}`, paddingTop: '1.5rem', marginTop: '1.5rem' }}>
      <h2 style={{ color: ink, fontWeight: 700, fontSize: '1rem', margin: '0 0 0.6rem' }}>{title}</h2>
      <p style={{ fontSize: '0.88rem', lineHeight: 1.7, margin: 0 }}>{children}</p>
    </div>
  )
}

const link: React.CSSProperties = { color: ink, fontWeight: 600, textDecoration: 'underline' }
