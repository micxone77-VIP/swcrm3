import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useState, useEffect } from 'react'
import Sidebar from './Sidebar'
import GlobalSearch from './GlobalSearch'
import ContextualAI from './ContextualAI'

export default function Layout() {
  const { user, loading } = useAuth()
  const [searchOpen, setSearchOpen] = useState(false)

  // Cmd+K / Ctrl+K global keyboard shortcut
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(o => !o)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  if (loading) return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--bg)', color: 'var(--muted)', fontSize: 14,
      gap: 10,
    }}>
      <div style={{ width: 18, height: 18, border: '2px solid var(--border)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      Loading…
    </div>
  )

  if (!user) return <Navigate to="/login" replace />

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar onSearch={() => setSearchOpen(true)} />
      <main style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
        <Outlet />
      </main>

      {/* Global Cmd+K search overlay */}
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Floating contextual AI panel */}
      <ContextualAI />
    </div>
  )
}
