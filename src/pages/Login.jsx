import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useLanguage } from '../contexts/LanguageContext'

const s = {
  wrap:  { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '20px' },
  card:  { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '40px 36px', width: '100%', maxWidth: 400 },
  logo:  { textAlign: 'center', marginBottom: 32 },
  crown: { fontSize: 36, display: 'block', marginBottom: 8 },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--text)' },
  sub:   { fontSize: 13, color: 'var(--muted)', marginTop: 4 },
  label: { display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6, fontWeight: 600, letterSpacing: '.4px', textTransform: 'uppercase' },
  input: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 14px', borderRadius: 8, outline: 'none', marginBottom: 18 },
  btn:   { width: '100%', background: 'var(--accent)', color: '#fff', border: 'none', padding: '11px', borderRadius: 8, fontWeight: 700, fontSize: 14, marginTop: 4 },
  err:   { background: 'rgba(248,81,73,.12)', border: '1px solid rgba(248,81,73,.3)', color: 'var(--red)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 },
  foot:  { textAlign: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 28 },
}

export default function Login() {
  const { signIn } = useAuth()
  const navigate   = useNavigate()
  const { t } = useLanguage()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email, password)
    if (error) {
      setError(error.message === 'Invalid login credentials'
        ? t('login.wrongCredentials')
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
          <div style={s.sub}>{t('login.subtitle')}</div>
        </div>

        {error && <div style={s.err}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <label style={s.label}>{t('login.emailLabel')}</label>
          <input
            style={s.input}
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoFocus
          />

          <label style={s.label}>{t('login.passwordLabel')}</label>
          <input
            style={s.input}
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />

          <button style={s.btn} type="submit" disabled={loading}>
            {loading ? t('login.signingIn') : t('login.signIn')}
          </button>
        </form>

        <div style={s.foot}>
          {t('login.forgot')}
        </div>
      </div>
    </div>
  )
}
