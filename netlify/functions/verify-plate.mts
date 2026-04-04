import type { Config } from '@netlify/functions'

const REGCHECK_ENDPOINT = 'https://www.regcheck.org.uk/api/reg.asmx/CheckPortugal'
const REGCHECK_USERNAME_FALLBACK = 'ownizo'

function normalizePlate(value: string): string {
  return value
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '')
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

function toFieldValue(field: unknown): string {
  if (!field) return ''
  if (typeof field === 'string' || typeof field === 'number') return String(field)
  if (typeof field === 'object') {
    const candidate = field as { CurrentTextValue?: string | null; CurrentValue?: string | number | null }
    if (candidate.CurrentTextValue) return String(candidate.CurrentTextValue)
    if (candidate.CurrentValue !== undefined && candidate.CurrentValue !== null) return String(candidate.CurrentValue)
  }
  return ''
}

function tagValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return match?.[1]?.trim() ?? ''
}

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const { plate } = await req.json()
    const registration = normalizePlate(String(plate ?? ''))

    if (!registration) {
      return Response.json({ error: 'Matrícula inválida' }, { status: 400 })
    }

    const username = process.env.REGCHECK_USERNAME ?? REGCHECK_USERNAME_FALLBACK
    if (!username) {
      return Response.json(
        { error: 'Serviço de matrículas indisponível. Falta configurar REGCHECK_USERNAME.' },
        { status: 500 },
      )
    }

    const endpoint = new URL(REGCHECK_ENDPOINT)
    endpoint.searchParams.set('RegistrationNumber', registration)
    endpoint.searchParams.set('username', username)

    const apiResponse = await fetch(endpoint, {
      method: 'GET',
    })

    const xml = await apiResponse.text()

    if (!apiResponse.ok) {
      throw new Error(`Erro HTTP na API RegCheck (${apiResponse.status})`)
    }

    if (/username is incorrect/i.test(xml)) {
      return Response.json(
        { error: 'Credenciais inválidas para a API de matrículas.' },
        { status: 500 },
      )
    }

    const vehicleJsonRaw = tagValue(xml, 'vehicleJson')
    const vehicleJsonDecoded = decodeXmlEntities(vehicleJsonRaw)

    let vehicleData: Record<string, unknown> = {}
    if (vehicleJsonDecoded) {
      try {
        vehicleData = JSON.parse(vehicleJsonDecoded) as Record<string, unknown>
      } catch {
        vehicleData = {}
      }
    }

    const description = toFieldValue(vehicleData.Description) || tagValue(xml, 'Description')
    const make = toFieldValue(vehicleData.CarMake) || toFieldValue(vehicleData.MakeDescription)
    const model = toFieldValue(vehicleData.CarModel) || toFieldValue(vehicleData.ModelDescription)

    if (!description && !make && !model) {
      return Response.json(
        { error: 'Matrícula não encontrada em Portugal.' },
        { status: 404 },
      )
    }

    return Response.json({
      plate: registration,
      source: 'regcheck',
      vehicle: {
        description,
        make,
        model,
        registrationYear: toFieldValue(vehicleData.RegistrationYear),
        manufactureYearFrom: toFieldValue(vehicleData.ManufactureYearFrom),
        manufactureYearTo: toFieldValue(vehicleData.ManufactureYearTo),
        fuelType: toFieldValue(vehicleData.FuelType),
        transmission: toFieldValue(vehicleData.Transmission),
        bodyStyle: toFieldValue(vehicleData.BodyStyle),
        engineSize: toFieldValue(vehicleData.EngineSize),
        numberOfDoors: toFieldValue(vehicleData.NumberOfDoors),
        numberOfSeats: toFieldValue(vehicleData.NumberOfSeats),
        abiCode: toFieldValue(vehicleData.ABICode),
      },
    })
  } catch (error: any) {
    console.error('Error verifying plate:', error)
    return Response.json(
      { error: 'Erro ao consultar matrícula', details: error.message },
      { status: 500 },
    )
  }
}

export const config: Config = {
  path: '/api/verify-plate',
}
