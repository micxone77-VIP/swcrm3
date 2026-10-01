import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const s = {
  wrap:  { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '20px' },
  card:  { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '40px 36px', width: '100%', maxWidth: 400 },
  logo:  { textAlign: 'center', marginBottom: 32 },
  crown: { fontSize: 36, display: 'block', marginBottom: 8 },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--text)' },
  sub:   { fontSize: 13, color: 'var(--muted)', marginTop: 4 },
  label: { display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6, fontWeight: 600, letterSpacing: '.4px', textTransform: 'uppercase' },
  input: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 14px', borderRadius: 8, outline: 'none', marginBottom: 18, boxSizing: 'border-box', fontSize: 14 },
  btn:   { width: '100%', background: 'var(--accent)', color: '#fff', border: 'none', padding: '11px', borderRadius: 8, fontWeight: 700, fontSize: 14, marginTop: 4, cursor: 'pointer' },
  err:   { background: 'rgba(248,81,73,.12)', border: '1px solid rgba(248,81,73,.3)', color: 'var(--red)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 },
  foot:  { textAlign: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 28 },
}

export default function Login() {
  const { signIn } = useAuth()
  const navigate   = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(username.trim(), password)
    if (error) {
      setError(error.message === 'Invalid login credentials'
        ? 'Incorrect username or password.'
        : error.message)
      setLoading(false)
    } else {
      navigate('/dashboard')
    }
  }

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.logo}>
          <span style={s.crown}>👑</span>
          <div style={s.title}>SureWin VIP CRM</div>
          <div style={s.sub}>Staff login</div>
        </div>

        {error && <div style={s.err}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <label style={s.label}>Username</label>
          <input
            style={s.input}
            type="text"
            placeholder="your username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
          />

          <label style={s.label}>Password</label>
          <input
            style={s.input}
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />

          <button style={s.btn} type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div style={s.foot}>Contact admin to reset your password.</div>
      </div>
    </div>
  )
}
