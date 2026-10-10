import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useLanguage } from '../contexts/LanguageContext'
import { TIER_COLOR, TIER_BG } from '../lib/constants'
import { NAV_GROUPS } from '../components/Sidebar'

// ── styles ────────────────────────────────────────────────────────────────────
const ROLE_COLOR = { admin:'#58a6ff', host:'#3fb950', readonly:'#8b949e' }
const ROLE_ZH    = { admin:'管理员', host:'负责人', readonly:'只读' }
const ROLE_BG    = { admin:'rgba(88,166,255,.12)', host:'rgba(63,185,80,.1)', readonly:'rgba(139,148,158,.1)' }

const s = {
  page:     { padding:'24px 28px', minHeight:'100vh' },
  title:    { fontSize:22, fontWeight:700, color:'var(--text)' },
  sub:      { fontSize:13, color:'var(--muted)', marginTop:4 },
  card:     { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12 },
  cardHdr:  { padding:'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' },
  cardHdrL: { display:'flex', alignItems:'center', gap:8, fontSize:12, fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px' },
  tbl:      { width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:       { padding:'10px 16px', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'left', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' },
  td:       { padding:'12px 16px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' },
  btn:      { background:'var(--accent)', color:'#fff', border:'none', padding:'9px 20px', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer' },
  btnSm:    { background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)', padding:'6px 14px', borderRadius:7, fontSize:12, cursor:'pointer' },
  btnDanger:{ background:'rgba(248,81,73,.12)', color:'#f85149', border:'1px solid rgba(248,81,73,.25)', padding:'6px 14px', borderRadius:7, fontSize:12, cursor:'pointer' },
  btnSuccess:{ background:'rgba(63,185,80,.12)', color:'#3fb950', border:'1px solid rgba(63,185,80,.25)', padding:'6px 14px', borderRadius:7, fontSize:12, cursor:'pointer' },
  btnWarn:  { background:'rgba(210,153,34,.12)', color:'#d29922', border:'1px solid rgba(210,153,34,.25)', padding:'6px 14px', borderRadius:7, fontSize:12, cursor:'pointer' },
  badge:    { display:'inline-block', padding:'3px 10px', borderRadius:12, fontSize:11, fontWeight:700 },
  overlay:  { position:'fixed', inset:0, background:'rgba(0,0,0,.75)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:20 },
  modal:    { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, width:'100%', maxWidth:560, maxHeight:'92vh', overflowY:'auto' },
  mhdr:     { padding:'18px 22px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, background:'var(--surface)', zIndex:1 },
  mbody:    { padding:'20px 22px' },
  flbl:     { fontSize:11, color:'var(--muted)', marginBottom:5, fontWeight:600, textTransform:'uppercase', letterSpacing:'.4px' },
  finput:   { width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'9px 12px', borderRadius:8, fontSize:13, outline:'none', boxSizing:'border-box' },
  fsel:     { width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'9px 12px', borderRadius:8, fontSize:13, outline:'none', cursor:'pointer' },
  frow:     { marginBottom:14 },
  grid2:    { display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 },
  err:      { background:'rgba(248,81,73,.1)', border:'1px solid rgba(248,81,73,.3)', color:'#f85149', borderRadius:8, padding:'9px 12px', fontSize:12, marginBottom:12 },
  ok:       { background:'rgba(63,185,80,.1)', border:'1px solid rgba(63,185,80,.3)', color:'#3fb950', borderRadius:8, padding:'9px 12px', fontSize:12, marginBottom:12 },
  divider:  { borderTop:'1px solid var(--border)', margin:'18px 0' },
}

// Edge Function URL (server-side admin operations)
const EDGE_FN = 'https://utopskwciorvooronpwg.supabase.co/functions/v1/admin-user'

async function callAdminFn(payload) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(EDGE_FN, {
    method:  'POST',
    headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${session?.access_token}` },
    body:    JSON.stringify(payload),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

// ── permission checkboxes component ──────────────────────────────────────────
function PermissionsGrid({ permissions, onChange, disabled }) {
  const perms = Array.isArray(permissions) ? permissions : []
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)

  function toggle(key) {
    if (disabled) return
    const next = perms.includes(key) ? perms.filter(k => k !== key) : [...perms, key]
    onChange(next)
  }

  function toggleGroup(keys) {
    if (disabled) return
    const allOn = keys.every(k => perms.includes(k))
    let next = perms.filter(k => !keys.includes(k))
    if (!allOn) next = [...next, ...keys]
    onChange(next)
  }

  function toggleAll() {
    if (disabled) return
    const allKeys = NAV_GROUPS.flatMap(g => g.items.map(i => i.permKey))
    const allOn = allKeys.every(k => perms.includes(k))
    onChange(allOn ? [] : allKeys)
  }

  const allKeys = NAV_GROUPS.flatMap(g => g.items.map(i => i.permKey))
  const allOn = allKeys.every(k => perms.includes(k))

  return (
    <div style={{ border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
      {/* Select all */}
      <div style={{ padding:'8px 14px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span style={{ fontSize:11, fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px' }}>{L2('Page Access','页面访问权限')}</span>
        <label style={{ display:'flex', alignItems:'center', gap:6, cursor: disabled?'default':'pointer', fontSize:12, color:'var(--text)' }}>
          <input type="checkbox" checked={allOn} onChange={toggleAll} disabled={disabled}
            style={{ accentColor:'var(--accent)', width:14, height:14 }} />
          {L2('Select All','全选')}
        </label>
      </div>

      {NAV_GROUPS.map(group => {
        const groupKeys = group.items.map(i => i.permKey)
        const groupAllOn = groupKeys.every(k => perms.includes(k))
        const groupSomeOn = groupKeys.some(k => perms.includes(k))
        return (
          <div key={group.key} style={{ borderBottom:'1px solid var(--border)' }}>
            {/* Group header */}
            <div style={{ padding:'7px 14px', background:'rgba(255,255,255,.02)', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid var(--border)' }}>
              <span style={{ fontSize:12, fontWeight:700, color:'var(--text)', display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:14 }}>{group.icon}</span>
                {lang === 'zh' ? (group.zh || group.label) : group.label}
              </span>
              <label style={{ display:'flex', alignItems:'center', gap:5, cursor: disabled?'default':'pointer', fontSize:11, color: groupSomeOn?'var(--accent)':'var(--muted)' }}>
                <input
                  type="checkbox"
                  checked={groupAllOn}
                  ref={el => { if (el) el.indeterminate = groupSomeOn && !groupAllOn }}
                  onChange={() => toggleGroup(groupKeys)}
                  disabled={disabled}
                  style={{ accentColor:'var(--accent)', width:13, height:13 }}
                />
                {L2('All','全部')}
              </label>
            </div>
            {/* Items */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', padding:'8px 10px', gap:'4px 0' }}>
              {group.items.map(item => (
                <label key={item.permKey} style={{ display:'flex', alignItems:'center', gap:7, padding:'4px 6px', borderRadius:6, cursor: disabled?'default':'pointer',
                  background: perms.includes(item.permKey) ? 'rgba(255,106,0,.08)' : 'transparent',
                  transition:'background .15s' }}>
                  <input
                    type="checkbox"
                    checked={perms.includes(item.permKey)}
                    onChange={() => toggle(item.permKey)}
                    disabled={disabled}
                    style={{ accentColor:'var(--accent)', width:13, height:13, flexShrink:0 }}
                  />
                  <span style={{ fontSize:12, color: perms.includes(item.permKey) ? 'var(--text)' : 'var(--muted)' }}>
                    {item.icon} {lang === 'zh' ? (item.zh || item.label) : item.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── avatar ────────────────────────────────────────────────────────────────────
function Avatar({ name, role }) {
  return (
    <div style={{
      width:36, height:36, borderRadius:'50%',
      background: ROLE_BG[role] || 'var(--surface2)',
      border: `2px solid ${ROLE_COLOR[role] || 'var(--border)'}`,
      display:'flex', alignItems:'center', justifyContent:'center',
      fontSize:14, fontWeight:700, color: ROLE_COLOR[role] || 'var(--text)',
      flexShrink:0,
    }}>
      {(name||'?')[0].toUpperCase()}
    </div>
  )
}

// ── main ──────────────────────────────────────────────────────────────────────
export default function ManageUsers() {
  const { profile: myProfile } = useAuth()
  const { t, lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const roleLabel = (r) => (lang === 'zh' ? (ROLE_ZH[r] || r) : r)
  const isAdmin = myProfile?.role === 'admin'

  const [users,      setUsers]      = useState([])
  const [userStats,  setUserStats]  = useState({})
  const [loading,    setLoading]    = useState(true)
  const [modal,      setModal]      = useState(null)  // 'create' | 'edit' | 'assign'
  const [selected,   setSelected]   = useState(null)
  const [saving,     setSaving]     = useState(false)
  const [msg,        setMsg]        = useState({ text:'', ok:true })

  // Excluded players
  const [excluded,    setExcluded]    = useState([])
  const [exSearch,    setExSearch]    = useState('')
  const [exResults,   setExResults]   = useState([])
  const [exSearching, setExSearching] = useState(false)
  const [exMsg,       setExMsg]       = useState('')

  // Create form
  const [form, setForm] = useState({
    username: '', full_name: '', role: 'host', password: '', permissions: [],
  })

  // Edit form
  const [editForm, setEditForm] = useState({
    full_name: '', role: 'host', permissions: [],
  })
  const [setPwMode,    setSetPwMode]    = useState(false)
  const [newPassword,  setNewPassword]  = useState('')
  const [newPassword2, setNewPassword2] = useState('')

  // Assign VIPs
  const [allVIPs,      setAllVIPs]      = useState([])
  const [assignSearch, setAssignSearch] = useState('')
  const [assigning,    setAssigning]    = useState(false)

  useEffect(() => { loadUsers(); loadExcluded() }, [])

  // ── load ──────────────────────────────────────────────────────────────────
  async function loadUsers() {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
    if (data) { setUsers(data); loadAllStats(data) }
    setLoading(false)
  }

  async function loadAllStats(users) {
    const stats = {}
    await Promise.all(users.map(async u => {
      const name = u.full_name || u.username
      const [{ count: logCount }, { count: vipCount }] = await Promise.all([
        supabase.from('contact_logs').select('id', { count:'exact' }).eq('host_name', name),
        supabase.from('vip_members').select('id', { count:'exact' }).eq('host_assigned', name).eq('is_excluded', false),
      ])
      stats[u.id] = { logs: logCount||0, vips: vipCount||0 }
    }))
    setUserStats(stats)
  }

  async function loadExcluded() {
    const { data } = await supabase.from('vip_members').select('id, username, tier, host_assigned')
      .eq('is_excluded', true).order('username')
    setExcluded(data || [])
  }

  async function searchExcludable(q) {
    setExSearch(q)
    if (q.trim().length < 2) { setExResults([]); return }
    setExSearching(true)
    const { data } = await supabase.from('vip_members')
      .select('id, username, tier, host_assigned, is_excluded')
      .ilike('username', `%${q.trim()}%`).limit(10)
    setExResults(data || [])
    setExSearching(false)
  }

  async function setExclude(id, username, exclude) {
    await supabase.from('vip_members').update({ is_excluded: exclude }).eq('id', id)
    setExMsg(exclude ? t('manageUsers.addedToExclusion', { username }) : t('manageUsers.removedFromExclusion', { username }))
    setExResults(prev => prev.map(r => r.id === id ? { ...r, is_excluded: exclude } : r))
    loadExcluded()
    setTimeout(() => setExMsg(''), 3000)
  }

  // ── create user (via Edge Function) ──────────────────────────────────────
  async function createUser() {
    const uname = form.username.trim().toLowerCase()
    if (!uname || !form.full_name.trim() || !form.password) {
      setMsg({ text:L2('Username, full name and password are required.','用户名、全名和密码为必填项。'), ok:false }); return
    }
    if (form.password.length < 6) {
      setMsg({ text:L2('Password must be at least 6 characters.','密码至少需要 6 个字符。'), ok:false }); return
    }
    setSaving(true); setMsg({ text:'', ok:true })
    try {
      await callAdminFn({
        action:      'create',
        username:    uname,
        full_name:   form.full_name.trim(),
        password:    form.password,
        role:        form.role,
        permissions: form.role === 'admin' ? [] : form.permissions,
      })
      setMsg({ text:L2('✅ User created successfully!','✅ 用户创建成功！'), ok:true })
      setForm({ username:'', full_name:'', role:'host', password:'', permissions:[] })
      setTimeout(loadUsers, 800)
    } catch (e) {
      setMsg({ text: e.message, ok:false })
    }
    setSaving(false)
  }

  // ── save edit ─────────────────────────────────────────────────────────────
  async function saveEdit() {
    setSaving(true); setMsg({ text:'', ok:true })
    const { error } = await supabase.from('profiles').update({
      full_name:   editForm.full_name,
      role:        editForm.role,
      permissions: editForm.role === 'admin' ? [] : editForm.permissions,
      updated_at:  new Date().toISOString(),
    }).eq('id', selected.id)
    if (error) { setMsg({ text: error.message, ok:false }) }
    else       { setMsg({ text:L2('✅ Profile updated.','✅ 资料已更新。'), ok:true }); loadUsers() }
    setSaving(false)
  }

  // ── set password directly (via Edge Function) ────────────────────────────
  async function handleSetPassword() {
    if (newPassword.length < 6)       { setMsg({ text:L2('Password must be at least 6 characters.','密码至少需要 6 个字符。'), ok:false }); return }
    if (newPassword !== newPassword2)  { setMsg({ text:L2('Passwords do not match.','两次输入的密码不一致。'), ok:false }); return }
    setSaving(true); setMsg({ text:'', ok:true })
    try {
      await callAdminFn({ action:'set-password', userId: selected.id, password: newPassword })
      setMsg({ text:L2('✅ Password updated successfully.','✅ 密码更新成功。'), ok:true })
      setNewPassword(''); setNewPassword2(''); setSetPwMode(false)
    } catch (e) {
      setMsg({ text: e.message, ok:false })
    }
    setSaving(false)
  }

  // ── toggle active ─────────────────────────────────────────────────────────
  async function toggleActive(user) {
    await supabase.from('profiles').update({ is_active: !user.is_active }).eq('id', user.id)
    loadUsers()
  }

  // ── assign VIPs ───────────────────────────────────────────────────────────
  async function openAssign(user) {
    setSelected(user)
    setAssignSearch('')
    const { data } = await supabase.from('vip_members')
      .select('id, username, full_name, tier, host_assigned')
      .eq('is_excluded', false).order('vip_score', { ascending: false })
    setAllVIPs(data || [])
    setModal('assign')
  }

  async function assignVIP(vipId, hostName) {
    setAssigning(true)
    await supabase.from('vip_members').update({ host_assigned: hostName }).eq('id', vipId)
    const { data } = await supabase.from('vip_members')
      .select('id, username, full_name, tier, host_assigned')
      .eq('is_excluded', false).order('vip_score', { ascending: false })
    setAllVIPs(data || [])
    setAssigning(false)
  }

  async function unassignVIP(vipId) {
    setAssigning(true)
    await supabase.from('vip_members').update({ host_assigned: null }).eq('id', vipId)
    const { data } = await supabase.from('vip_members')
      .select('id, username, full_name, tier, host_assigned')
      .eq('is_excluded', false).order('vip_score', { ascending: false })
    setAllVIPs(data || [])
    setAssigning(false)
  }

  // ── modal helpers ─────────────────────────────────────────────────────────
  function openCreate() {
    setSelected(null)
    setForm({ username:'', full_name:'', role:'host', password:'', permissions:[] })
    setMsg({ text:'', ok:true })
    setModal('create')
  }

  function openEdit(user) {
    setSelected(user)
    setEditForm({
      full_name:   user.full_name || '',
      role:        user.role || 'host',
      permissions: Array.isArray(user.permissions) ? user.permissions : [],
    })
    setSetPwMode(false); setNewPassword(''); setNewPassword2('')
    setMsg({ text:'', ok:true })
    setModal('edit')
  }

  function closeModal() {
    setModal(null); setSelected(null)
    setMsg({ text:'', ok:true })
    setSetPwMode(false); setNewPassword(''); setNewPassword2('')
  }

  const filteredVIPs = allVIPs.filter(v =>
    !assignSearch.trim() ||
    v.username?.toLowerCase().includes(assignSearch.toLowerCase()) ||
    v.full_name?.toLowerCase().includes(assignSearch.toLowerCase())
  )
  const assignedToSelected = allVIPs.filter(v =>
    v.host_assigned === (selected?.full_name || selected?.username)
  )

  if (!isAdmin) return (
    <div style={{ ...s.page, display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60vh' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:40, marginBottom:12 }}>🔒</div>
        <div style={{ fontSize:16, fontWeight:700, color:'var(--text)' }}>{L2('Admin Only','仅限管理员')}</div>
        <div style={{ fontSize:13, color:'var(--muted)', marginTop:6 }}>{L2('You need admin access to manage users.','您需要管理员权限才能管理用户。')}</div>
      </div>
    </div>
  )

  return (
    <div style={s.page}>

      {/* ── Header ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <div style={s.title}>👥 {L2('Manage Users','用户管理')}</div>
          <div style={s.sub}>{users.length} {L2('users','位用户')} · {users.filter(u => u.is_active !== false).length} {L2('active','活跃')}</div>
        </div>
        <button style={s.btn} onClick={openCreate}>{L2('＋ Create User','＋ 创建用户')}</button>
      </div>

      {/* ── Users Table ── */}
      <div style={{ ...s.card, overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <table style={s.tbl}>
            <thead>
              <tr>
                <th style={s.th}>{L2('User','用户')}</th>
                <th style={s.th}>{L2('Role','角色')}</th>
                <th style={s.th}>{L2('Status','状态')}</th>
                <th style={s.th}>{L2('Assigned VIPs','已分配 VIP')}</th>
                <th style={s.th}>{L2('Total Logs','记录总数')}</th>
                <th style={s.th}>{L2('Actions','操作')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ ...s.td, textAlign:'center', padding:40, color:'var(--muted)' }}>{L2('Loading...','载入中...')}</td></tr>
              ) : users.map(user => {
                const stats  = userStats[user.id] || { logs:0, vips:0 }
                const isMe   = user.id === myProfile?.id
                const active = user.is_active !== false
                return (
                  <tr key={user.id}
                    onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                    onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                    <td style={s.td}>
                      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <Avatar name={user.full_name || user.username} role={user.role} />
                        <div>
                          <div style={{ fontWeight:700, color:'var(--text)' }}>
                            {user.full_name || user.username}
                            {isMe && <span style={{ marginLeft:6, fontSize:11, color:'var(--accent)' }}>{L2('(you)','（你）')}</span>}
                          </div>
                          <div style={{ fontSize:11, color:'var(--muted)' }}>@{user.username || user.email?.split('@')[0]}</div>
                        </div>
                      </div>
                    </td>
                    <td style={s.td}>
                      <span style={{ ...s.badge, background:ROLE_BG[user.role]||'transparent', color:ROLE_COLOR[user.role]||'var(--text)' }}>
                        {roleLabel(user.role || 'host')}
                      </span>
                    </td>
                    <td style={s.td}>
                      <span style={{ fontSize:12, fontWeight:600, color: active ? '#3fb950' : '#f85149' }}>
                        ● {active ? L2('Active','活跃') : L2('Inactive','停用')}
                      </span>
                    </td>
                    <td style={{ ...s.td, fontWeight:700, color:'var(--accent)' }}>{stats.vips}</td>
                    <td style={{ ...s.td, color:'var(--muted)' }}>{stats.logs}</td>
                    <td style={s.td}>
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                        <button style={s.btnSm} onClick={() => openEdit(user)}>✏️ {L2('Edit','编辑')}</button>
                        <button style={{ ...s.btnSm, color:'var(--accent)', borderColor:'var(--accent)' }}
                          onClick={() => openAssign(user)}>
                          👤 {L2('Assign VIPs','分配 VIP')}
                        </button>
                        {!isMe && (
                          <button style={active ? s.btnDanger : s.btnSuccess}
                            onClick={() => toggleActive(user)}>
                            {active ? L2('🚫 Deactivate','🚫 停用') : L2('✅ Activate','✅ 启用')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ══ MODAL: CREATE USER ══ */}
      {modal === 'create' && (
        <div style={s.overlay} onClick={e => e.target === e.currentTarget && closeModal()}>
          <div style={s.modal}>
            <div style={s.mhdr}>
              <div style={{ fontSize:16, fontWeight:700 }}>➕ {L2('Create New User','创建新用户')}</div>
              <button onClick={closeModal} style={{ background:'none', border:'none', color:'var(--muted)', fontSize:20, cursor:'pointer' }}>×</button>
            </div>
            <div style={s.mbody}>
              <div style={s.grid2}>
                <div style={s.frow}>
                  <div style={s.flbl}>{L2('Username *','用户名 *')}</div>
                  <input style={s.finput} value={form.username}
                    onChange={e => setForm({ ...form, username: e.target.value.toLowerCase().replace(/\s/g,'') })}
                    placeholder={L2('e.g. host_ali','例如 host_ali')} autoCapitalize="none" autoCorrect="off" />
                </div>
                <div style={s.frow}>
                  <div style={s.flbl}>{L2('Full Name *','全名 *')}</div>
                  <input style={s.finput} value={form.full_name}
                    onChange={e => setForm({ ...form, full_name: e.target.value })}
                    placeholder={L2('e.g. Ahmad Faris','例如 Ahmad Faris')} />
                </div>
              </div>
              <div style={s.grid2}>
                <div style={s.frow}>
                  <div style={s.flbl}>{L2('Role *','角色 *')}</div>
                  <select style={s.fsel} value={form.role} onChange={e => setForm({ ...form, role: e.target.value, permissions: e.target.value === 'admin' ? [] : form.permissions })}>
                    <option value="host">{L2('Host','负责人')}</option>
                    <option value="admin">{L2('Admin','管理员')}</option>
                    <option value="readonly">{L2('Read Only','只读')}</option>
                  </select>
                </div>
                <div style={s.frow}>
                  <div style={s.flbl}>{L2('Password *','密码 *')}</div>
                  <input type="password" style={s.finput} value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    placeholder={L2('Min 6 characters','至少 6 个字符')} />
                </div>
              </div>

              {/* Note about first login */}
              <div style={{ background:'rgba(88,166,255,.08)', border:'1px solid rgba(88,166,255,.2)', borderRadius:8, padding:'9px 12px', fontSize:12, color:'var(--muted)', marginBottom:16 }}>
                💡 {L2('User will be prompted to change their password on first login.','用户首次登录时将被要求更改密码。')}
              </div>

              {/* Permissions */}
              <div style={s.frow}>
                <div style={s.flbl}>{L2('Page Permissions','页面权限')}</div>
                {form.role === 'admin' ? (
                  <div style={{ background:'rgba(88,166,255,.08)', border:'1px solid rgba(88,166,255,.2)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#58a6ff' }}>
                    {L2('⚡ Admin has full access to all pages — no restrictions needed.','⚡ 管理员拥有所有页面的完整权限 — 无需设置限制。')}
                  </div>
                ) : (
                  <PermissionsGrid
                    permissions={form.permissions}
                    onChange={perms => setForm({ ...form, permissions: perms })}
                  />
                )}
              </div>

              {msg.text && <div style={msg.ok ? s.ok : s.err}>{msg.text}</div>}
              <div style={{ display:'flex', gap:8, marginTop:4 }}>
                <button style={{ ...s.btn, opacity: saving ? .5 : 1 }} onClick={createUser} disabled={saving}>
                  {saving ? L2('Creating…','创建中…') : L2('✅ Create User','✅ 创建用户')}
                </button>
                <button style={s.btnSm} onClick={closeModal}>{L2('Cancel','取消')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: EDIT USER ══ */}
      {modal === 'edit' && selected && (
        <div style={s.overlay} onClick={e => e.target === e.currentTarget && closeModal()}>
          <div style={s.modal}>
            <div style={s.mhdr}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <Avatar name={selected.full_name || selected.username} role={selected.role} />
                <div>
                  <div style={{ fontSize:16, fontWeight:700 }}>{selected.full_name || selected.username}</div>
                  <div style={{ fontSize:12, color:'var(--muted)' }}>@{selected.username || selected.email?.split('@')[0]}</div>
                </div>
              </div>
              <button onClick={closeModal} style={{ background:'none', border:'none', color:'var(--muted)', fontSize:20, cursor:'pointer' }}>×</button>
            </div>
            <div style={s.mbody}>

              {/* Stats */}
              <div style={{ background:'var(--surface2)', borderRadius:8, padding:'12px 16px', marginBottom:16, display:'flex', gap:28 }}>
                <div>
                  <div style={{ fontSize:20, fontWeight:800, color:'var(--accent)' }}>{userStats[selected.id]?.vips || 0}</div>
                  <div style={{ fontSize:11, color:'var(--muted)' }}>{L2('Assigned VIPs','已分配 VIP')}</div>
                </div>
                <div>
                  <div style={{ fontSize:20, fontWeight:800, color:'var(--text)' }}>{userStats[selected.id]?.logs || 0}</div>
                  <div style={{ fontSize:11, color:'var(--muted)' }}>{L2('Total Logs','记录总数')}</div>
                </div>
              </div>

              {/* Profile fields */}
              <div style={s.grid2}>
                <div style={s.frow}>
                  <div style={s.flbl}>{L2('Full Name','全名')}</div>
                  <input style={s.finput} value={editForm.full_name}
                    onChange={e => setEditForm({ ...editForm, full_name: e.target.value })} />
                </div>
                <div style={s.frow}>
                  <div style={s.flbl}>{L2('Role','角色')}</div>
                  <select style={s.fsel} value={editForm.role}
                    onChange={e => setEditForm({ ...editForm, role: e.target.value, permissions: e.target.value === 'admin' ? [] : editForm.permissions })}>
                    <option value="host">{L2('Host','负责人')}</option>
                    <option value="admin">{L2('Admin','管理员')}</option>
                    <option value="readonly">{L2('Read Only','只读')}</option>
                  </select>
                </div>
              </div>

              {/* Permissions */}
              <div style={s.frow}>
                <div style={s.flbl}>{L2('Page Permissions','页面权限')}</div>
                {editForm.role === 'admin' ? (
                  <div style={{ background:'rgba(88,166,255,.08)', border:'1px solid rgba(88,166,255,.2)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#58a6ff' }}>
                    {L2('⚡ Admin has full access to all pages — no restrictions needed.','⚡ 管理员拥有所有页面的完整权限 — 无需设置限制。')}
                  </div>
                ) : (
                  <PermissionsGrid
                    permissions={editForm.permissions}
                    onChange={perms => setEditForm({ ...editForm, permissions: perms })}
                  />
                )}
              </div>

              <div style={s.divider} />

              {/* Set password section */}
              <div>
                <button style={s.btnWarn} onClick={() => { setSetPwMode(v => !v); setMsg({ text:'', ok:true }) }}>
                  🔑 {setPwMode ? L2('Cancel Password Change','取消更改密码') : L2('Set New Password','设置新密码')}
                </button>
                {setPwMode && (
                  <div style={{ marginTop:12, background:'rgba(210,153,34,.06)', border:'1px solid rgba(210,153,34,.2)', borderRadius:8, padding:'14px' }}>
                    <div style={{ ...s.grid2, marginBottom:0 }}>
                      <div style={s.frow}>
                        <div style={s.flbl}>{L2('New Password','新密码')}</div>
                        <input type="password" style={s.finput} value={newPassword}
                          onChange={e => setNewPassword(e.target.value)}
                          placeholder={L2('Min 6 characters','至少 6 个字符')} autoFocus />
                      </div>
                      <div style={s.frow}>
                        <div style={s.flbl}>{L2('Confirm Password','确认密码')}</div>
                        <input type="password" style={s.finput} value={newPassword2}
                          onChange={e => setNewPassword2(e.target.value)}
                          placeholder={L2('Repeat password','再次输入密码')} />
                      </div>
                    </div>
                    <button style={{ ...s.btnWarn, marginTop:4, opacity: saving?.5:1 }}
                      onClick={handleSetPassword} disabled={saving}>
                      {saving ? L2('Setting…','设置中…') : L2('✅ Confirm New Password','✅ 确认新密码')}
                    </button>
                  </div>
                )}
              </div>

              {msg.text && <div style={{ ...msg.ok ? s.ok : s.err, marginTop:12 }}>{msg.text}</div>}

              <div style={{ display:'flex', gap:8, marginTop:14 }}>
                <button style={{ ...s.btn, opacity: saving?.5:1 }} onClick={saveEdit} disabled={saving}>
                  {saving ? L2('Saving…','保存中…') : L2('💾 Save Changes','💾 保存更改')}
                </button>
                <button style={s.btnSm} onClick={closeModal}>{L2('Cancel','取消')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: ASSIGN VIPs ══ */}
      {modal === 'assign' && selected && (
        <div style={s.overlay} onClick={e => e.target === e.currentTarget && closeModal()}>
          <div style={{ ...s.modal, maxWidth:680 }}>
            <div style={s.mhdr}>
              <div>
                <div style={{ fontSize:16, fontWeight:700 }}>👤 {L2('Assign VIPs','分配 VIP')} — {selected.full_name || selected.username}</div>
                <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>
                  {L2('Currently assigned:','当前已分配：')} <strong style={{ color:'var(--accent)' }}>{assignedToSelected.length}</strong> {L2('VIPs','位 VIP')}
                </div>
              </div>
              <button onClick={closeModal} style={{ background:'none', border:'none', color:'var(--muted)', fontSize:20, cursor:'pointer' }}>×</button>
            </div>
            <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)' }}>
              <input style={{ ...s.finput, width:'100%' }}
                placeholder={L2('🔍 Search VIP username or name...','🔍 搜索 VIP 用户名或姓名...')}
                value={assignSearch} onChange={e => setAssignSearch(e.target.value)} />
            </div>
            <div style={{ maxHeight:420, overflowY:'auto' }}>
              <table style={s.tbl}>
                <thead>
                  <tr>
                    <th style={s.th}>VIP</th>
                    <th style={s.th}>{L2('Tier','等级')}</th>
                    <th style={s.th}>{L2('Current Host','当前负责人')}</th>
                    <th style={s.th}>{L2('Action','操作')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVIPs.slice(0,100).map(v => {
                    const hostName  = selected.full_name || selected.username
                    const isAssigned = v.host_assigned === hostName
                    return (
                      <tr key={v.id}
                        onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                        onMouseLeave={e => e.currentTarget.style.background=isAssigned?'rgba(88,166,255,.05)':'transparent'}
                        style={{ background: isAssigned ? 'rgba(88,166,255,.05)' : 'transparent' }}>
                        <td style={{ ...s.td, fontWeight:700 }}>{v.username}
                          {v.full_name && <span style={{ fontSize:11, color:'var(--muted)', fontWeight:400, marginLeft:6 }}>{v.full_name}</span>}
                        </td>
                        <td style={s.td}>
                          <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:10, background:TIER_BG[v.tier]||'transparent', color:TIER_COLOR[v.tier]||'var(--text)' }}>
                            {v.tier}
                          </span>
                        </td>
                        <td style={{ ...s.td, fontSize:12, color: isAssigned ? 'var(--accent)' : 'var(--muted)' }}>
                          {v.host_assigned || '—'}
                        </td>
                        <td style={s.td}>
                          {isAssigned ? (
                            <button style={s.btnDanger} onClick={() => unassignVIP(v.id)} disabled={assigning}>{L2('Remove','移除')}</button>
                          ) : (
                            <button style={s.btnSuccess} onClick={() => assignVIP(v.id, hostName)} disabled={assigning}>{L2('Assign','分配')}</button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {filteredVIPs.length > 100 && (
                <div style={{ padding:'10px 16px', fontSize:12, color:'var(--muted)', textAlign:'center' }}>
                  {L2(`Showing 100 of ${filteredVIPs.length} — use search to narrow down`, `显示 ${filteredVIPs.length} 条中的 100 条 — 请使用搜索缩小范围`)}
                </div>
              )}
            </div>
            <div style={{ padding:'12px 20px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end' }}>
              <button style={s.btn} onClick={closeModal}>{L2('Done','完成')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── EXCLUDED PLAYERS SECTION ── */}
      <div style={{ ...s.card, marginTop:24 }}>
        <div style={s.cardHdr}>
          <div style={s.cardHdrL}>
            <span>🚫</span> {t('manageUsers.exclusionManagement')}
            <span style={{ background:'rgba(248,81,73,.12)', color:'#f85149', padding:'2px 8px', borderRadius:10, fontSize:11 }}>
              {t('manageUsers.accountsCount', { n: excluded.length })}
            </span>
          </div>
          <div style={{ fontSize:12, color:'var(--muted)' }}>{t('manageUsers.exclusionDesc')}</div>
        </div>
        <div style={{ padding:'16px 20px' }}>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'var(--muted)', marginBottom:8 }}>{t('manageUsers.searchToAdd')}</div>
            <div style={{ display:'flex', gap:8, marginBottom:8 }}>
              <input value={exSearch} onChange={e => searchExcludable(e.target.value)}
                placeholder={t('manageUsers.searchUsernamePlaceholder')} style={{ ...s.finput, maxWidth:300 }} />
              {exSearching && <span style={{ fontSize:12, color:'var(--muted)', alignSelf:'center' }}>{t('manageUsers.searching')}</span>}
            </div>
            {exMsg && <div style={{ fontSize:12, color:'#3fb950', fontWeight:600, marginBottom:8 }}>{exMsg}</div>}
            {exResults.length > 0 && (
              <div style={{ border:'1px solid var(--border)', borderRadius:8, overflow:'hidden', maxWidth:560 }}>
                {exResults.map(r => (
                  <div key={r.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'9px 14px', borderBottom:'1px solid var(--border)', background: r.is_excluded ? 'rgba(248,81,73,.05)' : 'transparent' }}>
                    <span style={{ flex:1, fontSize:13, fontWeight:600 }}>{r.username}</span>
                    <span style={{ fontSize:11, color: r.tier==='DIAMOND'?'#b9f2ff':r.tier==='PLATINUM'?'#C0C0C0':'#ffd700', fontWeight:700 }}>{r.tier}</span>
                    <span style={{ fontSize:11, color:'var(--muted)' }}>{r.host_assigned || '—'}</span>
                    {r.is_excluded
                      ? <button style={s.btnSuccess} onClick={() => setExclude(r.id, r.username, false)}>{t('manageUsers.excludedClickRestore')}</button>
                      : <button style={s.btnDanger}  onClick={() => setExclude(r.id, r.username, true)}>{t('manageUsers.addToExclusion')}</button>
                    }
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize:12, fontWeight:600, color:'var(--muted)', marginBottom:8 }}>{t('manageUsers.currentExclusionList')}</div>
            {excluded.length === 0 ? (
              <div style={{ fontSize:13, color:'var(--muted)', fontStyle:'italic' }}>{t('manageUsers.noExcludedAccounts')}</div>
            ) : (
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {excluded.map(ex => (
                  <div key={ex.id} style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(248,81,73,.08)', border:'1px solid rgba(248,81,73,.2)', borderRadius:8, padding:'5px 10px' }}>
                    <span style={{ fontSize:12, fontWeight:700, color:'#f85149' }}>🚫</span>
                    <span style={{ fontSize:12, fontWeight:600 }}>{ex.username}</span>
                    <span style={{ fontSize:10, color:'var(--muted)' }}>{ex.tier}</span>
                    <button onClick={() => setExclude(ex.id, ex.username, false)}
                      style={{ background:'none', border:'none', color:'var(--muted)', cursor:'pointer', fontSize:14, lineHeight:1, padding:'0 2px', marginLeft:2 }}
                      title={t('manageUsers.removeFromExclusion')}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  )
}
