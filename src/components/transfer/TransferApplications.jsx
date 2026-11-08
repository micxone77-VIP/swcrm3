// TransferApplications.jsx — admin review of applications from the public VIP Transfer page (public/vip-transfer.html)
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../contexts/LanguageContext'
import { useUrlParam } from '../../hooks/useUrlParam'
import CopyBtn from '../CopyBtn'

const STATUS = {
  new:       { en: 'New',       zh: '新申请', color: '#58a6ff' },
  contacted: { en: 'Contacted', zh: '已联系', color: '#f59e0b' },
  approved:  { en: 'Approved',  zh: '已批准', color: '#3fb950' },
  rejected:  { en: 'Rejected',  zh: '已拒绝', color: '#f85149' },
}

const s = {
  card:  { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 20 },
  hdr:   { padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  th:    { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  td:    { padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--text)' },
  input: { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 12px', borderRadius: 7, fontSize: 13, outline: 'none' },
  btn:   { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '7px 12px', borderRadius: 7, fontWeight: 600, fontSize: 12, cursor: 'pointer' },
  label: { fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 3 },
  grid:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, marginBottom: 16 },
}

const fmtTime = (iso) => new Date(iso).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' })

function Status({ value, lang }) {
  const st = STATUS[value] || STATUS.new
  return <span style={{ color: st.color, background: `${st.color}22`, padding: '2px 8px', borderRadius: 5, fontSize: 11, fontWeight: 700 }}>{lang === 'zh' ? st.zh : st.en}</span>
}

export default function TransferApplications({ onAddToTracker }) {
  const { profile } = useAuth()
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [apps, setApps] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useUrlParam('appStatus', 'ALL')
  const [openId, setOpenId] = useUrlParam('app', '')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('transfer_applications').select('*').order('created_at', { ascending: false }).limit(500)
      .then(({ data, error: err }) => { if (err) { setError(err.message); setApps([]) } else setApps(data || []) })
  }, [])

  const open = apps?.find(a => a.id === openId)
  useEffect(() => { setNotes(open?.review_notes || '') }, [open?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(fields) {
    setSaving(true)
    setError('')
    const patch = { ...fields, reviewed_by: profile?.id, reviewed_at: new Date().toISOString() }
    const { error: err } = await supabase.from('transfer_applications').update(patch).eq('id', open.id)
    if (err) setError(err.message)
    else setApps(list => list.map(a => (a.id === open.id ? { ...a, ...patch } : a)))
    setSaving(false)
  }

  async function viewProof(path) {
    const tab = window.open('', '_blank')
    const { data, error: err } = await supabase.storage.from('transfer-proofs').createSignedUrl(path, 300)
    if (err || !data?.signedUrl) { tab?.close(); setError(err?.message || L2('Could not open the file', '无法打开文件')); return }
    if (tab) { tab.opener = null; tab.location.href = data.signedUrl }
  }

  if (!apps) return <div style={{ padding: 40, color: 'var(--muted)', textAlign: 'center' }}>{L2('Loading…', '载入中…')}</div>
  const shown = filter === 'ALL' ? apps : apps.filter(a => a.status === filter)
  const safeLink = open && /^https?:\/\//i.test(open.platform_link) ? open.platform_link : null
  const details = open ? [
    [L2('Contact number', '电话号码'), open.contact_number, true],
    ['WhatsApp', open.whatsapp_number, true],
    [L2('Email', '电邮'), open.email, true],
    [L2('sureWin account', 'sureWin 账户'), open.has_account ? L2('Yes', '是') : L2('No', '否')],
    [L2('Member ID', '会员 ID'), open.member_id || '—', !!open.member_id],
    [L2('Preferred tier', '期望等级'), open.preferred_tier],
    [L2('Previous platform', '前平台'), open.platform_name],
    [L2('Tier there', '原平台等级'), open.current_tier],
    [L2('Avg monthly deposit', '平均每月存款'), open.avg_deposit],
    [L2('Avg monthly withdrawal', '平均每月提款'), open.avg_withdrawal || '—'],
    [L2('Applied', '申请时间'), fmtTime(open.created_at)],
  ] : []
  const proofs = open ? [
    [L2('VIP tier', 'VIP 等级'), open.proof_tier_path],
    [L2('30 days deposit & withdrawal', '30 天充值和提现'), open.proof_activity_path],
    [L2('Name & user ID', '姓名和用户 ID'), open.proof_identity_path],
  ].filter(p => p[1]) : []

  return (
    <div style={s.card}>
      <div style={s.hdr}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{L2('Transfer Applications', '转会申请')} <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>({shown.length})</span></span>
        <select style={s.input} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="ALL">{L2('All statuses', '全部状态')}</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{lang === 'zh' ? v.zh : v.en}</option>)}
        </select>
      </div>
      {error && <div style={{ padding: '10px 20px', color: '#f85149', fontSize: 13, fontWeight: 600 }}>{error}</div>}

      {open && (
        <div style={{ padding: 20, borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{open.full_name} <Status value={open.status} lang={lang} /></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select style={s.input} value={open.status} disabled={saving} onChange={e => save({ status: e.target.value })}>
                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{lang === 'zh' ? v.zh : v.en}</option>)}
              </select>
              <button style={s.btn} onClick={() => onAddToTracker(open)}>{L2('➕ Add to Tracker', '➕ 加入追踪')}</button>
              <button style={s.btn} onClick={() => setOpenId('')}>{L2('Close', '关闭')}</button>
            </div>
          </div>
          <div style={s.grid}>
            {details.map(([label, value, copy]) => (
              <div key={label}>
                <div style={s.label}>{label}</div>
                <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{value}{copy && <CopyBtn text={value} />}</div>
              </div>
            ))}
            <div>
              <div style={s.label}>{L2('Platform link', '平台链接')}</div>
              <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{safeLink ? <a href={safeLink} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{safeLink}</a> : open.platform_link}</div>
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={s.label}>{L2('Why us / why leaving', '为何选择我们 / 为何离开')}</div>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{open.why_us}</div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={s.label}>{L2('Screenshots', '截图')}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              {proofs.map(([label, path]) => <button key={path} style={s.btn} onClick={() => viewProof(path)}>📎 {label}</button>)}
            </div>
          </div>
          <div style={s.label}>{L2('Review notes', '审核备注')}</div>
          <textarea style={{ ...s.input, width: '100%', minHeight: 64, resize: 'vertical', fontFamily: 'inherit' }} value={notes} onChange={e => setNotes(e.target.value)} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <button style={s.btn} disabled={saving || notes === (open.review_notes || '')} onClick={() => save({ review_notes: notes.trim() || null })}>{saving ? L2('Saving…', '保存中…') : L2('Save notes', '保存备注')}</button>
            {open.sync_error && <span style={{ fontSize: 12, color: '#f59e0b' }}>⚠️ {L2('Not in Google Sheet / email: ', '未同步到 Google 表格 / 电邮：')}{open.sync_error}</span>}
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface2)' }}>
              {[L2('Applied', '申请时间'), L2('Name', '姓名'), L2('Previous platform', '前平台'), L2('Tier there', '原平台等级'), L2('Avg deposit', '平均存款'), L2('Wants', '期望等级'), L2('Status', '状态')].map(h => <th key={h} style={s.th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', color: 'var(--muted)', padding: 32 }}>{L2('No applications yet', '暂无申请')}</td></tr>
            ) : shown.map(a => (
              <tr key={a.id} onClick={() => setOpenId(a.id)} style={{ cursor: 'pointer', background: a.id === openId ? 'var(--surface2)' : undefined }}>
                <td style={{ ...s.td, whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 12 }}>{fmtTime(a.created_at)}</td>
                <td style={{ ...s.td, fontWeight: 700 }}>{a.full_name}</td>
                <td style={s.td}>{a.platform_name}</td>
                <td style={s.td}>{a.current_tier}</td>
                <td style={s.td}>{a.avg_deposit}</td>
                <td style={s.td}>{a.preferred_tier}</td>
                <td style={s.td}><Status value={a.status} lang={lang} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
