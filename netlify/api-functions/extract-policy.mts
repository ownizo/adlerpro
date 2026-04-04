import type { Config } from '@netlify/functions'
import OpenAI from 'openai'

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

    const arrayBuffer = await file.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    })

    const systemPrompt = `És um especialista em análise de apólices de seguros da Adler & Rochefort.
A tua tarefa é extrair informação estruturada de documentos de apólices de seguro.
Responde APENAS com JSON válido, sem texto adicional, sem marcadores de código.`

    const userPrompt = `Analisa este documento de apólice de seguro e extrai as seguintes informações em formato JSON estrito:
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
Se nao conseguires extrair um campo, usa null para strings e 0 para numeros.`

    let messages: any[]

    if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
      messages = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${file.type};base64,${base64}`,
                detail: 'high',
              },
            },
            { type: 'text', text: userPrompt },
          ],
        },
      ]
    } else {
      const text = Buffer.from(arrayBuffer).toString('utf-8')
      messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${userPrompt}\n\nConteudo do documento:\n${text.substring(0, 30000)}` },
      ]
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages,
      max_tokens: 2048,
      temperature: 0.1,
    })

    const contentText = response.choices[0]?.message?.content || ''
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
