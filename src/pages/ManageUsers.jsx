import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useLanguage } from '../contexts/LanguageContext'
import { TIER_COLOR, TIER_BG } from '../lib/constants'

// ── styles ────────────────────────────────────────────────────────────────────
const ROLE_COLOR = { admin:'#58a6ff', host:'#3fb950', readonly:'#8b949e' }
const ROLE_BG    = { admin:'rgba(88,166,255,.12)', host:'rgba(63,185,80,.1)', readonly:'rgba(139,148,158,.1)' }

const s = {
  page:    { padding:'24px 28px', minHeight:'100vh' },
  title:   { fontSize:22, fontWeight:700, color:'var(--text)' },
  sub:     { fontSize:13, color:'var(--muted)', marginTop:4 },
  card:    { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12 },
  cardHdr: { padding:'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' },
  cardHdrL:{ display:'flex', alignItems:'center', gap:8, fontSize:12, fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px' },
  cardBody:{ padding:'18px 20px' },
  tbl:     { width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:      { padding:'10px 16px', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'left', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' },
  td:      { padding:'12px 16px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' },
  btn:     { background:'var(--accent)', color:'#fff', border:'none', padding:'9px 20px', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer' },
  btnSm:   { background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)', padding:'6px 14px', borderRadius:7, fontSize:12, cursor:'pointer' },
  btnDanger:{ background:'rgba(248,81,73,.12)', color:'#f85149', border:'1px solid rgba(248,81,73,.25)', padding:'6px 14px', borderRadius:7, fontSize:12, cursor:'pointer' },
  btnSuccess:{ background:'rgba(63,185,80,.12)', color:'#3fb950', border:'1px solid rgba(63,185,80,.25)', padding:'6px 14px', borderRadius:7, fontSize:12, cursor:'pointer' },
  badge:   { display:'inline-block', padding:'3px 10px', borderRadius:12, fontSize:11, fontWeight:700 },
  overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,.75)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:20 },
  modal:   { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, width:'100%', maxWidth:520, maxHeight:'90vh', overflowY:'auto' },
  mhdr:    { padding:'18px 22px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' },
  mbody:   { padding:'20px 22px' },
  flbl:    { fontSize:11, color:'var(--muted)', marginBottom:4 },
  finput:  { width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'9px 12px', borderRadius:8, fontSize:13, outline:'none', boxSizing:'border-box' },
  fsel:    { width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'9px 12px', borderRadius:8, fontSize:13, outline:'none' },
  frow:    { marginBottom:14 },
  grid2:   { display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 },
  err:     { color:'#f85149', fontSize:12, marginTop:6 },
  ok:      { color:'#3fb950', fontSize:12, marginTop:6 },
}

// ── helper ────────────────────────────────────────────────────────────────────
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
  const { t } = useLanguage()
  const isAdmin = myProfile?.role === 'admin'

  const [users,       setUsers]       = useState([])
  const [userStats,   setUserStats]   = useState({}) // { [userId]: { logs, vips } }

  // Excluded players
  const [excluded,      setExcluded]      = useState([])
  const [exSearch,      setExSearch]      = useState('')
  const [exResults,     setExResults]     = useState([])
  const [exSearching,   setExSearching]   = useState(false)
  const [exMsg,         setExMsg]         = useState('')
  const [loading,     setLoading]     = useState(true)
  const [modal,       setModal]       = useState(null) // null | 'create' | 'edit' | 'assign' | 'stats'
  const [selected,    setSelected]    = useState(null)
  const [saving,      setSaving]      = useState(false)
  const [msg,         setMsg]         = useState({ text:'', ok:true })

  // create/edit form
  const [form, setForm] = useState({ email:'', full_name:'', role:'host', password:'' })

  // assign VIPs state
  const [allVIPs,      setAllVIPs]      = useState([])
  const [assignSearch, setAssignSearch] = useState('')
  const [assigning,    setAssigning]    = useState(false)

  useEffect(() => { loadUsers(); loadExcluded() }, [])

  async function loadExcluded() {
    const { data } = await supabase
      .from('vip_members')
      .select('id, username, tier, host_assigned')
      .eq('is_excluded', true)
      .order('username')
    setExcluded(data || [])
  }

  async function searchExcludable(q) {
    setExSearch(q)
    if (q.trim().length < 2) { setExResults([]); return }
    setExSearching(true)
    const { data } = await supabase
      .from('vip_members')
      .select('id, username, tier, host_assigned, is_excluded')
      .ilike('username', `%${q.trim()}%`)
      .limit(10)
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

  async function loadUsers() {
    setLoading(true)
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
    if (data) {
      setUsers(data)
      loadAllStats(data)
    }
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

  // ── create user ──────────────────────────────────────────────────────────────
  async function createUser() {
    if (!form.email || !form.full_name || !form.password) {
      setMsg({ text:'Email, name and password are required.', ok:false }); return
    }
    setSaving(true); setMsg({ text:'', ok:true })

    // Try admin API first, fall back to signUp
    let userId = null
    const { data: adminData, error: adminError } = await supabase.auth.admin.createUser({
      email:         form.email,
      password:      form.password,
      email_confirm: true,
      user_metadata: { full_name: form.full_name, role: form.role },
    })
    if (!adminError && adminData?.user?.id) {
      userId = adminData.user.id
    } else {
      const { data: signUpData, error: e2 } = await supabase.auth.signUp({
        email: form.email, password: form.password,
        options: { data: { full_name: form.full_name, role: form.role } }
      })
      if (e2) { setMsg({ text: e2.message, ok:false }); setSaving(false); return }
      userId = signUpData?.user?.id
    }

    // Insert profile row with correct columns (no username column)
    if (userId) {
      const { error: profileError } = await supabase.from('profiles').upsert({
        id:        userId,
        email:     form.email,
        full_name: form.full_name,
        role:      form.role,
        is_active: true,
        created_at: new Date().toISOString(),
      }, { onConflict: 'id' })
      if (profileError) {
        setMsg({ text: '⚠️ Auth user created but profile save failed: ' + profileError.message, ok:false })
        setSaving(false); return
      }
    } else {
      // No userId yet (email confirmation pending) — poll until the profile row appears
      async function waitForProfile(userId, maxRetries = 6) {
        for (let i = 0; i < maxRetries; i++) {
          await new Promise(r => setTimeout(r, 600))
          const { data } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle()
          if (data) return data
        }
        return null
      }
      const { data: authUser } = await supabase.auth.admin.getUserByEmail?.(form.email) || {}
      if (authUser?.id) {
        const newUserId = authUser.id
        await supabase.from('profiles').upsert({
          id: newUserId, email: form.email,
          full_name: form.full_name, role: form.role,
          is_active: true, created_at: new Date().toISOString(),
        }, { onConflict: 'id' })
        const profile = await waitForProfile(newUserId)
        if (!profile) {
          setMsg({ text: 'User auth created but profile never appeared — please refresh and check.', ok:false })
          setSaving(false); return
        }
      }
    }

    setMsg({ text:'✅ User created successfully!', ok:true })
    setForm({ email:'', full_name:'', role:'host', password:'' })
    setSaving(false)
    setTimeout(() => loadUsers(), 1000)
  }

  // ── edit user ────────────────────────────────────────────────────────────────
  async function saveEdit() {
    setSaving(true); setMsg({ text:'', ok:true })
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: form.full_name, role: form.role, updated_at: new Date().toISOString() })
      .eq('id', selected.id)
    if (error) { setMsg({ text: error.message, ok:false }) }
    else { setMsg({ text:'✅ Profile updated.', ok:true }); loadUsers() }
    setSaving(false)
  }

  // ── reset password ───────────────────────────────────────────────────────────
  async function resetPassword() {
    if (!selected?.email && !form.email) { setMsg({ text:'No email on record for this user.', ok:false }); return }
    setSaving(true)
    const { error } = await supabase.auth.resetPasswordForEmail(selected?.email || form.email)
    if (error) setMsg({ text: error.message, ok:false })
    else       setMsg({ text:'✅ Password reset email sent!', ok:true })
    setSaving(false)
  }

  // ── toggle active ────────────────────────────────────────────────────────────
  async function toggleActive(user) {
    await supabase.from('profiles').update({ is_active: !user.is_active }).eq('id', user.id)
    loadUsers()
  }

  // ── assign VIPs modal ────────────────────────────────────────────────────────
  async function openAssign(user) {
    setSelected(user)
    setAssignSearch('')
    const { data } = await supabase
      .from('vip_members')
      .select('id, username, full_name, tier, host_assigned')
      .eq('is_excluded', false)
      .order('vip_score', { ascending: false })
    setAllVIPs(data || [])
    setModal('assign')
  }

  async function assignVIP(vipId, hostName) {
    setAssigning(true)
    await supabase.from('vip_members').update({ host_assigned: hostName }).eq('id', vipId)
    const { data } = await supabase
      .from('vip_members').select('id, username, full_name, tier, host_assigned')
      .eq('is_excluded', false).order('vip_score', { ascending: false })
    setAllVIPs(data || [])
    setAssigning(false)
  }

  async function unassignVIP(vipId) {
    setAssigning(true)
    await supabase.from('vip_members').update({ host_assigned: null }).eq('id', vipId)
    const { data } = await supabase
      .from('vip_members').select('id, username, full_name, tier, host_assigned')
      .eq('is_excluded', false).order('vip_score', { ascending: false })
    setAllVIPs(data || [])
    setAssigning(false)
  }

  function openEdit(user) {
    setSelected(user)
    setForm({ email: user.email||'', full_name: user.full_name||'', role: user.role||'host', password:'' })
    setMsg({ text:'', ok:true })
    setModal('edit')
  }

  function openCreate() {
    setSelected(null)
    setForm({ email:'', full_name:'', role:'host', password:'' })
    setMsg({ text:'', ok:true })
    setModal('create')
  }

  function closeModal() { setModal(null); setSelected(null); setMsg({ text:'', ok:true }) }

  const filteredVIPs = allVIPs.filter(v =>
    !assignSearch.trim() ||
    v.username?.toLowerCase().includes(assignSearch.toLowerCase()) ||
    v.full_name?.toLowerCase().includes(assignSearch.toLowerCase())
  )
  // TODO: This matches by host full_name string — if a host renames, assignments break.
  // Future fix: migrate vip_members.host_assigned to store host UUID instead of name.
  const assignedToSelected = allVIPs.filter(v => v.host_assigned === (selected?.full_name || selected?.username))

  if (!isAdmin) return (
    <div style={{ ...s.page, display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60vh' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:40, marginBottom:12 }}>🔒</div>
        <div style={{ fontSize:16, fontWeight:700, color:'var(--text)' }}>Admin Only</div>
        <div style={{ fontSize:13, color:'var(--muted)', marginTop:6 }}>You need admin access to manage users.</div>
      </div>
    </div>
  )

  return (
    <div style={s.page}>

      {/* ── Header ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <div style={s.title}>👥 Manage Users</div>
          <div style={s.sub}>{users.length} users · {users.filter(u=>u.is_active!==false).length} active</div>
        </div>
        <button style={s.btn} onClick={openCreate}>＋ Create User</button>
      </div>

      {/* ── Users table ── */}
      <div style={{ ...s.card, overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <table style={s.tbl}>
            <thead>
              <tr>
                <th style={s.th}>User</th>
                <th style={s.th}>Role</th>
                <th style={s.th}>Status</th>
                <th style={s.th}>Assigned VIPs</th>
                <th style={s.th}>Total Logs</th>
                <th style={s.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ ...s.td, textAlign:'center', padding:40, color:'var(--muted)' }}>Loading...</td></tr>
              ) : users.map(user => {
                const stats   = userStats[user.id] || { logs:0, vips:0 }
                const isMe    = user.id === myProfile?.id
                const active  = user.is_active !== false
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
                            {isMe && <span style={{ marginLeft:6, fontSize:11, color:'var(--accent)' }}>(you)</span>}
                          </div>
                          <div style={{ fontSize:11, color:'var(--muted)' }}>{user.email || user.username}</div>
                        </div>
                      </div>
                    </td>
                    <td style={s.td}>
                      <span style={{ ...s.badge, background:ROLE_BG[user.role]||'transparent', color:ROLE_COLOR[user.role]||'var(--text)' }}>
                        {user.role || 'host'}
                      </span>
                    </td>
                    <td style={s.td}>
                      <span style={{ fontSize:12, fontWeight:600, color: active ? '#3fb950' : '#f85149' }}>
                        ● {active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ ...s.td, fontWeight:700, color:'var(--accent)' }}>{stats.vips}</td>
                    <td style={{ ...s.td, color:'var(--muted)' }}>{stats.logs}</td>
                    <td style={s.td}>
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                        <button style={s.btnSm} onClick={() => openEdit(user)}>✏️ Edit</button>
                        <button style={{ ...s.btnSm, color:'var(--accent)', borderColor:'var(--accent)' }}
                          onClick={() => openAssign(user)}>
                          👤 Assign VIPs
                        </button>
                        {!isMe && (
                          <button style={active ? s.btnDanger : s.btnSuccess}
                            onClick={() => toggleActive(user)}>
                            {active ? '🚫 Deactivate' : '✅ Activate'}
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
        <div style={s.overlay} onClick={e => e.target===e.currentTarget && closeModal()}>
          <div style={s.modal}>
            <div style={s.mhdr}>
              <div style={{ fontSize:16, fontWeight:700 }}>➕ Create New User</div>
              <button onClick={closeModal} style={{ background:'none', border:'none', color:'var(--muted)', fontSize:20, cursor:'pointer' }}>×</button>
            </div>
            <div style={s.mbody}>
              <div style={s.frow}>
                <div style={s.flbl}>Full Name *</div>
                <input style={s.finput} value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})} placeholder="e.g. Ahmad Faris" />
              </div>
              <div style={s.frow}>
                <div style={s.flbl}>Email Address *</div>
                <input type="email" style={s.finput} value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="host@surewin.com" />
              </div>
              <div style={{ ...s.grid2, marginBottom:14 }}>
                <div>
                  <div style={s.flbl}>Role *</div>
                  <select style={s.fsel} value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
                    <option value="host">Host</option>
                    <option value="admin">Admin</option>
                    <option value="readonly">Read Only</option>
                  </select>
                </div>
                <div>
                  <div style={s.flbl}>Temporary Password *</div>
                  <input type="password" style={s.finput} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Min 8 characters" />
                </div>
              </div>
              {msg.text && <div style={msg.ok ? s.ok : s.err}>{msg.text}</div>}
              <div style={{ display:'flex', gap:8, marginTop:16 }}>
                <button style={{ ...s.btn, opacity: saving?.5:1 }} onClick={createUser} disabled={saving}>
                  {saving ? 'Creating...' : '✅ Create User'}
                </button>
                <button style={s.btnSm} onClick={closeModal}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: EDIT USER ══ */}
      {modal === 'edit' && selected && (
        <div style={s.overlay} onClick={e => e.target===e.currentTarget && closeModal()}>
          <div style={s.modal}>
            <div style={s.mhdr}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <Avatar name={selected.full_name||selected.username} role={selected.role} />
                <div style={{ fontSize:16, fontWeight:700 }}>{selected.full_name || selected.username}</div>
              </div>
              <button onClick={closeModal} style={{ background:'none', border:'none', color:'var(--muted)', fontSize:20, cursor:'pointer' }}>×</button>
            </div>
            <div style={s.mbody}>
              <div style={s.frow}>
                <div style={s.flbl}>Full Name</div>
                <input style={s.finput} value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})} />
              </div>
              <div style={s.frow}>
                <div style={s.flbl}>Role</div>
                <select style={s.fsel} value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
                  <option value="host">Host</option>
                  <option value="admin">Admin</option>
                  <option value="readonly">Read Only</option>
                </select>
              </div>

              {/* Stats summary */}
              <div style={{ background:'var(--surface2)', borderRadius:8, padding:'12px 14px', marginBottom:14, display:'flex', gap:24 }}>
                <div>
                  <div style={{ fontSize:20, fontWeight:800, color:'var(--accent)' }}>{userStats[selected.id]?.vips||0}</div>
                  <div style={{ fontSize:11, color:'var(--muted)' }}>Assigned VIPs</div>
                </div>
                <div>
                  <div style={{ fontSize:20, fontWeight:800, color:'var(--text)' }}>{userStats[selected.id]?.logs||0}</div>
                  <div style={{ fontSize:11, color:'var(--muted)' }}>Total Contact Logs</div>
                </div>
              </div>

              {msg.text && <div style={msg.ok ? s.ok : s.err}>{msg.text}</div>}

              <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
                <button style={{ ...s.btn, opacity:saving?.5:1 }} onClick={saveEdit} disabled={saving}>
                  {saving ? 'Saving...' : '💾 Save Changes'}
                </button>
                <button style={{ ...s.btnSm, color:'#d29922', borderColor:'#d29922' }}
                  onClick={resetPassword} disabled={saving}>
                  🔑 Send Password Reset
                </button>
                <button style={s.btnSm} onClick={closeModal}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: ASSIGN VIPs ══ */}
      {modal === 'assign' && selected && (
        <div style={s.overlay} onClick={e => e.target===e.currentTarget && closeModal()}>
          <div style={{ ...s.modal, maxWidth:680 }}>
            <div style={s.mhdr}>
              <div>
                <div style={{ fontSize:16, fontWeight:700 }}>👤 Assign VIPs — {selected.full_name || selected.username}</div>
                <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>
                  Currently assigned: <strong style={{ color:'var(--accent)' }}>{assignedToSelected.length}</strong> VIPs
                </div>
              </div>
              <button onClick={closeModal} style={{ background:'none', border:'none', color:'var(--muted)', fontSize:20, cursor:'pointer' }}>×</button>
            </div>
            <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)' }}>
              <input
                style={{ ...s.finput, width:'100%' }}
                placeholder="🔍 Search VIP username or name..."
                value={assignSearch}
                onChange={e => setAssignSearch(e.target.value)}
              />
            </div>
            <div style={{ maxHeight:420, overflowY:'auto' }}>
              <table style={s.tbl}>
                <thead>
                  <tr>
                    <th style={s.th}>VIP</th>
                    <th style={s.th}>Tier</th>
                    <th style={s.th}>Current Host</th>
                    <th style={s.th}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVIPs.slice(0,100).map(v => {
                    const hostName = selected.full_name || selected.username
                    const isAssigned = v.host_assigned === hostName
                    return (
                      <tr key={v.id}
                        onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                        onMouseLeave={e => e.currentTarget.style.background= isAssigned?'rgba(88,166,255,.05)':'transparent'}
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
                            <button style={s.btnDanger} onClick={() => unassignVIP(v.id)} disabled={assigning}>
                              Remove
                            </button>
                          ) : (
                            <button style={s.btnSuccess} onClick={() => assignVIP(v.id, hostName)} disabled={assigning}>
                              Assign
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {filteredVIPs.length > 100 && (
                <div style={{ padding:'10px 16px', fontSize:12, color:'var(--muted)', textAlign:'center' }}>
                  Showing 100 of {filteredVIPs.length} — use search to narrow down
                </div>
              )}
            </div>
            <div style={{ padding:'12px 20px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end' }}>
              <button style={s.btn} onClick={closeModal}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* ── EXCLUDED PLAYERS SECTION ── */}
      <div style={{ ...s.card, marginTop: 24 }}>
        <div style={s.cardHdr}>
          <div style={s.cardHdrL}>
            <span>🚫</span> {t('manageUsers.exclusionManagement')}
            <span style={{ background:'rgba(248,81,73,.12)', color:'#f85149', padding:'2px 8px', borderRadius:10, fontSize:11 }}>{t('manageUsers.accountsCount', { n: excluded.length })}</span>
          </div>
          <div style={{ fontSize:12, color:'var(--muted)' }}>{t('manageUsers.exclusionDesc')}</div>
        </div>
        <div style={{ padding:'16px 20px' }}>
          {/* Search to add */}
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
                    <span style={{ fontSize:11, color:'var(--muted)' }}>{r.host_assigned||'—'}</span>
                    {r.is_excluded
                      ? <button style={s.btnSuccess} onClick={() => setExclude(r.id, r.username, false)}>{t('manageUsers.excludedClickRestore')}</button>
                      : <button style={s.btnDanger}  onClick={() => setExclude(r.id, r.username, true)}>{t('manageUsers.addToExclusion')}</button>}
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Current excluded list */}
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
