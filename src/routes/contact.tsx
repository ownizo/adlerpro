import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

export const Route = createFileRoute('/contact')({
  component: ContactPage,
})

function ContactPage() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle')

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setStatus('sending')

    const form = e.currentTarget
    const formData = new FormData(form)
    const encodedData = new URLSearchParams()
    formData.forEach((value, key) => {
      encodedData.append(key, String(value))
    })

    try {
      const response = await fetch('/__forms.html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: encodedData.toString(),
      })

      if (!response.ok) {
        throw new Error('Erro no envio do formulário')
      }

      setStatus('success')
      form.reset()
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="min-h-screen bg-white text-primary px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-navy-700 mb-2">Entrar em Contacto</h1>
          <p className="text-navy-500">Preencha o formulário e a equipa da Adler & Rochefort responderá rapidamente.</p>
        </div>

        <form
          name="contact-adler-rochefort"
          method="POST"
          data-netlify="true"
          netlify-honeypot="bot-field"
          onSubmit={handleSubmit}
          className="bg-white border border-navy-200 rounded p-6 space-y-4"
        >
          <input type="hidden" name="form-name" value="contact-adler-rochefort" />
          <p className="hidden">
            <label>
              Não preencher: <input name="bot-field" />
            </label>
          </p>

          <Field label="Nome completo" name="fullName" required />
          <Field label="Empresa" name="company" required />
          <Field label="Email" name="email" type="email" required />
          <Field label="Telefone" name="phone" required />

          {status === 'success' && (
            <div className="text-sm p-3 rounded" style={{ background: '#EAF3DE', color: '#3B6D11' }}>
              Contacto enviado com sucesso. A equipa irá responder brevemente.
            </div>
          )}

          {status === 'error' && (
            <div className="text-sm p-3 rounded" style={{ background: '#FAEEDA', color: '#854F0B' }}>
              Ocorreu um erro ao enviar. Tente novamente dentro de instantes.
            </div>
          )}

          <button
            type="submit"
            disabled={status === 'sending'}
            className="w-full bg-[#111111] text-white py-2.5 rounded hover:bg-black disabled:opacity-50"
          >
            {status === 'sending' ? 'A enviar...' : 'Enviar Contacto'}
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between gap-4 text-sm">
          <Link to="/" className="text-navy-500 hover:text-navy-700">
            Voltar à página inicial
          </Link>
          <a href="mailto:insurance@adlerrochefort.com" className="text-gold-700 hover:text-gold-800">
            insurance@adlerrochefort.com
          </a>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  name,
  type = 'text',
  required,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-navy-700 mb-1">{label}</label>
      <input
        type={type}
        name={name}
        required={required}
        className="w-full p-2 border border-navy-200 rounded focus:ring-2 focus:ring-gold-400 outline-none"
      />
    </div>
  )
}
