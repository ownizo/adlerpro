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
    const { nif } = await req.json()

    // 1. Tentar obter o nome real da empresa através de uma API pública (ex: nif.pt)
    let companyName = `Empresa Parceira ${nif} Lda`;
    try {
      // Para funcionar em produção requer chave API do nif.pt, mas deixamos a estrutura preparada
      const nifRes = await fetch(`https://www.nif.pt/?json=1&q=${nif}`);
      if (nifRes.ok) {
        const nifData = await nifRes.json();
        // Se a API retornar dados válidos e não um erro de "Key necessary"
        if (nifData.result === 'success' && nifData.records && nifData.records[nif]) {
          const title = nifData.records[nif].title;
          if (title && !title.includes('Key necessary')) {
            companyName = title;
          }
        }
      }
    } catch (e) {
      console.warn('Não foi possível obter o nome real pelo NIF, a usar nome fictício.');
    }

    // 2. Simulação da chamada à Bizapis para obter dados de risco
    const isHighRisk = nif.startsWith('500');
    const bizapisData = {
      nif,
      nome: companyName,
      estado_atividade: 'Ativa',
      incidentes_judiciais: isHighRisk ? 2 : 0,
      dividas_fiscais: isHighRisk,
      valor_divida: isHighRisk ? 15400.50 : 0,
      risco_credito: isHighRisk ? 'Elevado' : 'Baixo',
      ultima_atualizacao: new Date().toISOString()
    }

    // 3. Chamada à IA da Claude para analisar os dados
    const anthropic = new Anthropic()
    
    const prompt = `Atua como consultor de risco de parceiros. Recebeste os seguintes dados da API Bizapis para o NIF ${nif}:
${JSON.stringify(bizapisData, null, 2)}

Por favor, escreve um relatório de análise de risco em formato HTML (usa apenas tags semânticas como <h3>, <p>, <ul>, <li>, <strong>) analisando a exposição ao risco desta empresa, destacando as dívidas e o risco de crédito. O relatório deve mencionar o nome da empresa.`

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    let report = message.content[0].type === 'text' ? message.content[0].text : ''
    // Remover marcadores de código markdown se presentes (```html ... ``` ou ``` ... ```)
    report = report.replace(/^```(?:html)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

    return Response.json({ report })
  } catch (error: any) {
    console.error('Error analyzing partner:', error)
    return Response.json(
      { error: 'Erro ao analisar parceiro', details: error.message },
      { status: 500 }
    )
  }
}

export const config: Config = {
  path: '/api/analyze-partner',
}
