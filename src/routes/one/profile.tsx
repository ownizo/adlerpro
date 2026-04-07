import { createFileRoute } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { useState, useEffect } from 'react'
import { OneLayout } from './__root'

export const Route = createFileRoute('/one/profile')({
  component: OneProfile,
  ssr: false,
})

const navy = '#0A1628'
const gold  = '#C9A84C'

interface IndividualClient {
  id: string
  full_name: string
  nif?: string
  email?: string
  phone?: string
  address?: string
  status: string
}

function OneProfile() {
  const [client,    setClient]    = useState<IndividualClient | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [editing,   setEditing]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveOk,    setSaveOk]    = useState(false)
  const [form, setForm] = useState({ phone: '', address: '' })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) { window.location.replace('/one/login'); return }

      let clientData: IndividualClient | null = null
      const { data: byAuthId } = await supabase
        .from('individual_clients').select('*').eq('auth_user_id', user.id).maybeSingle()

      if (byAuthId) {
        clientData = byAuthId
      } else if (user.email) {
        const { data: byEmail } = await supabase
          .from('individual_clients').select('*').ilike('email', user.email).maybeSingle()
        if (byEmail) {
          clientData = byEmail
          await supabase.from('individual_clients').update({ auth_user_id: user.id }).eq('id', clientData!.id)
        }
      }

      setClient(clientData)
      if (clientData) {
        setForm({ phone: clientData.phone ?? '', address: clientData.address ?? '' })
      }
    } catch (e: any) {
      setError('Erro ao carregar perfil.')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!client) return
    setSaving(true)
    setSaveError('')
    setSaveOk(false)
    try {
      const { error: err } = await supabase
        .from('individual_clients')
        .update({ phone: form.phone || null, address: form.address || null })
        .eq('id', client.id)
      if (err) throw err
      setClient(c => c ? { ...c, phone: form.phone, address: form.address } : c)
      setEditing(false)
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 3000)
    } catch (e: any) {
      setSaveError('Erro ao guardar. Tente novamente.')
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <OneLayout>
      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorMsg msg={error} />
      ) : !client ? (
        <div style={{ padding: '1.5rem', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, fontSize: '0.85rem', color: '#92400E' }}>
          <strong>Perfil não encontrado.</strong> Contacte a Adler Rochefort para associar a sua conta ao seu perfil.
        </div>
      ) : (
        <>
          <div style={{ marginBottom: '1.75rem' }}>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: navy, margin: 0 }}>Perfil</h1>
            <p style={{ fontSize: '0.82rem', color: '#64748B', marginTop: '0.3rem' }}>Os seus dados pessoais</p>
          </div>

          {saveOk && (
            <div style={{ marginBottom: '1rem', padding: '0.65rem 0.85rem', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 4, color: '#166534', fontSize: '0.82rem' }}>
              Dados actualizados com sucesso.
            </div>
          )}

          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', marginBottom: '1.5rem' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: navy, margin: 0 }}>Dados Pessoais</h2>
            </div>
            <div style={{ padding: '1.25rem 1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem' }}>
              <ProfileField label="Nome Completo"  value={client.full_name} />
              <ProfileField label="NIF"            value={client.nif}      />
              <ProfileField label="Email"          value={client.email}    />
              <ProfileField label="Telefone"       value={client.phone}    />
              <ProfileField label="Morada" value={client.address} wide />
            </div>
          </div>

          {/* Editable fields */}
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: navy, margin: 0 }}>Actualizar Contacto</h2>
              {!editing && (
                <button
                  onClick={() => setEditing(true)}
                  style={{ padding: '0.4rem 1rem', background: 'none', border: `1px solid ${gold}`, color: navy, fontWeight: 600, fontSize: '0.78rem', borderRadius: 4, cursor: 'pointer' }}
                >
                  Editar
                </button>
              )}
            </div>
            <div style={{ padding: '1.25rem 1.5rem' }}>
              {editing ? (
                <form onSubmit={handleSave} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                  <div>
                    <FieldLabel>Telefone</FieldLabel>
                    <input
                      value={form.phone}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder="+351 912 345 678"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <FieldLabel>Morada</FieldLabel>
                    <input
                      value={form.address}
                      onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                      placeholder="Rua, número, código postal"
                      style={inputStyle}
                    />
                  </div>
                  {saveError && (
                    <div style={{ gridColumn: '1 / -1', padding: '0.65rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 4, color: '#B91C1C', fontSize: '0.78rem' }}>
                      {saveError}
                    </div>
                  )}
                  <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.75rem' }}>
                    <button
                      type="submit"
                      disabled={saving}
                      style={{ padding: '0.6rem 1.4rem', background: saving ? '#e5c97a' : gold, color: navy, fontWeight: 700, fontSize: '0.82rem', border: 'none', borderRadius: 4, cursor: saving ? 'not-allowed' : 'pointer' }}
                    >
                      {saving ? 'A guardar...' : 'Guardar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditing(false); setSaveError(''); setForm({ phone: client.phone ?? '', address: client.address ?? '' }) }}
                      style={{ padding: '0.6rem 1.2rem', background: 'none', border: '1px solid #E2E8F0', color: '#64748B', fontWeight: 600, fontSize: '0.82rem', borderRadius: 4, cursor: 'pointer' }}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem' }}>
                  <ProfileField label="Telefone" value={client.phone} />
                  <ProfileField label="Morada"   value={client.address} />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </OneLayout>
  )
}

function ProfileField({ label, value, wide }: { label: string; value?: string | null; wide?: boolean }) {
  return (
    <div style={{ gridColumn: wide ? '1 / -1' : undefined }}>
      <p style={{ fontSize: '0.62rem', fontWeight: 600, color: '#94A3B8', letterSpacing: '0.06em', textTransform: 'uppercase', margin: 0 }}>{label}</p>
      <p style={{ fontSize: '0.88rem', color: value ? navy : '#CBD5E1', fontWeight: value ? 500 : 400, margin: '0.2rem 0 0' }}>
        {value || '—'}
      </p>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 600, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.3rem' }}>{children}</label>
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.85rem',
  border: '1px solid #E2E8F0', borderRadius: 4, outline: 'none',
  color: '#111', boxSizing: 'border-box', fontFamily: "'Montserrat', sans-serif",
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '4rem' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', border: `3px solid ${gold}`, borderTopColor: 'transparent', animation: 'one-spin 0.75s linear infinite' }} />
      <style>{`@keyframes one-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function ErrorMsg({ msg }: { msg: string }) {
  return <div style={{ padding: '2rem', textAlign: 'center', color: '#B91C1C', fontSize: '0.9rem' }}>{msg}</div>
}
