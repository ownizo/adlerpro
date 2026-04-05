import type { Config } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10MB

type UserFacingError = {
  status: number
  error: string
  details: string
}

function mapExtractPolicyError(error: any): UserFacingError {
  const rawMessage = String(error?.message ?? '').trim()
  const errMsg = rawMessage.toLowerCase()
  const statusFromProvider = Number(error?.status || error?.statusCode || 0)

  if (statusFromProvider === 401 || statusFromProvider === 403) {
    return {
      status: 502,
      error: 'Serviço de IA indisponível neste momento. Tente novamente mais tarde.',
      details: rawMessage || 'Provider authentication error',
    }
  }

  if (
    statusFromProvider === 429 ||
    errMsg.includes('rate_limit') ||
    errMsg.includes('rate limit') ||
    errMsg.includes('overloaded') ||
    errMsg.includes('too many requests')
  ) {
    return {
      status: 429,
      error: 'Serviço temporariamente sobrecarregado. Tente novamente em alguns segundos.',
      details: rawMessage || 'Rate limit',
    }
  }

  if (
    statusFromProvider === 413 ||
    errMsg.includes('too large') ||
    errMsg.includes('file size') ||
    errMsg.includes('request too large') ||
    errMsg.includes('content too large') ||
    errMsg.includes('maximum')
  ) {
    return {
      status: 413,
      error: 'Ficheiro demasiado grande. O limite é 10MB.',
      details: rawMessage || 'Payload too large',
    }
  }

  if (
    errMsg.includes('unsupported') ||
    errMsg.includes('media_type') ||
    errMsg.includes('mime') ||
    errMsg.includes('invalid image')
  ) {
    return {
      status: 400,
      error: 'Formato de ficheiro não suportado. Use PDF, JPG, PNG ou WEBP.',
      details: rawMessage || 'Unsupported media type',
    }
  }

  if (
    errMsg.includes('no pages') ||
    errMsg.includes('empty') ||
    errMsg.includes('corrupt') ||
    errMsg.includes('failed to parse pdf')
  ) {
    return {
      status: 400,
      error: 'O ficheiro enviado parece estar vazio ou corrompido. Verifique e tente novamente.',
      details: rawMessage || 'Invalid PDF content',
    }
  }

  if (
    errMsg.includes('json_parse_failed') ||
    errMsg.includes('json') ||
    errMsg.includes('unexpected token')
  ) {
    return {
      status: 422,
      error: 'Não foi possível extrair os dados da apólice. O documento pode não estar em formato reconhecível.',
      details: rawMessage || 'Unable to parse structured data',
    }
  }

  return {
    status: 500,
    error: 'Erro ao processar o documento. Verifique se o ficheiro é uma apólice de seguro válida.',
    details: rawMessage || 'Unknown processing error',
  }
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
    const file = formData.get('file') as File | null

    if (!file) {
      return Response.json({ error: 'Nenhum ficheiro fornecido.' }, { status: 400 })
    }

    if (file.size <= 0) {
      return Response.json({ error: 'O ficheiro enviado está vazio.' }, { status: 400 })
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json({ error: 'Ficheiro demasiado grande. O limite é 10MB.' }, { status: 413 })
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
    const isSupportedImageType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)

    if (!isPdf && !isImage) {
      return Response.json({ error: 'Formato de ficheiro não suportado. Use PDF, JPG, PNG ou WEBP.' }, { status: 400 })
    }

    if (isImage && !isSupportedImageType) {
      return Response.json({ error: 'Tipo de imagem não suportado. Use JPG, PNG ou WEBP.' }, { status: 400 })
    }

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
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 2048,
      messages: [{ role: 'user', content: messageParts }],
    })

    const contentText = response.content[0].type === 'text' ? response.content[0].text : ''

    // Extrair JSON da resposta
    const jsonMatch = contentText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('json_parse_failed: Não foi possível extrair os dados em formato JSON do documento.')
    }

    let extractedData: unknown
    try {
      extractedData = JSON.parse(jsonMatch[0])
    } catch {
      throw new Error('json_parse_failed: resposta da IA não estava em JSON válido.')
    }

    return Response.json(extractedData)

  } catch (error: any) {
    console.error('[extract-policy] Error:', error)
    const mapped = mapExtractPolicyError(error)

    return Response.json(
      { error: mapped.error, details: mapped.details },
      { status: mapped.status }
    )
  }
}

export const config: Config = {
  path: '/api/extract-policy',
}
