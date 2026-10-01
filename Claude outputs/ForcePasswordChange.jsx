// Shown when profile.must_change_password === true
// Blocks all navigation until the user sets a new password
import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'

const s = {
  overlay: { position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card:    { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '40px 36px', width: '100%', maxWidth: 420 },
  icon:    { fontSize: 40, textAlign: 'center', marginBottom: 12 },
  title:   { fontSize: 20, fontWeight: 700, color: 'var(--text)', textAlign: 'center', marginBottom: 6 },
  sub:     { fontSize: 13, color: 'var(--muted)', textAlign: 'center', marginBottom: 28, lineHeight: 1.5 },
  label:   { display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' },
  input:   { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 14px', borderRadius: 8, outline: 'none', marginBottom: 16, boxSizing: 'border-box', fontSize: 14 },
  btn:     { width: '100%', background: 'var(--accent)', color: '#fff', border: 'none', padding: '11px', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  err:     { background: 'rgba(248,81,73,.12)', border: '1px solid rgba(248,81,73,.3)', color: 'var(--red)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 },
  ok:      { background: 'rgba(63,185,80,.12)', border: '1px solid rgba(63,185,80,.3)', color: '#3fb950', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 },
}

export default function ForcePasswordChange() {
  const { changePassword, signOut, profile } = useAuth()
  const [pw,    setPw]    = useState('')
  const [pw2,   setPw2]   = useState('')
  const [msg,   setMsg]   = useState({ text: '', ok: true })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setMsg({ text: '', ok: true })
    if (pw.length < 6) { setMsg({ text: 'Password must be at least 6 characters.', ok: false }); return }
    if (pw !== pw2)    { setMsg({ text: 'Passwords do not match.', ok: false }); return }
    setSaving(true)
    const { error } = await changePassword(pw)
    if (error) {
      setMsg({ text: error.message, ok: false })
      setSaving(false)
    } else {
      setMsg({ text: '✅ Password updated! Loading…', ok: true })
    }
  }

  return (
    <div style={s.overlay}>
      <div style={s.card}>
        <div style={s.icon}>🔐</div>
        <div style={s.title}>Set Your Password</div>
        <div style={s.sub}>
          Welcome, <strong>{profile?.full_name || profile?.username}</strong>!<br />
          Please set a new password before you continue.
        </div>

        {msg.text && <div style={msg.ok ? s.ok : s.err}>{msg.text}</div>}

        <form onSubmit={handleSubmit}>
          <label style={s.label}>New Password</label>
          <input
            style={s.input}
            type="password"
            placeholder="At least 6 characters"
            value={pw}
            onChange={e => setPw(e.target.value)}
            required
            autoFocus
          />
          <label style={s.label}>Confirm Password</label>
          <input
            style={s.input}
            type="password"
            placeholder="Repeat your new password"
            value={pw2}
            onChange={e => setPw2(e.target.value)}
            required
          />
          <button style={s.btn} type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Set Password & Continue'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <button onClick={signOut} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12, cursor: 'pointer' }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
