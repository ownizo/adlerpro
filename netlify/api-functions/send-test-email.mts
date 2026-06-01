import type { Context } from '@netlify/functions'
import { createElement } from 'react'
import { sendEmail } from '../../src/lib/email/client.ts'
import { ConfirmationEmail } from '../../src/lib/email/templates/ConfirmationEmail.tsx'

export const config = {
  path: '/api/send-test-email',
}

export default async function handler(req: Request, _context: Context) {
  const isAdmin =
    req.headers.get('authorization') ===
    `Bearer ${process.env.ADMIN_SECRET ?? 'adler-admin-2025'}`

  if (!isAdmin) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const url = new URL(req.url)
  const to = url.searchParams.get('to')

  if (!to) {
    return new Response(
      JSON.stringify({ error: 'Parâmetro "to" obrigatório. Ex: ?to=exemplo@email.com' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  try {
    const result = await sendEmail({
      to,
      subject: '✅ Email de teste — Adler Pro',
      template: createElement(ConfirmationEmail, {
        recipientName: 'Utilizador de Teste',
        title: 'Integração Resend a funcionar',
        message:
          'Este é um email de confirmação gerado automaticamente para validar a integração com o Resend. Se o recebeu, o envio de emails transacionais está operacional.',
        referenceCode: `TEST-${Date.now()}`,
        ctaLabel: 'Abrir Portal',
        ctaUrl: 'https://pro.adlerrochefort.com',
      }),
    })

    return new Response(
      JSON.stringify({ ok: true, emailId: result.id, sentTo: to }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[send-test-email] Erro:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
