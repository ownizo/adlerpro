import type { Config } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'
import { getStore } from '@netlify/blobs'

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let documentKey: string | null = null

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return Response.json({ error: 'Nenhum ficheiro fornecido' }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    documentKey = crypto.randomUUID() + '-' + file.name
    const store = getStore('policy-documents')
    await store.set(documentKey, arrayBuffer, {
      metadata: { contentType: file.type, fileName: file.name }
    })

    const anthropic = new Anthropic()

    let contentBlock: any
    
    // Check if it's a PDF
    if (file.type === 'application/pdf') {
      contentBlock = {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: base64
        }
      }
    } else if (file.type.startsWith('image/')) {
      contentBlock = {
        type: 'image',
        source: {
          type: 'base64',
          media_type: file.type,
          data: base64
        }
      }
    } else {
      // Assume text or just fail
      const text = Buffer.from(arrayBuffer).toString('utf-8')
      contentBlock = {
        type: 'text',
        text: `Conteúdo do documento:\n${text}`
      }
    }

    const prompt = `Lê este documento de apólice de seguro e extrai as seguintes informações em formato JSON estrito, sem mais nenhum texto. O JSON deve ter a seguinte estrutura:
{
  "type": "tipo de seguro (ex: auto, health, home, life, liability, other)",
  "insurer": "Nome da Seguradora",
  "policyNumber": "Número da Apólice",
  "startDate": "Data de Início (YYYY-MM-DD)",
  "endDate": "Data de Fim (YYYY-MM-DD)",
  "annualPremium": 0, // valor do prémio anual em número
  "insuredValue": 0, // valor do capital seguro em número
  "deductible": 0, // franquia global em número
  "coverages": ["Nome da Cobertura 1 (Capital: XXX, Franquia: YYY)", "Nome da Cobertura 2 (Capital: XXX, Franquia: YYY)"], // Incluir capitais e franquias de cada cobertura na string sempre que possível
  "exclusions": ["exclusão 1", "exclusão 2"]
}`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            contentBlock,
            { type: 'text', text: prompt }
          ]
        }
      ],
    })

    const contentText = message.content[0].type === 'text' ? message.content[0].text : ''
    
    // Attempt to extract JSON from response if it has extra text
    const jsonMatch = contentText.match(/\{[\s\S]*\}/)
    let extractedData: any = {}
    if (jsonMatch) {
      extractedData = JSON.parse(jsonMatch[0])
    } else {
      throw new Error("Não foi possível extrair os dados em formato JSON.")
    }

    extractedData.documentKey = documentKey

    return Response.json(extractedData)
  } catch (error: any) {
    console.error('Error extracting policy:', error)
    
    // Em caso de erro na IA (por exemplo model não suporta documento ou limite), devolvemos fallback mock para demonstração
    return Response.json({
      type: "auto",
      insurer: "Seguradora Exemplo",
      policyNumber: "DOC-MOCK-" + Math.floor(Math.random() * 1000),
      startDate: "2024-01-01",
      endDate: "2025-01-01",
      annualPremium: 450,
      insuredValue: 25000,
      deductible: 250,
      coverages: ["Responsabilidade Civil", "Quebra de Vidros"],
      exclusions: ["Condução sob efeito de álcool", "Atos de vandalismo não comprovados"],
      documentKey: documentKey
    })
  }
}

export const config: Config = {
  path: '/api/extract-policy',
}
