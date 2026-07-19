import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Row,
  Column,
  Text,
  Hr,
} from 'react-email'
import type { ReactNode } from 'react'
import { EMAIL_BRAND_PT, type EmailBrand } from '../brand'

// Brand tokens — fontes web (Montserrat) não são fiáveis em clientes de email;
// Arial/Helvetica garante fidelidade universal.
const NAVY = '#1B2B4B'
const GOLD = '#C9A84C'
const FONT = 'Arial, Helvetica, sans-serif'

interface BaseLayoutProps {
  preview: string
  children: ReactNode
  /** Defaults to the Portuguese "Os Meus Seguros" brand (unchanged output). */
  brand?: EmailBrand
}

export function BaseLayout({ preview, children, brand = EMAIL_BRAND_PT }: BaseLayoutProps) {
  return (
    <Html lang="pt">
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: '#F4F6F9',
          fontFamily: FONT,
        }}
      >
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
          {/* ── Header ── */}
          <Section style={{ backgroundColor: NAVY, padding: '24px 32px' }}>
            <Row>
              <Column style={{ width: 48, verticalAlign: 'middle' }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    backgroundColor: GOLD,
                    borderRadius: 4,
                    textAlign: 'center',
                    lineHeight: '36px',
                  }}
                >
                  <span
                    style={{
                      color: '#ffffff',
                      fontSize: 20,
                      fontWeight: 900,
                      fontFamily: FONT,
                    }}
                  >
                    A
                  </span>
                </div>
              </Column>
              <Column style={{ verticalAlign: 'middle', paddingLeft: 12 }}>
                <Text
                  style={{
                    color: '#ffffff',
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    margin: 0,
                    lineHeight: '1.2',
                    fontFamily: FONT,
                  }}
                >
                  {brand.name}
                </Text>
                <Text
                  style={{
                    color: 'rgba(255,255,255,0.6)',
                    fontSize: 9,
                    fontWeight: 400,
                    letterSpacing: '0.08em',
                    margin: '1px 0 0',
                    lineHeight: '1.4',
                    fontFamily: FONT,
                  }}
                >
                  {brand.tagline}
                </Text>
                <Text
                  style={{
                    color: GOLD,
                    fontSize: 9,
                    fontWeight: 400,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    margin: 0,
                    lineHeight: '1.4',
                    fontFamily: FONT,
                  }}
                >
                  {brand.kicker}
                </Text>
              </Column>
            </Row>
          </Section>

          {/* ── Content (injectado por cada template) ── */}
          {children}

          {/* ── Footer ── */}
          <Hr style={{ borderColor: '#eeeeee', margin: 0 }} />
          <Section
            style={{ backgroundColor: '#F8F8F8', padding: '20px 32px' }}
          >
            <Text
              style={{
                fontSize: 11,
                color: '#aaaaaa',
                margin: '0 0 4px',
                lineHeight: '1.6',
                fontFamily: FONT,
              }}
            >
              <strong style={{ color: '#666666' }}>
                {brand.footerName}
              </strong>
            </Text>
            <Text
              style={{
                fontSize: 11,
                color: '#aaaaaa',
                margin: 0,
                lineHeight: '1.6',
                fontFamily: FONT,
              }}
            >
              {brand.footerNote}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}
