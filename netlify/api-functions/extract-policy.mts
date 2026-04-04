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
      return Response.json({ error: 'Nenhum ficheiro fornecido' }, { status: 400 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return Response.json({ error: 'GEMINI_API_KEY nao configurada' }, { status: 500 })
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    const arrayBuffer = await file.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    const prompt = `Analisa este documento de apolice de seguro e extrai as seguintes informacoes em formato JSON estrito, sem texto adicional, sem marcadores de codigo:
{
  "type": "tipo de seguro: auto | health | home | life | liability | other",
  "insurer": "Nome da Seguradora",
  "policyNumber": "Numero da Apolice",
  "startDate": "Data de Inicio (YYYY-MM-DD)",
  "endDate": "Data de Fim (YYYY-MM-DD)",
  "annualPremium": 0,
  "insuredValue": 0,
  "deductible": 0,
  "coverages": ["Cobertura 1 (Capital: X euros, Franquia: Y euros)", "Cobertura 2"],
  "exclusions": ["Exclusao 1", "Exclusao 2"]
}
Se nao conseguires extrair um campo, usa null para strings e 0 para numeros. Responde APENAS com o JSON, sem mais nada.`

    let result

    if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
      result = await model.generateContent([
        {
          inlineData: {
            mimeType: file.type as any,
            data: base64,
          },
        },
        prompt,
      ])
    } else {
      const text = Buffer.from(arrayBuffer).toString('utf-8')
      result = await model.generateContent([
        `${prompt}\n\nConteudo do documento:\n${text.substring(0, 30000)}`,
      ])
    }

    const contentText = result.response.text()
    const jsonMatch = contentText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('Nao foi possivel extrair os dados em formato JSON.')
    }

    const extractedData = JSON.parse(jsonMatch[0])
    return Response.json(extractedData)
  } catch (error: any) {
    console.error('Error extracting policy:', error)
    return Response.json(
      { error: 'Erro ao processar o documento. Verifique se o ficheiro e uma apolice de seguro valida.', details: error.message },
      { status: 500 }
    )
  }
}

export const config: Config = {
  path: '/api/extract-policy',
}
