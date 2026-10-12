// src/components/alerts/BigWinLossBanner.jsx — compact "yesterday big win / big loss" card for the Today page
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../contexts/LanguageContext'
import { loadBigWinLoss } from '../../lib/bigWinLoss'

export default function BigWinLossBanner() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [res, setRes] = useState(null)

  useEffect(() => {
    let off = false
    loadBigWinLoss().then(r => { if (!off) setRes(r) }).catch(() => {})
    return () => { off = true }
  }, [])

  if (!res) return null
  const myName = profile?.full_name || ''
  const mine = rows => rows.filter(r => r.host === myName)
  const hasMine = myName && (mine(res.losses).length + mine(res.wins).length) > 0
  const losses = hasMine ? mine(res.losses) : res.losses
  const wins = hasMine ? mine(res.wins) : res.wins
  if (!losses.length && !wins.length) return null
  const gift = losses.filter(r => r.giftEligible).length

  return (
    <div onClick={() => navigate('/alerts?tab=winloss')}
      style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'inset 3px 0 0 #d29922' }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>💰 {L2('Big Win / Big Loss yesterday', '昨日大赢 / 大输')}</div>
      <div style={{ fontSize: 13, color: '#f85149', fontWeight: 700 }}>🔻 {losses.length} {L2('big loss', '大输')}</div>
      <div style={{ fontSize: 13, color: '#3fb950', fontWeight: 700 }}>🔺 {wins.length} {L2('big win', '大赢')}</div>
      {gift > 0 && <div style={{ fontSize: 12, color: '#d29922', fontWeight: 600 }}>🎁 {gift} {L2('gift-eligible', '可送礼')}</div>}
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
        {hasMine ? L2('Your VIPs', '我的VIP') : L2('All VIPs', '全部VIP')}{res.dataDate ? ` · ${L2('data', '数据')} ${res.dataDate}` : ''}
      </div>
      <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>{L2('View →', '查看 →')}</div>
    </div>
  )
}
