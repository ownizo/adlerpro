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
      return Response.json({ error: 'Por favor envie pelo menos uma cotacao' }, { status: 400 })
    }

    if (files.length > 3) {
      return Response.json({ error: 'Por favor envie no maximo 3 cotacoes.' }, { status: 400 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return Response.json({ error: 'GEMINI_API_KEY nao configurada' }, { status: 500 })
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    // Build content parts for Gemini
    const parts: any[] = []

    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer()
      const base64 = Buffer.from(arrayBuffer).toString('base64')

      parts.push({ text: `--- COTACAO: ${file.name} ---` })

      if (file.type.startsWith('image/') || file.type === 'application/pdf') {
        parts.push({
          inlineData: {
            mimeType: file.type as any,
            data: base64,
          },
        })
      } else {
        const text = Buffer.from(arrayBuffer).toString('utf-8')
        parts.push({ text: text.substring(0, 20000) })
      }
    }

    parts.push({
      text: `Com base nestas ${files.length} cotacao(oes) de seguro, realiza uma analise comparativa detalhada:

1. Resumo de cada cotacao: Premio anual, coberturas principais, franquias e exclusoes relevantes.
2. Comparacao lado a lado: Pontos fortes e fracos de cada opcao.
3. Recomendacao final: Qual a melhor opcao para o cliente e porque razao.

Apresenta a resposta em HTML bem estruturado usando estas classes:
- Titulos: <h3 class="text-lg font-semibold mt-4 mb-2">
- Paragrafos: <p class="mb-2 text-gray-700">
- Listas: <ul class="list-disc pl-5 mb-3 space-y-1"><li class="text-gray-700">
- Destaque: <strong class="text-gray-900">
- Seccoes: <div class="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
- Recomendacao: <div class="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">

NAO incluas marcadores de codigo como \`\`\`html. Apenas HTML puro.`,
    })

    const result = await model.generateContent(parts)
    const report = result.response.text().replace(/```html\n?|\n?```/g, '').trim()

    return Response.json({ report })
  } catch (error: any) {
    console.error('Error analyzing quotes:', error)
    return Response.json(
      { error: 'Erro ao analisar cotacoes', details: error.message },
      { status: 500 }
    )
  }
}

export const config: Config = {
  path: '/api/compare-quotes',
}
