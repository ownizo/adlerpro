import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/license-plates')({
  component: LicensePlatesPage,
})

interface PlateResult {
  plate: string
  source: string
  vehicle: {
    description: string
    make: string
    model: string
    registrationYear: string
    manufactureYearFrom: string
    manufactureYearTo: string
    fuelType: string
    transmission: string
    bodyStyle: string
    engineSize: string
    numberOfDoors: string
    numberOfSeats: string
    abiCode: string
  }
}

interface SeguroResult {
  plate: string
  date: string
  source: string
  seguro: Record<string, unknown> | null
  message?: string
}

function LicensePlatesPage() {
  const { t } = useTranslation()
  const [plate, setPlate] = useState('')
  const [date, setDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingSeguro, setLoadingSeguro] = useState(false)
  const [result, setResult] = useState<PlateResult | null>(null)
  const [seguroResult, setSeguroResult] = useState<SeguroResult | null>(null)
  const [error, setError] = useState('')
  const [seguroError, setSeguroError] = useState('')

  const verifyPlate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!plate) return

    setError('')
    setSeguroError('')
    setResult(null)
    setSeguroResult(null)
    setLoading(true)
    setLoadingSeguro(!!date)

    const platePromise = fetch('/api/verify-plate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plate }),
    })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data?.error || t('licensePlates.errors.notFound'))
        setResult(data)
      })
      .catch((err: any) => {
        setError(err.message || t('licensePlates.errors.query'))
      })
      .finally(() => setLoading(false))

    const promises: Promise<void>[] = [platePromise]

    if (date) {
      const seguroPromise = fetch('/api/verify-seguro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plate, date }),
      })
        .then(async (response) => {
          const data = await response.json()
          if (!response.ok) throw new Error(data?.error || t('licensePlates.errors.insurance'))
          setSeguroResult(data)
        })
        .catch((err: any) => {
          setSeguroError(err.message || t('licensePlates.errors.insuranceQuery'))
        })
        .finally(() => setLoadingSeguro(false))

      promises.push(seguroPromise)
    }

    await Promise.allSettled(promises)
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-navy-700 mb-2">{t('licensePlates.title')}</h1>
        <p className="text-navy-500 mb-8">{t('licensePlates.subtitle')}</p>

        <form onSubmit={verifyPlate} className="bg-white p-6 rounded border border-navy-200 mb-8">
          <div className="grid sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-2">
                {t('licensePlates.plateLabel')}
              </label>
              <input
                type="text"
                className="w-full p-2 border border-navy-200 rounded focus:ring-2 focus:ring-gold-400 outline-none uppercase"
                placeholder={t('licensePlates.platePlaceholder')}
                value={plate}
                onChange={(e) => setPlate(e.target.value.toUpperCase())}
                pattern="^[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}$"
                title="A matrícula deve seguir o formato 00-AA-00, AA-00-00 ou 00-00-AA"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-2">
                {t('licensePlates.dateLabel')}
              </label>
              <input
                type="date"
                className="w-full p-2 border border-navy-200 rounded focus:ring-2 focus:ring-gold-400 outline-none"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <p className="text-xs text-navy-400 mt-1">{t('licensePlates.dateHint')}</p>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading || loadingSeguro}
            className="bg-[#111111] text-white px-6 py-2 rounded hover:bg-black disabled:opacity-50 w-full sm:w-auto"
          >
            {loading || loadingSeguro ? t('licensePlates.searching') : t('licensePlates.searchBtn')}
          </button>
          {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
          {seguroError && <p className="text-red-500 text-sm mt-2">Seguro: {seguroError}</p>}
        </form>

        <div className="grid gap-6">
          {loading && (
            <div className="bg-white p-6 rounded border border-navy-200 shadow-sm text-center text-navy-500">
              {t('licensePlates.loadingVehicle')}
            </div>
          )}
          {result && (
            <div className="bg-white p-6 rounded border border-navy-200 shadow-sm">
              <div className="flex items-center justify-between mb-6 border-b border-navy-100 pb-4">
                <h2 className="text-xl font-bold text-navy-700">
                  <span className="inline-block mr-2">🚗</span>
                  {t('licensePlates.vehicleData')} — <span className="text-gold-600 bg-gold-50 px-2 py-1 rounded">{result.plate}</span>
                </h2>
                <span className="bg-blue-100 text-blue-800 text-xs font-semibold px-2.5 py-0.5 rounded uppercase">
                  {result.source}
                </span>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field label={t('licensePlates.fields.description')} value={result.vehicle.description} nd={t('common.nd')} />
                <Field label={t('licensePlates.fields.make')} value={result.vehicle.make} nd={t('common.nd')} />
                <Field label={t('licensePlates.fields.model')} value={result.vehicle.model} nd={t('common.nd')} />
                <Field label={t('licensePlates.fields.registrationYear')} value={result.vehicle.registrationYear} nd={t('common.nd')} />
                <Field
                  label={t('licensePlates.fields.manufactureYears')}
                  value={[result.vehicle.manufactureYearFrom, result.vehicle.manufactureYearTo].filter(Boolean).join(' - ')}
                  nd={t('common.nd')}
                />
                <Field label={t('licensePlates.fields.fuelType')} value={result.vehicle.fuelType} nd={t('common.nd')} />
                <Field label={t('licensePlates.fields.transmission')} value={result.vehicle.transmission} nd={t('common.nd')} />
                <Field label={t('licensePlates.fields.bodyStyle')} value={result.vehicle.bodyStyle} nd={t('common.nd')} />
                <Field label={t('licensePlates.fields.engineSize')} value={result.vehicle.engineSize} nd={t('common.nd')} />
                <Field label={t('licensePlates.fields.doors')} value={result.vehicle.numberOfDoors} nd={t('common.nd')} />
                <Field label={t('licensePlates.fields.seats')} value={result.vehicle.numberOfSeats} nd={t('common.nd')} />
                <Field label={t('licensePlates.fields.abiCode')} value={result.vehicle.abiCode} nd={t('common.nd')} />
              </div>
            </div>
          )}

          {loadingSeguro && (
            <div className="bg-white p-6 rounded border border-navy-200 shadow-sm text-center text-navy-500">
              {t('licensePlates.loadingInsurance')}
            </div>
          )}
          {seguroResult && (
            <div className="bg-white p-6 rounded border border-green-200 shadow-sm">
              <div className="flex items-center justify-between mb-6 border-b border-green-100 pb-4">
                <h2 className="text-xl font-bold text-navy-700">
                  <span className="inline-block mr-2">🛡️</span>
                  {t('licensePlates.insuranceData')} — <span className="text-gold-600 bg-gold-50 px-2 py-1 rounded">{seguroResult.plate}</span>
                </h2>
                <span className="bg-green-100 text-green-800 text-xs font-semibold px-2.5 py-0.5 rounded uppercase">
                  {seguroResult.source}
                </span>
              </div>

              {seguroResult.seguro === null ? (
                <div className="text-navy-500 text-sm py-2">
                  {seguroResult.message || t('licensePlates.noInsurance')}
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label={t('licensePlates.fields.dateConsulted')} value={seguroResult.date} nd={t('common.nd')} />
                  <SeguroFields data={seguroResult.seguro} nd={t('common.nd')} noData={t('licensePlates.noData')} />
                </div>
              )}
            </div>
          )}

          {!loading && !loadingSeguro && !result && !seguroResult && !error && !seguroError && (
            <div className="text-center text-navy-400 py-8">
              {t('licensePlates.emptyState')}
              <br />
              {t('licensePlates.emptyStateHint')}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}

function Field({ label, value, nd }: { label: string; value?: string; nd: string }) {
  return (
    <div>
      <p className="text-sm text-navy-400">{label}</p>
      <p className="font-medium text-navy-700">{value || nd}</p>
    </div>
  )
}

function SeguroFields({ data, nd, noData }: { data: Record<string, unknown>; nd: string; noData: string }) {
  if (!data || typeof data !== 'object') return null

  const fieldLabels: Record<string, string> = {
    seguradora: 'Seguradora',
    apolice: 'Apólice',
    nrApolice: 'N.º Apólice',
    numeroApolice: 'N.º Apólice',
    dataInicio: 'Data Início',
    dataFim: 'Data Fim',
    tipoSeguro: 'Tipo de Seguro',
    situacao: 'Situação',
    estado: 'Estado',
    tomador: 'Tomador',
    nifTomador: 'NIF Tomador',
    mediador: 'Mediador',
    coberturas: 'Coberturas',
    categoria: 'Categoria',
    subcategoria: 'Subcategoria',
    marca: 'Marca',
    modelo: 'Modelo',
    matricula: 'Matrícula',
  }

  const entries = Object.entries(data).filter(
    ([, v]) => v !== null && v !== undefined && v !== '',
  )

  if (entries.length === 0) {
    return (
      <div className="col-span-2 text-navy-400 text-sm">
        {noData}
      </div>
    )
  }

  return (
    <>
      {entries.map(([key, value]) => {
        const label = fieldLabels[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())

        if (typeof value === 'object' && value !== null) {
          return (
            <div key={key} className="col-span-2">
              <p className="text-sm text-navy-400 mb-1">{label}</p>
              <pre className="text-sm font-medium text-navy-700 bg-navy-50 p-2 rounded overflow-x-auto">
                {JSON.stringify(value, null, 2)}
              </pre>
            </div>
          )
        }

        return <Field key={key} label={label} value={String(value)} nd={nd} />
      })}
    </>
  )
}
