// src/components/vip/PotentialProfile.jsx — VIP360 view for Silver / Bronze players (potential_players)
// They are NOT in the VIP list (no KPIs, queues, churn). Data comes from the daily CSV import:
//   potential_players         → lifetime totals + the last imported day
//   potential_daily_snapshots → daily turnover history
// Also exports PotentialSearch: "Silver / Bronze matches" list for search boxes.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../contexts/LanguageContext'

const TIER_STYLE = { SILVER: ['#c0c7d1', '🥈'], BRONZE: ['#cd7f32', '🥉'] }
const sym = c => (String(c || '').toUpperCase() === 'SGD' ? 'SGD ' : String(c || '').toUpperCase() === 'KHUSD' ? 'USD ' : 'RM ')
const fmt = v => Math.round(Number(v) || 0).toLocaleString('en-MY')

export function PotentialSearch({ query, limit = 15 }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const q = String(query || '').trim()

  useEffect(() => {
    if (q.length < 3) { setRows([]); return }
    let off = false
    const t = setTimeout(async () => {
      const { data } = await supabase.from('potential_players')
        .select('username, tier, currency, monthly_valid_bet, total_deposit, is_graduated')
        .ilike('username', `%${q.replace(/[%_]/g, '')}%`).eq('is_graduated', false).order('total_deposit', { ascending: false }).limit(limit)
      if (!off) setRows(data || [])
    }, 300)
    return () => { off = true; clearTimeout(t) }
  }, [q, limit])

  if (!rows.length) return null
  return (
    <div style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, background: 'var(--surface)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>
        🥈🥉 {L2('Silver / Bronze matches (not in VIP list)', '银 / 铜级匹配（不在VIP名单）')} · {rows.length}{rows.length === limit ? '+' : ''}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {rows.map(r => {
          const [col, ic] = TIER_STYLE[r.tier] || ['var(--muted)', '•']
          return (
            <button key={r.username} onClick={() => navigate(`/vip360?player=${encodeURIComponent(r.username)}`)}
              style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${col}66`, background: 'var(--surface2)', color: 'var(--text)', cursor: 'pointer', fontSize: 13, textAlign: 'left' }}>
              <span style={{ fontWeight: 700 }}>{ic} {r.username}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>{r.tier} · {String(r.currency || 'MYR').toUpperCase()} · {L2('lifetime dep', '累计存款')} {sym(r.currency)}{fmt(r.total_deposit)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function PotentialProfile({ p }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const navigate = useNavigate()
  const [daily, setDaily] = useState(null)
  const [copied, setCopied] = useState(false)
  const cur = String(p.currency || 'MYR').toUpperCase()
  const [col, ic] = TIER_STYLE[p.tier] || ['var(--muted)', '•']

  useEffect(() => {
    let off = false
    supabase.from('potential_daily_snapshots').select('snapshot_date, tier, monthly_valid_bet')
      .eq('username', p.username).order('snapshot_date', { ascending: false }).limit(90)
      .then(({ data }) => { if (!off) setDaily(data || []) })
    return () => { off = true }
  }, [p.username])

  const d30 = (daily || []).slice(0, 30)
  const sum30 = d30.reduce((s, r) => s + (Number(r.monthly_valid_bet) || 0), 0)
  const act30 = d30.filter(r => Number(r.monthly_valid_bet) > 0).length
  const maxVb = Math.max(1, ...(daily || []).map(r => Number(r.monthly_valid_bet) || 0))
  const lastActive = (daily || []).find(r => Number(r.monthly_valid_bet) > 0)?.snapshot_date

  const card = { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }
  const stat = (label, value, color, sub) => (
    <div style={card}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || 'var(--text)', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )

  return (
    <div style={{ padding: 24, maxWidth: 1400 }}>
      <div onClick={() => navigate(-1)} style={{ fontSize: 13, color: 'var(--muted)', cursor: 'pointer', marginBottom: 12 }}>← {L2('Back', '返回')}</div>

      <div style={{ ...card, padding: 20, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ width: 54, height: 54, borderRadius: '50%', border: `2px solid ${col}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>{ic}</div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 800 }}>{p.username}</span>
            <button onClick={() => { navigator.clipboard.writeText(p.username); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
              style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: copied ? '#3fb950' : 'var(--muted)', cursor: 'pointer' }}>{copied ? '✅' : '📋'}</button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 9px', borderRadius: 10, background: col + '22', color: col, border: `1px solid ${col}66` }}>{p.tier}</span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 10, background: 'rgba(56,189,248,.12)', color: '#38bdf8' }}>{L2('Potential — not in VIP list', '潜力玩家 — 不在VIP名单')}</span>
            {p.upgrade_flag && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 10, background: 'rgba(255,107,0,.15)', color: '#FF8C00' }}>⬆ {L2('Upgrade candidate', '可升级')}</span>}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>
            {[p.region, cur, p.registration_date && `${L2('Registered', '注册')} ${String(p.registration_date).slice(0, 10)}`, p.first_seen_month && `${L2('First seen', '首次出现')} ${p.first_seen_month}`, p.months_active != null && `${p.months_active} ${L2('active month(s)', '个活跃月')}`].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', margin: '4px 0 8px', textTransform: 'uppercase' }}>{L2('Lifetime', '累计')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginBottom: 16 }}>
        {stat(L2('Deposit', '存款'), sym(cur) + fmt(p.total_deposit), '#3fb950', `${fmt(p.deposit_count)} ${L2('deposits', '次存款')}`)}
        {stat(L2('Withdrawal', '提款'), sym(cur) + fmt(p.total_withdrawal), '#f85149', `${fmt(p.withdrawal_count)} ${L2('withdrawals', '次提款')}`)}
        {stat(L2('Net deposit', '净存款'), sym(cur) + fmt((p.total_deposit || 0) - (p.total_withdrawal || 0)))}
        {stat(L2('Player win/loss', '玩家输赢'), (Number(p.total_win_loss) >= 0 ? '+' : '-') + sym(cur) + fmt(Math.abs(p.total_win_loss || 0)), Number(p.total_win_loss) >= 0 ? '#3fb950' : '#f85149')}
        {stat(L2('Rebate + reward', '返水 + 奖励'), sym(cur) + fmt((p.total_rebate || 0) + (p.total_reward || 0)))}
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', margin: '4px 0 8px', textTransform: 'uppercase' }}>{L2('Last imported day', '最近导入日')}{p.valid_bet_month ? ` · ${p.valid_bet_month}` : ''}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginBottom: 16 }}>
        {stat(L2('Turnover', '流水'), sym(cur) + fmt(p.monthly_valid_bet), 'var(--accent)')}
        {stat(L2('Deposit', '存款'), sym(cur) + fmt(p.monthly_deposit), '#3fb950')}
        {stat(L2('Withdrawal', '提款'), sym(cur) + fmt(p.monthly_withdrawal), '#f85149')}
        {stat(L2('Win/loss', '输赢'), (Number(p.monthly_win_loss) >= 0 ? '+' : '-') + sym(cur) + fmt(Math.abs(p.monthly_win_loss || 0)), Number(p.monthly_win_loss) >= 0 ? '#3fb950' : '#f85149')}
        {stat(L2('Last 30 days turnover', '近30天流水'), daily ? sym(cur) + fmt(sum30) : '…', null, daily ? `${act30} ${L2('active day(s)', '个活跃日')}${lastActive ? ` · ${L2('last', '最近')} ${lastActive}` : ''}` : '')}
      </div>

      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>📅 {L2('Daily turnover (last 90 days)', '每日流水（近90天）')}</div>
        {!daily ? <div style={{ color: 'var(--muted)' }}>{L2('Loading…', '载入中…')}</div> : !daily.length ? <div style={{ color: 'var(--muted)' }}>{L2('No daily data yet.', '暂无每日数据。')}</div> : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120 }}>
              {[...daily].reverse().map(r => {
                const v = Number(r.monthly_valid_bet) || 0
                return <div key={r.snapshot_date} title={`${r.snapshot_date}: ${sym(cur)}${fmt(v)}`} style={{ flex: 1, minWidth: 3, height: `${Math.max(v ? 4 : 1, (v / maxVb) * 100)}%`, background: v ? 'var(--accent)' : 'var(--border)', borderRadius: '2px 2px 0 0' }} />
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              <span>{daily[daily.length - 1]?.snapshot_date}</span><span>{daily[0]?.snapshot_date}</span>
            </div>
          </>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
        {L2('Silver / Bronze players come from the daily CSV import and are kept out of the VIP list, KPIs and queues. When a player reaches Gold in the CSV they move into the VIP list automatically, with contact log, spending and campaigns.',
          '银 / 铜级玩家来自每日CSV导入，不计入VIP名单、KPI和任务队列。当玩家在CSV中升到 Gold，会自动进入VIP名单，并开启联系记录、开支和活动功能。')}
      </div>
    </div>
  )
}
