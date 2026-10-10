import { useEffect, useMemo, useState } from 'react'
import LegacyCampaigns from './Campaigns'
import { supabase } from '../lib/supabase'
import { parseManualUserIds } from '../lib/campaignEnrollment'
import { useLanguage } from '../contexts/LanguageContext'

const TIERS = ['BLACK','DIAMOND','PLATINUM','GOLD','SILVER','BRONZE']
const TIER_COLOR = { DIAMOND:'#b9f2ff', PLATINUM:'#C0C0C0', GOLD:'#ffd700', SILVER:'#a8a8a8', BRONZE:'#cd7f32' }
const TIER_BG = { DIAMOND:'rgba(185,242,255,.12)', PLATINUM:'rgba(192,192,192,.12)', GOLD:'rgba(255,215,0,.12)', SILVER:'rgba(168,168,168,.1)', BRONZE:'rgba(205,127,50,.1)' }
const panel = { margin:'0 0 18px', padding:'16px 18px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12 }
const input = { width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 10px', borderRadius:7, boxSizing:'border-box', fontSize:13 }
const button = { background:'var(--accent)', color:'#fff', border:'none', padding:'8px 14px', borderRadius:7, fontWeight:700, cursor:'pointer' }

export default function CampaignsMixedWrapper() {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [campaigns, setCampaigns] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [tiers, setTiers] = useState([])
  const [manualIds, setManualIds] = useState('')
  const [preview, setPreview] = useState({ tier:0, manual:0, duplicate:0, missing:0 })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const selected = useMemo(() => campaigns.find(c => c.id === selectedId) || null, [campaigns, selectedId])

  async function loadCampaigns() {
    const { data, error } = await supabase.from('campaigns').select('id,campaign_name,campaign_code,target_tier,auto_enroll_tiers,enrollment_mode').order('created_at', { ascending:false })
    if (error) { setMessage(error.message); return }
    setCampaigns(data || [])
    if (!selectedId && data?.length) setSelectedId(data[0].id)
  }
  useEffect(() => { loadCampaigns() }, [])
  useEffect(() => {
    if (!selected) return
    const currentTiers = Array.isArray(selected.auto_enroll_tiers) && selected.auto_enroll_tiers.length ? selected.auto_enroll_tiers : (selected.target_tier || [])
    setTiers(currentTiers); setManualIds(''); setPreview({ tier:0, manual:0, duplicate:0, missing:0 }); setMessage('')
  }, [selectedId])
  useEffect(() => {
    let cancelled = false
    async function calculatePreview() {
      const ids = parseManualUserIds(manualIds)
      if (!selected || (!tiers.length && !ids.length)) { setPreview({ tier:0, manual:0, duplicate:0, missing:0 }); return }
      const [{ data: tierPlayers }, { data: manualPlayers }] = await Promise.all([
        tiers.length ? supabase.from('vip_members').select('username,tier').in('tier', tiers).eq('is_excluded', false) : Promise.resolve({ data:[] }),
        ids.length ? supabase.from('vip_members').select('username,tier').in('username', ids).eq('is_excluded', false) : Promise.resolve({ data:[] }),
      ])
      if (cancelled) return
      const tierNames = new Set((tierPlayers || []).map(p => String(p.username).toLowerCase()))
      const foundManual = new Set((manualPlayers || []).map(p => String(p.username).toLowerCase()))
      setPreview({ tier:(tierPlayers || []).length, manual:foundManual.size, duplicate:ids.filter(id => tierNames.has(String(id).toLowerCase())).length, missing:Math.max(0, ids.length-foundManual.size) })
    }
    const timer = setTimeout(calculatePreview, 180)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [selectedId, tiers, manualIds, selected])
  function toggleTier(tier) { setTiers(prev => prev.includes(tier) ? prev.filter(t => t !== tier) : [...prev, tier]) }

  async function syncEnrollment() {
    if (!selected) return
    setLoading(true); setMessage('')
    try {
      const ids = parseManualUserIds(manualIds)
      const mode = tiers.length && ids.length ? 'mixed' : tiers.length ? 'auto_tier' : 'manual'
      const { error: campaignError } = await supabase.from('campaigns').update({ target_tier:tiers.length?tiers:null, auto_enroll_tiers:tiers.length?tiers:null, enrollment_mode:mode }).eq('id', selected.id)
      if (campaignError) throw campaignError
      if (ids.length) {
        const { data:vips, error:vipError } = await supabase.from('vip_members').select('id,username,full_name,tier,phone,whatsapp').in('username',ids).eq('is_excluded',false)
        if (vipError) throw vipError
        const rows = (vips||[]).map(v => ({ campaign_id:selected.id,vip_id:v.id,username:v.username,tier:v.tier,player_name:v.full_name||null,whatsapp:v.whatsapp||v.phone||null,total_deposit:0,campaign_period_deposit:0,converted:false,payout_status:'pending',status:'enrolled',enrollment_source:'manual',added_at:new Date().toISOString(),enrolled_at:new Date().toISOString() }))
        if (rows.length) {
          const { error:upsertError } = await supabase.from('campaign_players').upsert(rows,{onConflict:'campaign_id,username'})
          if (upsertError) throw upsertError
          const tierSet = new Set(tiers.map(t=>String(t).toUpperCase()))
          const both = (vips||[]).filter(v=>tierSet.has(String(v.tier||'').toUpperCase())).map(v=>v.username)
          const manual = (vips||[]).filter(v=>!tierSet.has(String(v.tier||'').toUpperCase())).map(v=>v.username)
          if (both.length) { const {error}=await supabase.from('campaign_players').update({enrollment_source:'both'}).eq('campaign_id',selected.id).in('username',both); if(error) throw error }
          if (manual.length) { const {error}=await supabase.from('campaign_players').update({enrollment_source:'manual'}).eq('campaign_id',selected.id).in('username',manual); if(error) throw error }
        }
      }
      setMessage(L2(`Saved. ${preview.tier} tier players + ${preview.manual} manual players, ${preview.duplicate} duplicate(s) removed${preview.missing?`, ${preview.missing} missing ID(s) skipped`:''}.`, `已保存。等级玩家 ${preview.tier} 名 + 手动玩家 ${preview.manual} 名，已移除重复 ${preview.duplicate} 个${preview.missing?`，跳过缺失ID ${preview.missing} 个`:''}。`))
      await loadCampaigns(); window.setTimeout(()=>window.location.reload(),500)
    } catch(e) { setMessage('ERR:'+L2('Enrollment sync failed: ','报名同步失败：')+e.message) } finally { setLoading(false) }
  }

  return <div>
    <div style={panel}>
      <div style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'flex-start',flexWrap:'wrap'}}>
        <div><div style={{fontSize:15,fontWeight:800}}>🎯 {L2('Campaign Audience / Mixed Enrollment','活动受众 / 混合报名')}</div><div style={{fontSize:11,color:'var(--muted)',marginTop:4}}>{L2('Select VIP tiers for automatic enrollment, then optionally add specific User IDs. A player is enrolled only once.','选择VIP等级自动报名，再可选择添加指定用户ID。每位玩家只会报名一次。')}</div></div>
        <span style={{fontSize:10,color:'#3fb950',fontWeight:700}}>{L2('AUTO TIER + MANUAL','自动等级 + 手动')}</span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'minmax(220px,1fr) minmax(280px,1.5fr)',gap:14,marginTop:14}}>
        <div><div style={{fontSize:10,color:'var(--muted)',fontWeight:700,marginBottom:5}}>{L2('CAMPAIGN','活动')}</div><select style={input} value={selectedId} onChange={e=>setSelectedId(e.target.value)}><option value="">{L2('Select campaign','选择活动')}</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.campaign_name} · {c.campaign_code}</option>)}</select></div>
        <div><div style={{fontSize:10,color:'var(--muted)',fontWeight:700,marginBottom:5}}>{L2('AUTO-ENROLL TIERS','自动报名等级')}</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{TIERS.map(tier=>{const active=tiers.includes(tier);return <button type="button" key={tier} onClick={()=>toggleTier(tier)} style={{padding:'5px 11px',borderRadius:12,border:`1px solid ${active?TIER_COLOR[tier]||'var(--accent)':'var(--border)'}`,background:active?TIER_BG[tier]||'rgba(99,102,241,.12)':'var(--surface2)',color:active?TIER_COLOR[tier]||'var(--text)':'var(--muted)',cursor:'pointer',fontSize:11,fontWeight:700}}>{tier}</button>})}</div></div>
      </div>
      <div style={{marginTop:12}}><div style={{fontSize:10,color:'var(--muted)',fontWeight:700,marginBottom:5}}>{L2('MANUAL USER IDs — OPTIONAL','手动用户ID — 可选')}</div><textarea style={{...input,minHeight:72,resize:'vertical',fontFamily:'inherit'}} value={manualIds} onChange={e=>setManualIds(e.target.value)} placeholder={L2('One User ID per line, or paste comma-separated IDs\nExample: ABC123, VIP888, USER001','每行一个用户ID，或粘贴以逗号分隔的ID\n例如：ABC123, VIP888, USER001')} /></div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginTop:10}}>{[[L2('Tier Players','等级玩家'),preview.tier,'var(--accent)'],[L2('Manual Found','手动已找到'),preview.manual,'#3fb950'],[L2('Duplicates','重复'),preview.duplicate,'#f59e0b'],[L2('Missing IDs','缺失ID'),preview.missing,'#f85149']].map(([label,value,color])=><div key={label} style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:7,padding:'8px 10px'}}><div style={{fontSize:15,fontWeight:800,color}}>{value}</div><div style={{fontSize:9,color:'var(--muted)'}}>{label}</div></div>)}</div>
      <div style={{display:'flex',alignItems:'center',gap:10,marginTop:12,flexWrap:'wrap'}}><button style={button} onClick={syncEnrollment} disabled={!selected||loading}>{loading?L2('Syncing…','同步中…'):L2('💾 Save Audience & Enroll','💾 保存受众并报名')}</button>{selected&&<span style={{fontSize:10,color:'var(--muted)'}}>{L2('Current mode:','当前模式：')} <strong style={{color:'var(--text)'}}>{selected.enrollment_mode||'manual'}</strong></span>}{message&&<span style={{fontSize:11,color:message.startsWith('ERR:')?'#f85149':'#3fb950'}}>{message.replace(/^ERR:/,'')}</span>}</div>
    </div>
    <LegacyCampaigns />
  </div>
}
