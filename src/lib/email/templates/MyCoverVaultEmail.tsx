/**
 * English transactional email for the My Cover Vault client portal
 * (welcome / password / generic notification). Uses the shared BaseLayout with
 * the My Cover Vault brand. Sent via the same Resend key as every other email.
 *
 * The Portuguese "Os Meus Seguros" templates are untouched — this is an
 * additive English variant for the My Cover Vault deploy.
 */
import { Section, Row, Column, Heading, Text, Button, Hr } from 'react-email'
import { BaseLayout } from './BaseLayout'
import { EMAIL_BRAND_MCV } from '../brand'

const NAVY = '#1B2B4B'
const GOLD = '#C9A84C'
const FONT = 'Arial, Helvetica, sans-serif'

export interface MyCoverVaultEmailProps {
  recipientName: string
  /** Small uppercase banner label, e.g. "Welcome" / "Notification". */
  kicker?: string
  title: string
  message: string
  referenceCode?: string
  ctaLabel?: string
  ctaUrl?: string
}

export function MyCoverVaultEmail({
  recipientName,
  kicker = 'Welcome',
  title,
  message,
  referenceCode,
  ctaLabel,
  ctaUrl,
}: MyCoverVaultEmailProps) {
  return (
    <BaseLayout brand={EMAIL_BRAND_MCV} preview={`${title} — My Cover Vault`}>
      <Section style={{ backgroundColor: NAVY, padding: '10px 32px' }}>
        <Text
          style={{
            color: GOLD,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            margin: 0,
            textAlign: 'center',
            fontFamily: FONT,
          }}
        >
          {kicker}
        </Text>
      </Section>

      <Section style={{ padding: '32px 32px 8px', fontFamily: FONT }}>
        <Heading
          as="h2"
          style={{ fontSize: 20, fontWeight: 700, color: NAVY, margin: '0 0 20px', fontFamily: FONT }}
        >
          {title}
        </Heading>

        <Text style={{ fontSize: 15, color: '#333333', margin: '0 0 6px', fontWeight: 600, fontFamily: FONT }}>
          Dear {recipientName},
        </Text>

        <Text style={{ fontSize: 14, color: '#666666', margin: '0 0 24px', lineHeight: '1.7', fontFamily: FONT }}>
          {message}
        </Text>

        {referenceCode && (
          <Section
            style={{ backgroundColor: '#F4F6F9', borderRadius: 4, padding: '16px 24px', marginBottom: 24, borderLeft: `4px solid ${GOLD}` }}
          >
            <Text style={{ fontSize: 10, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 4px', fontFamily: FONT }}>
              Reference code
            </Text>
            <Text style={{ fontSize: 18, fontWeight: 700, color: NAVY, margin: 0, fontFamily: 'Courier New, Courier, monospace', letterSpacing: '0.12em' }}>
              {referenceCode}
            </Text>
          </Section>
        )}

        {ctaLabel && ctaUrl && (
          <Row style={{ textAlign: 'center', margin: '8px 0 24px' }}>
            <Column>
              <Button
                href={ctaUrl}
                style={{ backgroundColor: GOLD, color: '#ffffff', fontSize: 14, fontWeight: 700, padding: '14px 32px', borderRadius: 4, textDecoration: 'none', letterSpacing: '0.03em', display: 'inline-block', fontFamily: FONT }}
              >
                {ctaLabel} →
              </Button>
            </Column>
          </Row>
        )}
      </Section>

      <Hr style={{ borderColor: '#eeeeee', margin: '0 32px' }} />

      <Section style={{ padding: '16px 32px 28px', fontFamily: FONT }}>
        <Text style={{ fontSize: 12, color: '#999999', margin: 0, lineHeight: '1.6', fontFamily: FONT }}>
          If you have any questions, contact your{' '}
          <strong style={{ color: '#666666' }}>Adler &amp; Rochefort</strong> team.
        </Text>
      </Section>
    </BaseLayout>
  )
}
