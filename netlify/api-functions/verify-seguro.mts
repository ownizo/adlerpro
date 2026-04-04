import type { Config } from '@netlify/functions'

const SEGURO_ENDPOINT = 'https://apigwws.bizapis.com/v2/documents/seguro-by-matricula'

function normalizePlate(value: string): string {
  return value
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '')
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

    const apiKey = process.env.BIZAPIS_API_KEY
    if (!apiKey) {
      console.warn('BIZAPIS_API_KEY não configurada. A devolver dados de seguro simulados para demonstração.')
      return Response.json({
        plate: matricula,
        date,
        source: 'bizapis (mock)',
        seguro: {
          seguradora: 'Seguradora Simulada S.A.',
          nrApolice: `SIM-${Math.floor(Math.random() * 10000000).toString().padStart(7, '0')}`,
          dataInicio: new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().split('T')[0],
          dataFim: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0],
          estado: 'Ativo',
          matricula: matricula,
          marca: 'Marca Simulada',
          modelo: 'Modelo Simulado',
          nota: 'Dados gerados localmente pois a BIZAPIS_API_KEY não está configurada.'
        },
      })
    }

    const response = await fetch(SEGURO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        matricula,
        data: date,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      const errorMsg = typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>).message || (data as Record<string, unknown>).error || 'Erro ao consultar seguro'
        : 'Erro ao consultar seguro'
      return Response.json({ error: String(errorMsg) }, { status: response.status })
    }

    return Response.json({
      plate: matricula,
      date,
      source: 'bizapis',
      seguro: data,
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
