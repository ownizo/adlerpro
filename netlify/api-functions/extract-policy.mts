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
    const file = formData.get('file') as File | null

    if (!file) {
      return Response.json({ error: 'Nenhum ficheiro fornecido.' }, { status: 400 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return Response.json({ error: 'Serviço de IA não configurado. Contacte o suporte.' }, { status: 500 })
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    // gemini-2.0-flash é mais estável para extracção de documentos
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

    const arrayBuffer = await file.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)

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

    // Verificar se é PDF válido (começa com %PDF)
    const isPdf = file.type === 'application/pdf' ||
      (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)

    const isImage = file.type.startsWith('image/')

    let result

    if ((isPdf || isImage) && bytes.length > 100) {
      const base64 = Buffer.from(arrayBuffer).toString('base64')
      const mimeType = isPdf ? 'application/pdf' : (file.type || 'image/jpeg')
      result = await model.generateContent([
        {
          inlineData: {
            mimeType: mimeType as any,
            data: base64,
          },
        },
        prompt,
      ])
    } else {
      // Texto ou ficheiro não reconhecido
      const text = Buffer.from(arrayBuffer).toString('utf-8')
      const cleanText = text.replace(/[^\x20-\x7E\u00A0-\uFFFF\n\r\t]/g, ' ').substring(0, 30000)
      result = await model.generateContent([
        `${prompt}\n\nConteúdo do documento:\n${cleanText}`,
      ])
    }

    const contentText = result.response.text()

    // Extrair JSON da resposta (pode vir com texto à volta)
    const jsonMatch = contentText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('Não foi possível extrair os dados em formato JSON do documento.')
    }

    const extractedData = JSON.parse(jsonMatch[0])
    return Response.json(extractedData)

  } catch (error: any) {
    console.error('[extract-policy] Error:', error)

    let userMessage = 'Erro ao processar o documento. Verifique se o ficheiro é uma apólice de seguro válida.'
    const errMsg = error?.message ?? ''

    if (errMsg.includes('no pages') || errMsg.includes('No pages')) {
      userMessage = 'O PDF enviado parece estar vazio ou corrompido. Por favor verifique o ficheiro.'
    } else if (errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED')) {
      userMessage = 'Limite de análises atingido. Tente novamente em alguns minutos.'
    } else if (errMsg.includes('too large') || errMsg.includes('size')) {
      userMessage = 'Ficheiro demasiado grande. Por favor reduza o tamanho e tente novamente.'
    } else if (errMsg.includes('JSON')) {
      userMessage = 'Não foi possível extrair os dados da apólice. O documento pode não estar em formato reconhecível.'
    }

    return Response.json(
      { error: userMessage, details: errMsg },
      { status: 500 }
    )
  }
}

export const config: Config = {
  path: '/api/extract-policy',
}
