import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import Sidebar from './Sidebar'
import ForcePasswordChange from './ForcePasswordChange'
import { useLanguage } from '../contexts/LanguageContext'

export default function Layout() {
  const { user, profile, loading } = useAuth()
  const { lang } = useLanguage()

  if (loading) return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--bg)', color: 'var(--muted)', fontSize: 14,
      gap: 10,
    }}>
      <div style={{ width: 18, height: 18, border: '2px solid var(--border)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      {lang === 'zh' ? '载入中…' : 'Loading…'}
    </div>
  )

  if (!user) return <Navigate to="/login" replace />

  // Block entire app until host sets their own password on first login
  if (profile?.must_change_password) return <ForcePasswordChange />

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <main style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
        <Outlet />
      </main>
    </div>
  )
}
