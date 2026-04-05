import type { Config } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'

function extractPdfText(buffer: Buffer): string {
  const str = buffer.toString('latin1')
  const parts: string[] = []
  const btEtRegex = /BT([\s\S]*?)ET/g
  let block: RegExpExecArray | null

  while ((block = btEtRegex.exec(str)) !== null) {
    const content = block[1]

    const tjRegex = /\(((?:[^()\\]|\\[\s\S])*)\)\s*Tj/g
    let m: RegExpExecArray | null
    while ((m = tjRegex.exec(content)) !== null) {
      parts.push(decodePdfString(m[1]))
    }

    const tjArrRegex = /\[([\s\S]*?)\]\s*TJ/g
    while ((m = tjArrRegex.exec(content)) !== null) {
      const itemRegex = /\(((?:[^()\\]|\\[\s\S])*)\)/g
      let item: RegExpExecArray | null
      while ((item = itemRegex.exec(m[1])) !== null) {
        parts.push(decodePdfString(item[1]))
      }
    }
  }

  return parts.join(' ').replace(/\s{2,}/g, ' ').trim().substring(0, 8000)
}

function decodePdfString(s: string): string {
  return s
    .replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\')
}

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
    if (files.length > 3) {
      return Response.json({ error: 'Por favor envie no máximo 3 cotações.' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return Response.json({ error: 'Serviço de IA não configurado. Contacte o suporte.' }, { status: 500 })
    }

    // Extrair texto de todos os PDFs localmente (sem chamadas à API)
    const quotesText = await Promise.all(files.map(async (file, i) => {
      const arrayBuffer = await file.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      const buffer = Buffer.from(arrayBuffer)

      const isPdf = file.type === 'application/pdf' ||
        (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)

      let text: string
      if (isPdf) {
        text = extractPdfText(buffer)
        if (text.length < 50) {
          text = buffer.toString('utf-8').replace(/[^\x20-\x7E\u00A0-\uFFFF\n\r\t]/g, ' ').substring(0, 8000)
        }
      } else {
        text = buffer.toString('utf-8').replace(/[^\x20-\x7E\u00A0-\uFFFF\n\r\t]/g, ' ').substring(0, 8000)
      }

      return `=== Cotação ${i + 1}: ${file.name} ===\n${text.trim() || '[sem conteúdo legível]'}`
    }))

    const prompt = `Analisa estas ${files.length} cotações de seguro e compara-as em Português de Portugal.

${quotesText.join('\n\n')}

Para cada cotação extrai: seguradora, número de apólice, prémio anual, coberturas principais e exclusões.
Depois apresenta uma comparação directa e uma recomendação final.

Responde em HTML usando estas classes Tailwind:
- Secções: <div class="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
- Títulos: <h3 class="text-lg font-semibold mt-4 mb-2 text-gray-900">
- Parágrafos: <p class="mb-2 text-gray-700">
- Listas: <ul class="list-disc pl-5 mb-3 space-y-1"><li class="text-gray-700">
- Recomendação: <div class="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">
Apenas HTML puro, sem marcadores de código.`

    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
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
