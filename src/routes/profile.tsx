import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useIdentity } from '@/lib/identity-context'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchCurrentUserCompanyProfile } from '@/lib/server-fns'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/profile')({
  component: ProfilePage,
})

function ProfilePage() {
  const { t } = useTranslation()
  const { user, ready, logout } = useIdentity()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [uploading, setUploading] = useState(false)
  const [companyName, setCompanyName] = useState<string>('-')

  if (!ready) return <div className="p-8">{t('profile.loading')}</div>
  if (!user) {
    navigate({ to: '/login' })
    return null
  }

  const handleLogout = async () => {
    await logout()
    window.location.href = '/'
  }

  useEffect(() => {
    fetchCurrentUserCompanyProfile().then((data) => {
      setCompanyName(data.company?.name || '-')
    })
  }, [])

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setMessage(t('profile.passwordChanged'))
      setPassword('')
    } catch (err: any) {
      setMessage(t('profile.errors.passwordChange', { msg: err.message || t('common.nd') }))
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setMessage('')

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('type', 'avatar')

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) throw new Error(t('profile.errors.imageUpload'))

      const data = await res.json()

      const { error } = await supabase.auth.updateUser({
        data: { avatar_url: data.url },
      })
      if (error) throw error

      setMessage(t('profile.imageUpdated'))
      window.location.reload()
    } catch (err: any) {
      setMessage(t('profile.errors.imageChange', { msg: err.message }))
    } finally {
      setUploading(false)
    }
  }

  const avatarUrl = user.metadata?.avatar_url || user.user_metadata?.avatar_url || null

  return (
    <div className="max-w-2xl mx-auto py-8">
      <div className="mb-6">
        <button
          onClick={() => navigate({ to: '/dashboard' })}
          className="flex items-center text-sm font-medium text-navy-500 hover:text-navy-700 transition-colors"
        >
          <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          {t('profile.backToPortal')}
        </button>
      </div>

      <h1 className="text-2xl font-bold mb-8" style={{ fontFamily: "'Montserrat', sans-serif" }}>{t('profile.title')}</h1>

      {message && (
        <div className="mb-6 p-4 rounded bg-blue-50 text-blue-800">
          {message}
        </div>
      )}

      <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm mb-8">
        <h2 className="text-lg font-semibold mb-4">{t('profile.accountInfo')}</h2>
        <div className="flex items-center gap-6 mb-6">
          <div className="w-24 h-24 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden border">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl text-gray-500">{user.name?.charAt(0) || user.email?.charAt(0)}</span>
            )}
          </div>
          <div>
            <p className="font-medium text-lg">{user.name || t('profile.noName')}</p>
            <p className="text-gray-500 mb-3">{user.email}</p>
            <p className="text-sm text-gray-500 mb-3">{t('profile.company')} <strong>{companyName}</strong></p>
            <div>
              <label className="cursor-pointer bg-[#111111] text-white px-4 py-2 rounded text-sm hover:bg-black transition-colors">
                {uploading ? t('profile.uploading') : t('profile.changeImage')}
                <input
                  type="file"
                  className="hidden"
                  accept="image/png, image/jpeg, image/webp"
                  onChange={handleFileChange}
                  disabled={uploading}
                />
              </label>
              <p className="text-xs text-gray-400 mt-2">{t('profile.supportedFormats')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm mb-8">
        <h2 className="text-lg font-semibold mb-4">{t('profile.changePassword')}</h2>
        <form onSubmit={handlePasswordChange} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.newPassword')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-[#C8961A] outline-none"
              required
              minLength={6}
            />
          </div>
          <button
            type="submit"
            className="bg-[#111111] text-white px-4 py-2 rounded text-sm hover:bg-black transition-colors"
          >
            {t('profile.updatePassword')}
          </button>
        </form>
      </div>

      <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
        <h2 className="text-lg font-semibold text-red-600 mb-4">{t('profile.session')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('profile.sessionDesc')}</p>
        <button
          onClick={handleLogout}
          className="bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded text-sm hover:bg-red-100 transition-colors"
        >
          {t('profile.logout')}
        </button>
      </div>
    </div>
  )
}
