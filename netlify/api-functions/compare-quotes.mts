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

    if (files.length > 3) {
      return Response.json({ error: 'Por favor envie no máximo 3 cotações.' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return Response.json({ error: 'Serviço de IA não configurado. Contacte o suporte.' }, { status: 500 })
    }

    const client = new Anthropic({ apiKey })

    // Build content parts for Claude
    const messageParts: Anthropic.MessageParam['content'] = []
    const fileLabels: string[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const label = `Cotação ${i + 1}: ${file.name}`
      fileLabels.push(label)

      const arrayBuffer = await file.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      const base64 = Buffer.from(arrayBuffer).toString('base64')

      messageParts.push({ type: 'text', text: `\n--- ${label} ---\n` })

      const isPdf = file.type === 'application/pdf' ||
        (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)
      const isImage = file.type.startsWith('image/')

      if (isPdf && bytes.length > 100) {
        messageParts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } } as any)
      } else if (isImage && bytes.length > 100) {
        const mimeType = (file.type || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
        messageParts.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } })
      } else {
        const text = Buffer.from(arrayBuffer).toString('utf-8')
        const cleanText = text.replace(/[^\x20-\x7E\u00A0-\uFFFF\n\r\t]/g, ' ').substring(0, 30000)
        messageParts.push({ type: 'text', text: cleanText.trim().length > 0 ? cleanText : '[Ficheiro sem conteúdo legível]' })
      }
    }

    messageParts.push({
      type: 'text',
      text: `\nCom base nas ${files.length} cotação(ões) de seguro acima (${fileLabels.join(', ')}), realiza uma análise comparativa detalhada em Português de Portugal:\n\n1. **Resumo de cada cotação**: Prémio anual, coberturas principais, franquias e exclusões relevantes.\n2. **Comparação lado a lado**: Pontos fortes e fracos de cada opção.\n3. **Recomendação final**: Qual a melhor opção para o cliente e porquê.\n\nApresenta a resposta em HTML bem estruturado usando estas classes Tailwind:\n- Títulos de secção: <h3 class="text-lg font-semibold mt-4 mb-2 text-gray-900">\n- Parágrafos: <p class="mb-2 text-gray-700">\n- Listas: <ul class="list-disc pl-5 mb-3 space-y-1"><li class="text-gray-700">\n- Destaque: <strong class="text-gray-900">\n- Secções: <div class="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">\n- Recomendação final: <div class="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">\n- Tabela comparativa (se aplicável): <table class="w-full text-sm border-collapse mb-4"><thead class="bg-gray-100"><tr><th class="border border-gray-200 px-3 py-2 text-left">\nNÃO incluías marcadores de código como \`\`\`html. Apenas HTML puro.`,
    })

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: messageParts }],
    })

    const report = (response.content[0].type === 'text' ? response.content[0].text : '')
      .replace(/```html\n?|\n?```/g, '')
      .replace(/^```\n?|\n?```$/g, '')
      .trim()

    return Response.json({ report })

  } catch (error: any) {
    console.error('[compare-quotes] Error:', error)

    // Mensagens de erro amigáveis para erros comuns do Gemini
    let userMessage = 'Erro ao analisar as cotações. Tente novamente.'
    const errMsg = error?.message ?? ''

    if (errMsg.includes('no pages') || errMsg.includes('No pages')) {
      userMessage = 'O PDF enviado parece estar vazio ou corrompido. Por favor verifique o ficheiro e tente novamente.'
    } else if (errMsg.includes('rate_limit') || errMsg.includes('overloaded')) {
      userMessage = 'Serviço temporariamente sobrecarregado. Tente novamente em alguns segundos.'
    } else if (errMsg.includes('too large') || errMsg.includes('size')) {
      userMessage = 'Ficheiro demasiado grande. Por favor reduza o tamanho e tente novamente.'
    }

    return Response.json(
      { error: userMessage, details: errMsg },
      { status: 500 }
    )
  }
}

export const config: Config = {
  path: '/api/compare-quotes',
}
