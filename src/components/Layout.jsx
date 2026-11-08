import { Suspense, useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import Sidebar from './Sidebar'
import ForcePasswordChange from './ForcePasswordChange'
import { useLanguage } from '../contexts/LanguageContext'

export default function Layout() {
  const { user, profile, loading } = useAuth()
  const { lang } = useLanguage()
  const [menuOpen, setMenuOpen] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => { setMenuOpen(false) }, [pathname])

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

  // On phones (≤768px, see index.html) the menu hides behind the ☰ button in the top bar
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <div className={'app-sidebar' + (menuOpen ? ' open' : '')}><Sidebar /></div>
      {menuOpen && <div className="app-backdrop" onClick={() => setMenuOpen(false)} />}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="app-topbar">
          <button onClick={() => setMenuOpen(true)} aria-label={lang === 'zh' ? '打开菜单' : 'Open menu'} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, width: 40, height: 36, fontSize: 18, lineHeight: 1 }}>☰</button>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}><span style={{ color: 'var(--brand)', fontWeight: 900 }}>Sure</span>Win CRM</div>
        </div>
        <main style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
          <Suspense fallback={<PageLoading />}><Outlet /></Suspense>
        </main>
      </div>
    </div>
  )
}

// Shown while a page's code downloads (pages are lazy-loaded in App.jsx)
function PageLoading() {
  const { lang } = useLanguage()
  return <div style={{ padding: 32, color: 'var(--muted)', fontSize: 13 }}>{lang === 'zh' ? '加载中…' : 'Loading…'}</div>
}
