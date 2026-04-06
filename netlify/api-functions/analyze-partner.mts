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
    const body = await req.json()
    const { nif, cprc, lang } = body
    const isEnglish = lang === 'en'

    if (!nif && !cprc) {
      return Response.json({ error: isEnglish ? 'NIF or CPRC code required' : 'NIF ou código CPRC obrigatório' }, { status: 400 })
    }

    // 1. Obter dados reais via BizAPIs — nifName (identidade fiscal)
    let identityData: any = null
    let cprcData: any = null

    if (nif) {
      try {
        const nifRes = await fetch(
          `https://apigwws.bizapis.com/free-services/powerUser/nifName?service=IDENTITY&nif=${encodeURIComponent(nif)}`
        )
        if (nifRes.ok) {
          const nifJson = await nifRes.json()
          if (nifJson?.data && !nifJson.message?.includes('not valid')) {
            identityData = nifJson.data
          }
        }
      } catch (e) {
        console.warn('BizAPIs nifName falhou:', e)
      }
    }

    // 2. Obter dados do Registo Comercial via CPRC (se fornecido)
    if (cprc) {
      try {
        const cprcRes = await fetch(
          `https://apigwws.bizapis.com/free-services/powerUser/cprc?cprc=${encodeURIComponent(cprc)}`
        )
        if (cprcRes.ok) {
          const cprcJson = await cprcRes.json()
          if (cprcJson?.data && !cprcJson.message) {
            cprcData = cprcJson.data
          }
        }
      } catch (e) {
        console.warn('BizAPIs CPRC falhou:', e)
      }
    }

    // 3. Construir perfil da empresa com dados reais
    const companyName = cprcData?.NomeEmpresa || identityData?.name || `Empresa NIF ${nif}`
    const nipc = cprcData?.NIPC || nif
    const naturezaJuridica = cprcData?.NaturezaJuridica || 'Não disponível'
    const capitalSocial = cprcData?.CapitalSocial?.Montante ? `${cprcData.CapitalSocial.Montante} ${cprcData.CapitalSocial.Moeda || 'EUR'}` : 'Não disponível'
    const dataCriacao = cprcData?.DataCriacao || 'Não disponível'
    const cae = cprcData?.CAE?.Principal || 'Não disponível'
    const situacaoIVA = identityData?.situation || 'Não disponível'
    const enquadramentoIVA = identityData?.inclusion_iva || 'Não disponível'
    const reparticaoFinancas = identityData?.desc_financas || 'Não disponível'
    const representantes = cprcData?.Representantes || []
    const socios = cprcData?.Socios || []
    const factosPendentes = cprcData?.FactosPendentes === true ? 'Sim' : 'Não'
    const penhoraQuotas = cprcData?.PenhoraQuotas ? 'Sim' : 'Não'
    const processoRevitalizacao = cprcData?.ProcessoRevitalizacao ? 'Sim' : 'Não'

    const companyProfile = {
      identificacao: {
        nome: companyName,
        nif: nif || nipc,
        nipc,
        naturezaJuridica,
        capitalSocial,
        dataCriacao,
        cae,
        reparticaoFinancas,
      },
      situacaoFiscal: {
        situacaoIVA,
        enquadramentoIVA,
      },
      governanca: {
        representantes: representantes.slice(0, 5).map((r: any) => ({
          nome: r.Nome,
          cargo: r.Cargo || 'Gerente',
          percentagemCapital: r.PercentagemCapitalDetido,
        })),
        socios: socios.slice(0, 5).map((s: any) => ({
          nome: s.Nome,
          percentagem: s.PercentagemCapitalDetido,
        })),
      },
      alertas: {
        factosPendentes,
        penhoraQuotas,
        processoRevitalizacao,
      },
      fonteDados: {
        bizapisNifName: identityData ? 'Disponível' : 'Não disponível',
        bizapisCPRC: cprcData ? 'Disponível' : 'Não disponível',
        dataConsulta: new Date().toLocaleDateString('pt-PT'),
      },
    }

    // 4. Análise IA com Claude
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return Response.json({ error: 'Serviço de IA não configurado' }, { status: 500 })
    }

    const claude = new Anthropic({ apiKey })

    const prompt = isEnglish
      ? `You are a senior risk consultant at Adler & Rochefort, an insurance brokerage. You have received the following real data for the company "${companyName}" (NIF: ${nif || nipc}) obtained from the Commercial Registry and Tax Authority:

${JSON.stringify(companyProfile, null, 2)}

Produce a professional risk analysis report in semantic HTML (use only <h3>, <h4>, <p>, <ul>, <li>, <strong>, <table>, <tr>, <td>, <th>, <div>). The report must include:

1. **Company Identification** — Full name, NIF/NIPC, legal form, share capital, incorporation date, and CAE with activity description
2. **Tax Status** — Analyse the VAT framework and current tax status
3. **Governance Structure** — Identify shareholders/directors and capital structure
4. **Risk Assessment** — Classify overall risk (Low/Medium/High) with justification based on real data, including:
   - Credit risk (based on share capital and structure)
   - Operational risk (based on legal form and CAE)
   - Active alerts (pending facts, liens, revitalisation proceedings)
5. **Insurance Recommendations** — Suggest insurance types suitable for the company profile (e.g. Professional Liability, Multi-risk, D&O, Cyber)
6. **Conclusion** — Final opinion on viability as a partner/client

Use professional and technical language appropriate to the insurance sector. Do not include code markers. Respond with pure HTML only.`
      : `Actua como consultor sénior de risco da Adler & Rochefort, mediadora de seguros. Recebeste os seguintes dados reais da empresa "${companyName}" (NIF: ${nif || nipc}) obtidos via Registo Comercial e Autoridade Tributária:

${JSON.stringify(companyProfile, null, 2)}

Elabora um relatório profissional de análise de risco em HTML semântico (usa apenas <h3>, <h4>, <p>, <ul>, <li>, <strong>, <table>, <tr>, <td>, <th>, <div>). O relatório deve:

1. **Identificação da Empresa** — Apresentar nome completo, NIF/NIPC, natureza jurídica, capital social, data de constituição e CAE com a descrição da actividade
2. **Situação Fiscal** — Analisar o enquadramento IVA e situação fiscal actual
3. **Estrutura de Governança** — Identificar os sócios/gerentes e a estrutura de capital
4. **Avaliação de Risco** — Classificar o risco global (Baixo/Médio/Elevado) com justificação baseada nos dados reais, incluindo:
   - Risco de crédito (baseado no capital social e estrutura)
   - Risco operacional (baseado na natureza jurídica e CAE)
   - Alertas activos (factos pendentes, penhoras, processos de revitalização)
5. **Recomendações para Seguros** — Sugerir tipos de seguros adequados ao perfil da empresa (ex: RC Profissional, Multirriscos, D&O, Cyber)
6. **Conclusão** — Parecer final sobre a viabilidade como parceiro/cliente

Usa uma linguagem profissional e técnica adequada ao sector segurador. Não incluías marcadores de código. Responde apenas com HTML puro.`

    const aiResponse = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })
    const reportHtml = aiResponse.content[0].type === 'text' ? aiResponse.content[0].text : ''
    const cleanReport = reportHtml.replace(/^```(?:html)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

    return Response.json({
      report: cleanReport,
      companyName,
      companyProfile,
    })
  } catch (error: any) {
    console.error('Error analyzing partner:', error)
    const isRateLimit = error?.message?.includes('rate_limit') || error?.message?.includes('overloaded')
    return Response.json(
      {
        error: isRateLimit
          ? 'Serviço temporariamente sobrecarregado. Tente novamente em alguns segundos.'
          : 'Erro ao analisar parceiro. Verifique o NIF e tente novamente.',
        details: error.message,
      },
      { status: isRateLimit ? 429 : 500 }
    )
  }
}

export const config: Config = {
  path: '/api/analyze-partner',
}
