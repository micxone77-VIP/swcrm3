// src/pages/Survey.jsx — VIP Survey: who has answered, who still needs an invite (WhatsApp in EN / MY / 中文,
// logged to Contact Log with topic 'survey_invite'), import of new form answers (admin) and the VIP Voice summary.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useLanguage } from '../contexts/LanguageContext'
import { fetchAll } from '../lib/depositProfile'
import { TierBadge, StatusBadge } from '../components/ui'
import { WaButton } from '../components/WaSenderModal'
import VipVoice from '../components/exec/VipVoice'
import { parseCsv, surveyRows } from '../lib/surveyImport'
import { surveyLabel, FEELING_EN, FEELING_COLOR } from '../lib/surveyLabels'

const VIP_TIERS = ['BLACK', 'DIAMOND-P', 'DIAMOND', 'PLATINUM', 'GOLD']
const SETTINGS_KEY = 'survey_invite'

// Invite text — casual "bro" tone, agent intro first, brand "sureWin"
export const INVITE = {
  en: "Yo {username}! I'm {agent} from sureWin VIP department 😄\n\nBro, we're making our VIP rewards better and want to hear from you first 🙏 Can help me fill in a quick survey? Only 2–3 minutes:\n{link}\n\nTell us honestly what you like and what we can improve — your answer goes straight to our VIP team. Thanks bro! 🍀",
  my: "Hai {username}! Saya {agent} dari jabatan VIP sureWin 😄\n\nBro, kami nak buat ganjaran VIP lebih best dan nak dengar pendapat bro dulu 🙏 Boleh tolong isi survey ringkas? 2–3 minit je:\n{link}\n\nCakap jujur apa bro suka dan apa kami boleh baiki — jawapan bro terus sampai ke team VIP kami. Terima kasih bro! 🍀",
  cn: "哈咯 {username}～我是sureWin VIP部门的 {agent} 😄\n\n我们正在改善 VIP 福利，想先听听你的意见 🙏 可以帮忙填一份简单问卷吗？只要 2–3 分钟：\n{link}\n\n喜欢什么、哪里可以更好，直接告诉我们，你的回答会直接给到 VIP 团队。谢谢你！🍀",
}
const fill = (t, v) => t.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null && v[k] !== '' ? v[k] : m))

const s = {
  page: { padding: '24px 28px', color: 'var(--text)' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' },
  h2: { fontSize: 13, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  kpi: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' },
  input: { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 10px', borderRadius: 8, fontSize: 13 },
  btn: { background: 'var(--accent)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' },
  ghost: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer' },
  th: { textAlign: 'left', padding: '7px 8px', fontSize: 11, color: 'var(--muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  td: { padding: '7px 8px', fontSize: 13, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  wa: { display: 'inline-flex', width: 26, height: 26, borderRadius: 13, background: '#25D366', color: '#fff', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 },
}

export default function Survey() {
  const { profile } = useAuth()
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const navigate = useNavigate()
  const isAdmin = profile?.role === 'admin'
  const agent = profile?.full_name || ''

  const [vips, setVips] = useState(null)
  const [answers, setAnswers] = useState([])
  const [invites, setInvites] = useState({})      // username -> latest invite date
  const [link, setLink] = useState('')
  const [linkDraft, setLinkDraft] = useState('')
  const [tab, setTab] = useState('todo')
  const [f, setF] = useState({ tier: 'ALL', host: 'ALL', status: 'ALL', phoneOnly: true, notInvited: false, q: '' })
  const [imp, setImp] = useState(null)             // { name, rows, newRows, msg }
  const [reload, setReload] = useState(0)

  useEffect(() => {
    fetchAll(() => supabase.from('vip_members').select('id,username,tier,currency,host_assigned,activity_status,days_inactive,last_deposit_date,phone,whatsapp,is_excluded').order('username'))
      .then(rows => setVips((rows || []).filter(v => !v.is_excluded && VIP_TIERS.includes(String(v.tier).toUpperCase()))), () => setVips([]))
    supabase.from('vip_survey_responses').select('*').order('submitted_at', { ascending: false }).limit(5000).then(({ data }) => setAnswers(data || []))
    fetchAll(() => supabase.from('contact_logs').select('username,logged_at').eq('topic', 'survey_invite').order('logged_at', { ascending: false }))
      .then(rows => { const m = {}; (rows || []).forEach(r => { if (!m[r.username]) m[r.username] = r.logged_at }); setInvites(m) }, () => setInvites({}))
    supabase.from('app_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle()
      .then(({ data }) => { const l = data?.value?.link || ''; setLink(l); setLinkDraft(l) })
  }, [reload])

  const answered = useMemo(() => new Set(answers.map(a => a.username).filter(Boolean)), [answers])
  const all = vips || []
  const todo = all.filter(v => !answered.has(v.username))
  const hosts = [...new Set(all.map(v => v.host_assigned).filter(Boolean))].sort()
  const list = todo.filter(v =>
    (f.tier === 'ALL' || String(v.tier).toUpperCase() === f.tier) &&
    (f.host === 'ALL' || (f.host === '__none' ? !v.host_assigned : v.host_assigned === f.host)) &&
    (f.status === 'ALL' || v.activity_status === f.status) &&
    (!f.phoneOnly || v.whatsapp || v.phone) &&
    (!f.notInvited || !invites[v.username]) &&
    (!f.q || v.username.toLowerCase().includes(f.q.toLowerCase())))
    .sort((a, b) => VIP_TIERS.indexOf(String(a.tier).toUpperCase()) - VIP_TIERS.indexOf(String(b.tier).toUpperCase()) || a.username.localeCompare(b.username))
  const invitedOpen = todo.filter(v => invites[v.username]).length
  const fmtDay = d => new Date(d).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-MY', { day: 'numeric', month: 'short' })

  async function saveLink() {
    const value = { link: linkDraft.trim() }
    const { error } = await supabase.from('app_settings').upsert({ key: SETTINGS_KEY, value, updated_by: agent || null, updated_at: new Date().toISOString() })
    if (error) { alert(error.message); return }
    setLink(value.link)
  }

  // New answers from the Google Form CSV: only rows not imported yet (same survey + same time) are added
  async function readCsv(file) {
    const text = await file.text()
    const members = await fetchAll(() => supabase.from('vip_members_all').select('username,email,tier').in('tier', ['GOLD', 'PLATINUM', 'DIAMOND', 'DIAMOND-P', 'BLACK', 'SILVER']).order('username'))
    const name = imp?.name || answers[0]?.survey_name || 'VIP Member Experience Survey'
    const rows = surveyRows(parseCsv(text), members || [], name)
    const have = new Set(answers.filter(a => a.survey_name === name).map(a => new Date(a.submitted_at).toISOString()))
    const newRows = rows.filter(r => !have.has(r.submitted_at))
    setImp({ name, rows, newRows, msg: '' })
  }
  async function saveImport() {
    if (!imp?.newRows?.length) return
    const rows = imp.newRows.map(r => ({ ...r, survey_name: imp.name }))
    const { error } = await supabase.from('vip_survey_responses').insert(rows)
    if (error) { setImp(i => ({ ...i, msg: '❌ ' + error.message })); return }
    setImp(i => ({ ...i, msg: L2(`✅ Imported ${rows.length} new answer(s)`, `✅ 已导入 ${rows.length} 份新回答`), newRows: [] }))
    setReload(x => x + 1)
  }

  const Tab = ({ k, children }) => <button onClick={() => setTab(k)} style={{ ...s.ghost, ...(tab === k ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', fontWeight: 700 } : {}) }}>{children}</button>
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)

  return (
    <div style={s.page}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>🗣 {L2('VIP Survey', 'VIP 问卷')}</div>
      <div style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 16px' }}>{L2('Who has answered, who still needs an invite, and what they told us.', '谁已回答、谁还需要邀请，以及他们说了什么。')}</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 14 }}>
        {[[L2('VIPs (Gold and above)', 'VIP（Gold 以上）'), all.length, 'var(--text)'],
          [L2('Answered', '已回答'), `${all.length - todo.length} · ${pct(all.length - todo.length, all.length)}%`, '#3fb950'],
          [L2('Not answered yet', '还没回答'), todo.length, '#d29922'],
          [L2('Invited, no answer yet', '已邀请，还没回答'), invitedOpen, '#58a6ff']].map(([l, v, c]) => (
          <div key={l} style={s.kpi}><div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{l}</div><div style={{ fontSize: 24, fontWeight: 800, color: c, marginTop: 4 }}>{vips ? v : '…'}</div></div>
        ))}
      </div>

      <div style={{ ...s.card, marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13 }}>🔗 {L2('Survey link', '问卷链接')}</b>
        {isAdmin ? <>
          <input style={{ ...s.input, flex: 1, minWidth: 260 }} value={linkDraft} onChange={e => setLinkDraft(e.target.value)} placeholder="https://forms.gle/…" />
          <button style={s.btn} onClick={saveLink} disabled={linkDraft.trim() === link}>{L2('Save', '保存')}</button>
        </> : <span style={{ fontSize: 13 }}>{link || L2('Not set — ask an admin', '未设定 — 请管理员设定')}</span>}
        {!link && <span style={{ fontSize: 12, color: '#d29922', width: '100%' }}>⚠️ {L2('Set the Google Form link first — the invite message uses it.', '请先设定 Google 表单链接 — 邀请讯息会用到它。')}</span>}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <Tab k="todo">📨 {L2(`Not answered yet (${todo.length})`, `还没回答 (${todo.length})`)}</Tab>
        <Tab k="done">✅ {L2(`Answered (${answers.length})`, `已回答 (${answers.length})`)}</Tab>
        <Tab k="voice">🗣 {L2('VIP Voice', 'VIP 心声')}</Tab>
        {isAdmin && <Tab k="import">⬆ {L2('Import new answers', '导入新回答')}</Tab>}
      </div>

      {tab === 'todo' && (
        <div style={s.card}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
            <select style={s.input} value={f.tier} onChange={e => setF({ ...f, tier: e.target.value })}>
              <option value="ALL">{L2('All tiers', '全部等级')}</option>{VIP_TIERS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select style={s.input} value={f.host} onChange={e => setF({ ...f, host: e.target.value })}>
              <option value="ALL">{L2('All managers', '全部经理')}</option>{hosts.map(h => <option key={h} value={h}>{h}</option>)}<option value="__none">{L2('No manager', '无负责人')}</option>
            </select>
            <select style={s.input} value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>
              <option value="ALL">{L2('All statuses', '全部状态')}</option>{['Active', 'Resting', 'At Risk', 'Churn', 'Dormant'].map(x => <option key={x} value={x}>{x}</option>)}
            </select>
            <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={f.phoneOnly} onChange={e => setF({ ...f, phoneOnly: e.target.checked })} />{L2('Has WhatsApp / phone', '有 WhatsApp / 电话')}</label>
            <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={f.notInvited} onChange={e => setF({ ...f, notInvited: e.target.checked })} />{L2('Not invited yet', '还没邀请')}</label>
            <input style={{ ...s.input, width: 160 }} placeholder={L2('Search username', '搜索用户名')} value={f.q} onChange={e => setF({ ...f, q: e.target.value })} />
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{L2(`${list.length} players`, `${list.length} 位玩家`)}</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{[L2('Player', '玩家'), L2('Tier', '等级'), L2('Status', '状态'), L2('Manager', '负责人'), L2('Last deposit', '最后存款'), L2('Invited', '已邀请'), ''].map((h, i) => <th key={i} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>{list.slice(0, 300).map(v => {
                const inv = invites[v.username]
                const vars = { username: v.username, agent, link }
                return (
                  <tr key={v.id}>
                    <td style={{ ...s.td, fontWeight: 700, cursor: 'pointer' }} onClick={() => navigate(`/vip360?player=${encodeURIComponent(v.username)}`)}>{v.username}</td>
                    <td style={s.td}><TierBadge tier={v.tier} /></td>
                    <td style={s.td}><StatusBadge status={v.activity_status} /></td>
                    <td style={{ ...s.td, color: 'var(--muted)' }}>{v.host_assigned || L2('no host', '无负责人')}</td>
                    <td style={{ ...s.td, color: 'var(--muted)' }}>{v.last_deposit_date ? `${fmtDay(v.last_deposit_date)} · ${v.days_inactive ?? '—'}d` : '—'}</td>
                    <td style={{ ...s.td, color: inv ? '#58a6ff' : 'var(--muted)' }}>{inv ? `📨 ${fmtDay(inv)}` : '—'}</td>
                    <td style={s.td}>{(v.whatsapp || v.phone) && link
                      ? <WaButton vip={v} topic="survey_invite" logLabel="Survey invite" title={L2('Send survey invite', '发送问卷邀请')} style={s.wa}
                          templates={{ en: fill(INVITE.en, vars), my: fill(INVITE.my, vars), cn: fill(INVITE.cn, vars) }} onLogged={() => setReload(x => x + 1)}>W</WaButton>
                      : <span style={{ fontSize: 11, color: 'var(--muted)' }}>{!link ? L2('set link', '先设链接') : L2('no phone', '无电话')}</span>}</td>
                  </tr>
                )
              })}</tbody>
            </table>
            {list.length > 300 && <div style={{ fontSize: 12, color: 'var(--muted)', padding: 8 }}>{L2(`Showing 300 of ${list.length} — use the filters.`, `显示 300 / ${list.length} — 请用筛选。`)}</div>}
          </div>
        </div>
      )}

      {tab === 'done' && (
        <div style={s.card}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{[L2('Player', '玩家'), L2('Answered', '回答日期'), L2('Tier now', '目前等级'), L2('VIP benefits feel', '权益感受'), L2('Why playing less', '玩少原因'), L2('Survey', '问卷')].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{answers.map(a => (
              <tr key={a.id} style={{ cursor: a.username ? 'pointer' : 'default' }} onClick={() => a.username && navigate(`/vip360?player=${encodeURIComponent(a.username)}`)}>
                <td style={{ ...s.td, fontWeight: 700 }}>{a.username || <span style={{ color: 'var(--muted)' }}>{L2('(not matched)', '（未匹配）')}</span>}</td>
                <td style={s.td}>{fmtDay(a.submitted_at)}</td>
                <td style={s.td}>{a.tier_at_import ? <TierBadge tier={a.tier_at_import} /> : '—'}</td>
                <td style={{ ...s.td, color: FEELING_COLOR[a.benefit_feeling] }}>{a.benefit_feeling ? (lang === 'zh' ? surveyLabel(a.benefit_feeling, lang) : FEELING_EN[a.benefit_feeling] || a.benefit_feeling) : '—'}</td>
                <td style={{ ...s.td, whiteSpace: 'normal' }}>{(a.drop_reasons || []).filter(x => !x.startsWith('Other: ')).map(x => surveyLabel(x, lang)).join(', ') || '—'}</td>
                <td style={{ ...s.td, color: 'var(--muted)', fontSize: 12 }}>{a.survey_name}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {tab === 'voice' && <VipVoice card={s.card} h2={s.h2} />}

      {tab === 'import' && isAdmin && (
        <div style={s.card}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>{L2('Download the Google Form responses as CSV and choose the file. Only answers not imported yet are added; players are matched by username (or email).', '从 Google 表单下载回答 CSV 后选择文件。只会加入还没导入的回答；按用户名（或电邮）匹配玩家。')}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('Survey name', '问卷名称')}</span>
            <input style={{ ...s.input, minWidth: 320 }} value={imp?.name ?? answers[0]?.survey_name ?? ''} onChange={e => setImp(i => ({ ...(i || {}), name: e.target.value }))} />
            <input type="file" accept=".csv,text/csv" onChange={e => e.target.files?.[0] && readCsv(e.target.files[0])} />
          </div>
          {imp?.rows && (
            <div style={{ fontSize: 13 }}>
              {L2(`File has ${imp.rows.length} answers · ${imp.newRows.length} new · matched to a player: ${imp.newRows.filter(r => r.username).length}`,
                  `文件共 ${imp.rows.length} 份回答 · 新的 ${imp.newRows.length} 份 · 已匹配玩家 ${imp.newRows.filter(r => r.username).length} 份`)}
              {imp.newRows.some(r => !r.username) && <div style={{ color: '#d29922', fontSize: 12, marginTop: 4 }}>⚠️ {L2('Not matched (username wrong / blank): ', '未匹配（用户名错误/空白）：')}{imp.newRows.filter(r => !r.username).length}</div>}
              <div style={{ marginTop: 8 }}><button style={s.btn} onClick={saveImport} disabled={!imp.newRows.length}>{L2(`Import ${imp.newRows.length} new answer(s)`, `导入 ${imp.newRows.length} 份新回答`)}</button></div>
            </div>
          )}
          {imp?.msg && <div style={{ marginTop: 8, fontSize: 13 }}>{imp.msg}</div>}
        </div>
      )}
    </div>
  )
}
