import { Html, Head, Preview, Body, Container, Section, Row, Column, Text, Hr, Img } from 'react-email'

const NAVY = '#1B2B4B'
const GOLD = '#C9A84C'
const FONT = 'Arial, Helvetica, sans-serif'

export interface DocumentEmailProps {
  clientName: string
  policyNumber: string
  insurer: string
  filename: string
  message: string
}

export function DocumentEmail({
  clientName,
  policyNumber,
  insurer,
  filename,
  message,
}: DocumentEmailProps) {
  const salutation = clientName ? `Olá ${clientName},` : 'Olá,'

  return (
    <Html lang="pt">
      <Head />
      <Preview>Documento da sua apólice {policyNumber} — Adler &amp; Rochefort</Preview>
      <Body style={{ margin: 0, padding: 0, backgroundColor: '#F4F6F9', fontFamily: FONT }}>
        <Container
          style={{
            maxWidth: 600,
            margin: '32px auto',
            backgroundColor: '#ffffff',
            borderRadius: 4,
            overflow: 'hidden',
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          }}
        >
          {/* ── Header com logo ── */}
          <Section style={{ backgroundColor: NAVY, padding: '24px 32px', textAlign: 'center' }}>
            <Img
              src="https://admin.adlerrochefort.com/logo-email.png"
              width={200}
              alt="Adler &amp; Rochefort"
              style={{ display: 'block', margin: '0 auto', border: 0, height: 'auto' }}
            />
          </Section>

          {/* ── Banner do tipo de comunicação ── */}
          <Section style={{ backgroundColor: GOLD, padding: '11px 32px' }}>
            <Text
              style={{
                color: NAVY,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.09em',
                textTransform: 'uppercase',
                margin: 0,
                textAlign: 'center',
                fontFamily: FONT,
              }}
            >
              Documento de Apólice
            </Text>
          </Section>

          {/* ── Corpo ── */}
          <Section style={{ padding: '32px 32px 8px', fontFamily: FONT }}>
            <Text
              style={{ fontSize: 15, color: '#222222', margin: '0 0 20px', fontWeight: 600, fontFamily: FONT }}
            >
              {salutation}
            </Text>

            <Text
              style={{ fontSize: 14, color: '#555555', lineHeight: '1.75', margin: '0 0 24px', fontFamily: FONT }}
            >
              {message}
            </Text>

            {/* Bloco de referência da apólice */}
            <Section
              style={{
                backgroundColor: '#F4F6F9',
                borderRadius: 4,
                padding: '16px 20px',
                marginBottom: 24,
                borderLeft: `4px solid ${GOLD}`,
              }}
            >
              <Row>
                <Column>
                  <Text
                    style={{
                      fontSize: 10,
                      color: '#888888',
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      margin: '0 0 6px',
                      fontFamily: FONT,
                    }}
                  >
                    Referência da Apólice
                  </Text>
                  <Text
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color: NAVY,
                      margin: '0 0 4px',
                      fontFamily: 'Courier New, Courier, monospace',
                      letterSpacing: '0.1em',
                    }}
                  >
                    {policyNumber}
                  </Text>
                  <Text
                    style={{ fontSize: 12, color: '#666666', margin: 0, fontFamily: FONT }}
                  >
                    {insurer}
                  </Text>
                </Column>
              </Row>
            </Section>

            <Text
              style={{
                fontSize: 13,
                color: '#777777',
                lineHeight: '1.7',
                margin: '0 0 8px',
                fontFamily: FONT,
              }}
            >
              Em anexo encontra o documento <strong style={{ color: '#444444' }}>{filename}</strong> referente à sua apólice.
            </Text>
          </Section>

          {/* ── Rodapé ── */}
          <Hr style={{ borderColor: '#eeeeee', margin: 0 }} />
          <Section style={{ backgroundColor: '#F8F8F8', padding: '20px 32px' }}>
            <Text
              style={{ fontSize: 11, color: '#aaaaaa', margin: '0 0 3px', lineHeight: '1.6', fontFamily: FONT }}
            >
              <strong style={{ color: '#666666' }}>Adler &amp; Rochefort</strong> · Mediadores de Seguros
            </Text>
            <Text
              style={{ fontSize: 11, color: '#aaaaaa', margin: '0 0 3px', lineHeight: '1.6', fontFamily: FONT }}
            >
              Tel. +351 928 226 570 &nbsp;·&nbsp;{' '}
              <a href="mailto:insurance@adlerrochefort.com" style={{ color: '#aaaaaa', textDecoration: 'none' }}>
                insurance@adlerrochefort.com
              </a>
              {' '}&nbsp;·&nbsp;{' '}
              <a href="https://adlerrochefort.com" style={{ color: '#aaaaaa', textDecoration: 'none' }}>
                adlerrochefort.com
              </a>
            </Text>
            <Text
              style={{ fontSize: 11, color: '#aaaaaa', margin: 0, lineHeight: '1.6', fontFamily: FONT }}
            >
              Mediador registado na ASF sob o n.º 425591790/3
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}
