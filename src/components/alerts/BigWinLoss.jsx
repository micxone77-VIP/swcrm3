// src/components/alerts/BigWinLoss.jsx — Alerts → "💰 Big Win / Big Loss" tab
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../contexts/LanguageContext'
import { formatMoney } from '../../lib/format'
import { TIER_COLOR, TIER_BG } from '../../lib/constants'
import { loadBigWinLoss, saveWinLossSettings, WINLOSS_TIERS } from '../../lib/bigWinLoss'
import { WaButton } from '../WaSenderModal'
import { enumLabel } from '../../lib/enums'

const th = { textAlign: 'left', padding: '8px 10px', color: 'var(--muted)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }
const td = { padding: '9px 10px', borderBottom: '1px solid var(--border)', fontSize: 13, whiteSpace: 'nowrap' }
const btn = { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
const inp = { width: 90, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 6px', borderRadius: 5, fontSize: 12 }
const daysAgo = d => (d ? Math.max(0, Math.floor((Date.now() - new Date(d)) / 86400000)) : null)

export default function BigWinLoss() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const myName = profile?.full_name || ''
  const isAdmin = profile?.role === 'admin'

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [scope, setScope] = useState('mine') // 'mine' | 'all'
  const [editOpen, setEditOpen] = useState(false)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)

  async function load(settings) {
    setLoading(true); setErr('')
    try { const d = await loadBigWinLoss({ settings }); setData(d); setDraft(JSON.parse(JSON.stringify(d.settings))) }
    catch (e) { console.error('BigWinLoss load', e); setErr(e.message || String(e)) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function saveSettings() {
    setSaving(true)
    const clean = {
      ...draft,
      tiers: Object.fromEntries(Object.entries(draft.tiers).map(([k, v]) => [k, { loss: Number(v.loss) || 0, win: Number(v.win) || 0, withdraw: Number(v.withdraw) || 0, spike: Number(v.spike) || 0 }])),
      fx_to_myr: Object.fromEntries(Object.entries(draft.fx_to_myr).map(([k, v]) => [k, Number(v) || 1])),
      gift_loss_rule: Number(draft.gift_loss_rule) || 0,
      withdraw_x: Number(draft.withdraw_x) || 0,
      spike_x: Number(draft.spike_x) || 0,
      drop_pct: Number(draft.drop_pct) || 0,
    }
    const { error } = await saveWinLossSettings(clean, myName)
    setSaving(false)
    if (error) { alert(L2('Save failed: ', '保存失败：') + error.message); return }
    setEditOpen(false); load(clean)
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>{L2('Loading…', '载入中…')}</div>
  if (err) return <div style={{ padding: 24, color: '#f85149' }}>{err}</div>

  const mine = r => r.host === myName
  const losses = scope === 'mine' ? data.losses.filter(mine) : data.losses
  const wins = scope === 'mine' ? data.wins.filter(mine) : data.wins
  const withdrawals = scope === 'mine' ? data.withdrawals.filter(mine) : data.withdrawals
  const spikes = scope === 'mine' ? data.spikes.filter(mine) : data.spikes
  const drops = scope === 'mine' ? data.drops.filter(mine) : data.drops
  const ALL = ['losses', 'wins', 'withdrawals', 'spikes', 'drops']
  const myCount = ALL.reduce((s, k) => s + data[k].filter(mine).length, 0)
  const allCount = ALL.reduce((s, k) => s + data[k].length, 0)

  // Care / congrats message for the shared WA popup (auto-logs the contact)
  const waInfo = (r, kind) => {
    const raw = (r.phone && r.phone.replace(/\D/g, '').length >= 10) ? r.phone : (r.whatsapp && r.whatsapp.replace(/\D/g, '').length >= 10) ? r.whatsapp : ''
    if (!raw.replace(/\D/g, '')) return null
    const host = myName || 'Agent'
    const intro = `Hi bro *${r.username}*! 👋 I'm ${host} from sureWin VIP department.`
    const introCn = `嗨 *${r.username}*！👋 我是sureWin VIP部门的${host}。`
    return kind === 'loss'
      ? { en: `${intro}

Just checking on you bro, hope everything ok 🙏 Anything I can help, just tell me anytime ya.`,
          cn: `${introCn}

来关心一下你，希望一切都好 🙏 有什么需要帮忙的随时跟我说哦。`, label: 'Big loss care' }
      : { en: `${intro}

Congrats bro on your big win yesterday! 🎉 Need anything, I'm here ya 💎`,
          cn: `${introCn}

恭喜你昨天大赢！🎉 有什么需要随时找我 💎`, label: 'Big win congrats' }
  }

  const money = (v, cur) => formatMoney(Math.abs(Number(v) || 0), cur)
  const signed = (v, cur) => { const x = Number(v) || 0; return <span style={{ color: x < 0 ? '#f85149' : x > 0 ? '#3fb950' : 'var(--muted)', fontWeight: 600 }}>{x < 0 ? '−' : x > 0 ? '+' : ''}{money(x, cur)}</span> }

  const table = (list, kind) => (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={th}>#</th><th style={th}>VIP</th><th style={th}>{L2('Tier', '等级')}</th><th style={th}>{L2('Host', '负责人')}</th>
          <th style={th}>{kind === 'loss' ? L2('Lost yesterday', '昨日输') : L2('Won yesterday', '昨日赢')}</th>
          <th style={th}>{L2('Dep / WD yesterday', '昨日存 / 提')}</th>
          <th style={th}>{L2('7-day net', '7天净输赢')}</th><th style={th}>{L2('30-day net', '30天净输赢')}</th>
          <th style={th}>{L2('Net since Jun', '6月至今净输赢')}</th>
          <th style={th}>{L2('Last contact', '最后联系')}</th><th style={th}>{L2('Flag', '标记')}</th><th style={th}></th>
        </tr></thead>
        <tbody>
          {list.map((r, i) => {
            const wa = waInfo(r, kind)
            const dc = daysAgo(r.lastContact)
            return (
              <tr key={r.username} style={{ cursor: 'pointer' }} onClick={() => r.id && navigate(`/vips/${r.id}`)}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)' }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                <td style={{ ...td, color: 'var(--muted)', fontSize: 12 }}>{i + 1}</td>
                <td style={td}><b>{r.username}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.full_name}{r.affiliate ? ` · ${r.affiliate}` : ''}</div></td>
                <td style={td}><span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: TIER_BG[r.tier] || 'transparent', color: TIER_COLOR[r.tier] || 'var(--text)' }}>{r.tier}</span></td>
                <td style={{ ...td, color: r.host === myName ? 'var(--brand, #FF6B00)' : 'var(--muted)', fontWeight: r.host === myName ? 700 : 400 }}>{r.host || '—'}</td>
                <td style={{ ...td, fontSize: 15, fontWeight: 800, color: kind === 'loss' ? '#f85149' : '#3fb950' }}>
                  {kind === 'loss' ? '−' : '+'}{money(r.wl_day, r.currency)}
                  {r.currency !== 'MYR' && <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>≈ RM {Math.round(Math.abs(r.dayMyr)).toLocaleString()}</div>}
                </td>
                <td style={{ ...td, fontSize: 12 }}>{money(r.dep_day, r.currency)} / <span style={{ color: Number(r.wd_day) > 0 ? '#d29922' : 'inherit' }}>{money(r.wd_day, r.currency)}</span></td>
                <td style={td}>{signed(r.wl_7d, r.currency)}</td>
                <td style={td}>{signed(r.wl_30d, r.currency)}</td>
                <td style={td}>{signed(r.wl_since_start, r.currency)}</td>
                <td style={{ ...td, fontSize: 12, color: dc === null || dc >= 3 ? '#d29922' : 'var(--muted)' }}>
                  {dc === null ? L2('Never', '从未') : dc === 0 ? L2('Today', '今天') : L2(`${dc}d ago`, `${dc}天前`)}
                  {r.lastContactHost && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{r.lastContactHost}</div>}
                </td>
                <td style={{ ...td, fontSize: 11 }}>
                  {kind === 'loss' && r.giftEligible && <div style={{ color: '#f472b6', fontWeight: 700 }} title={L2('Net loss since Jun passes the big-loss gift rule', '6月至今净亏损已达大额亏损礼物标准')}>🎁 {L2('Gift rule', '礼物标准')}</div>}
                  {kind === 'win' && r.withdrew && <div style={{ color: '#d29922', fontWeight: 700 }}>💸 {L2('Withdrew yesterday', '昨日已提款')}</div>}
                </td>
                <td style={td} onClick={e => e.stopPropagation()}>
                  {wa && <WaButton vip={r} templates={wa} logLabel={wa.label} style={{ display: 'inline-flex', width: 26, height: 26, borderRadius: 13, background: '#25D366', color: '#fff', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, textDecoration: 'none', marginRight: 6 }}>W</WaButton>}
                  <button style={btn} onClick={() => r.id && navigate(`/vips/${r.id}`)}>{L2('Open', '打开')}</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )

  const section = (title, sub, color, list, kind) => (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: 15, color }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('Total', '共')} <b style={{ color }}>{list.length}</b> · {sub}</div>
      </div>
      {list.length === 0 ? <div style={{ padding: 18, color: 'var(--muted)', fontSize: 13 }}>{L2('None above the threshold.', '没有超过门槛的玩家。')}</div> : table(list, kind)}
    </div>
  )

  // ── Money alerts: big withdrawal / deposit spike / deposit drop (get_money_alerts) ──
  const moneyWa = (r, kind) => {
    if (!(r.phone || r.whatsapp)) return null
    if (kind === 'drop') return { purpose: 'decline', logLabel: 'Deposit drop check-in' }
    const host = myName || 'Agent'
    const intro = `Hi bro *${r.username}*! 👋 I'm ${host} from sureWin VIP department.`
    const introCn = `嗨 *${r.username}*！👋 我是sureWin VIP部门的${host}。`
    return kind === 'withdrawal'
      ? { templates: { en: `${intro}\n\nSaw you cashed out yesterday — congrats bro 🎉 enjoy ya!\nAny new promo coming I'll let you know first 💎`,
                       cn: `${introCn}\n\n看到你昨天提款了，恭喜恭喜 🎉 好好享受～\n之后有什么新优惠我第一时间通知你 💎` }, logLabel: 'Big withdrawal check-in' }
      : { templates: { en: `${intro}\n\nThanks for the big support yesterday bro 🙏\nAnything you need — VIP perks, promo — just tell me ya 💎`,
                       cn: `${introCn}\n\n谢谢你昨天的大力支持 🙏\n有什么需要，VIP 福利或优惠，随时跟我说哦 💎` }, logLabel: 'Deposit spike thank-you' }
  }
  const moneyTable = (list, kind) => (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={th}>#</th><th style={th}>VIP</th><th style={th}>{L2('Tier', '等级')}</th><th style={th}>{L2('Host', '负责人')}</th>
          {kind === 'withdrawal' && <><th style={th}>{L2('Withdrew yesterday', '昨日提款')}</th><th style={th}>{L2('Usual deposit', '平常每次存款')}</th><th style={th}>{L2('Win/loss yesterday', '昨日输赢')}</th></>}
          {kind === 'spike' && <><th style={th}>{L2('Deposited yesterday', '昨日存款')}</th><th style={th}>{L2('Usual deposit', '平常每次存款')}</th></>}
          {kind === 'drop' && <><th style={th}>{L2('Last 7 days', '最近7天存款')}</th><th style={th}>{L2('7 days before', '前7天存款')}</th><th style={th}>{L2('Drop', '下降')}</th></>}
          <th style={th}>{L2('Status', '状态')}</th><th style={th}>{L2('Last contact', '最后联系')}</th><th style={th}></th>
        </tr></thead>
        <tbody>
          {list.map((r, i) => {
            const wa = moneyWa(r, kind)
            const dc = daysAgo(r.lastContact)
            return (
              <tr key={r.username} style={{ cursor: 'pointer' }} onClick={() => r.id && navigate(`/vips/${r.id}`)}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)' }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                <td style={{ ...td, color: 'var(--muted)', fontSize: 12 }}>{i + 1}</td>
                <td style={td}><b>{r.username}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.full_name}{r.affiliate ? ` · ${r.affiliate}` : ''}</div></td>
                <td style={td}><span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: TIER_BG[r.tier] || 'transparent', color: TIER_COLOR[r.tier] || 'var(--text)' }}>{r.tier}</span></td>
                <td style={{ ...td, color: r.host === myName ? 'var(--brand, #FF6B00)' : 'var(--muted)', fontWeight: r.host === myName ? 700 : 400 }}>{r.host || '—'}</td>
                {kind !== 'drop' && (
                  <td style={{ ...td, fontSize: 15, fontWeight: 800, color: kind === 'withdrawal' ? '#d29922' : '#3fb950' }}>
                    {money(r.amount, r.currency)}
                    {r.currency !== 'MYR' && <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>≈ RM {Math.round(r.amountMyr).toLocaleString()}</div>}
                  </td>
                )}
                {kind !== 'drop' && <td style={{ ...td, fontSize: 12 }}>{r.usual_dep ? money(r.usual_dep, r.currency) : '—'}{r.ratio ? <b style={{ marginLeft: 6 }}>{Number(r.ratio).toFixed(1)}×</b> : null}</td>}
                {kind === 'withdrawal' && <td style={td}>{signed(r.wl_day, r.currency)}</td>}
                {kind === 'drop' && <>
                  <td style={{ ...td, fontWeight: 700 }}>{money(r.last7, r.currency)}</td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{money(r.prev7, r.currency)}</td>
                  <td style={{ ...td, fontSize: 15, fontWeight: 800, color: '#f85149' }}>−{r.drop_pct}%</td>
                </>}
                <td style={{ ...td, fontSize: 12 }}>{enumLabel(r.status, lang) || '—'}</td>
                <td style={{ ...td, fontSize: 12, color: dc === null || dc >= 3 ? '#d29922' : 'var(--muted)' }}>
                  {dc === null ? L2('Never', '从未') : dc === 0 ? L2('Today', '今天') : L2(`${dc}d ago`, `${dc}天前`)}
                  {r.lastContactHost && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{r.lastContactHost}</div>}
                </td>
                <td style={td} onClick={e => e.stopPropagation()}>
                  {wa && <WaButton vip={r} templates={wa.templates} purpose={wa.purpose} logLabel={wa.logLabel} style={{ display: 'inline-flex', width: 26, height: 26, borderRadius: 13, background: '#25D366', color: '#fff', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, marginRight: 6 }}>W</WaButton>}
                  <button style={btn} onClick={() => r.id && navigate(`/vips/${r.id}`)}>{L2('Open', '打开')}</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
  const moneySection = (title, sub, color, list, kind) => (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: 15, color }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('Total', '共')} <b style={{ color }}>{list.length}</b> · {sub}</div>
      </div>
      {list.length === 0 ? <div style={{ padding: 18, color: 'var(--muted)', fontSize: 13 }}>{L2('None above the threshold.', '没有超过门槛的玩家。')}</div> : moneyTable(list, kind)}
    </div>
  )

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ fontSize: 13 }}>{L2('Data date', '数据日期')}: <b>{data.dataDate || '—'}</b> <span style={{ color: 'var(--muted)' }}>{L2('(latest daily upload)', '（最新每日上传）')}</span></div>
        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginLeft: 'auto' }}>
          {[['mine', L2(`My VIPs (${myCount})`, `我的VIP（${myCount}）`)], ['all', L2(`All VIPs (${allCount})`, `全部VIP（${allCount}）`)]].map(([k, l]) => (
            <button key={k} onClick={() => setScope(k)} style={{ border: 'none', padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: scope === k ? 'var(--brand, #FF6B00)' : 'transparent', color: scope === k ? '#fff' : 'var(--muted)' }}>{l}</button>
          ))}
        </div>
        <button style={btn} onClick={() => setEditOpen(o => !o)}>⚙️ {L2('Thresholds by tier', '各等级门槛')}</button>
      </div>

      {editOpen && draft && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 16, background: 'var(--surface2)' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{L2('Alert when one day’s win or loss (in MYR) is at least:', '单日输或赢（以RM计）达到以下金额时提醒：')}</div>
          <table style={{ borderCollapse: 'collapse', marginBottom: 10 }}>
            <thead><tr><th style={th}>{L2('Tier', '等级')}</th><th style={th}>{L2('Big loss ≥ RM', '大输 ≥ RM')}</th><th style={th}>{L2('Big win ≥ RM', '大赢 ≥ RM')}</th>
              <th style={th}>{L2('Big withdrawal ≥ RM', '大额提款 ≥ RM')}</th><th style={th}>{L2('Deposit spike from RM', '存款暴增 最低 RM')}</th></tr></thead>
            <tbody>{WINLOSS_TIERS.map(t => (
              <tr key={t}>
                <td style={{ ...td, fontWeight: 700 }}>{t}</td>
                {['loss', 'win', 'withdraw', 'spike'].map(f => (
                  <td key={f} style={td}><input type="number" style={inp} disabled={!isAdmin} value={draft.tiers[t]?.[f] ?? ''} onChange={e => setDraft(d => ({ ...d, tiers: { ...d.tiers, [t]: { ...d.tiers[t], [f]: e.target.value } } }))} /></td>
                ))}
              </tr>
            ))}</tbody>
          </table>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, marginBottom: 10 }}>
            <span>💸 {L2('Big withdrawal also ≥', '大额提款也要 ≥')} <input type="number" step="0.5" style={{ ...inp, width: 50 }} disabled={!isAdmin} value={draft.withdraw_x} onChange={e => setDraft(d => ({ ...d, withdraw_x: e.target.value }))} /> {L2('× usual deposit', '× 平常每次存款')}</span>
            <span>📈 {L2('Spike = deposit ≥', '暴增 = 存款 ≥')} <input type="number" step="0.5" style={{ ...inp, width: 50 }} disabled={!isAdmin} value={draft.spike_x} onChange={e => setDraft(d => ({ ...d, spike_x: e.target.value }))} /> {L2('× usual deposit', '× 平常每次存款')}</span>
            <span>📉 {L2('Drop = last 7 days ≥', '骤降 = 最近7天少了 ≥')} <input type="number" style={{ ...inp, width: 50 }} disabled={!isAdmin} value={draft.drop_pct} onChange={e => setDraft(d => ({ ...d, drop_pct: e.target.value }))} />% {L2('below the 7 days before (7 days before ≥ 2 × spike minimum)', '（和前7天比；前7天至少 2 × 暴增最低额）')}</span>
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
            <span>{L2('FX to MYR', '汇率换算RM')}: SGD <input type="number" step="0.01" style={{ ...inp, width: 60 }} disabled={!isAdmin} value={draft.fx_to_myr.SGD} onChange={e => setDraft(d => ({ ...d, fx_to_myr: { ...d.fx_to_myr, SGD: e.target.value } }))} /> · KHUSD <input type="number" step="0.01" style={{ ...inp, width: 60 }} disabled={!isAdmin} value={draft.fx_to_myr.KHUSD} onChange={e => setDraft(d => ({ ...d, fx_to_myr: { ...d.fx_to_myr, KHUSD: e.target.value } }))} /></span>
            <span>{L2('🎁 Gift rule: net loss since Jun ≥ RM', '🎁 礼物标准：6月至今净亏损 ≥ RM')} <input type="number" style={inp} disabled={!isAdmin} value={draft.gift_loss_rule} onChange={e => setDraft(d => ({ ...d, gift_loss_rule: e.target.value }))} /></span>
            {isAdmin ? <button style={{ ...btn, background: 'var(--brand, #FF6B00)', color: '#fff', border: 'none' }} disabled={saving} onClick={saveSettings}>{saving ? '…' : L2('Save for everyone', '保存（全员适用）')}</button>
              : <span style={{ color: 'var(--muted)' }}>{L2('Only admins can change thresholds.', '只有管理员可以修改门槛。')}</span>}
          </div>
        </div>
      )}

      {section(L2('🔻 Big Loss', '🔻 大输'), L2('Care call — check on them so they don’t leave unhappy', '关怀联系 — 关心玩家，避免带着不满离开'), '#f85149', losses, 'loss')}
      {section(L2('🔺 Big Win', '🔺 大赢'), L2('Congratulate — keep them engaged (big winners often withdraw and leave)', '恭喜玩家 — 保持互动（大赢玩家常提款离开）'), '#3fb950', wins, 'win')}
      {moneySection(L2('💸 Big Withdrawal', '💸 大额提款'), L2('Cashed out much more than they usually deposit — contact today, they may not come back', '提款远超平常存款 — 今天就联系，可能提完就不回来'), '#d29922', withdrawals, 'withdrawal')}
      {moneySection(L2('📈 Deposit Spike', '📈 存款暴增'), L2('Deposited far more than usual — chance to upgrade / offer a campaign, or check they are not chasing losses', '存款远超平常 — 可以推升级 / 活动，也留意是不是在追输'), '#3fb950', spikes, 'spike')}
      {moneySection(L2('📉 Deposit Drop (weekly watch)', '📉 存款骤降（每周观察）'), L2('Still playing, but deposits fell sharply vs the week before — reach out before they churn', '还在玩，但存款比前一周大跌 — 在流失之前先联系'), '#f85149', drops, 'drop')}
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
        {L2('Win/loss is from the daily platform upload (player view: − = player lost). "Net since Jun" covers the data available in the CRM (from June 2026), not full lifetime.',
            '输赢数据来自每日平台上传（玩家角度：− 为玩家输）。「6月至今」为CRM现有数据（自2026年6月起），并非完整终身数据。')}
      </div>
    </div>
  )
}
