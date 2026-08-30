import { useAuth } from '../hooks/useAuth'

// Wraps a route's element and blocks it unless the signed-in user's role is
// in `roles`. This mirrors the same roles arrays used in Sidebar.jsx — if you
// add a page to the sidebar for certain roles, wrap its <Route> with this
// component using the SAME roles array, or the sidebar link and the actual
// page access will silently disagree (sidebar hides it, but the URL still works).
export default function RequireRole({ roles, children }) {
  const { profile } = useAuth()
  const role = profile?.role || 'readonly'

  if (!roles.includes(role)) {
    return (
      <div style={{ padding: '80px 32px', textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
        <div style={{ fontSize: 40, marginBottom: 14 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
          Access restricted
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
          Your account role (<strong>{role}</strong>) doesn't have permission to view this page.
          If you think this is a mistake, ask an admin to check your role under Manage Users.
        </div>
      </div>
    )
  }

  return children
}
