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
    const files = formData.getAll('quotes') as File[]

    if (!files || files.length === 0) {
      return Response.json({ error: 'Por favor envie até 3 cotações (ficheiros)' }, { status: 400 })
    }
    
    if (files.length > 3) {
      return Response.json({ error: 'Por favor envie no máximo 3 cotações.' }, { status: 400 })
    }

    const contentBlocks: any[] = []
    
    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer()
      const base64 = Buffer.from(arrayBuffer).toString('base64')

      if (file.type.startsWith('image/')) {
        contentBlocks.push({
          type: 'text',
          text: `--- COTAÇÃO (${file.name}) ---`
        })
        contentBlocks.push({
          type: 'image_url',
          image_url: {
            url: `data:${file.type};base64,${base64}`
          }
        })
      } else {
        // Fallback to text for PDF or other documents. 
        // Em produção, deve-se usar uma biblioteca de PDF-to-Text antes do envio para a OpenAI se não suportar nativo no chat completions,
        // mas para teste assumimos que o conteúdo textual vai ser legível ou é um ficheiro de texto
        const text = Buffer.from(arrayBuffer).toString('utf-8')
        contentBlocks.push({
          type: 'text',
          text: `--- COTAÇÃO (${file.name}) ---\n${text.substring(0, 20000)}\n\n`
        })
      }
    }

    const openai = new OpenAI()
    
    contentBlocks.push({
      type: 'text',
      text: `Com base nestas cotações, por favor:
1. Extrai os pontos principais de cada uma (Prémio, Coberturas principais, Franquias, Exclusões).
2. Compara as cotações destacando prós e contras de cada.
3. Apresenta uma conclusão final indicando qual é a melhor opção para o cliente e porquê.

Apresenta a resposta num formato HTML bem estruturado usando as tags semânticas (<div class="mb-4">, <h3>, <p>, <ul class="list-disc pl-5">, <li>, <strong>) para fácil leitura.
Não inclua \`\`\`html no output. Apenas o HTML cru.`
    })

    const response = await openai.chat.completions.create({
      model: 'gpt-4o', // Modelo capaz de ler imagem e texto longo
      messages: [
        {
          role: 'system',
          content: 'Atuas como um consultor de seguros especializado (Adler & Rochefort). O cliente enviou documentos com cotações de seguros.'
        },
        {
          role: 'user',
          content: contentBlocks
        }
      ],
      max_tokens: 2000
    })

    const report = response.choices[0]?.message?.content || ''

    return Response.json({ report: report.replace(/```html\n?|\n?```/g, '') })
  } catch (error: any) {
    console.error('Error analyzing quotes:', error)
    return Response.json(
      { error: 'Erro ao analisar cotações', details: error.message },
      { status: 500 }
    )
  }
}

export const config: Config = {
  path: '/api/compare-quotes',
}
