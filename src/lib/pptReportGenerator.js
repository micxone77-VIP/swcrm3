// src/lib/pptReportGenerator.js — Monthly VIP Report PPT Generator
// Generates a 33-slide monthly report using pptxgenjs (browser-compatible)
import PptxGenJS from 'pptxgenjs'
import { calculateRetentionMetrics } from './retentionAnalytics.js'

// ─── Color constants ───────────────────────────────────────────────────────────
const C = {
  BG:    '0D1B3E',   // dark navy background
  BG2:   '162040',   // card/table fill
  STRIP: '1A3260',   // header strip
  ACC:   '4A90E2',   // blue accent
  WHITE: 'FFFFFF',
  MUTED: '8B9BB8',
  GREEN: '3FB950',
  RED:   'F85149',
  AMBER: 'D29922',
  GOLD:  'F59E0B',
}
const TIER_C = {
  BLACK:    'A0A0C0', DIAMOND: '7DD3FC', PLATINUM: 'CBD5E1',
  GOLD:     'FCD34D', SILVER:  'D1D5DB', BRONZE:   'D97706',
}
const TIERS = ['BLACK','DIAMOND','PLATINUM','GOLD','SILVER','BRONZE']
const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ─── Helpers ──────────────────────────────────────────────────────────────────
const prevM = ym => { if(!ym)return null; const [y,m]=ym.split('-').map(Number); return m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,'0')}` }
const nextM = ym => { if(!ym)return null; const [y,m]=ym.split('-').map(Number); return m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,'0')}` }
const mLabel = ym => { if(!ym)return ''; const [y,m]=ym.split('-'); return `${MONTH_NAMES[parseInt(m)]} ${y}` }
const fmt = (n,sym='RM')=>{ if(n==null)return '—'; const a=Math.abs(n),s=n<0?'-':''; if(a>=1e6)return`${s}${sym} ${(a/1e6).toFixed(2)}M`; if(a>=1e3)return`${s}${sym} ${(a/1e3).toFixed(1)}K`; return`${s}${sym} ${Math.round(a).toLocaleString()}` }
const pct = n => n==null?'—':`${Number(n).toFixed(1)}%`
const chg = (c,p) => { if(!p||p===0)return 0; return((c-p)/Math.abs(p)*100) }
const arw = n => n>0?'▲':n<0?'▼':'—'
const arwC = n => n>0?C.GREEN:n<0?C.RED:C.MUTED
const hs = (text,bold=false,color=C.WHITE,opts={}) => ({ text, options:{ color, bold, ...opts } })
const hdr = text => ({ text, options:{ bold:true, color:C.WHITE, fill:{ color:C.STRIP }, fontSize:10 } })
const cell = (text,opts={}) => ({ text:String(text??'—'), options:{ color:C.WHITE, fontSize:10, ...opts } })
const altRow = ri => ({ fill:{ color: ri%2===0 ? C.BG2 : C.BG } })

// ─── Layout helpers ────────────────────────────────────────────────────────────
// Canvas: 10" × 5.625" (LAYOUT_16x9)
function bg(slide) {
  slide.addShape('rect', { x:0,y:0,w:10,h:5.625, fill:{ color:C.BG } })
}
function header(slide, title, sub='') {
  slide.addShape('rect', { x:0,y:0,w:10,h:0.62, fill:{ color:C.STRIP } })
  slide.addText(title,  { x:0.25,y:0,w:7.5,h:0.62, fontSize:18,bold:true,color:C.WHITE,valign:'middle',isTextBox:true })
  if(sub) slide.addText(sub, { x:7.5,y:0,w:2.25,h:0.62, fontSize:10,color:C.MUTED,align:'right',valign:'middle',isTextBox:true })
}
function kpiTile(slide, x, y, w, h, label, value, sub='', valColor=C.WHITE) {
  slide.addShape('rect', { x,y,w,h, fill:{ color:C.BG2 }, line:{ color:'2A3F6F',width:0.5 } })
  slide.addText(label, { x:x+0.1,y:y+0.08,w:w-0.2,h:0.2,  fontSize:9,color:C.MUTED,bold:true,isTextBox:true })
  slide.addText(value, { x:x+0.1,y:y+0.26,w:w-0.2,h:0.38, fontSize:15,bold:true,color:valColor,isTextBox:true })
  if(sub) slide.addText(sub, { x:x+0.1,y:y+0.62,w:w-0.2,h:0.2, fontSize:9,color:C.MUTED,isTextBox:true })
}
function placeholder(slide, msg) {
  slide.addShape('rect', { x:0.25,y:0.75,w:9.5,h:4.7, fill:{ color:C.BG2 }, line:{ color:'2A3F6F',width:0.75,dashType:'dash' } })
  slide.addText(msg, { x:0.25,y:0.75,w:9.5,h:4.7, fontSize:14,color:C.MUTED,align:'center',valign:'middle',isTextBox:true })
}

// ─── Data computation ──────────────────────────────────────────────────────────
function active(rows) { return rows.filter(r=>(r.monthly_valid_bet||0)>0) }
function tierStats(rows) {
  const a = active(rows)
  return Object.fromEntries(TIERS.map(t => {
    const tr = a.filter(r=>(r.tier||'').toUpperCase()===t)
    return [t, {
      count:   tr.length,
      dep:     tr.reduce((s,r)=>s+(r.total_deposit||0),0),
      bet:     tr.reduce((s,r)=>s+(r.monthly_valid_bet||0),0),
      wl:      tr.reduce((s,r)=>s+(r.win_loss||0),0),
      rebate:  tr.reduce((s,r)=>s+(r.total_rebate||0),0),
      bonus:   tr.reduce((s,r)=>s+(r.bonus_amount||0),0),
    }]
  }))
}
function retention(currRows, prevRows, reactLogs=[]) {
  const ca=active(currRows), pa=active(prevRows)
  const pSet=new Set(pa.map(r=>r.username)), cSet=new Set(ca.map(r=>r.username))
  const rSet=new Set(reactLogs.map(l=>l.username||l.vip_username||''))
  const retained     = ca.filter(r=>pSet.has(r.username))
  const churned      = pa.filter(r=>!cSet.has(r.username))
  const reactivated  = ca.filter(r=>!pSet.has(r.username)&&rSet.has(r.username))
  const metrics = calculateRetentionMetrics({ openingVipCount:pa.length, retainedVipCount:retained.length, churnedVipCount:churned.length, reactivatedVipCount:reactivated.length })
  return { ca, pa, retained, churned, reactivated, ...metrics }
}
function expSum(expenses, field='amount') {
  return expenses.reduce((s,e)=>s+(e[field]||0),0)
}

// ─── Data fetcher ──────────────────────────────────────────────────────────────
export async function fetchPPTData(month, supabase) {
  const m1=prevM(month), m2=prevM(m1), m3=prevM(m2), nM=nextM(month)
  const [r0,r1,r2,r3] = await Promise.all([
    supabase.from('vip_monthly_totals').select('*').eq('snapshot_month',month),
    supabase.from('vip_monthly_totals').select('*').eq('snapshot_month',m1),
    supabase.from('vip_monthly_totals').select('*').eq('snapshot_month',m2),
    supabase.from('vip_monthly_totals').select('*').eq('snapshot_month',m3),
  ])
  const [rL,daily,campsR,expR,upcomR] = await Promise.all([
    supabase.from('reactivation_logs').select('*').eq('reactivated_month',month),
    supabase.from('vip_daily_snapshots').select('username,snapshot_date,total_deposit,monthly_valid_bet,win_loss,tier,bet_count').gte('snapshot_date',`${month}-01`).lt('snapshot_date',`${nM}-01`),
    supabase.from('campaigns').select('id,campaign_name,campaign_type,target_tier,start_date,end_date,status,campaign_players(username,payout_status,campaign_rewards(reward_amount,status))').gte('start_date',`${month}-01`).lt('start_date',`${nM}-01`),
    supabase.from('department_expenses').select('*').eq('month',month),
    supabase.from('campaigns').select('id,campaign_name,campaign_type,target_tier,start_date,end_date,status').in('status',['upcoming','active']).order('start_date').limit(10),
  ])
  return {
    month, currRows:r0.data||[], prevRows:r1.data||[], prev2Rows:r2.data||[], prev3Rows:r3.data||[],
    reactLogs:rL.data||[], dailySnaps:daily.data||[], campaigns:campsR.data||[], expenses:expR.data||[], upcoming:upcomR.data||[],
    prevMonth:m1, prev2Month:m2, prev3Month:m3, nextMonth:nM,
  }
}

// ─── Slide generators ──────────────────────────────────────────────────────────
function slide01_cover(pptx, month) {
  const sl = pptx.addSlide()
  bg(sl)
  sl.addShape('rect',  { x:0,y:0,w:10,h:0.08, fill:{ color:C.ACC } })
  sl.addShape('rect',  { x:0,y:5.545,w:10,h:0.08, fill:{ color:C.ACC } })
  sl.addText('SUREWIN VIP',       { x:0.6,y:1.3,w:8.8,h:1.0, fontSize:44,bold:true,color:C.WHITE,isTextBox:true })
  sl.addText('Monthly Operations Report', { x:0.6,y:2.2,w:8.8,h:0.7, fontSize:24,color:C.ACC,isTextBox:true })
  sl.addText(mLabel(month),       { x:0.6,y:2.85,w:8.8,h:0.5, fontSize:18,color:C.MUTED,isTextBox:true })
  sl.addShape('line',  { x:0.6,y:3.45,w:8.8,h:0, line:{ color:'2A3F6F',width:1 } })
  sl.addText('VIP Retention & Performance Division', { x:0.6,y:3.55,w:8.8,h:0.4, fontSize:13,color:C.MUTED,isTextBox:true })
  sl.addText('CONFIDENTIAL',      { x:0,y:5.1,w:10,h:0.35, fontSize:10,color:'3A4F6F',align:'center',bold:true,isTextBox:true })
}

function slide02_kpi(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, `D+P VIP Performance Overview`, mLabel(d.month))
  const ca=active(d.currRows), pa=active(d.prevRows)
  const totDep  = ca.reduce((s,r)=>s+(r.total_deposit||0),0)
  const totBet  = ca.reduce((s,r)=>s+(r.monthly_valid_bet||0),0)
  const totWL   = ca.reduce((s,r)=>s+(r.win_loss||0),0)
  const totReb  = ca.reduce((s,r)=>s+(r.total_rebate||0),0)
  const totBonus= ca.reduce((s,r)=>s+(r.bonus_amount||0),0)
  const holdPct = totBet>0?(totWL/totBet*100):0
  const cntChg  = chg(ca.length, pa.length)
  const depChg  = chg(totDep, pa.reduce((s,r)=>s+(r.total_deposit||0),0))
  const W=2.3, H=1.0
  const tiles = [
    { l:'Active VIPs',      v:String(ca.length),    s:`${arw(cntChg)} ${pct(Math.abs(cntChg))} MoM`, vc:C.WHITE,       sc:arwC(cntChg) },
    { l:'Total Deposit',    v:fmt(totDep),           s:`${arw(depChg)} ${pct(Math.abs(depChg))} MoM`,  vc:C.WHITE,       sc:arwC(depChg) },
    { l:'Valid Bet (GGR)',  v:fmt(totBet),           s:'Monthly Valid Bet',                             vc:C.ACC,         sc:C.MUTED },
    { l:'Win / Loss',       v:fmt(totWL),            s:`Hold ${pct(holdPct)}`,                          vc:totWL>=0?C.GREEN:C.RED, sc:C.MUTED },
    { l:'Total Rebate',     v:fmt(totReb),           s:'To players',                                    vc:C.AMBER,       sc:C.MUTED },
    { l:'Bonus Paid',       v:fmt(totBonus),         s:'Promotional cost',                              vc:C.AMBER,       sc:C.MUTED },
  ]
  tiles.forEach((t,i)=>{
    const x = 0.25 + (i%3)*(W+0.1), y = 0.75 + Math.floor(i/3)*(H+0.1)
    kpiTile(sl, x, y, W, H, t.l, t.v, t.s, t.vc)
  })
}

function slide03_tier_overview(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Active VIPs by Tier', mLabel(d.month))
  const ts  = tierStats(d.currRows)
  const ts1 = tierStats(d.prevRows)
  const rows = TIERS.map((t,ri)=>{
    const s=ts[t], p=ts1[t]
    const dChg=chg(s.dep,p.dep)
    const hp = s.bet>0?(s.wl/s.bet*100):0
    return [
      cell(t, { color:TIER_C[t]||C.WHITE, bold:true, ...altRow(ri) }),
      cell(s.count, { align:'center', ...altRow(ri) }),
      cell(fmt(s.dep), { align:'right', ...altRow(ri) }),
      cell(fmt(s.bet), { align:'right', ...altRow(ri) }),
      cell(fmt(s.wl),  { align:'right', color:s.wl>=0?C.GREEN:C.RED, ...altRow(ri) }),
      cell(pct(hp),    { align:'center', ...altRow(ri) }),
      cell(`${arw(dChg)} ${pct(Math.abs(dChg))}`, { align:'center', color:arwC(dChg), ...altRow(ri) }),
    ]
  })
  sl.addTable([[hdr('TIER'),hdr('Active'),hdr('Total Deposit'),hdr('Valid Bet'),hdr('Win/Loss'),hdr('Hold%'),hdr('Dep MoM')], ...rows], {
    x:0.25,y:0.75,w:9.5,colW:[1.4,1.0,1.8,1.8,1.8,1.0,0.7],rowH:0.55,
    border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
}

function slide04_trend(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, '3-Month Retention Trend', `${mLabel(d.prev2Month)} → ${mLabel(d.month)}`)
  const months = [d.prev2Month, d.prevMonth, d.month]
  const allRows = [d.prev3Rows, d.prev2Rows, d.prevRows]
  const results = months.map((m,i) => retention(allRows[i]||[], i>0?(allRows[i-1]||[]):[], []))
  // Trend table
  const hRow = [hdr('METRIC'), ...months.map(m=>hdr(mLabel(m)))]
  const dataRows = [
    ['Opening VIPs',    ...results.map(r=>r.pa.length)],
    ['Active VIPs',     ...results.map(r=>r.ca.length)],
    ['Retained',        ...results.map(r=>r.retained.length)],
    ['Churned',         ...results.map(r=>r.churned.length)],
    ['Reactivated',     ...results.map(r=>r.reactivated.length)],
    ['Retention Rate',  ...results.map(r=>pct(r.retentionRate))],
    ['Churn Rate',      ...results.map(r=>pct(r.churnRate))],
    ['Reactivation %',  ...results.map(r=>pct(r.reactivationRate))],
  ].map((row,ri)=>[
    cell(row[0], { bold:true, ...altRow(ri) }),
    ...row.slice(1).map(v=>cell(v, { align:'center', ...altRow(ri) })),
  ])
  sl.addTable([hRow,...dataRows], { x:0.25,y:0.75,w:9.5,colW:[2.8,2.2,2.2,2.3],rowH:0.4, border:{type:'solid',color:'2A3F6F',pt:0.5} })
}

function slide05_deposit_behavior(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Deposit Behavior Quality', mLabel(d.month))
  const ca=active(d.currRows)
  const byTier = Object.fromEntries(TIERS.map(t=>{
    const tr=ca.filter(r=>(r.tier||'').toUpperCase()===t)
    const dep=tr.reduce((s,r)=>s+(r.total_deposit||0),0)
    const bet=tr.reduce((s,r)=>s+(r.monthly_valid_bet||0),0)
    return [t,{ count:tr.length, dep, bet, avgDep:tr.length?dep/tr.length:0, betRatio:dep>0?bet/dep:0 }]
  }))
  const rows = TIERS.map((t,ri)=>{
    const s=byTier[t]
    return [
      cell(t, { color:TIER_C[t]||C.WHITE, bold:true, ...altRow(ri) }),
      cell(s.count, { align:'center', ...altRow(ri) }),
      cell(fmt(s.dep), { align:'right', ...altRow(ri) }),
      cell(fmt(s.avgDep), { align:'right', ...altRow(ri) }),
      cell(pct(s.betRatio*100), { align:'center', ...altRow(ri) }),
      cell(s.betRatio>=0.9?'🟢 High':s.betRatio>=0.6?'🟡 Mid':'🔴 Low', { align:'center', ...altRow(ri) }),
    ]
  })
  sl.addTable([[hdr('TIER'),hdr('Active'),hdr('Total Dep'),hdr('Avg Dep/VIP'),hdr('Bet/Dep Ratio'),hdr('Quality')], ...rows], {
    x:0.25,y:0.75,w:9.5,colW:[1.4,1.0,1.8,1.8,1.7,1.8],rowH:0.55, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
  sl.addText('⚠ Bet/Dep Ratio = Valid Bet ÷ Deposit (proxy for activity quality; >90% = strong player)', { x:0.25,y:4.7,w:9.5,h:0.35, fontSize:9,color:C.MUTED,isTextBox:true })
}

function slide06_top10_decline(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Top 10 Deposit Decline — MoM', `${mLabel(d.prevMonth)} → ${mLabel(d.month)}`)
  const prev = Object.fromEntries((d.prevRows||[]).map(r=>[r.username,r]))
  const sorted = active(d.currRows)
    .map(r=>({ ...r, prevDep:prev[r.username]?.total_deposit||0, chgPct:chg(r.total_deposit||0, prev[r.username]?.total_deposit||0) }))
    .filter(r=>r.chgPct<0 && r.prevDep>0)
    .sort((a,b)=>a.chgPct-b.chgPct)
    .slice(0,10)
  const rows = sorted.map((r,ri)=>[
    cell(ri+1, { align:'center', ...altRow(ri) }),
    cell(r.username, { bold:true, ...altRow(ri) }),
    cell(r.tier||'—', { color:TIER_C[(r.tier||'').toUpperCase()]||C.MUTED, bold:true, ...altRow(ri) }),
    cell(fmt(r.prevDep), { align:'right', ...altRow(ri) }),
    cell(fmt(r.total_deposit||0), { align:'right', ...altRow(ri) }),
    cell(`${arw(r.chgPct)} ${pct(Math.abs(r.chgPct))}`, { align:'center', color:C.RED, bold:true, ...altRow(ri) }),
  ])
  sl.addTable([[hdr('#'),hdr('USERNAME'),hdr('TIER'),hdr('Prev Deposit'),hdr('Curr Deposit'),hdr('Change%')], ...rows], {
    x:0.25,y:0.75,w:9.5,colW:[0.5,2.3,1.3,1.9,1.9,1.6],rowH:0.38, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
}

function slide07_active_rate(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Active Rate by Tier — MoM', `${mLabel(d.prevMonth)} → ${mLabel(d.month)}`)
  const ts=tierStats(d.currRows), tsP=tierStats(d.prevRows)
  const allC = active(d.currRows).length, allP = active(d.prevRows).length
  const rows = TIERS.map((t,ri)=>{
    const c=ts[t],p=tsP[t]
    const chgN = c.count-p.count
    const rateC = allC>0?c.count/allC*100:0
    const rateP = allP>0?p.count/allP*100:0
    return [
      cell(t, { color:TIER_C[t]||C.WHITE, bold:true, ...altRow(ri) }),
      cell(p.count, { align:'center', ...altRow(ri) }),
      cell(c.count, { align:'center', ...altRow(ri) }),
      cell(`${chgN>=0?'+':''}${chgN}`, { align:'center', color:chgN>=0?C.GREEN:C.RED, bold:true, ...altRow(ri) }),
      cell(`${pct(rateP)} → ${pct(rateC)}`, { align:'center', ...altRow(ri) }),
    ]
  })
  const totRow = [
    cell('TOTAL', { bold:true, color:C.ACC }),
    cell(allP, { align:'center', bold:true }),
    cell(allC, { align:'center', bold:true }),
    cell(`${(allC-allP)>=0?'+':''}${allC-allP}`, { align:'center', bold:true, color:(allC-allP)>=0?C.GREEN:C.RED }),
    cell('', { align:'center' }),
  ]
  sl.addTable([[hdr('TIER'),hdr('Prev Active'),hdr('Curr Active'),hdr('Change'),hdr('Share of Total')], ...rows, totRow], {
    x:0.25,y:0.75,w:9.5,colW:[1.4,1.8,1.8,1.7,2.8],rowH:0.48, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
}

function slide08_quadrant(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Behavior Quadrant — Deposit × Activity', mLabel(d.month))
  const ca=active(d.currRows)
  const medDep = [...ca].sort((a,b)=>(b.total_deposit||0)-(a.total_deposit||0))[Math.floor(ca.length/2)]?.total_deposit||0
  const medBet = [...ca].sort((a,b)=>(b.monthly_valid_bet||0)-(a.monthly_valid_bet||0))[Math.floor(ca.length/2)]?.monthly_valid_bet||0
  const q = {HH:0,HL:0,LH:0,LL:0}
  ca.forEach(r=>{ const hd=(r.total_deposit||0)>=medDep,hb=(r.monthly_valid_bet||0)>=medBet; q[hd&&hb?'HH':hd&&!hb?'HL':!hd&&hb?'LH':'LL']++ })
  const W=4.5, H=2.2, GX=0.5, GY=0.75
  const quadrants = [
    { x:GX+W+0.05,y:GY, label:'HIGH BET · HIGH DEP', n:q.HH, desc:'Core VIPs', color:C.GREEN },
    { x:GX,       y:GY, label:'HIGH BET · LOW DEP',  n:q.LH, desc:'Value Players', color:C.ACC },
    { x:GX+W+0.05,y:GY+H+0.05, label:'LOW BET · HIGH DEP', n:q.HL, desc:'Churn Risk', color:C.AMBER },
    { x:GX,       y:GY+H+0.05, label:'LOW BET · LOW DEP',  n:q.LL, desc:'At Risk',  color:C.RED },
  ]
  quadrants.forEach(q=>{
    sl.addShape('rect', { x:q.x,y:q.y,w:W,h:H, fill:{ color:C.BG2 }, line:{ color:'2A3F6F',width:0.75 } })
    sl.addText(q.label,  { x:q.x+0.15,y:q.y+0.1,w:W-0.3,h:0.3, fontSize:9,bold:true,color:q.color,isTextBox:true })
    sl.addText(String(q.n), { x:q.x,y:q.y+0.35,w:W,h:1.1, fontSize:44,bold:true,color:C.WHITE,align:'center',isTextBox:true })
    sl.addText(q.desc,   { x:q.x+0.15,y:q.y+1.7,w:W-0.3,h:0.3, fontSize:10,color:C.MUTED,isTextBox:true })
  })
  sl.addText('← Low Deposit | High Deposit →', { x:0.25,y:5.2,w:9.5,h:0.3, fontSize:9,color:C.MUTED,align:'center',isTextBox:true })
  sl.addText('Median Deposit: '+fmt(medDep)+'  |  Median Valid Bet: '+fmt(medBet), { x:0.25,y:5.1,w:9.5,h:0.2, fontSize:8.5,color:C.MUTED,align:'right',isTextBox:true })
}

function slide09_10_diamond(pptx, d, slideNum=9) {
  const sl = pptx.addSlide(); bg(sl)
  const tier = slideNum===9?'DIAMOND':'BLACK'
  header(sl, `${tier} VIP Performance`, mLabel(d.month))
  const prev = Object.fromEntries((d.prevRows||[]).map(r=>[r.username,r]))
  const vips = active(d.currRows).filter(r=>(r.tier||'').toUpperCase()===tier).sort((a,b)=>(b.total_deposit||0)-(a.total_deposit||0)).slice(0,12)
  if(!vips.length) { placeholder(sl, `No active ${tier} VIPs in ${mLabel(d.month)}`); return }
  const rows = vips.map((r,ri)=>{
    const p=prev[r.username], depChg=chg(r.total_deposit||0, p?.total_deposit||0)
    return [
      cell(ri+1, { align:'center', ...altRow(ri) }),
      cell(r.username, { bold:true, ...altRow(ri) }),
      cell(fmt(r.total_deposit||0), { align:'right', ...altRow(ri) }),
      cell(fmt(r.monthly_valid_bet||0), { align:'right', ...altRow(ri) }),
      cell(fmt(r.win_loss||0), { align:'right', color:(r.win_loss||0)>=0?C.GREEN:C.RED, ...altRow(ri) }),
      cell(`${arw(depChg)} ${pct(Math.abs(depChg))}`, { align:'center', color:arwC(depChg), ...altRow(ri) }),
      cell(r.host_assigned||'—', { fontSize:9, color:C.MUTED, ...altRow(ri) }),
    ]
  })
  sl.addTable([[hdr('#'),hdr('USERNAME'),hdr('Deposit'),hdr('Valid Bet'),hdr('Win/Loss'),hdr('Dep Chg'),hdr('Host')], ...rows], {
    x:0.25,y:0.75,w:9.5,colW:[0.4,2.1,1.6,1.6,1.5,1.2,1.1],rowH:0.36, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
}

function slide11_diamond_summary(pptx, d) {
  // slide09_10_diamond handles Diamond; this does a summary of Diamond+Platinum combined
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Premium Tier Summary (Diamond + Platinum)', mLabel(d.month))
  const premTiers = ['BLACK','DIAMOND','PLATINUM']
  const ts=tierStats(d.currRows), tsP=tierStats(d.prevRows)
  const rows = premTiers.map((t,ri)=>{
    const c=ts[t],p=tsP[t]
    const depChg=chg(c.dep,p.dep), cntChg=c.count-p.count, hp=c.bet>0?c.wl/c.bet*100:0
    return [
      cell(t, { color:TIER_C[t]||C.WHITE, bold:true, ...altRow(ri) }),
      cell(c.count, { align:'center', ...altRow(ri) }),
      cell(`${cntChg>=0?'+':''}${cntChg}`, { align:'center', color:cntChg>=0?C.GREEN:C.RED, bold:true, ...altRow(ri) }),
      cell(fmt(c.dep), { align:'right', ...altRow(ri) }),
      cell(`${arw(depChg)} ${pct(Math.abs(depChg))}`, { align:'center', color:arwC(depChg), ...altRow(ri) }),
      cell(fmt(c.bet), { align:'right', ...altRow(ri) }),
      cell(fmt(c.wl),  { align:'right', color:c.wl>=0?C.GREEN:C.RED, ...altRow(ri) }),
      cell(pct(hp),    { align:'center', ...altRow(ri) }),
    ]
  })
  sl.addTable([[hdr('TIER'),hdr('Active'),hdr('MoM'),hdr('Deposit'),hdr('Dep%'),hdr('Valid Bet'),hdr('Win/Loss'),hdr('Hold%')], ...rows], {
    x:0.25,y:0.75,w:9.5,colW:[1.3,0.9,0.9,1.5,1.0,1.5,1.5,0.9],rowH:0.65, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
}

function slide12_deposit_drop(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Significant Deposit Drop Analysis', `${mLabel(d.prevMonth)} → ${mLabel(d.month)}`)
  const prev = Object.fromEntries((d.prevRows||[]).map(r=>[r.username,r]))
  const drops = active(d.prevRows)
    .map(r=>({ ...r, curr:d.currRows.find(c=>c.username===r.username), prevDep:r.total_deposit||0 }))
    .filter(r=>r.curr&&(chg(r.curr.total_deposit||0,r.prevDep)< -20))
    .sort((a,b)=>chg(a.curr?.total_deposit||0,a.prevDep)-chg(b.curr?.total_deposit||0,b.prevDep))
    .slice(0,12)
  if(!drops.length) { placeholder(sl,'No significant deposit drops (>20%) this month'); return }
  const rows = drops.map((r,ri)=>{
    const c=r.curr, diff=(c?.total_deposit||0)-r.prevDep, pChange=chg(c?.total_deposit||0,r.prevDep)
    return [
      cell(r.username, { bold:true, ...altRow(ri) }),
      cell(r.tier||'—', { color:TIER_C[(r.tier||'').toUpperCase()]||C.MUTED, bold:true, ...altRow(ri) }),
      cell(fmt(r.prevDep), { align:'right', ...altRow(ri) }),
      cell(fmt(c?.total_deposit||0), { align:'right', ...altRow(ri) }),
      cell(fmt(diff), { align:'right', color:C.RED, bold:true, ...altRow(ri) }),
      cell(pct(Math.abs(pChange))+' ▼', { align:'center', color:C.RED, bold:true, ...altRow(ri) }),
    ]
  })
  sl.addTable([[hdr('USERNAME'),hdr('TIER'),hdr('Prev Dep'),hdr('Curr Dep'),hdr('Δ Amount'),hdr('Δ%')], ...rows], {
    x:0.25,y:0.75,w:9.5,colW:[2.0,1.3,1.7,1.7,1.8,1.0],rowH:0.37, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
}

function slide13_retention_list(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Priority Retention List — Churned VIPs', mLabel(d.month))
  const ret = retention(d.currRows, d.prevRows, d.reactLogs)
  const churned = ret.churned.sort((a,b)=>(b.total_deposit||0)-(a.total_deposit||0)).slice(0,12)
  if(!churned.length) { placeholder(sl,'No churned VIPs — great retention this month! 🎉'); return }
  const rows = churned.map((r,ri)=>[
    cell(ri+1, { align:'center', ...altRow(ri) }),
    cell(r.username, { bold:true, ...altRow(ri) }),
    cell(r.tier||'—', { color:TIER_C[(r.tier||'').toUpperCase()]||C.MUTED, bold:true, ...altRow(ri) }),
    cell(fmt(r.total_deposit||0), { align:'right', ...altRow(ri) }),
    cell(fmt(r.monthly_valid_bet||0), { align:'right', ...altRow(ri) }),
    cell(r.host_assigned||'Unassigned', { fontSize:9, color:C.MUTED, ...altRow(ri) }),
    cell('🔴 Chase', { align:'center', color:C.RED, bold:true, ...altRow(ri) }),
  ])
  sl.addTable([[hdr('#'),hdr('USERNAME'),hdr('TIER'),hdr('Last Dep'),hdr('Last Bet'),hdr('Host'),hdr('Action')], ...rows], {
    x:0.25,y:0.75,w:9.5,colW:[0.4,2.0,1.2,1.5,1.5,1.5,1.4],rowH:0.37, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
  sl.addText(`Total churned: ${ret.churned.length} VIPs  |  Churn Rate: ${pct(ret.churnRate)}  |  Showing top 12 by prev deposit`, { x:0.25,y:5.0,w:9.5,h:0.3, fontSize:9,color:C.MUTED,isTextBox:true })
}

function slide14_platinum(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'PLATINUM VIP Performance Detail', mLabel(d.month))
  const prev = Object.fromEntries((d.prevRows||[]).map(r=>[r.username,r]))
  const vips = active(d.currRows).filter(r=>(r.tier||'').toUpperCase()==='PLATINUM').sort((a,b)=>(b.total_deposit||0)-(a.total_deposit||0)).slice(0,12)
  if(!vips.length) { placeholder(sl,'No active PLATINUM VIPs this month'); return }
  const rows = vips.map((r,ri)=>{
    const p=prev[r.username], dc=chg(r.total_deposit||0,p?.total_deposit||0)
    return [
      cell(ri+1, { align:'center', ...altRow(ri) }),
      cell(r.username, { bold:true, ...altRow(ri) }),
      cell(fmt(r.total_deposit||0), { align:'right', ...altRow(ri) }),
      cell(fmt(r.monthly_valid_bet||0), { align:'right', ...altRow(ri) }),
      cell(fmt(r.win_loss||0), { align:'right', color:(r.win_loss||0)>=0?C.GREEN:C.RED, ...altRow(ri) }),
      cell(`${arw(dc)} ${pct(Math.abs(dc))}`, { align:'center', color:arwC(dc), ...altRow(ri) }),
      cell(r.host_assigned||'—', { fontSize:9,color:C.MUTED, ...altRow(ri) }),
    ]
  })
  sl.addTable([[hdr('#'),hdr('USERNAME'),hdr('Deposit'),hdr('Valid Bet'),hdr('Win/Loss'),hdr('Dep Chg'),hdr('Host')], ...rows], {
    x:0.25,y:0.75,w:9.5,colW:[0.4,2.1,1.6,1.6,1.5,1.2,1.1],rowH:0.36, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
}

function slide15_expenses(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Department Expenses', mLabel(d.month))
  if(!d.expenses.length) { placeholder(sl,'No expense records found for this month.\nAdd via Expenses module.'); return }
  const byCat = {}
  d.expenses.forEach(e=>{
    const k=e.category||'Other'
    if(!byCat[k]) byCat[k]={ total:0, count:0, items:[] }
    byCat[k].total += (e.amount||0)
    byCat[k].count++
    byCat[k].items.push(e)
  })
  const catRows = Object.entries(byCat).sort((a,b)=>b[1].total-a[1].total)
  const rows = catRows.map(([cat,s],ri)=>[
    cell(cat, { bold:true, ...altRow(ri) }),
    cell(s.count, { align:'center', ...altRow(ri) }),
    cell(fmt(s.total), { align:'right', bold:true, ...altRow(ri) }),
    cell(s.items.map(i=>i.platform||'—').filter((v,i,a)=>a.indexOf(v)===i).join(', '), { color:C.MUTED, ...altRow(ri) }),
  ])
  const total = d.expenses.reduce((s,e)=>s+(e.amount||0),0)
  const totRow = [cell('TOTAL', { bold:true, color:C.ACC }), cell(''), cell(fmt(total), { align:'right', bold:true, color:C.AMBER }), cell('')]
  sl.addTable([[hdr('CATEGORY'),hdr('Items'),hdr('Amount'),hdr('Platforms')], ...rows, totRow], {
    x:0.25,y:0.75,w:9.5,colW:[3.5,1.2,2.3,2.5],rowH:0.45, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
}

function slide16_17_campaign(pptx, d, campIdx=0) {
  const sl = pptx.addSlide(); bg(sl)
  const camp = d.campaigns[campIdx]
  if(!camp) { placeholder(sl,`Campaign #${campIdx+1} data not found`); return }
  header(sl, camp.campaign_name||'Campaign Report', `${camp.campaign_type||''}  |  ${mLabel(d.month)}`)
  const players = camp.campaign_players||[]
  const paid = players.reduce((s,p)=>{
    const rewards = p.campaign_rewards||[]
    return s + rewards.filter(r=>r.status==='paid').reduce((ss,r)=>ss+(r.reward_amount||0),0)
  },0)
  const approved = players.reduce((s,p)=>{
    const rewards = p.campaign_rewards||[]
    return s + rewards.filter(r=>['paid','approved'].includes(r.status)).reduce((ss,r)=>ss+(r.reward_amount||0),0)
  },0)
  const paidCount = players.filter(p=>(p.campaign_rewards||[]).some(r=>r.status==='paid')).length
  kpiTile(sl, 0.25,0.72,2.2,0.85,'Total Players', String(players.length), 'Enrolled', C.WHITE)
  kpiTile(sl, 2.55,0.72,2.2,0.85,'Completed',    String(paidCount),       `${pct(players.length?paidCount/players.length*100:0)} rate`, C.GREEN)
  kpiTile(sl, 4.85,0.72,2.2,0.85,'Paid Out',     fmt(paid),               'Rewards paid', C.AMBER)
  kpiTile(sl, 7.15,0.72,2.2,0.85,'Total Approved',fmt(approved),          'Incl. pending', C.ACC)
  const topPlayers = players.sort((a,b)=>{
    const ra=(a.campaign_rewards||[]).reduce((s,r)=>s+(r.reward_amount||0),0)
    const rb=(b.campaign_rewards||[]).reduce((s,r)=>s+(r.reward_amount||0),0)
    return rb-ra
  }).slice(0,10)
  const rows = topPlayers.map((p,ri)=>{
    const rewards=p.campaign_rewards||[]
    const amount=rewards.reduce((s,r)=>s+(r.reward_amount||0),0)
    const status=rewards.some(r=>r.status==='paid')?'Paid':rewards.some(r=>r.status==='approved')?'Approved':'Pending'
    return [
      cell(ri+1, { align:'center', ...altRow(ri) }),
      cell(p.username||'—', { bold:true, ...altRow(ri) }),
      cell(fmt(amount), { align:'right', bold:true, ...altRow(ri) }),
      cell(status, { align:'center', color:status==='Paid'?C.GREEN:status==='Approved'?C.ACC:C.MUTED, bold:true, ...altRow(ri) }),
    ]
  })
  sl.addTable([[hdr('#'),hdr('USERNAME'),hdr('Reward Amount'),hdr('Status')], ...rows], {
    x:0.25,y:1.7,w:9.5,colW:[0.5,4.5,2.8,1.7],rowH:0.33, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
}

function slide18_19_campaigns_summary(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'All Campaigns Summary', mLabel(d.month))
  if(!d.campaigns.length) { placeholder(sl,'No campaigns found for this month'); return }
  const rows = d.campaigns.map((c,ri)=>{
    const players=c.campaign_players||[]
    const paid=players.reduce((s,p)=>{
      return s+(p.campaign_rewards||[]).filter(r=>r.status==='paid').reduce((ss,r)=>ss+(r.reward_amount||0),0)
    },0)
    const paidCnt=players.filter(p=>(p.campaign_rewards||[]).some(r=>r.status==='paid')).length
    return [
      cell(c.campaign_name||'—', { bold:true, ...altRow(ri) }),
      cell(c.campaign_type||'—', { color:C.MUTED, ...altRow(ri) }),
      cell(c.target_tier||'ALL', { color:TIER_C[(c.target_tier||'').toUpperCase()]||C.MUTED, bold:true, ...altRow(ri) }),
      cell(players.length, { align:'center', ...altRow(ri) }),
      cell(paidCnt, { align:'center', color:C.GREEN, ...altRow(ri) }),
      cell(fmt(paid), { align:'right', color:C.AMBER, bold:true, ...altRow(ri) }),
      cell(c.status||'—', { align:'center', color:c.status==='active'?C.GREEN:c.status==='ended'?C.MUTED:C.ACC, ...altRow(ri) }),
    ]
  })
  sl.addTable([[hdr('CAMPAIGN'),hdr('TYPE'),hdr('TIER'),hdr('Players'),hdr('Paid'),hdr('Payout'),hdr('Status')], ...rows], {
    x:0.25,y:0.75,w:9.5,colW:[2.8,1.6,1.0,0.9,0.9,1.6,0.7],rowH:0.38, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
  const totalPaid=d.campaigns.reduce((s,c)=>{
    const ps=c.campaign_players||[]
    return s+ps.reduce((s2,p)=>(p.campaign_rewards||[]).filter(r=>r.status==='paid').reduce((s3,r)=>s3+(r.reward_amount||0),s2),0)
  },0)
  sl.addText(`Total campaign payout this month: ${fmt(totalPaid)}`, { x:0.25,y:5.05,w:9.5,h:0.35, fontSize:11,bold:true,color:C.AMBER,isTextBox:true })
}

function slide20_review(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Monthly Review & Highlights', mLabel(d.month))
  placeholder(sl, '📝  Monthly narrative — fill in highlights,\n\nkey wins, challenges, and team commentary\n\nafter reviewing the data in this report.')
}

function slide21_churn_calibration(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Churn Rule Calibration', mLabel(d.month))
  const ret=retention(d.currRows, d.prevRows, d.reactLogs)
  kpiTile(sl,0.25,0.72,2.2,0.85,'Opening VIPs', String(ret.pa.length), 'Previous month active', C.WHITE)
  kpiTile(sl,2.55,0.72,2.2,0.85,'Churned',      String(ret.churned.length), pct(ret.churnRate)+' rate', C.RED)
  kpiTile(sl,4.85,0.72,2.2,0.85,'Retained',     String(ret.retained.length), pct(ret.retentionRate)+' rate', C.GREEN)
  kpiTile(sl,7.15,0.72,2.2,0.85,'Reactivated',  String(ret.reactivated.length), pct(ret.reactivationRate)+' rate', C.ACC)
  sl.addShape('rect', { x:0.25,y:1.7,w:9.5,h:0.35, fill:{ color:C.STRIP } })
  sl.addText('Current Churn Definition:  VIP active last month (monthly_valid_bet > 0)  →  no activity this month', { x:0.35,y:1.7,w:9.3,h:0.35, fontSize:10,color:C.WHITE,valign:'middle',isTextBox:true })
  const cByTier = Object.fromEntries(TIERS.map(t=>[ t, ret.churned.filter(r=>(r.tier||'').toUpperCase()===t).length ]))
  const rows = TIERS.filter(t=>cByTier[t]>0).map((t,ri)=>[
    cell(t, { color:TIER_C[t]||C.WHITE, bold:true, ...altRow(ri) }),
    cell(cByTier[t], { align:'center', color:C.RED, bold:true, ...altRow(ri) }),
    cell(ret.churned.filter(r=>(r.tier||'').toUpperCase()===t).reduce((s,r)=>s+(r.total_deposit||0),0)|0, { align:'right', ...altRow(ri) }),
  ])
  sl.addTable([[hdr('TIER'),hdr('Churned Count'),hdr('Lost Dep (prev)')], ...rows], {
    x:0.25,y:2.15,w:5.5,colW:[1.8,1.8,1.9],rowH:0.48, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
}

function slide22_retention_analytics(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Retention Analytics — Full Detail', mLabel(d.month))
  const ret=retention(d.currRows, d.prevRows, d.reactLogs)
  const W=2.3,H=1.0
  const tiles=[
    { l:'Retention Rate',   v:pct(ret.retentionRate),    s:`${ret.retained.length} / ${ret.pa.length} VIPs`,   vc:ret.retentionRate>=70?C.GREEN:ret.retentionRate>=50?C.AMBER:C.RED },
    { l:'Churn Rate',       v:pct(ret.churnRate),         s:`${ret.churned.length} churned`,                     vc:ret.churnRate<=20?C.GREEN:ret.churnRate<=40?C.AMBER:C.RED },
    { l:'Reactivation Rate',v:pct(ret.reactivationRate),  s:`${ret.reactivated.length} reactivated`,             vc:C.ACC },
    { l:'New This Month',   v:String(ret.ca.filter(r=>!ret.pa.find(p=>p.username===r.username)).length), s:'First-time active', vc:C.WHITE },
  ]
  tiles.forEach((t,i)=>{ const x=0.25+(i%4)*(W+0.1),y=0.72; kpiTile(sl,x,y,W,H,t.l,t.v,t.s,t.vc) })
  // Tier retention table
  const ts=tierStats(d.currRows), tsP=tierStats(d.prevRows)
  const rows = TIERS.map((t,ri)=>{
    const c=ts[t],p=tsP[t]
    const prevA=active(d.prevRows).filter(r=>(r.tier||'').toUpperCase()===t)
    const currA=active(d.currRows).filter(r=>(r.tier||'').toUpperCase()===t)
    const retN=currA.filter(r=>prevA.find(pr=>pr.username===r.username)).length
    const retR=prevA.length?retN/prevA.length*100:0
    return [
      cell(t, { color:TIER_C[t]||C.WHITE, bold:true, ...altRow(ri) }),
      cell(p.count, { align:'center', ...altRow(ri) }),
      cell(c.count, { align:'center', ...altRow(ri) }),
      cell(retN, { align:'center', color:C.GREEN, ...altRow(ri) }),
      cell(pct(retR), { align:'center', color:retR>=70?C.GREEN:retR>=50?C.AMBER:C.RED, bold:true, ...altRow(ri) }),
    ]
  })
  sl.addTable([[hdr('TIER'),hdr('Opening'),hdr('Closing'),hdr('Retained'),hdr('Ret Rate')], ...rows], {
    x:0.25,y:1.85,w:9.5,colW:[1.7,1.9,1.9,1.9,2.1],rowH:0.42, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
}

function slide23_score_divergence(pptx) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'VIP Score Divergence Analysis', '(Requires Scoring Engine)')
  placeholder(sl, '📊  Score Divergence Module\n\n"High Deposit, Low Score" vs "High Score, Low Deposit"\n\nRequires VIP multi-dimensional scoring engine\nto be implemented in a future sprint.')
}

function slide24_ggr_concentration(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Win/Loss (GGR) Concentration — Pareto', mLabel(d.month))
  const vips = active(d.currRows).filter(r=>(r.win_loss||0)>0).sort((a,b)=>(b.win_loss||0)-(a.win_loss||0))
  if(!vips.length) { placeholder(sl,'No positive win/loss recorded this month'); return }
  const totalWL = vips.reduce((s,r)=>s+(r.win_loss||0),0)
  let cum=0
  const top20pct = Math.ceil(vips.length*0.2)
  const top20WL  = vips.slice(0,top20pct).reduce((s,r)=>s+(r.win_loss||0),0)
  kpiTile(sl,0.25,0.72,2.2,0.85,'Total Win/Loss', fmt(totalWL), 'Platform GGR', C.GREEN)
  kpiTile(sl,2.55,0.72,2.2,0.85,'Top 20% VIPs',   String(top20pct)+' players', pct(totalWL?top20WL/totalWL*100:0)+' of GGR', C.ACC)
  kpiTile(sl,4.85,0.72,2.2,0.85,'VIPs w/ Win/Loss',String(vips.length), 'Positive house edge', C.WHITE)
  const byTier = TIERS.map(t=>{
    const tr=vips.filter(r=>(r.tier||'').toUpperCase()===t)
    return { t, wl:tr.reduce((s,r)=>s+(r.win_loss||0),0), cnt:tr.length }
  }).filter(x=>x.wl>0)
  const rows = byTier.map(({t,wl,cnt},ri)=>[
    cell(t, { color:TIER_C[t]||C.WHITE, bold:true, ...altRow(ri) }),
    cell(cnt, { align:'center', ...altRow(ri) }),
    cell(fmt(wl), { align:'right', color:C.GREEN, bold:true, ...altRow(ri) }),
    cell(pct(totalWL?wl/totalWL*100:0), { align:'center', ...altRow(ri) }),
  ])
  sl.addTable([[hdr('TIER'),hdr('VIPs'),hdr('Win/Loss'),hdr('Share of Total')], ...rows], {
    x:0.25,y:1.7,w:7.0,colW:[1.5,1.3,2.2,2.0],rowH:0.45, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
}

function slide25_intramonth_trend(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Intra-Month 5-Day Deposit Trend', mLabel(d.month))
  if(!d.dailySnaps.length) { placeholder(sl,'No daily snapshot data for this month'); return }
  const windows = [1,6,11,16,21,26].map((start,i,arr)=>({
    label: `D${start}-${Math.min(start+4, 31)}`,
    snaps: d.dailySnaps.filter(s=>{ const day=parseInt(s.snapshot_date?.slice(8,10)||0); return day>=start&&day<(arr[i+1]||32) }),
  }))
  const rows = windows.map((w,ri)=>{
    const dep = w.snaps.reduce((s,r)=>s+(r.total_deposit||0),0)
    const uniq = new Set(w.snaps.map(r=>r.username)).size
    return [
      cell(w.label, { bold:true, color:C.ACC, ...altRow(ri) }),
      cell(uniq, { align:'center', ...altRow(ri) }),
      cell(fmt(dep), { align:'right', bold:true, ...altRow(ri) }),
      cell(uniq?fmt(dep/uniq):'—', { align:'right', color:C.MUTED, ...altRow(ri) }),
    ]
  })
  sl.addTable([[hdr('WINDOW'),hdr('Active Users'),hdr('Total Deposit'),hdr('Avg Dep/User')], ...rows], {
    x:0.25,y:0.75,w:9.5,colW:[1.8,2.5,2.7,2.5],rowH:0.55, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
  sl.addText('Note: Active Users = unique usernames with a deposit record in that 5-day window', { x:0.25,y:4.9,w:9.5,h:0.3, fontSize:9,color:C.MUTED,isTextBox:true })
}

function slide26_action_plan(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Action Plan — Next Month', `Priority Actions for ${mLabel(d.nextMonth)}`)
  const ret=retention(d.currRows, d.prevRows, d.reactLogs)
  const top10churn = ret.churned.sort((a,b)=>(b.total_deposit||0)-(a.total_deposit||0)).slice(0,8)
  sl.addText('🔴  HIGH PRIORITY: Chase Churned VIPs', { x:0.25,y:0.72,w:9.5,h:0.32, fontSize:12,bold:true,color:C.RED,isTextBox:true })
  const rows = top10churn.map((r,ri)=>[
    cell(ri+1, { align:'center', ...altRow(ri) }),
    cell(r.username, { bold:true, ...altRow(ri) }),
    cell(r.tier||'—', { color:TIER_C[(r.tier||'').toUpperCase()]||C.MUTED, bold:true, ...altRow(ri) }),
    cell(fmt(r.total_deposit||0), { align:'right', ...altRow(ri) }),
    cell(r.host_assigned||'Unassigned', { color:C.MUTED, ...altRow(ri) }),
    cell('📞 Chase → Deposit', { color:C.AMBER, ...altRow(ri) }),
  ])
  sl.addTable([[hdr('#'),hdr('USERNAME'),hdr('TIER'),hdr('Prev Dep'),hdr('Host'),hdr('Action')], ...rows], {
    x:0.25,y:1.08,w:9.5,colW:[0.4,2.1,1.2,1.6,1.8,2.4],rowH:0.37, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
  sl.addText(`Total ${ret.churned.length} churned VIPs — reactivation goal: at least ${Math.ceil(ret.churned.length*0.3)} = 30%`, { x:0.25,y:5.05,w:9.5,h:0.3, fontSize:10,color:C.MUTED,isTextBox:true })
}

function slide27_strategy(pptx) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Strategic Direction & Focus Areas', 'Management Input Required')
  placeholder(sl, '🎯  Strategic Direction\n\nFill in: quarterly objectives, focus tiers,\ncampaign strategy, team priorities\n\nand key initiatives for the coming month.')
}

function slide28_upcoming_campaigns(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, `Upcoming Campaign Plan — ${mLabel(d.nextMonth)}`, `Campaigns in status: upcoming / active`)
  if(!d.upcoming.length) { placeholder(sl,'No upcoming campaigns found.\nCreate campaigns in the Campaign module.'); return }
  const rows = d.upcoming.map((c,ri)=>[
    cell(c.campaign_name||'—', { bold:true, ...altRow(ri) }),
    cell(c.campaign_type||'—', { color:C.MUTED, ...altRow(ri) }),
    cell(c.target_tier||'ALL', { color:TIER_C[(c.target_tier||'').toUpperCase()]||C.MUTED, bold:true, ...altRow(ri) }),
    cell(c.start_date||'—', { align:'center', ...altRow(ri) }),
    cell(c.end_date||'—', { align:'center', ...altRow(ri) }),
    cell(c.status||'—', { align:'center', color:c.status==='active'?C.GREEN:C.ACC, bold:true, ...altRow(ri) }),
  ])
  sl.addTable([[hdr('CAMPAIGN'),hdr('TYPE'),hdr('TARGET TIER'),hdr('Start Date'),hdr('End Date'),hdr('Status')], ...rows], {
    x:0.25,y:0.75,w:9.5,colW:[3.0,1.8,1.5,1.3,1.3,0.6],rowH:0.48, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
}

function slide29_hold_pct(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Hold% Analysis by Tier', mLabel(d.month))
  const ts=tierStats(d.currRows)
  const allA=active(d.currRows)
  const totBet=allA.reduce((s,r)=>s+(r.monthly_valid_bet||0),0)
  const totWL =allA.reduce((s,r)=>s+(r.win_loss||0),0)
  const overallHP = totBet>0?(totWL/totBet*100):0
  kpiTile(sl,0.25,0.72,3.0,0.85,'Overall Hold%',  pct(overallHP), `Win/Loss ÷ Valid Bet`, overallHP>=3?C.GREEN:overallHP>=0?C.AMBER:C.RED)
  kpiTile(sl,3.4, 0.72,3.0,0.85,'Total Win/Loss', fmt(totWL),    'Platform GGR', totWL>=0?C.GREEN:C.RED)
  kpiTile(sl,6.55,0.72,2.9,0.85,'Valid Bet Handle',fmt(totBet),  'Total wagered', C.ACC)
  const rows = TIERS.map((t,ri)=>{
    const s=ts[t], hp=s.bet>0?s.wl/s.bet*100:0
    return [
      cell(t, { color:TIER_C[t]||C.WHITE, bold:true, ...altRow(ri) }),
      cell(s.count, { align:'center', ...altRow(ri) }),
      cell(fmt(s.bet), { align:'right', ...altRow(ri) }),
      cell(fmt(s.wl), { align:'right', color:s.wl>=0?C.GREEN:C.RED, bold:true, ...altRow(ri) }),
      cell(pct(hp), { align:'center', bold:true, color:hp>=3?C.GREEN:hp>=0?C.AMBER:C.RED, ...altRow(ri) }),
    ]
  })
  sl.addTable([[hdr('TIER'),hdr('Active VIPs'),hdr('Valid Bet'),hdr('Win/Loss'),hdr('Hold%')], ...rows], {
    x:0.25,y:1.7,w:9.5,colW:[1.6,1.9,2.2,2.2,1.6],rowH:0.45, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
  sl.addText('Hold% = Win/Loss ÷ Valid Bet × 100   (positive = house profit)', { x:0.25,y:5.0,w:9.5,h:0.3, fontSize:9,color:C.MUTED,isTextBox:true })
}

function slide30_expense_report(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Expense Report Summary by Platform', mLabel(d.month))
  if(!d.expenses.length) { placeholder(sl,'No expense records. Add expenses via the Expenses module.'); return }
  const byPlatform = {}
  d.expenses.forEach(e=>{ const p=e.platform||'Other'; if(!byPlatform[p])byPlatform[p]={total:0,items:[]}; byPlatform[p].total+=(e.amount||0); byPlatform[p].items.push(e) })
  const rows = Object.entries(byPlatform).sort((a,b)=>b[1].total-a[1].total).map(([p,s],ri)=>[
    cell(p, { bold:true, color:C.ACC, ...altRow(ri) }),
    cell(s.items.length, { align:'center', ...altRow(ri) }),
    cell(fmt(s.total), { align:'right', bold:true, color:C.AMBER, ...altRow(ri) }),
    cell(s.items.map(i=>i.category).filter((v,i,a)=>a.indexOf(v)===i).slice(0,3).join(', '), { color:C.MUTED, fontSize:9, ...altRow(ri) }),
  ])
  const grand=d.expenses.reduce((s,e)=>s+(e.amount||0),0)
  rows.push([cell('GRAND TOTAL',{bold:true,color:C.WHITE}),cell(''),cell(fmt(grand),{align:'right',bold:true,color:C.AMBER}),cell('')])
  sl.addTable([[hdr('PLATFORM'),hdr('Line Items'),hdr('Total Amount'),hdr('Categories')], ...rows], {
    x:0.25,y:0.75,w:9.5,colW:[1.8,1.5,2.5,3.7],rowH:0.5, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
}

function slide31_budget(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, `Budget Planning — ${mLabel(d.nextMonth)}`, 'Review & Update in Budget Module')
  const actual=d.expenses.reduce((s,e)=>s+(e.amount||0),0)
  kpiTile(sl,0.25,0.72,4.5,0.85,'This Month Actual Spend', fmt(actual), mLabel(d.month), C.AMBER)
  placeholder(sl, '💰  Budget Planning\n\nUpdate next month\'s budget allocation\nin the Budget module → /budget\n\nData will auto-populate here once budgets are set.')
}

function slide32_health_summary(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Member Health — 3-Month Summary', `${mLabel(d.prev2Month)} → ${mLabel(d.month)}`)
  const months=[d.prev2Month,d.prevMonth,d.month]
  const allRows=[d.prev3Rows,d.prev2Rows,d.prevRows]
  const results=months.map((m,i)=>retention(allRows[i]||[],i>0?allRows[i-1]||[]:[], []))
  const hRow=[hdr('METRIC'),...months.map(m=>hdr(mLabel(m)))]
  const dataRows=[
    ['Active VIPs',      ...results.map(r=>r.ca.length)],
    ['Retention Rate',   ...results.map(r=>pct(r.retentionRate))],
    ['Churn Rate',       ...results.map(r=>pct(r.churnRate))],
    ['Reactivation Rate',...results.map(r=>pct(r.reactivationRate))],
    ['Churned VIPs',     ...results.map(r=>r.churned.length)],
    ['Reactivated VIPs', ...results.map(r=>r.reactivated.length)],
  ].map((row,ri)=>[
    cell(row[0], { bold:true, ...altRow(ri) }),
    ...row.slice(1).map((v,ci)=>{
      const val=v, isRet=row[0]==='Retention Rate', isChurn=row[0]==='Churn Rate'
      const vc = typeof v === 'string' && v.includes('%')
        ? (isRet?(parseFloat(v)>=70?C.GREEN:parseFloat(v)>=50?C.AMBER:C.RED)
          :(isChurn?(parseFloat(v)<=20?C.GREEN:parseFloat(v)<=40?C.AMBER:C.RED):C.WHITE))
        : C.WHITE
      return cell(v, { align:'center', color:vc, ...altRow(ri) })
    }),
  ])
  sl.addTable([hRow,...dataRows], { x:0.25,y:0.75,w:9.5,colW:[2.8,2.2,2.2,2.3],rowH:0.43, border:{type:'solid',color:'2A3F6F',pt:0.5} })
}

function slide33_closing(pptx, month) {
  const sl = pptx.addSlide(); bg(sl)
  sl.addShape('rect',{ x:0,y:0,w:10,h:0.08, fill:{ color:C.ACC } })
  sl.addShape('rect',{ x:0,y:5.545,w:10,h:0.08, fill:{ color:C.ACC } })
  sl.addText('Thank You', { x:0.6,y:1.5,w:8.8,h:1.0, fontSize:44,bold:true,color:C.WHITE,isTextBox:true })
  sl.addText('VIP Retention & Performance Division', { x:0.6,y:2.4,w:8.8,h:0.5, fontSize:16,color:C.ACC,isTextBox:true })
  sl.addShape('line',{ x:0.6,y:3.0,w:8.8,h:0, line:{ color:'2A3F6F',width:1 } })
  sl.addText(mLabel(month)+' Monthly Report', { x:0.6,y:3.1,w:8.8,h:0.4, fontSize:14,color:C.MUTED,isTextBox:true })
  sl.addText('SUREWIN  ·  CONFIDENTIAL', { x:0,y:5.15,w:10,h:0.3, fontSize:10,color:'3A4F6F',align:'center',bold:true,isTextBox:true })
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function generateMonthlyPPT(month, supabase) {
  const d = await fetchPPTData(month, supabase)
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  pptx.author  = 'Surewin VIP System'
  pptx.subject = `VIP Monthly Report — ${mLabel(month)}`
  pptx.title   = `Surewin VIP Report ${month}`

  slide01_cover(pptx, month)
  slide02_kpi(pptx, d)
  slide03_tier_overview(pptx, d)
  slide04_trend(pptx, d)
  slide05_deposit_behavior(pptx, d)
  slide06_top10_decline(pptx, d)
  slide07_active_rate(pptx, d)
  slide08_quadrant(pptx, d)
  slide09_10_diamond(pptx, d, 9)   // Diamond
  slide09_10_diamond(pptx, d, 10)  // Black
  slide11_diamond_summary(pptx, d)
  slide12_deposit_drop(pptx, d)
  slide13_retention_list(pptx, d)
  slide14_platinum(pptx, d)
  slide15_expenses(pptx, d)
  // Campaign slides 16-19
  if(d.campaigns.length > 0) slide16_17_campaign(pptx, d, 0)
  else { const sl=pptx.addSlide(); bg(sl); header(sl,'Campaign Report #1',mLabel(month)); placeholder(sl,'No campaigns found for this month') }
  if(d.campaigns.length > 1) slide16_17_campaign(pptx, d, 1)
  else { const sl=pptx.addSlide(); bg(sl); header(sl,'Campaign Report #2',mLabel(month)); placeholder(sl,'No second campaign this month') }
  slide18_19_campaigns_summary(pptx, d)  // slide 18
  { const sl=pptx.addSlide(); bg(sl); header(sl,'Campaign ROI Analysis',mLabel(month)); placeholder(sl,'Campaign ROI requires expense cost data linked to each campaign.\n\nLink expenses to campaigns in the Expenses module.') } // slide 19
  slide20_review(pptx, d)
  slide21_churn_calibration(pptx, d)
  slide22_retention_analytics(pptx, d)
  slide23_score_divergence(pptx)
  slide24_ggr_concentration(pptx, d)
  slide25_intramonth_trend(pptx, d)
  slide26_action_plan(pptx, d)
  slide27_strategy(pptx)
  slide28_upcoming_campaigns(pptx, d)
  slide29_hold_pct(pptx, d)
  slide30_expense_report(pptx, d)
  slide31_budget(pptx, d)
  slide32_health_summary(pptx, d)
  slide33_closing(pptx, month)

  const fileName = `Surewin_VIP_Report_${month}.pptx`
  await pptx.writeFile({ fileName })
  return fileName
}
