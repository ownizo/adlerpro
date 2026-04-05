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
    const file = formData.get('file') as File | null

    if (!file) {
      return Response.json({ error: 'Nenhum ficheiro fornecido.' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return Response.json({ error: 'Serviço de IA não configurado. Contacte o suporte.' }, { status: 500 })
    }

    const client = new Anthropic({ apiKey })

    const arrayBuffer = await file.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    const isPdf = file.type === 'application/pdf' ||
      (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)
    const isImage = file.type.startsWith('image/')

    const prompt = `Analisa este documento de apólice de seguro e extrai as seguintes informações em formato JSON estrito, sem texto adicional, sem marcadores de código:
{
  "type": "tipo de seguro: auto | health | home | life | liability | other",
  "insurer": "Nome da Seguradora",
  "policyNumber": "Número da Apólice",
  "startDate": "Data de Início (YYYY-MM-DD)",
  "endDate": "Data de Fim (YYYY-MM-DD)",
  "annualPremium": 0,
  "insuredValue": 0,
  "deductible": 0,
  "coverages": ["Cobertura 1 (Capital: X euros, Franquia: Y euros)", "Cobertura 2"],
  "exclusions": ["Exclusão 1", "Exclusão 2"]
}
Se não conseguires extrair um campo, usa null para strings e 0 para números. Responde APENAS com o JSON, sem mais nada.`

    let messageParts: Anthropic.MessageParam['content']

    if (isPdf && bytes.length > 100) {
      messageParts = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } } as any,
        { type: 'text', text: prompt },
      ]
    } else if (isImage && bytes.length > 100) {
      const mimeType = (file.type || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
      messageParts = [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
        { type: 'text', text: prompt },
      ]
    } else {
      const text = Buffer.from(arrayBuffer).toString('utf-8')
      const cleanText = text.replace(/[^\x20-\x7E\u00A0-\uFFFF\n\r\t]/g, ' ').substring(0, 30000)
      messageParts = [
        { type: 'text', text: `${prompt}\n\nConteúdo do documento:\n${cleanText}` },
      ]
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: messageParts }],
    })

    const contentText = response.content[0].type === 'text' ? response.content[0].text : ''

    // Extrair JSON da resposta
    const jsonMatch = contentText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('Não foi possível extrair os dados em formato JSON do documento.')
    }

    const extractedData = JSON.parse(jsonMatch[0])
    return Response.json(extractedData)

  } catch (error: any) {
    const errMsg = error?.error?.message ?? error?.message ?? String(error)
    const errStatus = error?.status ?? 500
    console.error('[extract-policy] status:', errStatus, '| detalhe:', errMsg, '| raw:', error)
    let userMessage = 'Erro ao processar o documento. Verifique se o ficheiro é uma apólice de seguro válida.'

    if (errMsg.includes('no pages') || errMsg.includes('No pages')) {
      userMessage = 'O PDF enviado parece estar vazio ou corrompido. Por favor verifique o ficheiro.'
    } else if (errMsg.includes('rate_limit') || errMsg.includes('overloaded')) {
      userMessage = 'Serviço temporariamente sobrecarregado. Tente novamente em alguns segundos.'
    } else if (errMsg.includes('too large') || errMsg.includes('size')) {
      userMessage = 'Ficheiro demasiado grande. Por favor reduza o tamanho e tente novamente.'
    } else if (errMsg.includes('JSON')) {
      userMessage = 'Não foi possível extrair os dados da apólice. O documento pode não estar em formato reconhecível.'
    }

    return Response.json(
      { error: userMessage, details: errMsg, status: errStatus },
      { status: 500 }
    )
  }
}

export const config: Config = {
  path: '/api/extract-policy',
}
