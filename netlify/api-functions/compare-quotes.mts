import type { Config } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const formData = await req.formData()
    const files = formData.getAll('quotes') as File[]

    if (!files || files.length === 0) {
      return Response.json({ error: 'Por favor envie pelo menos uma cotação.' }, { status: 400 })
    }
    if (files.length > 2) {
      return Response.json({ error: 'Por favor envie no máximo 2 cotações.' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return Response.json({ error: 'Serviço de IA não configurado. Contacte o suporte.' }, { status: 500 })
    }

    const client = new Anthropic({ apiKey })

    const messageParts: Anthropic.MessageParam['content'] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const arrayBuffer = await file.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      const base64 = Buffer.from(arrayBuffer).toString('base64')

      messageParts.push({ type: 'text', text: `\n--- Cotação ${i + 1}: ${file.name} ---\n` })

      const isPdf = file.type === 'application/pdf' ||
        (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)
      const isImage = file.type.startsWith('image/')

      if (isPdf && bytes.length > 100) {
        messageParts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } } as any)
      } else if (isImage && bytes.length > 100) {
        const mimeType = (file.type || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
        messageParts.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } })
      } else {
        const cleanText = Buffer.from(arrayBuffer).toString('utf-8')
          .replace(/[^\x20-\x7E\u00A0-\uFFFF\n\r\t]/g, ' ')
          .substring(0, 8000)
        messageParts.push({ type: 'text', text: cleanText || '[sem conteúdo legível]' })
      }
    }

    messageParts.push({
      type: 'text',
      text: `\nAnalisa estas ${files.length} cotações de seguro e compara-as em Português de Portugal.

Para cada cotação identifica: seguradora, número de apólice, prémio anual, coberturas principais e exclusões.
Apresenta uma comparação directa e uma recomendação final.

Responde em HTML usando estas classes Tailwind:
- Secções: <div class="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
- Títulos: <h3 class="text-lg font-semibold mt-4 mb-2 text-gray-900">
- Parágrafos: <p class="mb-2 text-gray-700">
- Listas: <ul class="list-disc pl-5 mb-3 space-y-1"><li class="text-gray-700">
- Recomendação: <div class="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">
Apenas HTML puro, sem marcadores de código.`,
    })

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: messageParts }],
    })

    const report = (response.content[0].type === 'text' ? response.content[0].text : '')
      .replace(/```html\n?|\n?```/g, '')
      .trim()

    return Response.json({ report })

  } catch (error: any) {
    const errMsg = error?.error?.message ?? error?.message ?? String(error)
    const errStatus = error?.status ?? 500
    console.error('[compare-quotes] status:', errStatus, '| detalhe:', errMsg, '| raw:', error)
    let userMessage = 'Erro ao analisar as cotações. Tente novamente.'

    if (errMsg.includes('rate_limit') || errMsg.includes('overloaded')) {
      userMessage = 'Serviço temporariamente sobrecarregado. Tente novamente em alguns segundos.'
    } else if (errMsg.includes('too large') || errMsg.includes('size')) {
      userMessage = 'Ficheiro demasiado grande. Por favor reduza o tamanho e tente novamente.'
    }

    return Response.json(
      { error: userMessage, details: errMsg, status: errStatus },
      { status: 500 }
    )
  }
}

export const config: Config = {
  path: '/api/compare-quotes',
  timeout: 120,
}
