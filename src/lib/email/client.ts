import { Resend } from 'resend'
import { render } from 'react-email'
import type { ReactElement } from 'react'

// Singleton — partilhado por todos os envios no mesmo processo
export const resendClient = new Resend(process.env.RESEND_API_KEY)

export const FROM_EMAIL =
  process.env.EMAIL_FROM ?? 'Os Meus Seguros <noreply@adlerrochefort.com>'

export interface EmailAttachment {
  filename: string
  content: string | Buffer
  contentType?: string
}

export interface SendEmailOptions {
  to: string | string[]
  subject: string
  template: ReactElement
  from?: string
  bcc?: string | string[]
  replyTo?: string
  attachments?: EmailAttachment[]
}

export interface SendEmailResult {
  id: string
}

export async function sendEmail({
  to,
  subject,
  template,
  from,
  bcc,
  replyTo,
  attachments,
}: SendEmailOptions): Promise<SendEmailResult> {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY não configurada')
  }

  const html = await render(template)

  const { data, error } = await resendClient.emails.send({
    from: from ?? FROM_EMAIL,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    ...(bcc !== undefined ? { bcc } : {}),
    ...(replyTo !== undefined ? { replyTo } : {}),
    ...(attachments?.length ? { attachments } : {}),
  })

  if (error) {
    throw new Error(`Falha no envio de email: ${error.message}`)
  }

  return data as SendEmailResult
}
