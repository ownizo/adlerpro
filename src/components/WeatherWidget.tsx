import { useState, useEffect, useCallback } from 'react'
import {
  getWeatherForLocation,
  getSeverityColor,
  getSeverityBg,
  getAlertIcon,
  owmIconUrl,
  type WeatherData,
} from '@/lib/weather'

interface Props {
  lat: number
  lon: number
  distrito: string
  cityName: string
}

export function WeatherWidget({ lat, lon, distrito, cityName }: Props) {
  const [data, setData] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    getWeatherForLocation(lat, lon, distrito)
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [lat, lon, distrito])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div
        style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', padding: '1.25rem' }}
        aria-label="A carregar dados meteorológicos"
        aria-busy="true"
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ height: '14px', width: '120px', background: '#f0f0f0', borderRadius: '4px' }} />
          <div style={{ height: '14px', width: '50px', background: '#f0f0f0', borderRadius: '4px' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div style={{ width: '48px', height: '48px', background: '#f0f0f0', borderRadius: '50%' }} />
          <div>
            <div style={{ height: '24px', width: '80px', background: '#f0f0f0', borderRadius: '4px', marginBottom: '0.4rem' }} />
            <div style={{ height: '12px', width: '120px', background: '#f5f5f5', borderRadius: '4px' }} />
          </div>
        </div>
        {[1, 2].map((i) => (
          <div key={i} style={{ height: '36px', background: '#f5f5f5', borderRadius: '4px', marginBottom: '0.4rem' }} />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div
        style={{ background: '#fff', border: '1px solid #eeeeee', borderRadius: '4px', padding: '1.25rem', textAlign: 'center' }}
        role="alert"
      >
        <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem', color: '#888', margin: '0 0 0.5rem' }}>
          Dados meteorológicos indisponíveis
        </p>
        <button
          onClick={load}
          style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#C8961A', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
          aria-label="Tentar carregar dados meteorológicos novamente"
        >
          Tentar novamente
        </button>
      </div>
    )
  }

  const activeWarnings = (data?.warnings ?? []).filter(
    (w) => w.awarenessLevelID === 'yellow' || w.awarenessLevelID === 'orange' || w.awarenessLevelID === 'red'
  )

  return (
    <section
      style={{ background: '#ffffff', border: '1px solid #eeeeee', borderRadius: '4px', overflow: 'hidden' }}
      aria-label={`Condições meteorológicas em ${cityName}`}
    >
      {/* Header */}
      <div style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid #eeeeee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.9rem', color: '#111', margin: 0 }}>
          Clima — {cityName}
        </h2>
        {activeWarnings.length > 0 && (
          <span
            style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.65rem', fontWeight: 700, padding: '2px 8px', borderRadius: '10px', background: '#fff7ed', color: '#ea580c', border: '1px solid #fed7aa' }}
            aria-label={`${activeWarnings.length} aviso${activeWarnings.length !== 1 ? 's' : ''} meteorológico${activeWarnings.length !== 1 ? 's' : ''} ativo${activeWarnings.length !== 1 ? 's' : ''}`}
          >
            {activeWarnings.length} aviso{activeWarnings.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div style={{ padding: '1rem 1.25rem' }}>
        {/* Current conditions from OWM */}
        {data?.owm ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <img
              src={owmIconUrl(data.owm.icon)}
              alt={data.owm.description}
              width={48}
              height={48}
              style={{ flexShrink: 0 }}
            />
            <div>
              <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '1.5rem', color: '#111', margin: 0, lineHeight: 1 }}>
                {data.owm.temp}°C
              </p>
              <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#555', margin: '0.2rem 0 0', textTransform: 'capitalize' }}>
                {data.owm.description}
              </p>
              <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.68rem', color: '#999', margin: '0.15rem 0 0' }}>
                Sensação {data.owm.feelsLike}°C · Vento {data.owm.windSpeed} km/h · Humidade {data.owm.humidity}%
              </p>
            </div>
          </div>
        ) : (
          <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.78rem', color: '#aaa', margin: '0 0 0.75rem' }}>
            Condições atuais indisponíveis
          </p>
        )}

        {/* Active IPMA warnings */}
        {activeWarnings.length > 0 && (
          <div style={{ marginBottom: '0.75rem' }} role="list" aria-label="Avisos IPMA ativos">
            {activeWarnings.slice(0, 3).map((w, i) => (
              <div
                key={i}
                role="listitem"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.4rem 0.6rem',
                  marginBottom: '0.35rem',
                  background: getSeverityBg(w.awarenessLevelID),
                  borderRadius: '4px',
                  border: `1px solid ${getSeverityColor(w.awarenessLevelID)}33`,
                }}
              >
                <span style={{ fontSize: '0.9rem', flexShrink: 0 }} aria-hidden="true">
                  {getAlertIcon(w.awarenessTypeName)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: '0.7rem', color: getSeverityColor(w.awarenessLevelID), margin: 0 }}>
                    {w.awarenessTypeName}
                  </p>
                  {w.text && (
                    <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.67rem', color: '#555', margin: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {w.text}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Attribution */}
        <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.62rem', color: '#ccc', margin: 0 }}>
          {data?.owm ? 'Dados IPMA & OpenWeatherMap' : 'Dados IPMA'}
        </p>
      </div>
    </section>
  )
}
