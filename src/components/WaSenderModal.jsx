// src/components/WaSenderModal.jsx — shared WhatsApp sender modal
import { useState } from 'react'
import { useLanguage } from '../contexts/LanguageContext'

export default function WaSenderModal({ vip, waNumbers, myName, onClose }) {
  const [sender, setSender] = useState(waNumbers[0]?.codename || '')
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const rawWa = (vip.whatsapp || vip.phone || '').replace(/[\s\-()]/g, '')
  const waNumber = rawWa.startsWith('+') ? rawWa.slice(1) : rawWa
  function openWA() {
    const text = `Hi ${vip.username}, this is ${myName || 'your VIP host'} from SureWin.`
    window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(text)}`, '_blank')
    onClose()
  }
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:24, width:340, boxShadow:'0 16px 48px rgba(0,0,0,.5)' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight:700, marginBottom:12, fontSize:15 }}>💬 WhatsApp {vip.username}</div>
        {waNumbers.length > 0 ? (
          <>
            <div style={{ fontSize:12, color:'var(--muted)', marginBottom:6 }}>{L2('Send as (codename)', '发送身份（代号）')}</div>
            <select value={sender} onChange={e => setSender(e.target.value)}
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 12px', borderRadius:8, fontSize:13, outline:'none', marginBottom:14 }}>
              {waNumbers.map(n => <option key={n.id} value={n.codename}>{n.codename} — {n.number}{n.telco?' ('+n.telco+')':''}</option>)}
            </select>
          </>
        ) : (
          <div style={{ fontSize:12, color:'var(--muted)', marginBottom:14 }}>{L2('No active WA numbers. ', '没有可用的WA号码。')}<a href="/wa-numbers" style={{ color:'var(--accent)' }}>{L2('Add one', '添加')}</a></div>
        )}
        {!waNumber && <div style={{ fontSize:12, color:'#d29922', marginBottom:12 }}>⚠️ {L2('No phone/WhatsApp on file for this VIP.', '此VIP没有登记电话/WhatsApp。')}</div>}
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button onClick={onClose} style={{ background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 16px', borderRadius:8, cursor:'pointer', fontSize:13 }}>{L2('Cancel', '取消')}</button>
          <button onClick={openWA} disabled={!waNumber}
            style={{ background:'#25D366', border:'none', color:'#fff', padding:'8px 18px', borderRadius:8, fontWeight:700, fontSize:13, cursor:waNumber?'pointer':'not-allowed', opacity:waNumber?1:0.5 }}>
            {L2('Open WhatsApp', '打开WhatsApp')}
          </button>
        </div>
      </div>
    </div>
  )
}
