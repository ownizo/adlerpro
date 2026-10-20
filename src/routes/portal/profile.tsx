import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { fetchPortalProfile } from '@/lib/server-fns'
import { PortalLayout, PageTitle, Card, Spinner, ErrorNote, ChangePasswordForm, C, BRAND } from '@/components/portal/portal-ui'

export const Route = createFileRoute('/portal/profile')({
  component: PortalProfile,
  ssr: false,
  head: () => ({ meta: [{ title: 'Profile — MillionGuard' }] }),
})

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="mg-row">
      <span style={{ color: C.muted, fontSize: 13, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 14, textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

function PortalProfile() {
  const [p, setP] = useState<Awaited<ReturnType<typeof fetchPortalProfile>> | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchPortalProfile().then(setP).catch(() => setError('We could not load your profile. Please refresh the page.'))
  }, [])

  return (
    <PortalLayout>
      <PageTitle title="Profile" />
      {error && <ErrorNote>{error}</ErrorNote>}
      {!p && !error && <Spinner />}
      {p && (
        <div className="mg-two">
          <Card>
            <h2 style={{ margin: '0 0 6px', fontSize: 17 }}>{p.type === 'business' ? 'Business details' : 'Personal details'}</h2>
            <Row label="Signed in as" value={p.email} />
            <Row label={p.type === 'business' ? 'Company' : 'Name'} value={p.name} />
            <Row label="Tax number" value={p.taxNumber} />
            <Row label="Phone" value={p.phone} />
            <Row label="Address" value={p.address} />
            {p.type === 'business' && <Row label="Main contact" value={p.contactName} />}
            <Row label="Contact email" value={p.contactEmail} />
            <p style={{ margin: '14px 0 0', fontSize: 13, color: C.body, lineHeight: 1.6 }}>
              Something to update? Write to <a href={`mailto:${BRAND.contactEmail}`} style={{ color: C.ink }}>{BRAND.contactEmail}</a> and we change it on our side and with the insurers.
            </p>
          </Card>
          <Card>
            <h2 style={{ margin: '0 0 14px', fontSize: 17 }}>Change password</h2>
            <ChangePasswordForm />
          </Card>
        </div>
      )}
    </PortalLayout>
  )
}
