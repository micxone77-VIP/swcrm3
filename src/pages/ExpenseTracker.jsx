// ExpenseTracker.jsx — Department expense tracking with MY/SG/KH breakdown
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useLanguage } from '../contexts/LanguageContext'
import { useUrlParam } from '../hooks/useUrlParam'

const MONTHS     = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
// CATEGORIES (and the 'Bonus 红包' default below) are stored as literal values in
// department_expenses.category — they intentionally stay in their original form
// regardless of the language toggle, so existing records keep matching correctly.
const CATEGORIES = ['Gold Bar', 'Bonus 红包', 'Cash Voucher', 'Concert/Event Ticket', 'Full Reward 1K', 'SG Deposit Privilege', 'Daily Reward', 'Service Fee', 'Other']
const PLATFORMS  = ['MY', 'SG', 'KH', 'BOTH']
const EXP_TYPES  = ['online', 'offline']
const CURRENCIES = ['MYR', 'SGD', 'USD', 'KHUSD']

function fmt(n, currency='MYR') {
  if (!n && n!==0) return '—'
  const sym = currency==='SGD'?'SGD ':currency==='USD'?'USD ':currency==='KHUSD'?'USD ':'RM '
  if (n>=1000000) return sym+(n/1000000).toFixed(2)+'M'
  if (n>=1000)    return sym+(n/1000).toFixed(1)+'K'
  return sym+Math.round(n).toLocaleString()
}

const currentYearMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
}

const fmtMonthLabel = (m) => {
  if (!m) return ''
  const [y, mo] = m.split('-')
  return `${MONTHS[parseInt(mo,10)-1]} ${y}`
}

const s = {
  page:    { padding:'24px 28px', minHeight:'100vh', color:'var(--text)' },
  title:   { fontSize:22, fontWeight:700 },
  sub:     { fontSize:13, color:'var(--muted)', marginTop:4, marginBottom:24 },
  card:    { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, marginBottom:16 },
  cardHdr: { padding:'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10 },
  cardBdy: { padding:'20px' },
  input:   { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 12px', borderRadius:8, fontSize:13, outline:'none', width:'100%', boxSizing:'border-box' },
  sel:     { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 12px', borderRadius:8, fontSize:13, outline:'none', width:'100%' },
  btn:     (c='var(--accent)', dis=false) => ({ background:dis?'var(--border)':c, color:dis?'var(--muted)':'#fff', border:'none', padding:'9px 20px', borderRadius:8, fontWeight:700, fontSize:13, cursor:dis?'not-allowed':'pointer' }),
  btnSm:   (c='var(--surface2)') => ({ background:c, color:c==='var(--surface2)'?'var(--text)':'#fff', border:'1px solid var(--border)', padding:'5px 12px', borderRadius:6, fontSize:11, cursor:'pointer' }),
  tbl:     { width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:      { padding:'9px 14px', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'left', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' },
  td:      { padding:'10px 14px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' },
  tag:     (c) => ({ display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600, background:c+'22', color:c }),
  grid:    { display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))', gap:10, marginBottom:16 },
  statCard:{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:'14px 16px' },
  lbl:     { fontSize:11, color:'var(--muted)', marginBottom:4 },
  formGrid:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 16px', marginBottom:14 },
}

const SECTION_COLORS = {
  'MY-online':  '#3fb950',
  'MY-offline': '#58a6ff',
  'SG-online':  '#f59e0b',
  'SG-offline': '#b9f2ff',
  'KH-online':  '#e879f9',
  'KH-offline': '#fb923c',
}

const PLATFORM_COLOR = { MY:'#3fb950', SG:'#f59e0b', KH:'#e879f9', BOTH:'#8b5cf6' }
const TYPE_COLOR = { online:'#58a6ff', offline:'#cd7f32' }

export default function ExpenseTracker() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const isAdmin = profile?.role === 'admin'

  const [month,    setMonth]    = useUrlParam('month', currentYearMonth())
  const [expenses, setExpenses] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [editId,   setEditId]   = useState(null)

  const [form, setForm] = useState({
    category:         'Bonus 红包',
    item_name:        '',
    platform:         'MY',
    currency:         'MYR',
    amount:           '',
    expense_type:     'online',
    linked_campaign:  '',
    notes:            '',
  })

  useEffect(() => { loadExpenses() }, [month])

  async function loadExpenses() {
    setLoading(true)
    const { data } = await supabase
      .from('department_expenses')
      .select('*')
      .eq('month', month)
      .order('platform').order('expense_type').order('created_at')
    setExpenses(data || [])
    setLoading(false)
  }

  async function handleSave() {
    if (!form.item_name.trim() || !form.amount) return
    setSaving(true)
    const record = {
      month,
      category:        form.category,
      item_name:       form.item_name.trim(),
      platform:        form.platform,
      currency:        form.currency,
      amount:          parseFloat(form.amount) || 0,
      expense_type:    form.expense_type,
      linked_campaign: form.linked_campaign || null,
      notes:           form.notes || null,
      created_by:      profile?.id || null,
    }
    if (editId) {
      await supabase.from('department_expenses').update(record).eq('id', editId)
    } else {
      await supabase.from('department_expenses').insert(record)
    }
    setForm({ category:'Bonus 红包', item_name:'', platform:'MY', currency:'MYR', amount:'', expense_type:'online', linked_campaign:'', notes:'' })
    setShowForm(false)
    setEditId(null)
    setSaving(false)
    loadExpenses()
  }

  async function handleDelete(id) {
    if (!window.confirm(t('expenseTracker.deleteConfirm'))) return
    await supabase.from('department_expenses').delete().eq('id', id)
    loadExpenses()
  }

  function startEdit(exp) {
    setForm({
      category:        exp.category,
      item_name:       exp.item_name,
      platform:        exp.platform,
      currency:        exp.currency,
      amount:          String(exp.amount),
      expense_type:    exp.expense_type,
      linked_campaign: exp.linked_campaign || '',
      notes:           exp.notes || '',
    })
    setEditId(exp.id)
    setShowForm(true)
  }

  // ── Calculations ────────────────────────────────────────────────────────────
  // MY and SG sections include BOTH-platform expenses (filtered by currency)
  const myOnline  = expenses.filter(e => (e.platform==='MY' || e.platform==='BOTH') && e.expense_type==='online'  && e.currency==='MYR')
  const myOffline = expenses.filter(e => (e.platform==='MY' || e.platform==='BOTH') && e.expense_type==='offline' && e.currency==='MYR')
  const sgOnline  = expenses.filter(e => (e.platform==='SG' || e.platform==='BOTH') && e.expense_type==='online'  && e.currency==='SGD')
  const sgOffline = expenses.filter(e => (e.platform==='SG' || e.platform==='BOTH') && e.expense_type==='offline' && e.currency==='SGD')
  const khOnline  = expenses.filter(e => e.platform==='KH' && e.expense_type==='online'  && e.currency==='KHUSD')
  const khOffline = expenses.filter(e => e.platform==='KH' && e.expense_type==='offline' && e.currency==='KHUSD')

  const myTotal   = [...myOnline, ...myOffline].reduce((s,e) => s + (parseFloat(e.amount)||0), 0)
  const sgTotal   = [...sgOnline, ...sgOffline].reduce((s,e) => s + (parseFloat(e.amount)||0), 0)
  const khTotal   = [...khOnline, ...khOffline].reduce((s,e) => s + (parseFloat(e.amount)||0), 0)

  const myOnlineTotal  = myOnline.reduce((s,e) => s + (parseFloat(e.amount)||0), 0)
  const myOfflineTotal = myOffline.reduce((s,e) => s + (parseFloat(e.amount)||0), 0)
  const sgOnlineTotal  = sgOnline.reduce((s,e) => s + (parseFloat(e.amount)||0), 0)
  const sgOfflineTotal = sgOffline.reduce((s,e) => s + (parseFloat(e.amount)||0), 0)
  const khOnlineTotal  = khOnline.reduce((s,e) => s + (parseFloat(e.amount)||0), 0)
  const khOfflineTotal = khOffline.reduce((s,e) => s + (parseFloat(e.amount)||0), 0)

  // Group by platform+type for display
  const sections = [
    { key:'MY-online',  label:t('expenseTracker.sectionMyOnline'),  platform:'MY', type:'online',  items:myOnline,  total:myOnlineTotal,  currency:'MYR',   color:'#3fb950' },
    { key:'MY-offline', label:t('expenseTracker.sectionMyOffline'), platform:'MY', type:'offline', items:myOffline, total:myOfflineTotal, currency:'MYR',   color:'#58a6ff' },
    { key:'SG-online',  label:t('expenseTracker.sectionSgOnline'),  platform:'SG', type:'online',  items:sgOnline,  total:sgOnlineTotal,  currency:'SGD',   color:'#f59e0b' },
    { key:'SG-offline', label:t('expenseTracker.sectionSgOffline'), platform:'SG', type:'offline', items:sgOffline, total:sgOfflineTotal, currency:'SGD',   color:'#b9f2ff' },
    { key:'KH-online',  label:'🇰🇭 Cambodia — Online',               platform:'KH', type:'online',  items:khOnline,  total:khOnlineTotal,  currency:'KHUSD', color:'#e879f9' },
    { key:'KH-offline', label:'🇰🇭 Cambodia — Offline',              platform:'KH', type:'offline', items:khOffline, total:khOfflineTotal, currency:'KHUSD', color:'#fb923c' },
  ]

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:4, flexWrap:'wrap', gap:12 }}>
        <div>
          <div style={s.title}>💼 {t('expenseTracker.pageTitle')}</div>
          <div style={s.sub}>Department Expense Tracker — {fmtMonthLabel(month)}</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            style={{ ...s.input, width:160 }} />
          {isAdmin && (
            <button style={s.btn()} onClick={() => { setShowForm(s => !s); setEditId(null); setForm({ category:'Bonus 红包', item_name:'', platform:'MY', currency:'MYR', amount:'', expense_type:'online', linked_campaign:'', notes:'' }) }}>
              {showForm ? t('common.cancel') : t('expenseTracker.addExpenseBtn')}
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div style={s.grid}>
        <div style={s.statCard}>
          <div style={s.lbl}>{t('expenseTracker.statMyTotal')}</div>
          <div style={{ fontSize:22, fontWeight:800, color:'#3fb950' }}>{fmt(myTotal,'MYR')}</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>{t('expenseTracker.online')} {fmt(myOnlineTotal,'MYR')} · {t('expenseTracker.offline')} {fmt(myOfflineTotal,'MYR')}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.lbl}>{t('expenseTracker.statSgTotal')}</div>
          <div style={{ fontSize:22, fontWeight:800, color:'#f59e0b' }}>{fmt(sgTotal,'SGD')}</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>{t('expenseTracker.online')} {fmt(sgOnlineTotal,'SGD')} · {t('expenseTracker.offline')} {fmt(sgOfflineTotal,'SGD')}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.lbl}>🇰🇭 KH Total</div>
          <div style={{ fontSize:22, fontWeight:800, color:'#e879f9' }}>{fmt(khTotal,'KHUSD')}</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>{t('expenseTracker.online')} {fmt(khOnlineTotal,'KHUSD')} · {t('expenseTracker.offline')} {fmt(khOfflineTotal,'KHUSD')}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.lbl}>{t('expenseTracker.statMyOnlineSub')}</div>
          <div style={{ fontSize:20, fontWeight:700, color:'#3fb950' }}>{fmt(myOnlineTotal,'MYR')}</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>{t('expenseTracker.itemsCount', { n: myOnline.length })}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.lbl}>{t('expenseTracker.statMyOfflineSub')}</div>
          <div style={{ fontSize:20, fontWeight:700, color:'#58a6ff' }}>{fmt(myOfflineTotal,'MYR')}</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>{t('expenseTracker.itemsCount', { n: myOffline.length })}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.lbl}>{t('expenseTracker.statSgOnlineSub')}</div>
          <div style={{ fontSize:20, fontWeight:700, color:'#f59e0b' }}>{fmt(sgOnlineTotal,'SGD')}</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>{t('expenseTracker.itemsCount', { n: sgOnline.length })}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.lbl}>{t('expenseTracker.statSgOfflineSub')}</div>
          <div style={{ fontSize:20, fontWeight:700, color:'#b9f2ff' }}>{fmt(sgOfflineTotal,'SGD')}</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>{t('expenseTracker.itemsCount', { n: sgOffline.length })}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.lbl}>🇰🇭 KH Online</div>
          <div style={{ fontSize:20, fontWeight:700, color:'#e879f9' }}>{fmt(khOnlineTotal,'KHUSD')}</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>{t('expenseTracker.itemsCount', { n: khOnline.length })}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.lbl}>🇰🇭 KH Offline</div>
          <div style={{ fontSize:20, fontWeight:700, color:'#fb923c' }}>{fmt(khOfflineTotal,'KHUSD')}</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>{t('expenseTracker.itemsCount', { n: khOffline.length })}</div>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showForm && isAdmin && (
        <div style={{ ...s.card, border:'1px solid var(--accent)', marginBottom:16 }}>
          <div style={s.cardHdr}>
            <span style={{ fontSize:13, fontWeight:700 }}>{editId ? t('expenseTracker.editExpense') : t('expenseTracker.addNewExpense')}</span>
          </div>
          <div style={s.cardBdy}>
            <div style={s.formGrid}>
              <div>
                <div style={s.lbl}>{t('expenseTracker.category')}</div>
                <select style={s.sel} value={form.category} onChange={e => setForm({...form, category:e.target.value})}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <div style={s.lbl}>{t('expenseTracker.itemNameRequired')}</div>
                <input style={s.input} value={form.item_name} onChange={e => setForm({...form, item_name:e.target.value})}
                  placeholder={t('expenseTracker.itemNamePlaceholder')} />
              </div>
              <div>
                <div style={s.lbl}>{t('expenseTracker.platform')}</div>
                <select style={s.sel} value={form.platform} onChange={e => {
                  const p = e.target.value
                  let currency = 'MYR'
                  if (p === 'SG') currency = 'SGD'
                  else if (p === 'KH') currency = 'KHUSD'
                  setForm({...form, platform:p, currency})
                }}>
                  {PLATFORMS.map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <div style={s.lbl}>{t('expenseTracker.onlineOffline')}</div>
                <select style={s.sel} value={form.expense_type} onChange={e => setForm({...form, expense_type:e.target.value})}>
                  <option value="online">{t('expenseTracker.optionOnline')}</option>
                  <option value="offline">{t('expenseTracker.optionOffline')}</option>
                </select>
              </div>
              <div>
                <div style={s.lbl}>{t('common.currency')}</div>
                <select style={s.sel} value={form.currency} onChange={e => setForm({...form, currency:e.target.value})}>
                  {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <div style={s.lbl}>{t('expenseTracker.amountRequired')}</div>
                <input type="number" style={s.input} value={form.amount} onChange={e => setForm({...form, amount:e.target.value})}
                  placeholder="0.00" />
              </div>
              <div>
                <div style={s.lbl}>{t('expenseTracker.linkedCampaignOptional')}</div>
                <input style={s.input} value={form.linked_campaign} onChange={e => setForm({...form, linked_campaign:e.target.value})}
                  placeholder={t('expenseTracker.linkedCampaignPlaceholder')} />
              </div>
              <div>
                <div style={s.lbl}>{t('common.notes')}</div>
                <input style={s.input} value={form.notes} onChange={e => setForm({...form, notes:e.target.value})}
                  placeholder={t('expenseTracker.notesOptionalPlaceholder')} />
              </div>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button style={s.btn('var(--accent)', !form.item_name.trim()||!form.amount)} disabled={saving||!form.item_name.trim()||!form.amount} onClick={handleSave}>
                {saving ? t('common.saving') : editId ? t('expenseTracker.updateBtn') : t('expenseTracker.addExpenseFormBtn')}
              </button>
              <button style={s.btnSm()} onClick={() => { setShowForm(false); setEditId(null) }}>{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Expense sections */}
      {loading ? (
        <div style={{ textAlign:'center', padding:40, color:'var(--muted)' }}>{t('common.loading')}</div>
      ) : expenses.length === 0 ? (
        <div style={{ ...s.card, padding:40, textAlign:'center', color:'var(--muted)' }}>
          {t('expenseTracker.noExpensesYet', { month: fmtMonthLabel(month) })}
          {isAdmin && <span>{t('expenseTracker.clickAddHint')}</span>}
        </div>
      ) : (
        <>
          {sections.map(sec => sec.items.length > 0 && (
            <div key={sec.key} style={s.card}>
              <div style={{ ...s.cardHdr, borderLeft:`4px solid ${sec.color}` }}>
                <span style={{ fontSize:14, fontWeight:700, color:sec.color }}>{sec.label}</span>
                <span style={{ marginLeft:'auto', fontSize:14, fontWeight:800, color:sec.color }}>
                  {fmt(sec.total, sec.currency)}
                </span>
              </div>
              <table style={s.tbl}>
                <thead>
                  <tr>
                    <th style={s.th}>{t('expenseTracker.category')}</th>
                    <th style={s.th}>{t('expenseTracker.colItemName')}</th>
                    <th style={s.th}>{t('common.currency')}</th>
                    <th style={s.th}>{t('expenseTracker.colAmount')}</th>
                    <th style={s.th}>{t('expenseTracker.colLinkedCampaign')}</th>
                    <th style={s.th}>{t('common.notes')}</th>
                    {isAdmin && <th style={s.th}>{t('common.actions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {sec.items.map(exp => (
                    <tr key={exp.id}
                      onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                      onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                      <td style={s.td}><span style={s.tag('#8b949e')}>{exp.category}</span></td>
                      <td style={{ ...s.td, fontWeight:600 }}>
                        {exp.item_name}
                        {exp.platform === 'BOTH' && (
                          <span style={{ marginLeft:6, fontSize:10, color:'#8b5cf6', background:'#8b5cf622', borderRadius:4, padding:'1px 5px', fontWeight:600 }}>
                            Both
                          </span>
                        )}
                      </td>
                      <td style={s.td}><span style={s.tag(sec.color)}>{exp.currency}</span></td>
                      <td style={{ ...s.td, fontWeight:700, color:sec.color, fontFamily:'monospace' }}>
                        {fmt(exp.amount, exp.currency)}
                      </td>
                      <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>{exp.linked_campaign||'—'}</td>
                      <td style={{ ...s.td, fontSize:12, color:'var(--muted)', maxWidth:200 }}>
                        <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{exp.notes||'—'}</div>
                      </td>
                      {isAdmin && (
                        <td style={s.td} onClick={e => e.stopPropagation()}>
                          <div style={{ display:'flex', gap:6 }}>
                            <button style={s.btnSm()} onClick={() => startEdit(exp)}>{t('common.edit')}</button>
                            <button style={{ ...s.btnSm(), borderColor:'rgba(248,81,73,.3)', color:'#f85149' }} onClick={() => handleDelete(exp.id)}>{t('common.delete')}</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                  {/* Subtotal row */}
                  <tr style={{ background:'var(--surface2)' }}>
                    <td colSpan={isAdmin?3:3} style={{ ...s.td, fontWeight:700, color:'var(--muted)', fontSize:12 }}>{t('expenseTracker.subtotal')}</td>
                    <td colSpan={isAdmin?4:3} style={{ ...s.td, fontWeight:800, color:sec.color, fontFamily:'monospace' }}>
                      {fmt(sec.total, sec.currency)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}

          {/* Grand Total */}
          <div style={{ ...s.card, border:'2px solid var(--accent)' }}>
            <div style={{ padding:'16px 20px' }}>
              <div style={{ fontSize:13, fontWeight:700, color:'var(--muted)', marginBottom:12, textTransform:'uppercase', letterSpacing:'.5px' }}>
                {t('expenseTracker.grandTotalTitle', { month: fmtMonthLabel(month) })}
              </div>
              <div style={{ display:'flex', gap:24, flexWrap:'wrap', alignItems:'flex-end' }}>
                <div>
                  <div style={{ fontSize:11, color:'var(--muted)', marginBottom:2 }}>TOTAL (MYR)</div>
                  <div style={{ fontSize:28, fontWeight:800, color:'#3fb950' }}>{fmt(myTotal,'MYR')}</div>
                </div>
                <div style={{ fontSize:22, color:'var(--muted)', alignSelf:'center' }}>+</div>
                <div>
                  <div style={{ fontSize:11, color:'var(--muted)', marginBottom:2 }}>TOTAL (SGD)</div>
                  <div style={{ fontSize:28, fontWeight:800, color:'#f59e0b' }}>{fmt(sgTotal,'SGD')}</div>
                </div>
                <div style={{ fontSize:22, color:'var(--muted)', alignSelf:'center' }}>+</div>
                <div>
                  <div style={{ fontSize:11, color:'var(--muted)', marginBottom:2 }}>TOTAL (KHUSD)</div>
                  <div style={{ fontSize:28, fontWeight:800, color:'#e879f9' }}>{fmt(khTotal,'KHUSD')}</div>
                </div>
                <div style={{ fontSize:12, color:'var(--muted)', alignSelf:'center', maxWidth:200 }}>
                  {t('expenseTracker.sgCalculatedSeparately')}
                </div>
              </div>
              <div style={{fontSize:11, color:'var(--muted)', marginTop:4}}>
                ✱ MY, SG, and KH totals are in different currencies — not additive
              </div>
              <div style={{ marginTop:12, display:'flex', gap:16, flexWrap:'wrap', fontSize:12, color:'var(--muted)' }}>
                <span>{t('expenseTracker.myOnlineColon')} {fmt(myOnlineTotal,'MYR')}</span>
                <span>{t('expenseTracker.myOfflineColon')} {fmt(myOfflineTotal,'MYR')}</span>
                <span>{t('expenseTracker.sgOnlineColon')} {fmt(sgOnlineTotal,'SGD')}</span>
                <span>{t('expenseTracker.sgOfflineColon')} {fmt(sgOfflineTotal,'SGD')}</span>
                <span>🇰🇭 KH Online: {fmt(khOnlineTotal,'KHUSD')}</span>
                <span>🇰🇭 KH Offline: {fmt(khOfflineTotal,'KHUSD')}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
