import type { Config } from '@netlify/functions'

// Endpoint gratuito da BizAPIs — não requer chave de API
const FREE_ENDPOINT = 'https://apigwws.bizapis.com/free-services/powerUser/seguro-by-matricula'

function normalizePlate(value: string): string {
  return value
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '')
}

// Converte data de YYYY-MM-DD para DD-MM-YYYY (formato esperado pela BizAPIs)
function formatDateForBizAPIs(date: string): string {
  if (/^\d{2}-\d{2}-\d{4}$/.test(date)) return date
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split('-')
    return `${day}-${month}-${year}`
  }
  return date
}

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  try {
    const { plate, date } = await req.json()
    const matricula = normalizePlate(String(plate ?? ''))

    if (!matricula) {
      return Response.json({ error: 'Matrícula inválida' }, { status: 400 })
    }

    if (!date) {
      return Response.json({ error: 'Data é obrigatória para consulta de seguro' }, { status: 400 })
    }

    const formattedDate = formatDateForBizAPIs(String(date))

    // Endpoint gratuito — sem chave de API necessária
    const url = new URL(FREE_ENDPOINT)
    url.searchParams.set('licensePlate', matricula)
    url.searchParams.set('date', formattedDate)

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    })

    const data = await response.json() as any

    if (!response.ok) {
      const errorMsg = data?.message || data?.error || 'Erro ao consultar seguro'
      return Response.json({ error: String(errorMsg) }, { status: response.status })
    }

    // Normalizar a resposta do endpoint gratuito
    const seguroData = data?.data || data

    return Response.json({
      plate: matricula,
      date: formattedDate,
      source: 'bizapis',
      seguro: {
        seguradora: seguroData.entity || seguroData.seguradora || 'N/D',
        nrApolice: seguroData.policy || seguroData.nrApolice || 'N/D',
        dataInicio: seguroData.startDate || seguroData.dataInicio || 'N/D',
        dataFim: seguroData.endDate || seguroData.dataFim || 'N/D',
        estado: 'Ativo',
        matricula: seguroData.licensePlate || matricula,
        requestId: seguroData.requestId || null,
      },
    })
  } catch (error: any) {
    console.error('Error verifying seguro:', error)
    return Response.json(
      { error: 'Erro ao consultar seguro', details: error.message },
      { status: 500 },
    )
  }
}

export const config: Config = {
  path: '/api/verify-seguro',
}
