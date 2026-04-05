import type { Config } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'

// Recebe dados já extraídos (JSON) — não PDFs.
// Devolve { recommendedIndex, reason, justification } para o frontend construir a UI.
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
      `Cotação ${i} (índice ${i}) — ${q.name}:\n${JSON.stringify(q.data, null, 2)}`
    ).join('\n\n')

    const prompt = `Analisa estas ${quotes.length} cotações de seguro e responde APENAS com JSON válido, sem mais nada:

${quoteSummaries}

Responde com este JSON exacto (sem markdown, sem texto extra):
{
  "recommendedIndex": <número 0, 1 ou 2 — índice da cotação recomendada>,
  "reason": "<frase curta e directa com a razão principal da recomendação, em Português de Portugal>",
  "highlights": [
    "<ponto forte da cotação recomendada>",
    "<segundo ponto forte>",
    "<terceiro ponto forte se aplicável>"
  ],
  "warnings": {
    "<índice das outras cotações como string>": "<razão breve porque não é a melhor escolha>"
  }
}`

    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Resposta da IA não contém JSON válido.')

    const result = JSON.parse(jsonMatch[0])
    return Response.json(result)

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
