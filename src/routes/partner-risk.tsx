import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useState } from 'react'
import { Search, Building2, AlertTriangle, CheckCircle, Info, FileText, Shield } from 'lucide-react'

export const Route = createFileRoute('/partner-risk')({
  component: PartnerRiskPage,
})

function PartnerRiskPage() {
  const [nif, setNif] = useState('')
  const [cprc, setCprc] = useState('')
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState<string | null>(null)
  const [companyProfile, setCompanyProfile] = useState<any | null>(null)
  const [error, setError] = useState('')

  const analyzeRisk = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nif && !cprc) return
    setLoading(true)
    setError('')
    setReport(null)
    setCompanyName(null)
    setCompanyProfile(null)
    try {
      const response = await fetch('/api/analyze-partner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nif: nif.trim(), cprc: cprc.trim() }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Falha na análise de risco')
      setReport(data.report)
      setCompanyName(data.companyName)
      setCompanyProfile(data.companyProfile)
    } catch (err: any) {
      setError(err.message || 'Erro desconhecido')
    } finally {
      setLoading(false)
    }
  }

  const handlePrint = () => {
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(
      '<!DOCTYPE html><html><head><title>Relatório de Risco — ' + (companyName || 'Empresa') + '</title>' +
      '<style>body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#111}' +
      'h3{color:#111;border-bottom:2px solid #C8961A;padding-bottom:8px}h4{color:#333}' +
      'table{width:100%;border-collapse:collapse;margin:12px 0}td,th{padding:8px 12px;border:1px solid #ddd;font-size:13px}' +
      'th{background:#f5f5f5;font-weight:700}.header{background:#111;color:#fff;padding:20px;margin-bottom:24px;border-radius:4px}' +
      '.header h1{margin:0;font-size:18px;color:#fff}.header p{margin:4px 0 0;color:#C8961A;font-size:12px}</style></head><body>' +
      '<div class="header"><h1>ADLER PRO — Relatório de Risco de Parceiros</h1>' +
      '<p>' + (companyName || '') + ' · ' + new Date().toLocaleDateString('pt-PT') + '</p></div>' +
      (report || '') + '</body></html>'
    )
    w.document.close()
    w.print()
  }

  return (
    <AppLayout>
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '1.5rem 1rem' }}>
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '1.75rem', fontWeight: 700, color: '#111111', margin: '0 0 0.5rem' }}>
            Análise de Risco de Parceiros
          </h1>
          <p style={{ color: '#666666', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>
            Consulte dados reais do Registo Comercial e da Autoridade Tributária para avaliar a exposição ao risco de empresas parceiras ou clientes. Dados obtidos via <strong>BizAPIs</strong> e analisados por IA.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', padding: '1rem 1.25rem', background: '#f8f8f8', border: '1px solid #eeeeee', borderRadius: '4px', marginBottom: '1.5rem' }}>
          <Info style={{ width: '18px', height: '18px', color: '#C8961A', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.85rem', fontWeight: 600, color: '#111', margin: '0 0 0.25rem' }}>Como funciona</p>
            <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem', color: '#666', margin: 0, lineHeight: 1.5 }}>
              Introduza o <strong>NIF/NIPC</strong> para obter dados fiscais (nome, situação IVA, repartição de finanças). Opcionalmente, adicione o <strong>Código CPRC</strong> (Certidão Permanente do Registo Comercial) para dados completos: sócios, capital social, CAE, representantes e alertas de penhoras.
            </p>
          </div>
        </div>

        <div style={{ background: '#ffffff', border: '1.5px solid #111111', borderRadius: '4px', padding: '1.5rem', marginBottom: '2rem' }}>
          <form onSubmit={analyzeRisk}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#111', marginBottom: '0.5rem' }}>
                  NIF / NIPC <span style={{ color: '#C8961A' }}>*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#999' }}>
                    <Building2 style={{ width: '16px', height: '16px' }} />
                  </div>
                  <input
                    type="text"
                    style={{ width: '100%', padding: '0.625rem 0.75rem 0.625rem 2.25rem', border: '1px solid #ddd', borderRadius: '4px', fontFamily: "'Montserrat', sans-serif", fontSize: '0.9rem', color: '#111', outline: 'none', boxSizing: 'border-box' }}
                    placeholder="Ex: 500100144"
                    value={nif}
                    onChange={(e) => setNif(e.target.value.replace(/\D/g, '').slice(0, 9))}
                    maxLength={9}
                  />
                </div>
                <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.7rem', color: '#888', margin: '0.25rem 0 0' }}>9 dígitos — obrigatório</p>
              </div>
              <div>
                <label style={{ display: 'block', fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#111', marginBottom: '0.5rem' }}>
                  Código CPRC <span style={{ color: '#888', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(opcional)</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#999' }}>
                    <FileText style={{ width: '16px', height: '16px' }} />
                  </div>
                  <input
                    type="text"
                    style={{ width: '100%', padding: '0.625rem 0.75rem 0.625rem 2.25rem', border: '1px solid #ddd', borderRadius: '4px', fontFamily: "'Montserrat', sans-serif", fontSize: '0.9rem', color: '#111', outline: 'none', boxSizing: 'border-box' }}
                    placeholder="Ex: 3777-0000-1111"
                    value={cprc}
                    onChange={(e) => setCprc(e.target.value)}
                  />
                </div>
                <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.7rem', color: '#888', margin: '0.25rem 0 0' }}>Formato: XXXX-XXXX-XXXX — dados do registo comercial</p>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || (!nif && !cprc)}
              style={{ background: '#111', color: '#fff', padding: '0.75rem 2rem', borderRadius: '4px', border: 'none', fontFamily: "'Montserrat', sans-serif", fontSize: '0.875rem', fontWeight: 700, cursor: loading || (!nif && !cprc) ? 'not-allowed' : 'pointer', opacity: loading || (!nif && !cprc) ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              {loading ? (
                <><svg style={{ width: '16px', height: '16px', animation: 'spin 1s linear infinite' }} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70" /></svg>A analisar...</>
              ) : (
                <><Search style={{ width: '16px', height: '16px' }} />Analisar Empresa</>
              )}
            </button>
            {error && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginTop: '0.75rem', padding: '0.625rem 0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '4px' }}>
                <AlertTriangle style={{ width: '16px', height: '16px', color: '#dc2626', flexShrink: 0, marginTop: '1px' }} />
                <p style={{ color: '#dc2626', fontSize: '0.85rem', margin: 0 }}>{error}</p>
              </div>
            )}
          </form>
        </div>

        {companyProfile && (
          <div style={{ background: '#111', color: '#fff', borderRadius: '4px', padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.7rem', color: '#C8961A', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 0.25rem' }}>Empresa Identificada</p>
                <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '1.1rem', fontWeight: 700, color: '#fff', margin: '0 0 0.25rem' }}>{companyProfile.identificacao.nome}</h2>
                <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem', color: '#aaa', margin: 0 }}>
                  NIF {companyProfile.identificacao.nif} · {companyProfile.identificacao.naturezaJuridica} · Capital: {companyProfile.identificacao.capitalSocial}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {companyProfile.fonteDados.bizapisNifName === 'Disponível' && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: '#1a1a1a', border: '1px solid #333', borderRadius: '4px', padding: '0.25rem 0.625rem', fontFamily: "'Montserrat', sans-serif", fontSize: '0.7rem', color: '#aaa' }}>
                    <CheckCircle style={{ width: '12px', height: '12px', color: '#16a34a' }} /> AT
                  </span>
                )}
                {companyProfile.fonteDados.bizapisCPRC === 'Disponível' && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: '#1a1a1a', border: '1px solid #333', borderRadius: '4px', padding: '0.25rem 0.625rem', fontFamily: "'Montserrat', sans-serif", fontSize: '0.7rem', color: '#aaa' }}>
                    <CheckCircle style={{ width: '12px', height: '12px', color: '#16a34a' }} /> Registo Comercial
                  </span>
                )}
                {companyProfile.alertas?.factosPendentes === 'Sim' && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '4px', padding: '0.25rem 0.625rem', fontFamily: "'Montserrat', sans-serif", fontSize: '0.7rem', color: '#dc2626' }}>
                    <AlertTriangle style={{ width: '12px', height: '12px' }} /> Factos Pendentes
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {report && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Shield style={{ width: '18px', height: '18px', color: '#C8961A' }} />
                <h3 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#111', margin: 0 }}>Relatório de Análise de Risco</h3>
              </div>
              <button type="button" onClick={handlePrint}
                style={{ background: 'transparent', border: '1.5px solid #C8961A', color: '#C8961A', padding: '0.5rem 1rem', borderRadius: '4px', fontFamily: "'Montserrat', sans-serif", fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <FileText style={{ width: '14px', height: '14px' }} />Imprimir / PDF
              </button>
            </div>
            <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: '4px', padding: '2rem' }} dangerouslySetInnerHTML={{ __html: report }} />
            <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.75rem', color: '#888', margin: '0.75rem 0 0', lineHeight: 1.5 }}>
              Análise gerada por IA com base em dados do Registo Comercial e Autoridade Tributária em {new Date().toLocaleDateString('pt-PT')}. Este relatório é meramente informativo.
            </p>
          </div>
        )}

        {!report && !loading && (
          <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <Shield style={{ width: '64px', height: '64px', margin: '0 auto 1rem', color: '#e5e7eb' }} />
            <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.95rem', fontWeight: 600, color: '#555', marginBottom: '0.5rem' }}>Introduza o NIF de uma empresa para iniciar a análise</p>
            <p style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '0.85rem', color: '#888', lineHeight: 1.5 }}>O relatório inclui identificação fiscal, estrutura societária, alertas de risco e recomendações de seguros adequadas ao perfil da empresa.</p>
          </div>
        )}
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </AppLayout>
  )
}
