import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useState } from 'react'
import { Sun, CloudRain, Cloud, CloudSun, CloudLightning, Wind, Droplets, MapPin, AlertTriangle } from 'lucide-react'

export const Route = createFileRoute('/weather-alerts')({
  component: WeatherAlertsPage,
})

const IPMA_LOCATIONS = [
  { id: 1010500, name: 'Aveiro', district: 'Aveiro', lat: 40.6413, lon: -8.6535 },
  { id: 1020500, name: 'Beja', district: 'Beja', lat: 38.0200, lon: -7.8700 },
  { id: 1030300, name: 'Braga', district: 'Braga', lat: 41.5475, lon: -8.4227 },
  { id: 1040200, name: 'Bragança', district: 'Bragança', lat: 41.8076, lon: -6.7606 },
  { id: 1050200, name: 'Castelo Branco', district: 'Castelo Branco', lat: 39.8217, lon: -7.4957 },
  { id: 1060300, name: 'Coimbra', district: 'Coimbra', lat: 40.2081, lon: -8.4194 },
  { id: 1070500, name: 'Évora', district: 'Évora', lat: 38.5701, lon: -7.9104 },
  { id: 1080500, name: 'Faro', district: 'Faro', lat: 37.0146, lon: -7.9331 },
  { id: 1081505, name: 'Portimão', district: 'Faro', lat: 37.1369, lon: -8.5380 },
  { id: 1090700, name: 'Guarda', district: 'Guarda', lat: 40.5379, lon: -7.2647 },
  { id: 1090821, name: 'Covilhã', district: 'Castelo Branco', lat: 40.2800, lon: -7.5050 },
  { id: 1100900, name: 'Leiria', district: 'Leiria', lat: 39.7473, lon: -8.8069 },
  { id: 1110600, name: 'Lisboa', district: 'Lisboa', lat: 38.7660, lon: -9.1286 },
  { id: 1121400, name: 'Portalegre', district: 'Portalegre', lat: 39.2900, lon: -7.4200 },
  { id: 1131200, name: 'Porto', district: 'Porto', lat: 41.1580, lon: -8.6294 },
  { id: 1141600, name: 'Santarém', district: 'Santarém', lat: 39.2000, lon: -8.7400 },
  { id: 1151200, name: 'Setúbal', district: 'Setúbal', lat: 38.5246, lon: -8.8856 },
  { id: 1151300, name: 'Sines', district: 'Setúbal', lat: 37.9560, lon: -8.8643 },
  { id: 1160900, name: 'Viana do Castelo', district: 'Viana do Castelo', lat: 41.6952, lon: -8.8365 },
  { id: 1171400, name: 'Vila Real', district: 'Vila Real', lat: 41.3053, lon: -7.7440 },
  { id: 1182300, name: 'Viseu', district: 'Viseu', lat: 40.6566, lon: -7.9122 },
  { id: 2310300, name: 'Funchal', district: 'Madeira', lat: 32.6669, lon: -16.9241 },
  { id: 3410100, name: 'Ponta Delgada', district: 'Açores', lat: 37.7412, lon: -25.6756 },
  { id: 1030300, name: 'Guimarães', district: 'Braga', lat: 41.4430, lon: -8.2960 },
  { id: 1030300, name: 'Barcelos', district: 'Braga', lat: 41.5380, lon: -8.6180 },
  { id: 1110600, name: 'Cascais', district: 'Lisboa', lat: 38.6979, lon: -9.4215 },
  { id: 1110600, name: 'Sintra', district: 'Lisboa', lat: 38.7980, lon: -9.3880 },
  { id: 1110600, name: 'Amadora', district: 'Lisboa', lat: 38.7540, lon: -9.2310 },
  { id: 1151200, name: 'Almada', district: 'Setúbal', lat: 38.6780, lon: -9.1570 },
  { id: 1151200, name: 'Barreiro', district: 'Setúbal', lat: 38.6630, lon: -9.0720 },
  { id: 1060300, name: 'Figueira da Foz', district: 'Coimbra', lat: 40.1510, lon: -8.8600 },
  { id: 1100900, name: 'Caldas da Rainha', district: 'Leiria', lat: 39.4010, lon: -9.1340 },
  { id: 1131200, name: 'Gondomar', district: 'Porto', lat: 41.1440, lon: -8.5320 },
  { id: 1131200, name: 'Maia', district: 'Porto', lat: 41.2290, lon: -8.6200 },
  { id: 1131200, name: 'Matosinhos', district: 'Porto', lat: 41.1840, lon: -8.6890 },
  { id: 1131200, name: 'Gaia', district: 'Porto', lat: 41.1280, lon: -8.6120 },
]

const WEATHER_DESCRIPTIONS: Record<number, string> = {
  1: 'Céu limpo', 2: 'Céu pouco nublado', 3: 'Céu parcialmente nublado',
  4: 'Céu muito nublado', 5: 'Céu nublado', 6: 'Aguaceiros',
  7: 'Aguaceiros fracos', 8: 'Aguaceiros fortes', 9: 'Chuva fraca',
  10: 'Chuva moderada', 11: 'Chuva forte', 12: 'Nevoeiro',
  13: 'Granizo', 14: 'Neve fraca', 15: 'Neve forte',
  16: 'Trovoada', 17: 'Trovoada com granizo', 18: 'Nublado',
  19: 'Aguaceiros e trovoada', 20: 'Chuva e trovoada', 23: 'Trovoada',
}

function getWeatherIcon(id: number) {
  if (id === 1 || id === 2) return <Sun className="w-9 h-9 text-yellow-500" />
  if (id === 3 || id === 4 || id === 5 || id === 18) return <CloudSun className="w-9 h-9 text-gray-500" />
  if (id >= 6 && id <= 11) return <CloudRain className="w-9 h-9 text-blue-500" />
  if (id === 16 || id === 17 || id === 19 || id === 20 || id === 23) return <CloudLightning className="w-9 h-9 text-yellow-600" />
  return <Cloud className="w-9 h-9 text-gray-500" />
}

function getRiskLabel(precipitaProb: string, windClass: number) {
  const prob = parseFloat(precipitaProb || '0')
  if (windClass >= 4 || prob >= 80) return { label: 'Risco Elevado', color: '#dc2626' }
  if (windClass >= 3 || prob >= 60) return { label: 'Atenção', color: '#d97706' }
  if (windClass >= 2 || prob >= 40) return { label: 'Aviso', color: '#C8961A' }
  return { label: 'Normal', color: '#16a34a' }
}

function findLocationByName(query: string) {
  const q = query.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const exact = IPMA_LOCATIONS.find(loc =>
    loc.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === q
  )
  if (exact) return exact
  const partial = IPMA_LOCATIONS.find(loc =>
    loc.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q) ||
    q.includes(loc.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  )
  if (partial) return partial
  return IPMA_LOCATIONS.find(loc =>
    loc.district.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q)
  ) || null
}

function WeatherAlertsPage() {
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [weatherData, setWeatherData] = useState<any[] | null>(null)
  const [foundLocation, setFoundLocation] = useState<(typeof IPMA_LOCATIONS)[0] | null>(null)
  const [error, setError] = useState('')
  const [suggestions, setSuggestions] = useState<typeof IPMA_LOCATIONS>([])

  const handleInputChange = (value: string) => {
    setAddress(value)
    if (value.length >= 2) {
      const q = value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      const matches = IPMA_LOCATIONS.filter(loc =>
        loc.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q)
      ).filter((loc, idx, arr) => arr.findIndex(l => l.id === loc.id && l.name === loc.name) === idx).slice(0, 6)
      setSuggestions(matches)
    } else {
      setSuggestions([])
    }
  }

  const fetchWeatherForLocation = async (location: (typeof IPMA_LOCATIONS)[0]) => {
    setLoading(true)
    setError('')
    setWeatherData(null)
    setSuggestions([])
    setFoundLocation(location)
    try {
      const res = await fetch(`https://api.ipma.pt/open-data/forecast/meteorology/cities/daily/${location.id}.json`)
      if (!res.ok) throw new Error(`Não foi possível obter dados para ${location.name}`)
      const data = await res.json()
      const sorted = (data.data || [])
        .sort((a: any, b: any) => new Date(a.forecastDate).getTime() - new Date(b.forecastDate).getTime())
        .slice(0, 7)
      setWeatherData(sorted)
    } catch (err: any) {
      setError(err.message || 'Erro ao obter dados meteorológicos')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!address.trim()) return
    const location = findLocationByName(address)
    if (!location) {
      setError(`Localidade "${address}" não encontrada. Tente com o nome do distrito (ex: Lisboa, Porto, Faro) ou seleccione uma sugestão.`)
      return
    }
    await fetchWeatherForLocation(location)
  }

  return (
    <AppLayout>
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '1.5rem 1rem' }}>
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '1.75rem', fontWeight: 700, color: '#111111', margin: '0 0 0.5rem' }}>
            Alertas Meteorológicos
          </h1>
          <p style={{ color: '#666666', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>
            Consulte as previsões do tempo por localidade para avaliar o risco meteorológico associado a propriedades e activos segurados. Dados fornecidos pelo <strong>IPMA</strong>.
          </p>
        </div>

        <div style={{ background: '#fff', border: '1.5px solid #111', borderRadius: '4px', padding: '1.5rem', marginBottom: '2rem', position: 'relative' }}>
          <form onSubmit={handleSubmit}>
            <label style={{ display: 'block', fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#111', marginBottom: '0.75rem' }}>
              Localidade ou Distrito
            </label>
            <div style={{ display: 'flex', gap: '0.75rem', position: 'relative' }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <div style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#999', pointerEvents: 'none' }}>
                  <MapPin style={{ width: '16px', height: '16px' }} />
                </div>
                <input
                  type="text"
                  style={{ width: '100%', padding: '0.625rem 0.75rem 0.625rem 2.25rem', border: '1px solid #ddd', borderRadius: '4px', fontFamily: "'Montserrat', sans-serif", fontSize: '0.9rem', color: '#111', outline: 'none', boxSizing: 'border-box' }}
                  placeholder="Ex: Lisboa, Porto, Faro, Braga, Funchal..."
                  value={address}
                  onChange={(e) => handleInputChange(e.target.value)}
                  autoComplete="off"
                />
                {suggestions.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #ddd', borderTop: 'none', borderRadius: '0 0 4px 4px', zIndex: 100, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                    {suggestions.map((loc, i) => (
                      <button key={`${loc.id}-${loc.name}`} type="button"
                        onClick={() => { setAddress(loc.name); fetchWeatherForLocation(loc) }}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.625rem 0.75rem', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Montserrat', sans-serif", fontSize: '0.875rem', color: '#111', textAlign: 'left', borderBottom: i < suggestions.length - 1 ? '1px solid #f5f5f5' : 'none' }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f8f8f8')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                      >
                        <MapPin style={{ width: '14px', height: '14px', color: '#999', flexShrink: 0 }} />
                        <span style={{ fontWeight: 600 }}>{loc.name}</span>
                        <span style={{ color: '#999', fontSize: '0.8rem' }}>— {loc.district}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button type="submit" disabled={loading}
                style={{ background: '#111', color: '#fff', padding: '0.625rem 1.5rem', borderRadius: '4px', border: 'none', fontFamily: "'Montserrat', sans-serif", fontSize: '0.875rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                {loading ? 'A pesquisar...' : 'Ver Previsão'}
              </button>
            </div>
            {error && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginTop: '0.75rem', padding: '0.625rem 0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '4px' }}>
                <AlertTriangle style={{ width: '16px', height: '16px', color: '#dc2626', flexShrink: 0, marginTop: '1px' }} />
                <p style={{ color: '#dc2626', fontSize: '0.85rem', margin: 0 }}>{error}</p>
              </div>
            )}
          </form>
        </div>

        {weatherData && foundLocation && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '1.25rem', fontWeight: 700, color: '#111', margin: 0 }}>
                  {foundLocation.name}
                  <span style={{ color: '#C8961A', marginLeft: '0.5rem', fontSize: '0.9rem', fontWeight: 400 }}>{foundLocation.district}</span>
                </h2>
                <p style={{ color: '#888', fontSize: '0.8rem', margin: '0.25rem 0 0', fontFamily: "'Montserrat', sans-serif" }}>
                  Previsão para os próximos 7 dias · Fonte: IPMA
                </p>
              </div>
              <button type="button"
                onClick={() => alert(`Local "${foundLocation.name}" guardado!`)}
                style={{ background: 'transparent', border: '1.5px solid #C8961A', color: '#C8961A', padding: '0.5rem 1rem', borderRadius: '4px', fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                Gravar Local
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
              {weatherData.map((item: any, i: number) => {
                const risk = getRiskLabel(item.precipitaProb, item.classWindSpeed)
                return (
                  <div key={i} style={{ background: '#fff', border: i === 0 ? '2px solid #111' : '1px solid #eee', borderRadius: '4px', padding: '1rem 0.75rem', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', position: 'relative' }}>
                    {i === 0 && (
                      <span style={{ position: 'absolute', top: '-10px', left: '50%', transform: 'translateX(-50%)', background: '#111', color: '#fff', fontSize: '0.65rem', fontWeight: 700, padding: '2px 8px', borderRadius: '10px', fontFamily: "'Montserrat', sans-serif", letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Hoje</span>
                    )}
                    <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', fontWeight: 700, color: '#111', margin: '0 0 0.5rem', textTransform: 'capitalize' }}>
                      {new Date(item.forecastDate + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </p>
                    <div style={{ margin: '0.25rem 0' }}>{getWeatherIcon(item.idWeatherType)}</div>
                    <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.7rem', color: '#666', margin: '0.25rem 0 0.5rem', lineHeight: 1.3 }}>
                      {WEATHER_DESCRIPTIONS[item.idWeatherType] || 'Variável'}
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem', margin: '0.25rem 0' }}>
                      <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.85rem', fontWeight: 700, color: '#2563eb' }}>{item.tMin}°</span>
                      <span style={{ color: '#ddd' }}>|</span>
                      <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.85rem', fontWeight: 700, color: '#dc2626' }}>{item.tMax}°</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.5rem' }}>
                      <Droplets style={{ width: '12px', height: '12px', color: '#60a5fa' }} />
                      <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#555' }}>{item.precipitaProb}%</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.2rem' }}>
                      <Wind style={{ width: '12px', height: '12px', color: '#9ca3af' }} />
                      <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#555' }}>{item.predWindDir}</span>
                    </div>
                    <div style={{ marginTop: '0.625rem', padding: '2px 8px', borderRadius: '10px', background: `${risk.color}18`, border: `1px solid ${risk.color}44` }}>
                      <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.65rem', fontWeight: 700, color: risk.color }}>{risk.label}</span>
                    </div>
                  </div>
                )
              })}
            </div>

            <div style={{ background: '#f8f8f8', border: '1px solid #eee', borderRadius: '4px', padding: '1.25rem 1.5rem' }}>
              <h3 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#111', margin: '0 0 0.75rem' }}>
                Avaliação de Risco para Seguros — Hoje
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
                {[
                  { label: 'Risco de Inundação', value: parseFloat(weatherData[0]?.precipitaProb || '0') >= 60 ? 'Elevado' : 'Baixo', color: parseFloat(weatherData[0]?.precipitaProb || '0') >= 60 ? '#dc2626' : '#16a34a' },
                  { label: 'Risco de Vento', value: (weatherData[0]?.classWindSpeed || 1) >= 3 ? 'Elevado' : 'Baixo', color: (weatherData[0]?.classWindSpeed || 1) >= 3 ? '#dc2626' : '#16a34a' },
                  { label: 'Risco de Granizo', value: [13, 17].includes(weatherData[0]?.idWeatherType) ? 'Presente' : 'Baixo', color: [13, 17].includes(weatherData[0]?.idWeatherType) ? '#d97706' : '#16a34a' },
                  { label: 'Risco de Neve', value: [14, 15, 24, 25].includes(weatherData[0]?.idWeatherType) ? 'Presente' : 'Baixo', color: [14, 15, 24, 25].includes(weatherData[0]?.idWeatherType) ? '#d97706' : '#16a34a' },
                ].map((risk, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: '#fff', borderRadius: '4px', border: '1px solid #eee' }}>
                    <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem', color: '#555' }}>{risk.label}</span>
                    <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem', fontWeight: 700, color: risk.color }}>{risk.value}</span>
                  </div>
                ))}
              </div>
              <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#888', margin: '0.75rem 0 0', lineHeight: 1.5 }}>
                Avaliação baseada na previsão de hoje para <strong>{foundLocation.name}</strong>. Para análise detalhada, consulte o histórico meteorológico e as condições locais do imóvel ou activo segurado.
              </p>
            </div>
          </div>
        )}

        {!weatherData && !loading && (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#888' }}>
            <Cloud style={{ width: '64px', height: '64px', margin: '0 auto 1rem', color: '#e5e7eb' }} />
            <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.95rem', fontWeight: 600, color: '#555', marginBottom: '0.5rem' }}>
              Pesquise uma localidade para ver a previsão
            </p>
            <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.85rem', color: '#888' }}>
              Sugestões: Lisboa, Porto, Faro, Braga, Coimbra, Funchal, Ponta Delgada
            </p>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
