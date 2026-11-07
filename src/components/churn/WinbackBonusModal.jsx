// Give a win-back bonus to one or more Churn / Dormant VIPs: saves winback_bonuses rows
// (+ an optional contact log, topic 'winback'). The result is worked out later by v_winback_results.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../contexts/LanguageContext'
import { formatMoney } from '../../lib/format'
import { BONUS_TYPES, RESULT_INFO, loadWinbackHistory, todayMYT } from '../../lib/winback'

const box = { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'24px 28px', width:520, maxWidth:'92vw', maxHeight:'88vh', overflowY:'auto' }
const input = { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'7px 10px', borderRadius:7, fontSize:13, outline:'none', width:'100%', boxSizing:'border-box' }
const lbl = { fontSize:12, color:'var(--muted)', marginBottom:4 }
const btnSm = { background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)', padding:'7px 14px', borderRadius:7, fontSize:12, cursor:'pointer' }

export const stageOf = v => v?.activity_status === 'Dormant' ? 'Dormant' : 'Churn'

export default function WinbackBonusModal({ players, onClose, onSaved }) {
  const { profile } = useAuth()
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [amount, setAmount] = useState('')
  const [bonusType, setBonusType] = useState('direct_credit')
  const [givenOn, setGivenOn] = useState(todayMYT())
  const [notes, setNotes] = useState('')
  const [logContact, setLogContact] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [history, setHistory] = useState(null)

  const list = players || []
  const currencies = [...new Set(list.map(p => p.currency || 'MYR'))]
  const single = list.length === 1 ? list[0] : null

  useEffect(() => {
    loadWinbackHistory(list.map(p => p.username)).then(setHistory).catch(() => setHistory([]))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const histBy = {}
  ;(history || []).forEach(h => { (histBy[h.username] = histBy[h.username] || []).push(h) })
  const bonusOnlyPlayers = list.filter(p => (histBy[p.username] || []).some(h => h.result === 'bonus_only'))

  async function save() {
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) { setErr(L2('Enter the bonus amount.', '请输入奖金金额。')); return }
    if (!givenOn) { setErr(L2('Pick the date the bonus was given.', '请选择发放日期。')); return }
    setSaving(true); setErr('')
    const hostName = profile?.full_name || profile?.username || 'Host'
    const rows = list.map(p => ({
      username: p.username, vip_id: p.id || p.vip_id || null, tier: p.tier || null, currency: p.currency || 'MYR',
      stage: stageOf(p), days_inactive: p.days_inactive ?? p.days_since_deposit ?? null, last_deposit_date: p.last_deposit_date || null,
      bonus_type: bonusType, amount: amt, given_on: givenOn, host_name: hostName, host_id: profile?.id || null, notes: notes.trim() || null,
    }))
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await supabase.from('winback_bonuses').insert(rows.slice(i, i + 100))
      if (error) { setErr(L2('Save failed: ', '保存失败：') + error.message); setSaving(false); return }
    }
    let logWarn = ''
    if (logContact) {
      const myt = new Date(Date.now() + 8 * 3600000)
      const nowIso = new Date().toISOString()
      const typeEn = BONUS_TYPES[bonusType].en
      const logs = list.map(p => ({
        username: p.username, tier: p.tier || null, channel: 'Other', outcome: 'Contacted', direction: 'outbound', topic: 'winback',
        message_summary: `Win-back bonus (${typeEn}) ${formatMoney(amt, p.currency || 'MYR')} given on ${givenOn}, ${stageOf(p)} ${p.days_inactive ?? p.days_since_deposit ?? '?'} days${notes.trim() ? ` · ${notes.trim()}` : ''}`,
        bonus_offered: amt, bonus_type: `Win-back: ${typeEn}`,
        host_name: hostName, host_id: profile?.id || null, logged_at: nowIso,
        log_month: myt.toISOString().slice(0, 7), log_week: String(Math.ceil(myt.getUTCDate() / 7)),
      }))
      for (let i = 0; i < logs.length; i += 100) {
        const { error } = await supabase.from('contact_logs').insert(logs.slice(i, i + 100))
        if (error) { logWarn = error.message; break }
      }
    }
    setSaving(false)
    onSaved?.(logWarn ? L2(`Bonus saved, but the contact log failed: ${logWarn}`, `奖金已保存，但联系记录失败：${logWarn}`) : null)
    onClose()
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div style={box} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:17, fontWeight:700, marginBottom:4 }}>🎁 {L2('Give win-back bonus', '发放召回奖金')}</div>
        <div style={{ fontSize:13, color:'var(--muted)', marginBottom:16 }}>
          {single
            ? <><b style={{ color:'var(--text)' }}>{single.username}</b>{single.full_name ? ` · ${single.full_name}` : ''} · {single.tier} · {L2(stageOf(single), stageOf(single) === 'Dormant' ? '休眠' : '流失')} {single.days_inactive ?? single.days_since_deposit ?? '?'}{L2(' days', '天')}</>
            : L2(`${list.length} players selected`, `已选 ${list.length} 位玩家`)}
        </div>

        {!single && (
          <div style={{ maxHeight:120, overflowY:'auto', border:'1px solid var(--border)', borderRadius:8, padding:'6px 10px', marginBottom:14, fontSize:12 }}>
            {list.map(p => <div key={p.username} style={{ display:'flex', justifyContent:'space-between', gap:8, padding:'2px 0' }}><span><b>{p.username}</b>{p.full_name ? <span style={{ color:'var(--muted)' }}> · {p.full_name}</span> : null}</span><span style={{ color:'var(--muted)', whiteSpace:'nowrap' }}>{p.tier} · {L2(stageOf(p), stageOf(p) === 'Dormant' ? '休眠' : '流失')} {p.days_inactive ?? '?'}{L2('d', '天')} · {p.currency || 'MYR'}</span></div>)}
          </div>
        )}

        {bonusOnlyPlayers.length > 0 && (
          <div style={{ background:RESULT_INFO.bonus_only.bg, border:'1px solid rgba(210,153,34,.35)', color:RESULT_INFO.bonus_only.color, borderRadius:8, padding:'8px 12px', fontSize:12, marginBottom:14 }}>
            ⚠️ {L2('Took a win-back bonus before without depositing:', '之前领过召回奖金但没存款：')} <b>{bonusOnlyPlayers.map(p => p.username).join(', ')}</b>
          </div>
        )}
        {single && (histBy[single.username] || []).length > 0 && (
          <div style={{ fontSize:12, color:'var(--muted)', marginBottom:14 }}>
            {L2('Past win-back bonuses:', '以往召回奖金：')}
            {(histBy[single.username] || []).slice(0, 5).map((h, i) => <div key={i}>• {h.given_on} · {formatMoney(h.amount, h.currency)} · {RESULT_INFO[h.result]?.icon} {L2(RESULT_INFO[h.result]?.en, RESULT_INFO[h.result]?.zh)}</div>)}
          </div>
        )}

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
          <div>
            <div style={lbl}>{L2('Bonus amount', '奖金金额')} ({currencies.join(' / ')})</div>
            <input type="number" min="0" step="0.01" style={input} value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" autoFocus />
          </div>
          <div>
            <div style={lbl}>{L2('Date given', '发放日期')}</div>
            <input type="date" style={input} value={givenOn} max={todayMYT()} onChange={e => setGivenOn(e.target.value)} />
          </div>
        </div>
        {currencies.length > 1 && <div style={{ fontSize:11, color:'#d29922', marginBottom:10 }}>{L2('Players use different currencies: each gets this amount in their own currency.', '玩家使用不同货币：每人按自己的货币发放此金额。')}</div>}

        <div style={{ marginBottom:12 }}>
          <div style={lbl}>{L2('Bonus type', '奖金类型')}</div>
          <div style={{ display:'flex', gap:8 }}>
            {Object.entries(BONUS_TYPES).map(([k, v]) => (
              <button key={k} type="button" onClick={() => setBonusType(k)} style={{ ...btnSm, flex:1, fontWeight:700, background:bonusType === k ? 'var(--accent)' : 'var(--surface2)', color:bonusType === k ? '#fff' : 'var(--text)' }}>{L2(v.en, v.zh)}</button>
            ))}
          </div>
          <div style={{ fontSize:11, color:'var(--muted)', marginTop:4 }}>
            {bonusType === 'direct_credit' ? L2('Credit put straight into the account.', '直接存入玩家账户。') : L2('Only paid if the player deposits.', '玩家存款后才发放。')}
          </div>
        </div>

        <div style={{ marginBottom:12 }}>
          <div style={lbl}>{L2('Note (optional)', '备注（可选）')}</div>
          <textarea rows={2} style={{ ...input, resize:'vertical', fontFamily:'inherit' }} value={notes} onChange={e => setNotes(e.target.value)} placeholder={L2('e.g. told the player on WA, 1x turnover', '例如：已WA通知，1倍流水')} />
        </div>

        <label style={{ display:'flex', gap:8, alignItems:'center', fontSize:12, marginBottom:16, cursor:'pointer' }}>
          <input type="checkbox" checked={logContact} onChange={e => setLogContact(e.target.checked)} />
          {L2('Also add to the contact log', '同时记录到联系记录')}
        </label>

        <div style={{ fontSize:11, color:'var(--muted)', marginBottom:14 }}>
          {L2('The CRM checks the daily import afterwards: deposit within 7 days = came back. You will see the result in the 🎁 Win-back tab.', 'CRM 会根据每日数据自动检查：7天内存款 = 已回归。结果在 🎁 召回奖金 分页查看。')}
        </div>

        {err && <div style={{ color:'#f85149', fontSize:12, marginBottom:10 }}>{err}</div>}
        <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button style={btnSm} onClick={onClose}>{L2('Cancel', '取消')}</button>
          <button style={{ background:'#a855f7', color:'#fff', border:'none', padding:'8px 18px', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer', opacity:saving ? .6 : 1 }} onClick={save} disabled={saving}>
            {saving ? L2('Saving…', '保存中…') : L2(`🎁 Save bonus${list.length > 1 ? ` for ${list.length}` : ''}`, `🎁 保存奖金${list.length > 1 ? `（${list.length}位）` : ''}`)}
          </button>
        </div>
      </div>
    </div>
  )
}
