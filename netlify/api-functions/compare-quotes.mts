import type { Config } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'

// Recebe dados já extraídos (JSON) — não PDFs.
// O frontend usa /api/extract-policy por cada ficheiro e envia aqui apenas os resultados.
export default async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await req.json()
    const quotes: Array<{ name: string; data: Record<string, any> }> = body.quotes ?? []

    if (quotes.length < 2) {
      return Response.json({ error: 'São necessárias pelo menos 2 cotações para comparar.' }, { status: 400 })
    }
    if (quotes.length > 3) {
      return Response.json({ error: 'Máximo de 3 cotações.' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return Response.json({ error: 'Serviço de IA não configurado. Contacte o suporte.' }, { status: 500 })
    }

    const quoteSummaries = quotes.map((q, i) =>
      `Cotação ${i + 1} — ${q.name}:\n${JSON.stringify(q.data, null, 2)}`
    ).join('\n\n')

    const prompt = `Tens os dados estruturados de ${quotes.length} cotações de seguro:

${quoteSummaries}

Compara estas cotações em Português de Portugal. Para cada uma apresenta um resumo claro com seguradora, prémio anual, coberturas principais e exclusões. Depois faz uma comparação directa e dá uma recomendação fundamentada.

Responde em HTML usando estas classes Tailwind:
- Secções: <div class="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
- Títulos: <h3 class="text-lg font-semibold mt-4 mb-2 text-gray-900">
- Parágrafos: <p class="mb-2 text-gray-700">
- Listas: <ul class="list-disc pl-5 mb-3 space-y-1"><li class="text-gray-700">
- Destaques positivos: <span class="text-green-700 font-semibold">
- Destaques negativos: <span class="text-red-700 font-semibold">
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
    console.error('[compare-quotes] status:', errStatus, '| detalhe:', errMsg)
    return Response.json(
      { error: 'Erro ao comparar as cotações. Tente novamente.', details: errMsg, status: errStatus },
      { status: 500 }
    )
  }
}

export const config: Config = {
  path: '/api/compare-quotes',
  timeout: 120,
}
