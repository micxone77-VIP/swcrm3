// Shown when profile.must_change_password === true
// Blocks all navigation until the user sets a new password
import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useLanguage } from '../contexts/LanguageContext'

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
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [pw,    setPw]    = useState('')
  const [pw2,   setPw2]   = useState('')
  const [msg,   setMsg]   = useState({ text: '', ok: true })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setMsg({ text: '', ok: true })
    if (pw.length < 6) { setMsg({ text: L2('Password must be at least 6 characters.', '密码至少需要6个字符。'), ok: false }); return }
    if (pw !== pw2)    { setMsg({ text: L2('Passwords do not match.', '两次输入的密码不一致。'), ok: false }); return }
    setSaving(true)
    const { error } = await changePassword(pw)
    if (error) {
      setMsg({ text: error.message, ok: false })
      setSaving(false)
    } else {
      setMsg({ text: L2('✅ Password updated! Loading…', '✅ 密码已更新！载入中…'), ok: true })
    }
  }

  return (
    <div style={s.overlay}>
      <div style={s.card}>
        <div style={s.icon}>🔐</div>
        <div style={s.title}>{L2('Set Your Password', '设置您的密码')}</div>
        <div style={s.sub}>
          {L2('Welcome, ', '欢迎，')}<strong>{profile?.full_name || profile?.username}</strong>!<br />
          {L2('Please set a new password before you continue.', '继续之前请先设置新密码。')}
        </div>

        {msg.text && <div style={msg.ok ? s.ok : s.err}>{msg.text}</div>}

        <form onSubmit={handleSubmit}>
          <label style={s.label}>{L2('New Password', '新密码')}</label>
          <input
            style={s.input}
            type="password"
            placeholder={L2('At least 6 characters', '至少6个字符')}
            value={pw}
            onChange={e => setPw(e.target.value)}
            required
            autoFocus
          />
          <label style={s.label}>{L2('Confirm Password', '确认密码')}</label>
          <input
            style={s.input}
            type="password"
            placeholder={L2('Repeat your new password', '再次输入新密码')}
            value={pw2}
            onChange={e => setPw2(e.target.value)}
            required
          />
          <button style={s.btn} type="submit" disabled={saving}>
            {saving ? L2('Saving…', '保存中…') : L2('Set Password & Continue', '设置密码并继续')}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <button onClick={signOut} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12, cursor: 'pointer' }}>
            {L2('Sign out', '退出登录')}
          </button>
        </div>
      </div>
    </div>
  )
}
