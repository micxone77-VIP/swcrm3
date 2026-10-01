import { useAuth } from '../hooks/useAuth'
import { canAccess } from './Sidebar'

// Wraps a route and blocks access based on:
// - `permKey` (preferred): checks profile.permissions[] — admin always passes
// - `roles` (legacy fallback): checks profile.role against allowed roles list
export default function RequireRole({ roles, permKey, children }) {
  const { profile } = useAuth()
  const role = profile?.role || 'readonly'

  // Permission-key check (new system)
  if (permKey !== undefined) {
    if (canAccess(profile, permKey)) return children
    return <Blocked role={role} />
  }

  // Legacy role-array check (for routes not yet migrated)
  if (roles && !roles.includes(role)) return <Blocked role={role} />

  return children
}

function Blocked({ role }) {
  return (
    <div style={{ padding: '80px 32px', textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
      <div style={{ fontSize: 40, marginBottom: 14 }}>🔒</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
        Access restricted
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
        Your account (<strong>{role}</strong>) doesn't have access to this page.
        Contact your admin to enable it.
      </div>
    </div>
  )
}
