import type { Config } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'

/**
 * Extrai texto de um PDF sem dependências externas.
 * Lê os content streams BT/ET do PDF (funciona para PDFs gerados electronicamente).
 * PDFs digitalizados/scanned não têm texto extraível — nesses casos retorna string vazia.
 */
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
      const arr = m[1]
      const itemRegex = /\(((?:[^()\\]|\\[\s\S])*)\)/g
      let item: RegExpExecArray | null
      while ((item = itemRegex.exec(arr)) !== null) {
        parts.push(decodePdfString(item[1]))
      }
    }

    const quoteRegex = /\(((?:[^()\\]|\\[\s\S])*)\)\s*'/g
    while ((m = quoteRegex.exec(content)) !== null) {
      parts.push('\n' + decodePdfString(m[1]))
    }
  }

  return parts
    .join(' ')
    .replace(/\\n/g, '\n')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .substring(0, 20000)
}

function decodePdfString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
}

async function extractQuoteData(
  client: Anthropic,
  file: File,
  label: string
): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  const buffer = Buffer.from(arrayBuffer)

  const isPdf = file.type === 'application/pdf' ||
    (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)
  const isImage = file.type.startsWith('image/')

  const extractPrompt = `Analisa esta cotação de seguro e extrai os seguintes dados em formato JSON estrito, sem texto adicional:
{
  "insurer": "Nome da Seguradora",
  "policyType": "Tipo de seguro",
  "annualPremium": 0,
  "insuredValue": 0,
  "deductible": 0,
  "coverages": ["Cobertura principal 1", "Cobertura principal 2"],
  "exclusions": ["Exclusão 1", "Exclusão 2"],
  "highlights": ["Ponto forte 1", "Ponto forte 2"],
  "weaknesses": ["Ponto fraco 1"]
}
Usa null para campos não encontrados e 0 para valores numéricos não encontrados. Responde APENAS com o JSON.`

  const messageParts: Anthropic.MessageParam['content'] = []

  if (isPdf && bytes.length > 100) {
    const extracted = extractPdfText(buffer)
    if (extracted.length > 50) {
      messageParts.push({ type: 'text', text: extracted })
    } else {
      messageParts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } } as any)
    }
  } else if (isImage && bytes.length > 100) {
    const mimeType = (file.type || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
    messageParts.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: buffer.toString('base64') } })
  } else {
    const cleanText = buffer.toString('utf-8')
      .replace(/[^\x20-\x7E\u00A0-\uFFFF\n\r\t]/g, ' ')
      .substring(0, 20000)
    messageParts.push({ type: 'text', text: cleanText || '[Ficheiro sem conteúdo legível]' })
  }

  messageParts.push({ type: 'text', text: extractPrompt })

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: messageParts }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  return jsonMatch ? jsonMatch[0] : '{}'
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

    const client = new Anthropic({ apiKey })

    // Fase 1: extrair dados de cada cotação em paralelo
    const labels = files.map((f, i) => `Cotação ${i + 1}: ${f.name}`)
    const extractedResults = await Promise.all(
      files.map((file, i) => extractQuoteData(client, file, labels[i]))
    )

    // Fase 2: chamada final de comparação apenas com os dados estruturados (payload pequeno)
    const comparisonPrompt = `Tens os dados estruturados de ${files.length} cotações de seguro:

${extractedResults.map((data, i) => `${labels[i]}:\n${data}`).join('\n\n')}

Realiza uma análise comparativa detalhada em Português de Portugal:

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
NÃO incluas marcadores de código como \`\`\`html. Apenas HTML puro.`

    const comparisonResponse = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      messages: [{ role: 'user', content: comparisonPrompt }],
    })

    const report = (comparisonResponse.content[0].type === 'text' ? comparisonResponse.content[0].text : '')
      .replace(/```html\n?|\n?```/g, '')
      .replace(/^```\n?|\n?```$/g, '')
      .trim()

    return Response.json({ report })

  } catch (error: any) {
    const errMsg = error?.error?.message ?? error?.message ?? String(error)
    const errStatus = error?.status ?? 500
    console.error('[compare-quotes] status:', errStatus, '| detalhe:', errMsg, '| raw:', error)
    let userMessage = 'Erro ao analisar as cotações. Tente novamente.'

    if (errMsg.includes('no pages') || errMsg.includes('No pages')) {
      userMessage = 'O PDF enviado parece estar vazio ou corrompido. Por favor verifique o ficheiro e tente novamente.'
    } else if (errMsg.includes('rate_limit') || errMsg.includes('overloaded')) {
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
