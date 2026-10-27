import { useState } from 'react'
import { useLanguage } from '../contexts/LanguageContext'

// Small 📋 button next to a username or phone number: copies the text, shows ✅ for a moment.
// Safe inside clickable rows and links (does not open the row / follow the link).
export default function CopyBtn({ text, title, kind }) {
  const { lang } = useLanguage()
  const [done, setDone] = useState(false)
  if (text == null || String(text).trim() === '') return null
  const tip = title || (kind === 'phone'
    ? (lang === 'zh' ? '复制电话号码' : 'Copy phone number')
    : (lang === 'zh' ? '复制用户名' : 'Copy username'))
  const copy = e => {
    e.stopPropagation()
    e.preventDefault()
    navigator.clipboard?.writeText(String(text).trim())
    setDone(true)
    setTimeout(() => setDone(false), 1500)
  }
  return (
    <span role="button" tabIndex={0} title={tip} aria-label={tip}
      onClick={copy} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') copy(e) }}
      style={{ display:'inline-block', marginLeft:6, border:'1px solid var(--border)', borderRadius:5, padding:'0 5px', fontSize:11, lineHeight:'18px', cursor:'pointer', color: done ? '#3fb950' : 'var(--muted)', verticalAlign:'middle', fontWeight:400, userSelect:'none' }}>
      {done ? '✅' : '📋'}
    </span>
  )
}
