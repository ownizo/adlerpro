import type { IpmaWarning } from './types'

export interface OwmCurrent {
  temp: number
  feelsLike: number
  humidity: number
  description: string
  icon: string
  windSpeed: number
  cityName: string
}

export interface WeatherData {
  owm: OwmCurrent | null
  warnings: IpmaWarning[]
  idAreaAviso: string | null
}

export async function getWeatherForLocation(
  lat: number,
  lon: number,
  distrito: string
): Promise<WeatherData> {
  const res = await fetch('/api/weather', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lon, distrito }),
  })
  if (!res.ok) throw new Error('Erro ao obter dados meteorológicos')
  const data = await res.json()

  let owm: OwmCurrent | null = null
  if (data.owm) {
    owm = {
      temp: Math.round(data.owm.main?.temp ?? 0),
      feelsLike: Math.round(data.owm.main?.feels_like ?? 0),
      humidity: data.owm.main?.humidity ?? 0,
      description: data.owm.weather?.[0]?.description ?? '',
      icon: data.owm.weather?.[0]?.icon ?? '',
      // Convert m/s → km/h
      windSpeed: Math.round((data.owm.wind?.speed ?? 0) * 3.6),
      cityName: data.owm.name ?? '',
    }
  }

  return { owm, warnings: data.warnings ?? [], idAreaAviso: data.idAreaAviso ?? null }
}

export function getSeverityColor(level: IpmaWarning['awarenessLevelID']): string {
  switch (level) {
    case 'green':  return '#16a34a'
    case 'yellow': return '#ca8a04'
    case 'orange': return '#ea580c'
    case 'red':    return '#dc2626'
    default:       return '#6b7280'
  }
}

export function getSeverityBg(level: IpmaWarning['awarenessLevelID']): string {
  switch (level) {
    case 'green':  return '#f0fdf4'
    case 'yellow': return '#fefce8'
    case 'orange': return '#fff7ed'
    case 'red':    return '#fef2f2'
    default:       return '#f9fafb'
  }
}

export function getAlertIcon(awarenessTypeName: string): string {
  const name = awarenessTypeName.toLowerCase()
  if (name.includes('precipita') || name.includes('chuva')) return '🌧'
  if (name.includes('vento'))                                return '💨'
  if (name.includes('neve'))                                 return '❄️'
  if (name.includes('trovoada') || name.includes('electri')) return '⚡'
  if (name.includes('granizo'))                              return '🌨'
  if (name.includes('ondas') || name.includes('agitação'))   return '🌊'
  if (name.includes('nevoeiro') || name.includes('visibili')) return '🌫'
  if (name.includes('temp') || name.includes('calor') || name.includes('frio')) return '🌡'
  return '⚠️'
}

export function owmIconUrl(icon: string): string {
  return `https://openweathermap.org/img/wn/${icon}@2x.png`
}
