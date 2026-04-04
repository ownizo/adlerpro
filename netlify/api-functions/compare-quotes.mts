import type { Config } from '@netlify/functions'
import { GoogleGenerativeAI } from '@google/generative-ai'

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

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return Response.json({ error: 'Serviço de IA não configurado. Contacte o suporte.' }, { status: 500 })
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    // gemini-2.0-flash é mais estável para documentos; gemini-2.5-flash como fallback
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

    // Build content parts for Gemini
    const parts: any[] = []
    const fileLabels: string[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const label = `Cotação ${i + 1}: ${file.name}`
      fileLabels.push(label)

      const arrayBuffer = await file.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)

      parts.push({ text: `\n--- ${label} ---\n` })

      // Verificar se é PDF válido (começa com %PDF)
      const isPdf = file.type === 'application/pdf' ||
        (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)

      // Verificar se é imagem
      const isImage = file.type.startsWith('image/')

      if (isPdf && bytes.length > 100) {
        // PDF válido — enviar como inlineData
        const base64 = Buffer.from(arrayBuffer).toString('base64')
        parts.push({
          inlineData: {
            mimeType: 'application/pdf',
            data: base64,
          },
        })
      } else if (isImage && bytes.length > 100) {
        // Imagem — enviar como inlineData
        const base64 = Buffer.from(arrayBuffer).toString('base64')
        const mimeType = file.type || 'image/jpeg'
        parts.push({
          inlineData: {
            mimeType,
            data: base64,
          },
        })
      } else {
        // Texto ou ficheiro não reconhecido — enviar como texto
        const text = Buffer.from(arrayBuffer).toString('utf-8')
        const cleanText = text.replace(/[^\x20-\x7E\u00A0-\uFFFF\n\r\t]/g, ' ').substring(0, 30000)
        if (cleanText.trim().length > 0) {
          parts.push({ text: cleanText })
        } else {
          parts.push({ text: '[Ficheiro sem conteúdo legível]' })
        }
      }
    }

    parts.push({
      text: `\nCom base nas ${files.length} cotação(ões) de seguro acima (${fileLabels.join(', ')}), realiza uma análise comparativa detalhada em Português de Portugal:

1. **Resumo de cada cotação**: Prémio anual, coberturas principais, franquias e exclusões relevantes.
2. **Comparação lado a lado**: Pontos fortes e fracos de cada opção.
3. **Recomendação final**: Qual a melhor opção para o cliente e porquê.

Apresenta a resposta em HTML bem estruturado usando estas classes Tailwind:
- Títulos de secção: <h3 class="text-lg font-semibold mt-4 mb-2 text-gray-900">
- Parágrafos: <p class="mb-2 text-gray-700">
- Listas: <ul class="list-disc pl-5 mb-3 space-y-1"><li class="text-gray-700">
- Destaque: <strong class="text-gray-900">
- Secções: <div class="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
- Recomendação final: <div class="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">
- Tabela comparativa (se aplicável): <table class="w-full text-sm border-collapse mb-4"><thead class="bg-gray-100"><tr><th class="border border-gray-200 px-3 py-2 text-left">

NÃO incluas marcadores de código como \`\`\`html. Apenas HTML puro.`,
    })

    const result = await model.generateContent(parts)
    const report = result.response.text()
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
    } else if (errMsg.includes('GEMINI_API_KEY') || errMsg.includes('API key')) {
      userMessage = 'Serviço de IA temporariamente indisponível. Contacte o suporte.'
    } else if (errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED')) {
      userMessage = 'Limite de análises atingido. Tente novamente em alguns minutos.'
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
