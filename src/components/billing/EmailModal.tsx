import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sendIXInvoiceEmail, sendIXEstimateEmail } from '@/lib/server-fns'
import { font, inputStyle, btnPrimary, btnSecondary } from './styles'

export function EmailModal({
  docId,
  docType,
  onClose,
}: {
  docId: number
  docType: 'invoice' | 'estimate'
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const handleSend = async () => {
    if (!email.trim()) return
    setSending(true)
    setError('')
    try {
      const fn = docType === 'invoice' ? sendIXInvoiceEmail : sendIXEstimateEmail
      const result = await fn({ id: docId, email, subject, body })
      if (result && !result.ok) throw new Error(result.error)
      setSent(true)
      setTimeout(onClose, 1500)
    } catch (e: any) {
      setError(e.message || t('billing.errors.emailFailed'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={onClose} />
      <div style={{ position: 'relative', background: 'var(--color-base)', borderRadius: '8px', width: '95%', maxWidth: '480px', padding: '2rem', fontFamily: font }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 1.5rem', color: 'var(--color-primary)' }}>{t('billing.actions.sendEmail')}</h3>
        {sent ? (
          <p style={{ color: 'var(--status-success-text)', fontWeight: 600, fontSize: '0.85rem' }}>{t('billing.success.emailSent')}</p>
        ) : (
          <>
            {error && <div style={{ background: 'var(--status-danger-bg)', color: 'var(--status-danger-text)', padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.8rem', marginBottom: '1rem' }}>{error}</div>}
            <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <div><label style={{ fontFamily: font, fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-body)', display: 'block', marginBottom: '0.25rem', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>{t('billing.form.emailTo')} *</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} /></div>
              <div><label style={{ fontFamily: font, fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-body)', display: 'block', marginBottom: '0.25rem', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>{t('billing.form.emailSubject')}</label><input value={subject} onChange={(e) => setSubject(e.target.value)} style={inputStyle} /></div>
              <div><label style={{ fontFamily: font, fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-body)', display: 'block', marginBottom: '0.25rem', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>{t('billing.form.emailBody')}</label><textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ ...inputStyle, minHeight: '60px' }} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button onClick={onClose} style={btnSecondary}>{t('billing.form.cancel')}</button>
              <button onClick={handleSend} disabled={sending} style={btnPrimary}>{sending ? t('billing.form.sending') : t('billing.form.send')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
