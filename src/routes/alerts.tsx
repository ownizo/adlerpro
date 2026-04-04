import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useState } from 'react'
import { clearAlerts } from '@/lib/server-fns'

export const Route = createFileRoute('/alerts')({
  component: AlertsSettingsPage,
})

function AlertsSettingsPage() {
  const [settings, setSettings] = useState({
    renewalAlerts: true,
    weatherAlerts: true,
    channels: {
      platform: true,
      email: true,
      whatsapp: false,
    },
    emailAddress: '',
    whatsappNumber: '',
  })
  
  const [saved, setSaved] = useState(false)
  const [clearing, setClearing] = useState(false)

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    // In a real app, this would be an API call to save settings to the user's profile
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const handleClearAlerts = async () => {
    if (!confirm('Tem a certeza que deseja limpar todo o histórico de alertas? Esta ação não pode ser revertida.')) return;
    setClearing(true);
    try {
      await clearAlerts();
      alert('Histórico de alertas limpo com sucesso.');
    } catch (err) {
      alert('Erro ao limpar histórico de alertas.');
    } finally {
      setClearing(false);
    }
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-navy-700 mb-2">Definições de Alertas</h1>
        <p className="text-navy-500 mb-8">Configure as notificações que deseja receber e por que canal.</p>

        {saved && (
          <div className="mb-6 p-4 rounded bg-green-50 text-green-800 border border-green-200">
            Definições guardadas com sucesso!
          </div>
        )}

        <form onSubmit={handleSave} className="bg-white p-6 rounded-lg border border-navy-200 shadow-sm space-y-8 mb-8">
          
          {/* Tipos de Alertas */}
          <div>
            <h2 className="text-lg font-semibold text-navy-700 mb-4 border-b border-navy-100 pb-2">Tipos de Alertas</h2>
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input 
                  type="checkbox" 
                  className="w-4 h-4 text-gold-500 rounded border-navy-300 focus:ring-gold-500"
                  checked={settings.renewalAlerts}
                  onChange={(e) => setSettings({...settings, renewalAlerts: e.target.checked})}
                />
                <span className="text-navy-700">Alertas de Renovação (60 dias antes do término da apólice)</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input 
                  type="checkbox" 
                  className="w-4 h-4 text-gold-500 rounded border-navy-300 focus:ring-gold-500"
                  checked={settings.weatherAlerts}
                  onChange={(e) => setSettings({...settings, weatherAlerts: e.target.checked})}
                />
                <span className="text-navy-700">Alertas de Tempo (Avisos meteorológicos severos)</span>
              </label>
            </div>
          </div>

          {/* Canais de Comunicação */}
          <div>
            <h2 className="text-lg font-semibold text-navy-700 mb-4 border-b border-navy-100 pb-2">Como deseja receber a informação?</h2>
            <div className="space-y-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input 
                  type="checkbox" 
                  className="w-4 h-4 text-gold-500 rounded border-navy-300 focus:ring-gold-500"
                  checked={settings.channels.platform}
                  onChange={(e) => setSettings({...settings, channels: {...settings.channels, platform: e.target.checked}})}
                />
                <span className="text-navy-700">Alerta na Plataforma</span>
              </label>
              
              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input 
                    type="checkbox" 
                    className="w-4 h-4 text-gold-500 rounded border-navy-300 focus:ring-gold-500"
                    checked={settings.channels.email}
                    onChange={(e) => setSettings({...settings, channels: {...settings.channels, email: e.target.checked}})}
                  />
                  <span className="text-navy-700">Email</span>
                </label>
                {settings.channels.email && (
                  <div className="pl-7">
                    <input 
                      type="email"
                      placeholder="Endereço de email"
                      className="w-full md:w-1/2 p-2 border border-navy-200 rounded focus:ring-2 focus:ring-gold-400 outline-none text-sm"
                      value={settings.emailAddress}
                      onChange={(e) => setSettings({...settings, emailAddress: e.target.value})}
                      required={settings.channels.email}
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input 
                    type="checkbox" 
                    className="w-4 h-4 text-gold-500 rounded border-navy-300 focus:ring-gold-500"
                    checked={settings.channels.whatsapp}
                    onChange={(e) => setSettings({...settings, channels: {...settings.channels, whatsapp: e.target.checked}})}
                  />
                  <span className="text-navy-700">WhatsApp</span>
                </label>
                {settings.channels.whatsapp && (
                  <div className="pl-7">
                    <input 
                      type="tel"
                      placeholder="Número de telemóvel (ex: +351 912345678)"
                      className="w-full md:w-1/2 p-2 border border-navy-200 rounded focus:ring-2 focus:ring-gold-400 outline-none text-sm"
                      value={settings.whatsappNumber}
                      onChange={(e) => setSettings({...settings, whatsappNumber: e.target.value})}
                      required={settings.channels.whatsapp}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="pt-4 flex justify-end">
            <button
              type="submit"
              className="bg-[#111111] text-white px-6 py-2 rounded font-medium hover:bg-black transition-colors"
            >
              Guardar Definições
            </button>
          </div>
        </form>

        <div className="bg-white p-6 rounded-lg border border-red-200 shadow-sm mt-8">
          <h2 className="text-lg font-semibold text-red-700 mb-2">Gerir Histórico</h2>
          <p className="text-sm text-navy-500 mb-4">Pode limpar permanentemente todo o histórico de alertas da plataforma.</p>
          <button
            type="button"
            onClick={handleClearAlerts}
            disabled={clearing}
            className="bg-white text-red-600 border border-red-200 px-4 py-2 rounded font-medium hover:bg-red-50 transition-colors disabled:opacity-50 text-sm"
          >
            {clearing ? 'A limpar...' : 'Limpar Histórico de Alertas'}
          </button>
        </div>
      </div>
    </AppLayout>
  )
}
