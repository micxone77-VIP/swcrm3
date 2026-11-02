// src/lib/pptReportGenerator.js — Monthly VIP Report PPT Generator
// Generates the monthly report using pptxgenjs (browser-compatible)
// Money: MYR, SGD and KHUSD are never added together: totals are kept per currency (sumCur / fmtCur).
// Win/loss: the database holds the PLAYER's side (minus = player lost). fetchPPTData flips it, so every
// slide here reads win_loss as HOUSE win/loss (plus = house won).
import PptxGenJS from 'pptxgenjs'
import { calculateRetentionMetrics } from './retentionAnalytics.js'
import { fetchAll } from './depositProfile'
import { fetchCampaignPayout } from './campaignPayouts'
import { summarizeImpact } from './campaignImpactCore'

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
const TIERS = ['BLACK','DIAMOND-P','DIAMOND','PLATINUM','GOLD','SILVER','BRONZE']
const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ─── Helpers ──────────────────────────────────────────────────────────────────
const prevM = ym => { if(!ym)return null; const [y,m]=ym.split('-').map(Number); return m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,'0')}` }
const nextM = ym => { if(!ym)return null; const [y,m]=ym.split('-').map(Number); return m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,'0')}` }
const mLabel = ym => { if(!ym)return ''; const [y,m]=ym.split('-'); return `${MONTH_NAMES[parseInt(m)]} ${y}` }
const fmt = (n,sym='RM')=>{ if(n==null)return '—'; const a=Math.abs(n),s=n<0?'-':''; if(a>=1e6)return`${s}${sym} ${(a/1e6).toFixed(2)}M`; if(a>=1e3)return`${s}${sym} ${(a/1e3).toFixed(1)}K`; return`${s}${sym} ${Math.round(a).toLocaleString()}` }
const pct = n => n==null?'—':`${Number(n).toFixed(1)}%`
// Per-currency totals: { MYR: n, SGD: n } — never add these together
const CURS = ['MYR','SGD','KHUSD']
const SYM = { MYR:'RM', SGD:'SGD', KHUSD:'KHUSD' }
const curOf = r => r?.currency||'MYR'
const fmtP = (n,r) => fmt(n, SYM[curOf(r)]||curOf(r))
export const sumCur = (rows,f) => rows.reduce((m,r)=>{ const c=curOf(r); m[c]=(m[c]||0)+(Number(f(r))||0); return m },{})
const usedCurs = (...maps) => CURS.filter(c=>maps.some(m=>m?.[c]))
export const fmtCur = (m,sep=' · ') => { const cs=usedCurs(m); return cs.length?cs.map(c=>fmt(m[c],SYM[c])).join(sep):fmt(0) }
const fmtLines = m => fmtCur(m,'\n')
const mainCur = (...maps) => usedCurs(...maps)[0]||'MYR'
const mainVal = m => m?.[mainCur(m)]||0
// "▲ 5.0%" per currency (a currency name is added when there is more than MYR)
const perCur = (cs,f,sep) => cs.map(c=>(cs.length>1||c!=='MYR'?`${SYM[c]} `:'')+f(c)).join(sep)
const chgCur = (c,p,sep='\n') => { const cs=usedCurs(c,p); return cs.length?perCur(cs,x=>{ const v=chg(c[x]||0,p[x]||0); return `${arw(v)} ${pct(Math.abs(v))}` },sep):'—' }
const ratioCur = (a,b,sep='\n') => { const cs=usedCurs(b); return cs.length?perCur(cs,x=>pct((a[x]||0)/b[x]*100),sep):'—' }
const mainRatio = (a,b) => { const c=mainCur(b); return b[c]?(a[c]||0)/b[c]*100:0 }
const mainChg = (c,p) => { const x=mainCur(c,p); return chg(c[x]||0,p[x]||0) }
const medianCur = (rows,f) => { const by={}; rows.forEach(r=>(by[curOf(r)]=by[curOf(r)]||[]).push(Number(f(r))||0)); return Object.fromEntries(Object.entries(by).map(([c,v])=>[c,v.sort((a,b)=>b-a)[Math.floor(v.length/2)]||0])) }
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
  slide.addText(value, { x:x+0.1,y:y+0.26,w:w-0.2,h:0.38, fontSize:String(value).length>14?11:15,bold:true,color:valColor,isTextBox:true })
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
      dep:     sumCur(tr,r=>r.total_deposit),
      bet:     sumCur(tr,r=>r.monthly_valid_bet),
      wl:      sumCur(tr,r=>r.win_loss),
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
// ─── Data fetcher ──────────────────────────────────────────────────────────────
export async function fetchPPTData(month, supabase) {
  const m1=prevM(month), m2=prevM(m1), m3=prevM(m2), nM=nextM(month)
  const [r0,r1,r2,r3] = await Promise.all([
    supabase.from('vip_monthly_totals').select('*').eq('snapshot_month',month),
    supabase.from('vip_monthly_totals').select('*').eq('snapshot_month',m1),
    supabase.from('vip_monthly_totals').select('*').eq('snapshot_month',m2),
    supabase.from('vip_monthly_totals').select('*').eq('snapshot_month',m3),
  ])
  const [rL,campsR,expR,upcomR] = await Promise.all([
    supabase.from('reactivation_logs').select('*').eq('reactivated_month',month),
    supabase.from('campaigns').select('*').gte('start_date',`${month}-01`).lt('start_date',`${nM}-01`).order('start_date'),
    supabase.from('department_expenses').select('*').eq('month',month),
    // still running after this month ends (an old campaign left on "active" is not upcoming)
    supabase.from('campaigns').select('id,campaign_name,campaign_type,target_tier,start_date,end_date,status').in('status',['upcoming','active']).or(`end_date.is.null,end_date.gte.${nM}-01`).order('start_date').limit(10),
  ])
  // House view: database win_loss is the player's side (minus = player lost)
  const house = rows => (rows||[]).map(r=>({ ...r, win_loss:-(Number(r.win_loss)||0) }))
  const currRows = house(r0.data)
  const cur = Object.fromEntries(currRows.map(r=>[r.username,r.currency]))
  // Days with real play only (same rule as vip_monthly_totals); more than 1000 rows, so read page by page
  const daily = await fetchAll(()=>supabase.from('vip_daily_snapshots').select('username,snapshot_date,total_deposit,monthly_valid_bet').gte('snapshot_date',`${month}-01`).lt('snapshot_date',`${nM}-01`).gt('monthly_valid_bet',0).order('snapshot_date').order('username'))
  const campaigns = []
  for (const c of campsR.data||[]) campaigns.push({ ...c, payout:await fetchCampaignPayout(c,supabase) })
  return {
    month, currRows, prevRows:house(r1.data), prev2Rows:house(r2.data), prev3Rows:house(r3.data),
    reactLogs:rL.data||[], dailySnaps:daily.map(r=>({ ...r, currency:cur[r.username] })), campaigns, expenses:expR.data||[], upcoming:upcomR.data||[],
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
  header(sl, `VIP Performance Overview (Gold & above)`, mLabel(d.month))
  const ca=active(d.currRows), pa=active(d.prevRows)
  const totDep  = sumCur(ca,r=>r.total_deposit)
  const totBet  = sumCur(ca,r=>r.monthly_valid_bet)
  const totWL   = sumCur(ca,r=>r.win_loss)
  const totReb  = sumCur(ca,r=>r.total_rebate)
  const totBonus= sumCur(ca,r=>r.bonus_amount)
  const cntChg  = chg(ca.length, pa.length)
  const depChg  = chgCur(totDep, sumCur(pa,r=>r.total_deposit), ' · ')
  const W=2.3, H=1.0
  const tiles = [
    { l:'Active VIPs',      v:String(ca.length),    s:`${arw(cntChg)} ${pct(Math.abs(cntChg))} MoM`, vc:C.WHITE },
    { l:'Total Deposit',    v:fmtCur(totDep),       s:`${depChg} MoM`,                               vc:C.WHITE },
    { l:'Valid Bet',        v:fmtCur(totBet),       s:'Monthly Valid Bet',                             vc:C.ACC },
    { l:'House Win / Loss', v:fmtCur(totWL),        s:`Hold ${ratioCur(totWL,totBet,' · ')}`,         vc:mainVal(totWL)>=0?C.GREEN:C.RED },
    { l:'Total Rebate',     v:fmtCur(totReb),       s:'To players',                                    vc:C.AMBER },
    { l:'Bonus Paid',       v:fmtCur(totBonus),     s:'Promotional cost',                              vc:C.AMBER },
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
    return [
      cell(t, { color:TIER_C[t]||C.WHITE, bold:true, ...altRow(ri) }),
      cell(s.count, { align:'center', ...altRow(ri) }),
      cell(fmtLines(s.dep), { align:'right', ...altRow(ri) }),
      cell(fmtLines(s.bet), { align:'right', ...altRow(ri) }),
      cell(fmtLines(s.wl),  { align:'right', color:mainVal(s.wl)>=0?C.GREEN:C.RED, ...altRow(ri) }),
      cell(ratioCur(s.wl,s.bet), { align:'center', ...altRow(ri) }),
      cell(chgCur(s.dep,p.dep), { align:'center', color:arwC(mainChg(s.dep,p.dep)), ...altRow(ri) }),
    ]
  })
  sl.addTable([[hdr('TIER'),hdr('Active'),hdr('Total Deposit'),hdr('Valid Bet'),hdr('House W/L'),hdr('Hold%'),hdr('Dep MoM')], ...rows], {
    x:0.25,y:0.75,w:9.5,colW:[1.3,0.7,1.6,1.6,1.6,1.3,1.4],rowH:0.55,
    border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
}

function slide04_trend(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, '3-Month Performance Trend', `${mLabel(d.prev2Month)} → ${mLabel(d.month)}`)
  const months = [d.prev2Month, d.prevMonth, d.month]
  // Fix: currAllRows = [Jul, Aug, Sep], prevAllRows = [Jun, Jul, Aug] to match months correctly
  const currAllRows = [d.prev2Rows, d.prevRows, d.currRows]
  const prevAllRows = [d.prev3Rows, d.prev2Rows, d.prevRows]
  const results = months.map((m,i) => retention(currAllRows[i]||[], prevAllRows[i]||[], []))
  const deposits = currAllRows.map(rows => sumCur(active(rows),r=>r.total_deposit))
  // Trend table — includes deposit + retention metrics
  const hRow = [hdr('METRIC'), ...months.map(m=>hdr(mLabel(m)))]
  const dataRows = [
    ['Total Deposit',   ...deposits.map(d=>fmtCur(d))],
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
  sl.addTable([hRow,...dataRows], { x:0.25,y:0.75,w:9.5,colW:[2.8,2.2,2.2,2.3],rowH:0.38, border:{type:'solid',color:'2A3F6F',pt:0.5} })
}

function slide05_deposit_behavior(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Deposit Behavior Quality', mLabel(d.month))
  const ca=active(d.currRows)
  const byTier = Object.fromEntries(TIERS.map(t=>{
    const tr=ca.filter(r=>(r.tier||'').toUpperCase()===t)
    const dep=sumCur(tr,r=>r.total_deposit)
    const bet=sumCur(tr,r=>r.monthly_valid_bet)
    const n=sumCur(tr,()=>1)
    const avgDep=Object.fromEntries(Object.entries(dep).map(([c,v])=>[c,n[c]?v/n[c]:0]))
    return [t,{ count:tr.length, dep, bet, avgDep, betRatio:mainRatio(bet,dep)/100 }]
  }))
  const rows = TIERS.map((t,ri)=>{
    const s=byTier[t]
    return [
      cell(t, { color:TIER_C[t]||C.WHITE, bold:true, ...altRow(ri) }),
      cell(s.count, { align:'center', ...altRow(ri) }),
      cell(fmtLines(s.dep), { align:'right', ...altRow(ri) }),
      cell(fmtLines(s.avgDep), { align:'right', ...altRow(ri) }),
      cell(ratioCur(s.bet,s.dep), { align:'center', ...altRow(ri) }),
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
    cell(fmtP(r.prevDep,r), { align:'right', ...altRow(ri) }),
    cell(fmtP(r.total_deposit||0,r), { align:'right', ...altRow(ri) }),
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
  const medDep = medianCur(ca,r=>r.total_deposit)
  const medBet = medianCur(ca,r=>r.monthly_valid_bet)
  const q = {HH:0,HL:0,LH:0,LL:0}
  ca.forEach(r=>{ const hd=(r.total_deposit||0)>=medDep[curOf(r)],hb=(r.monthly_valid_bet||0)>=medBet[curOf(r)]; q[hd&&hb?'HH':hd&&!hb?'HL':!hd&&hb?'LH':'LL']++ })
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
  sl.addText('Median Deposit: '+fmtCur(medDep)+'  |  Median Valid Bet: '+fmtCur(medBet), { x:0.25,y:5.1,w:9.5,h:0.2, fontSize:8.5,color:C.MUTED,align:'right',isTextBox:true })
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
      cell(fmtP(r.total_deposit||0,r), { align:'right', ...altRow(ri) }),
      cell(fmtP(r.monthly_valid_bet||0,r), { align:'right', ...altRow(ri) }),
      cell(fmtP(r.win_loss||0,r), { align:'right', color:(r.win_loss||0)>=0?C.GREEN:C.RED, ...altRow(ri) }),
      cell(`${arw(depChg)} ${pct(Math.abs(depChg))}`, { align:'center', color:arwC(depChg), ...altRow(ri) }),
      cell(r.host_assigned||'—', { fontSize:9, color:C.MUTED, ...altRow(ri) }),
    ]
  })
  sl.addTable([[hdr('#'),hdr('USERNAME'),hdr('Deposit'),hdr('Valid Bet'),hdr('House W/L'),hdr('Dep Chg'),hdr('Host')], ...rows], {
    x:0.25,y:0.75,w:9.5,colW:[0.4,2.1,1.6,1.6,1.5,1.2,1.1],rowH:0.36, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
}

function slide11_diamond_summary(pptx, d) {
  // slide09_10_diamond handles Diamond; this does a summary of Diamond+Platinum combined
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Premium Tier Summary (Diamond + Platinum)', mLabel(d.month))
  const premTiers = ['BLACK','DIAMOND-P','DIAMOND','PLATINUM']
  const ts=tierStats(d.currRows), tsP=tierStats(d.prevRows)
  const rows = premTiers.map((t,ri)=>{
    const c=ts[t],p=tsP[t]
    const cntChg=c.count-p.count
    return [
      cell(t, { color:TIER_C[t]||C.WHITE, bold:true, ...altRow(ri) }),
      cell(c.count, { align:'center', ...altRow(ri) }),
      cell(`${cntChg>=0?'+':''}${cntChg}`, { align:'center', color:cntChg>=0?C.GREEN:C.RED, bold:true, ...altRow(ri) }),
      cell(fmtLines(c.dep), { align:'right', ...altRow(ri) }),
      cell(chgCur(c.dep,p.dep), { align:'center', color:arwC(mainChg(c.dep,p.dep)), ...altRow(ri) }),
      cell(fmtLines(c.bet), { align:'right', ...altRow(ri) }),
      cell(fmtLines(c.wl),  { align:'right', color:mainVal(c.wl)>=0?C.GREEN:C.RED, ...altRow(ri) }),
      cell(ratioCur(c.wl,c.bet), { align:'center', ...altRow(ri) }),
    ]
  })
  sl.addTable([[hdr('TIER'),hdr('Active'),hdr('MoM'),hdr('Deposit'),hdr('Dep%'),hdr('Valid Bet'),hdr('House W/L'),hdr('Hold%')], ...rows], {
    x:0.25,y:0.75,w:9.5,colW:[1.2,0.6,0.6,1.5,1.3,1.5,1.5,1.3],rowH:0.65, border:{type:'solid',color:'2A3F6F',pt:0.5},
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
      cell(fmtP(r.prevDep,r), { align:'right', ...altRow(ri) }),
      cell(fmtP(c?.total_deposit||0,r), { align:'right', ...altRow(ri) }),
      cell(fmtP(diff,r), { align:'right', color:C.RED, bold:true, ...altRow(ri) }),
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
    cell(fmtP(r.total_deposit||0,r), { align:'right', ...altRow(ri) }),
    cell(fmtP(r.monthly_valid_bet||0,r), { align:'right', ...altRow(ri) }),
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
      cell(fmtP(r.total_deposit||0,r), { align:'right', ...altRow(ri) }),
      cell(fmtP(r.monthly_valid_bet||0,r), { align:'right', ...altRow(ri) }),
      cell(fmtP(r.win_loss||0,r), { align:'right', color:(r.win_loss||0)>=0?C.GREEN:C.RED, ...altRow(ri) }),
      cell(`${arw(dc)} ${pct(Math.abs(dc))}`, { align:'center', color:arwC(dc), ...altRow(ri) }),
      cell(r.host_assigned||'—', { fontSize:9,color:C.MUTED, ...altRow(ri) }),
    ]
  })
  sl.addTable([[hdr('#'),hdr('USERNAME'),hdr('Deposit'),hdr('Valid Bet'),hdr('House W/L'),hdr('Dep Chg'),hdr('Host')], ...rows], {
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
    if(!byCat[k]) byCat[k]={ total:{}, count:0, items:[] }
    byCat[k].total[curOf(e)] = (byCat[k].total[curOf(e)]||0)+(Number(e.amount)||0)
    byCat[k].count++
    byCat[k].items.push(e)
  })
  const catRows = Object.entries(byCat).sort((a,b)=>(b[1].total.MYR||0)-(a[1].total.MYR||0))
  const rows = catRows.map(([cat,s],ri)=>[
    cell(cat, { bold:true, ...altRow(ri) }),
    cell(s.count, { align:'center', ...altRow(ri) }),
    cell(fmtLines(s.total), { align:'right', bold:true, ...altRow(ri) }),
    cell(s.items.map(i=>i.platform||'—').filter((v,i,a)=>a.indexOf(v)===i).join(', '), { color:C.MUTED, ...altRow(ri) }),
  ])
  const total = sumCur(d.expenses,e=>e.amount)
  const totRow = [cell('TOTAL', { bold:true, color:C.ACC }), cell(''), cell(fmtLines(total), { align:'right', bold:true, color:C.AMBER }), cell('')]
  sl.addTable([[hdr('CATEGORY'),hdr('Items'),hdr('Amount'),hdr('Platforms')], ...rows, totRow], {
    x:0.25,y:0.75,w:9.5,colW:[3.5,1.2,2.3,2.5],rowH:0.45, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
}

function slide16_17_campaign(pptx, d, campIdx=0) {
  const sl = pptx.addSlide(); bg(sl)
  const camp = d.campaigns[campIdx]
  if(!camp) { placeholder(sl,`Campaign #${campIdx+1} data not found`); return }
  header(sl, camp.campaign_name||'Campaign Report', `${camp.campaign_type||''}  |  ${mLabel(d.month)}`)
  const pay = camp.payout
  kpiTile(sl, 0.25,0.72,2.2,0.85,'Total Players',  String(pay.enrolled), 'Enrolled', C.WHITE)
  kpiTile(sl, 2.55,0.72,2.2,0.85,'Players Paid',   String(pay.paidPlayers), `${pct(pay.enrolled?pay.paidPlayers/pay.enrolled*100:0)} of players`, C.GREEN)
  kpiTile(sl, 4.85,0.72,2.2,0.85,'Total Earned',   fmtCur(pay.earnedByCur), 'Reward + streak bonus', C.AMBER)
  kpiTile(sl, 7.15,0.72,2.2,0.85,'Confirmed Paid', fmtCur(pay.paidByCur),  'Marked paid only', C.ACC)
  const topPlayers = pay.players.filter(p=>p.earned>0||p.paid>0).sort((a,b)=>b.earned-a.earned).slice(0,10)
  const rows = topPlayers.map((p,ri)=>{
    const status = p.paid>0&&p.paid>=p.earned?'Paid':p.paid>0?'Part paid':'Pending'
    return [
      cell(ri+1, { align:'center', ...altRow(ri) }),
      cell(p.username||'—', { bold:true, ...altRow(ri) }),
      cell(fmtP(p.earned,p), { align:'right', bold:true, ...altRow(ri) }),
      cell(fmtP(p.paid,p), { align:'right', ...altRow(ri) }),
      cell(status, { align:'center', color:status==='Paid'?C.GREEN:C.AMBER, bold:true, ...altRow(ri) }),
    ]
  })
  sl.addTable([[hdr('#'),hdr('USERNAME'),hdr('Earned'),hdr('Paid'),hdr('Status')], ...rows], {
    x:0.25,y:1.7,w:9.5,colW:[0.5,3.6,2.0,2.0,1.4],rowH:0.33, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
  sl.addText(`Paid = reward ${fmtCur(pay.paidRewardByCur)} + streak bonus ${fmtCur(pay.paidStreakByCur)}  |  Top 10 players by amount earned`, { x:0.25,y:5.35,w:9.5,h:0.22, fontSize:9,color:C.MUTED,isTextBox:true })
}

function slide18_19_campaigns_summary(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'All Campaigns Summary', mLabel(d.month))
  if(!d.campaigns.length) { placeholder(sl,'No campaigns found for this month'); return }
  const rows = d.campaigns.map((c,ri)=>[
    cell(c.campaign_name||'—', { bold:true, ...altRow(ri) }),
    cell(c.campaign_type||'—', { color:C.MUTED, ...altRow(ri) }),
    cell(Array.isArray(c.target_tier)?c.target_tier.join(','): (c.target_tier||'ALL'), { color:TIER_C[String(c.target_tier||'').toUpperCase()]||C.MUTED, bold:true, ...altRow(ri) }),
    cell(c.payout.enrolled, { align:'center', ...altRow(ri) }),
    cell(c.payout.paidPlayers, { align:'center', color:C.GREEN, ...altRow(ri) }),
    cell(fmtLines(c.payout.earnedByCur), { align:'right', color:C.AMBER, bold:true, ...altRow(ri) }),
    cell(fmtLines(c.payout.paidByCur), { align:'right', color:C.ACC, bold:true, ...altRow(ri) }),
  ])
  sl.addTable([[hdr('CAMPAIGN'),hdr('TYPE'),hdr('TIER'),hdr('Players'),hdr('Paid'),hdr('Earned'),hdr('Paid Amount')], ...rows], {
    x:0.25,y:0.75,w:9.5,colW:[2.8,1.2,1.0,0.8,0.7,1.5,1.5],rowH:0.45, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
  sl.addText(`Total this month — earned: ${fmtCur(campTotals(d,'earnedByCur'))}  |  paid: ${fmtCur(campTotals(d,'paidByCur'))}`, { x:0.25,y:5.05,w:9.5,h:0.35, fontSize:11,bold:true,color:C.AMBER,isTextBox:true })
}

const ROI_RESULT = { worked:'✅ Worked', costly:'🟡 Cost above extra GGR', small:'➖ Small effect', nolift:'❌ No lift', nobefore:'ℹ No before data', notstarted:'⏳ Not started', na:'ℹ Not enough data' }

// Same method as the Campaigns page 📈 Impact tab (rpc campaign_impact + summarizeImpact).
// Cost = rewards + streak bonuses earned (campaignPayouts), which stays current; the Impact tab's saved cost may be older.
async function loadCampaignRoi(d, supabase) {
  for (const c of d.campaigns) {
    const { data, error } = await supabase.rpc('campaign_impact', { p_campaign_id:c.id })
    c.roi = error ? [] : usedCurs(c.payout.earnedByCur).map(cur=>summarizeImpact(data,cur,c.payout.earnedByCur[cur])).filter(Boolean)
  }
}

function slide19_campaign_roi(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Campaign ROI Analysis', mLabel(d.month))
  const list = d.campaigns.flatMap(c=>(c.roi||[]).map(S=>({ c, S })))
  if(!list.length) { placeholder(sl,'No campaign with a reward cost this month'); return }
  const rows = list.map(({c,S},ri)=>{
    const sym = SYM[S.cur]||S.cur
    return [
      cell(c.campaign_name||'—', { bold:true, ...altRow(ri) }),
      cell(fmt(S.cost,sym), { align:'right', color:C.AMBER, ...altRow(ri) }),
      cell(S.during?.vb?fmt(S.during.vb.incremental,sym):'—', { align:'right', ...altRow(ri) }),
      cell(S.incGGR!=null?fmt(S.incGGR,sym):'—', { align:'right', color:(S.incGGR||0)>=0?C.GREEN:C.RED, ...altRow(ri) }),
      cell(S.net!=null?fmt(S.net,sym):'—', { align:'right', bold:true, color:(S.net||0)>=0?C.GREEN:C.RED, ...altRow(ri) }),
      cell(S.roi!=null?`${Math.round(S.roi)}%`:'—', { align:'center', bold:true, color:(S.roi||0)>=0?C.GREEN:C.RED, ...altRow(ri) }),
      cell(ROI_RESULT[S.verdict]||'—', { fontSize:9, ...altRow(ri) }),
    ]
  })
  sl.addTable([[hdr('CAMPAIGN'),hdr('Reward Cost'),hdr('Extra Turnover'),hdr('Extra GGR'),hdr('Net'),hdr('ROI'),hdr('Result')], ...rows], {
    x:0.25,y:0.75,w:9.5,colW:[2.6,1.1,1.2,1.1,1.1,0.7,1.7],rowH:0.48, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
  sl.addText('Extra = campaign players compared with similar players not in the campaign. Net = Extra GGR − Reward Cost. GGR swings, so read ROI with the turnover lift. Campaigns running at the same time can share players, so their effects overlap.', { x:0.25,y:4.85,w:9.5,h:0.5, fontSize:9,color:C.MUTED,isTextBox:true })
}

// One currency total across all campaigns
function campTotals(d, key) {
  const out={}
  d.campaigns.forEach(c=>Object.entries(c.payout[key]).forEach(([cur,v])=>{ out[cur]=(out[cur]||0)+v }))
  return out
}

function slide20_review(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Monthly Review & Highlights', mLabel(d.month))
  const ca=active(d.currRows), pa=active(d.prevRows)
  const totDep =sumCur(ca,r=>r.total_deposit)
  const prevDep=sumCur(pa,r=>r.total_deposit)
  const totWL  =sumCur(ca,r=>r.win_loss)
  const totBet =sumCur(ca,r=>r.monthly_valid_bet)
  // Highlights read the main platform (MYR); the tiles show every currency
  const holdPct=mainRatio(totWL,totBet)
  const mainSym=SYM[mainCur(totBet)]
  const mainWL=totWL[mainCur(totBet)]||0
  const ret=retention(d.currRows,d.prevRows,d.reactLogs)
  const depChgPct=mainChg(totDep,prevDep)
  const cntChgPct=chg(ca.length,pa.length)
  // KPI tiles at top
  kpiTile(sl,0.25,0.72,2.2,0.85,'Active VIPs',    String(ca.length),         `${arw(cntChgPct)} ${pct(Math.abs(cntChgPct))} MoM`, cntChgPct>=0?C.GREEN:C.AMBER)
  kpiTile(sl,2.55,0.72,2.2,0.85,'Total Deposit',  fmtCur(totDep),            `${chgCur(totDep,prevDep,' · ')} MoM`, depChgPct>=0?C.GREEN:C.RED)
  kpiTile(sl,4.85,0.72,2.2,0.85,'Retention Rate', pct(ret.retentionRate),    `${ret.retained.length} retained`,                   ret.retentionRate>=70?C.GREEN:ret.retentionRate>=50?C.AMBER:C.RED)
  kpiTile(sl,7.15,0.72,2.2,0.85,'House Hold%',    ratioCur(totWL,totBet,' · '), fmtCur(totWL),                            holdPct>=3?C.GREEN:holdPct>=0?C.AMBER:C.RED)
  // Auto-generated highlights banner
  sl.addShape('rect', { x:0.25,y:1.72,w:9.5,h:0.28, fill:{ color:C.STRIP } })
  sl.addText('AUTO-GENERATED HIGHLIGHTS  (review and add management commentary before presenting)', { x:0.35,y:1.72,w:9.3,h:0.28, fontSize:8.5,bold:true,color:C.MUTED,valign:'middle',isTextBox:true })
  // Build highlight lines from data
  const lines = []
  if(depChgPct>=5)         lines.push(`🟢  Deposits up ${pct(depChgPct)} MoM to ${fmtCur(totDep)} — strong player activity`)
  else if(depChgPct<=-20)  lines.push(`🔴  Significant deposit drop ${pct(Math.abs(depChgPct))} MoM — review deposit-drop and churned VIP lists`)
  else if(depChgPct<0)     lines.push(`🟡  Deposits dipped ${pct(Math.abs(depChgPct))} MoM — monitor closely; trigger recovery if trend continues`)
  else                     lines.push(`⚪  Deposits stable ${depChgPct>=0?'+':''}${pct(depChgPct)} MoM at ${fmtCur(totDep)}`)
  if(holdPct<0)            lines.push(`🔴  Negative hold this month (${pct(holdPct)}) — players won ${fmt(Math.abs(mainWL),mainSym)} — review GGR concentration by tier`)
  else if(holdPct<2)       lines.push(`🟡  Hold% below target at ${pct(holdPct)} — house edge is thin; review game mix`)
  else                     lines.push(`🟢  Hold% healthy at ${pct(holdPct)} — house won ${fmt(mainWL,mainSym)}`)
  if(ret.churnRate>20)     lines.push(`🔴  High churn: ${ret.churned.length} VIPs lost (${pct(ret.churnRate)}) — activate recovery plan for top churned immediately`)
  else if(ret.churnRate>10)lines.push(`🟡  Moderate churn: ${ret.churned.length} VIPs (${pct(ret.churnRate)}) — host team to follow up this week`)
  else                     lines.push(`🟢  Retention strong: only ${ret.churned.length} churned (${pct(ret.churnRate)} churn rate)`)
  if(ret.reactivated.length>0) lines.push(`✅  Reactivated ${ret.reactivated.length} VIPs this month — great recovery effort`)
  if(d.campaigns.length>0)     lines.push(`📣  ${d.campaigns.length} campaign(s) ran — rewards earned: ${fmtCur(campTotals(d,'earnedByCur'))}, paid: ${fmtCur(campTotals(d,'paidByCur'))}`)
  if(ca.length>pa.length)      lines.push(`📈  VIP base grew by +${ca.length-pa.length} active VIPs MoM`)
  lines.slice(0,6).forEach((line,i)=>{
    sl.addShape('rect', { x:0.25,y:2.05+i*0.49,w:9.5,h:0.44, fill:{ color:i%2===0?C.BG2:C.BG }, line:{color:'2A3F6F',width:0.5} })
    sl.addText(line, { x:0.4,y:2.07+i*0.49,w:9.2,h:0.4, fontSize:10,color:C.WHITE,valign:'middle',isTextBox:true })
  })
  sl.addText('✏  Add team wins, key decisions, and next-month focus here before presenting to management', { x:0.25,y:5.22,w:9.5,h:0.22, fontSize:8.5,color:C.MUTED,isTextBox:true })
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
    cell(fmtLines(sumCur(ret.churned.filter(r=>(r.tier||'').toUpperCase()===t),r=>r.total_deposit)), { align:'right', ...altRow(ri) }),
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

function slide24_ggr_concentration(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'House Win (GGR) Concentration — Pareto', mLabel(d.month))
  const vips = active(d.currRows).filter(r=>(r.win_loss||0)>0).sort((a,b)=>(b.win_loss||0)-(a.win_loss||0))
  if(!vips.length) { placeholder(sl,'No house win recorded this month'); return }
  const totalWL = sumCur(vips,r=>r.win_loss)
  // Top 20% of the players the house won from, inside each currency
  const top = usedCurs(totalWL).flatMap(c=>{ const v=vips.filter(r=>curOf(r)===c); return v.slice(0,Math.ceil(v.length*0.2)) })
  kpiTile(sl,0.25,0.72,2.2,0.85,'House Win',      fmtCur(totalWL), 'From players who lost', C.GREEN)
  kpiTile(sl,2.55,0.72,2.2,0.85,'Top 20% VIPs',   String(top.length)+' players', ratioCur(sumCur(top,r=>r.win_loss),totalWL,' · ')+' of GGR', C.ACC)
  kpiTile(sl,4.85,0.72,2.2,0.85,'VIPs who lost',  String(vips.length), 'House won from them', C.WHITE)
  const byTier = TIERS.map(t=>{
    const tr=vips.filter(r=>(r.tier||'').toUpperCase()===t)
    return { t, wl:sumCur(tr,r=>r.win_loss), cnt:tr.length }
  }).filter(x=>x.cnt>0)
  const rows = byTier.map(({t,wl,cnt},ri)=>[
    cell(t, { color:TIER_C[t]||C.WHITE, bold:true, ...altRow(ri) }),
    cell(cnt, { align:'center', ...altRow(ri) }),
    cell(fmtLines(wl), { align:'right', color:C.GREEN, bold:true, ...altRow(ri) }),
    cell(ratioCur(wl,Object.fromEntries(usedCurs(wl).map(c=>[c,totalWL[c]]))), { align:'center', ...altRow(ri) }),
  ])
  sl.addTable([[hdr('TIER'),hdr('VIPs'),hdr('House Win'),hdr('Share of Total')], ...rows], {
    x:0.25,y:1.7,w:7.0,colW:[1.5,1.3,2.2,2.0],rowH:0.45, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
  sl.addText('House win only counts players the house won from; players who won are left out.', { x:0.25,y:5.0,w:9.5,h:0.3, fontSize:9,color:C.MUTED,isTextBox:true })
}

function slide25_intramonth_trend(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Intra-Month 5-Day Deposit Trend', mLabel(d.month))
  if(!d.dailySnaps.length) { placeholder(sl,'No daily snapshot data for this month'); return }
  const [y,m] = d.month.split('-').map(Number)
  const lastDay = new Date(y,m,0).getDate()
  const windows = [1,6,11,16,21,26].map((start,i,arr)=>({
    label: `D${start}-${i<arr.length-1?arr[i+1]-1:lastDay}`,
    snaps: d.dailySnaps.filter(s=>{ const day=parseInt(s.snapshot_date?.slice(8,10)||0); return day>=start&&day<(arr[i+1]||32) }),
  }))
  const rows = windows.map((w,ri)=>{
    const dep = sumCur(w.snaps,r=>r.total_deposit)
    const users = {}
    w.snaps.forEach(r=>{ (users[curOf(r)]=users[curOf(r)]||new Set()).add(r.username) })
    const avg = Object.fromEntries(Object.entries(dep).map(([c,v])=>[c,v/users[c].size]))
    return [
      cell(w.label, { bold:true, color:C.ACC, ...altRow(ri) }),
      cell(new Set(w.snaps.map(r=>r.username)).size, { align:'center', ...altRow(ri) }),
      cell(fmtLines(dep), { align:'right', bold:true, ...altRow(ri) }),
      cell(fmtLines(avg), { align:'right', color:C.MUTED, ...altRow(ri) }),
    ]
  })
  sl.addTable([[hdr('WINDOW'),hdr('Active Users'),hdr('Total Deposit'),hdr('Avg Dep/User')], ...rows], {
    x:0.25,y:0.75,w:9.5,colW:[1.8,2.5,2.7,2.5],rowH:0.55, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
  sl.addText('Note: Active Users = unique usernames who played in that window. Gold and above.', { x:0.25,y:4.9,w:9.5,h:0.3, fontSize:9,color:C.MUTED,isTextBox:true })
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
    cell(fmtP(r.total_deposit||0,r), { align:'right', ...altRow(ri) }),
    cell(r.host_assigned||'Unassigned', { color:C.MUTED, ...altRow(ri) }),
    cell('📞 Chase → Deposit', { color:C.AMBER, ...altRow(ri) }),
  ])
  sl.addTable([[hdr('#'),hdr('USERNAME'),hdr('TIER'),hdr('Prev Dep'),hdr('Host'),hdr('Action')], ...rows], {
    x:0.25,y:1.08,w:9.5,colW:[0.4,2.1,1.2,1.6,1.8,2.4],rowH:0.37, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
  sl.addText(`Total ${ret.churned.length} churned VIPs — reactivation goal: at least ${Math.ceil(ret.churned.length*0.3)} = 30%`, { x:0.25,y:5.05,w:9.5,h:0.3, fontSize:10,color:C.MUTED,isTextBox:true })
}

function slide27_strategy(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Strategic Direction & Focus Areas', `${mLabel(d.month)} Review → ${mLabel(d.nextMonth)} Plan`)
  const ca=active(d.currRows)
  const ret=retention(d.currRows,d.prevRows,d.reactLogs)
  const medDep=medianCur(ca,r=>r.total_deposit)
  const medBet=medianCur(ca,r=>r.monthly_valid_bet)
  let atRisk=0; ca.forEach(r=>{ if((r.total_deposit||0)<medDep[curOf(r)]&&(r.monthly_valid_bet||0)<medBet[curOf(r)])atRisk++ })
  const upcomingCount=(d.upcoming||[]).filter(c=>c.status==='upcoming').length
  // Data signals section
  sl.addShape('rect', { x:0.25,y:0.72,w:9.5,h:0.28, fill:{ color:C.STRIP } })
  sl.addText('DATA SIGNALS  — use these to anchor the strategic discussion:', { x:0.35,y:0.72,w:9.3,h:0.28, fontSize:8.5,bold:true,color:C.MUTED,valign:'middle',isTextBox:true })
  const signals=[
    `At-Risk VIPs (low bet + low deposit): ${atRisk} of ${ca.length} active (${pct(ca.length?atRisk/ca.length*100:0)})`,
    `Churned this month: ${ret.churned.length} VIPs  |  Churn Rate: ${pct(ret.churnRate)}  |  Reactivated: ${ret.reactivated.length}`,
    `Retention Rate: ${pct(ret.retentionRate)}  |  Opening: ${ret.pa.length} VIPs  |  Closing: ${ret.ca.length} VIPs`,
    `Upcoming campaigns: ${upcomingCount} planned for ${mLabel(d.nextMonth)}`,
  ]
  signals.forEach((sig,i)=>{
    sl.addShape('rect', { x:0.25,y:1.05+i*0.37,w:9.5,h:0.32, fill:{ color:i%2===0?C.BG2:C.BG }, line:{color:'2A3F6F',width:0.5} })
    sl.addText(`→  ${sig}`, { x:0.4,y:1.08+i*0.37,w:9.2,h:0.27, fontSize:10,color:C.WHITE,valign:'middle',isTextBox:true })
  })
  // Management input section
  sl.addShape('rect', { x:0.25,y:2.58,w:9.5,h:0.28, fill:{ color:C.STRIP } })
  sl.addText('MANAGEMENT INPUT  — fill in during meeting:', { x:0.35,y:2.58,w:9.3,h:0.28, fontSize:8.5,bold:true,color:C.MUTED,valign:'middle',isTextBox:true })
  const inputs=[
    `Focus tier for ${mLabel(d.nextMonth)}: _______________________________________________`,
    'Campaign / promotion strategy: _______________________________________',
    'Host team priorities / reassignments: ________________________________',
    'Key decision or initiative from this meeting: ________________________',
  ]
  inputs.forEach((inp,i)=>{
    sl.addShape('rect', { x:0.25,y:2.91+i*0.42,w:9.5,h:0.37, fill:{ color:C.BG2 }, line:{color:'2A3F6F',width:0.5,dashType:'dash'} })
    sl.addText(inp, { x:0.4,y:2.94+i*0.42,w:9.2,h:0.31, fontSize:10,color:C.MUTED,valign:'middle',isTextBox:true })
  })
}

function slide28_upcoming_campaigns(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, `Upcoming Campaign Plan — ${mLabel(d.nextMonth)}`, `Upcoming / still running`)
  if(!d.upcoming.length) { placeholder(sl,'No upcoming campaigns found.\nCreate campaigns in the Campaign module.'); return }
  const rows = d.upcoming.map((c,ri)=>[
    cell(c.campaign_name||'—', { bold:true, ...altRow(ri) }),
    cell(c.campaign_type||'—', { color:C.MUTED, ...altRow(ri) }),
    cell(Array.isArray(c.target_tier)?c.target_tier.join(','): (c.target_tier||'ALL'), { color:TIER_C[String(c.target_tier||'').toUpperCase()]||C.MUTED, bold:true, ...altRow(ri) }),
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
  const totBet=sumCur(allA,r=>r.monthly_valid_bet)
  const totWL =sumCur(allA,r=>r.win_loss)
  const overallHP = mainRatio(totWL,totBet)
  kpiTile(sl,0.25,0.72,3.0,0.85,'Overall Hold%',  ratioCur(totWL,totBet,' · '), `House Win/Loss ÷ Valid Bet`, overallHP>=3?C.GREEN:overallHP>=0?C.AMBER:C.RED)
  kpiTile(sl,3.4, 0.72,3.0,0.85,'House Win/Loss', fmtCur(totWL),    'Platform GGR', mainVal(totWL)>=0?C.GREEN:C.RED)
  kpiTile(sl,6.55,0.72,2.9,0.85,'Valid Bet Handle',fmtCur(totBet),  'Total wagered', C.ACC)
  const rows = TIERS.map((t,ri)=>{
    const s=ts[t], hp=mainRatio(s.wl,s.bet)
    return [
      cell(t, { color:TIER_C[t]||C.WHITE, bold:true, ...altRow(ri) }),
      cell(s.count, { align:'center', ...altRow(ri) }),
      cell(fmtLines(s.bet), { align:'right', ...altRow(ri) }),
      cell(fmtLines(s.wl), { align:'right', color:mainVal(s.wl)>=0?C.GREEN:C.RED, bold:true, ...altRow(ri) }),
      cell(ratioCur(s.wl,s.bet), { align:'center', bold:true, color:hp>=3?C.GREEN:hp>=0?C.AMBER:C.RED, ...altRow(ri) }),
    ]
  })
  sl.addTable([[hdr('TIER'),hdr('Active VIPs'),hdr('Valid Bet'),hdr('House W/L'),hdr('Hold%')], ...rows], {
    x:0.25,y:1.7,w:9.5,colW:[1.6,1.9,2.2,2.2,1.6],rowH:0.45, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
  sl.addText('Hold% = House Win/Loss ÷ Valid Bet × 100   (positive = house profit)', { x:0.25,y:5.0,w:9.5,h:0.3, fontSize:9,color:C.MUTED,isTextBox:true })
}

function slide30_expense_report(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Expense Report Summary by Platform', mLabel(d.month))
  if(!d.expenses.length) { placeholder(sl,'No expense records. Add expenses via the Expenses module.'); return }
  const byPlatform = {}
  d.expenses.forEach(e=>{ const p=e.platform||'Other'; if(!byPlatform[p])byPlatform[p]={total:{},items:[]}; byPlatform[p].total[curOf(e)]=(byPlatform[p].total[curOf(e)]||0)+(Number(e.amount)||0); byPlatform[p].items.push(e) })
  const rows = Object.entries(byPlatform).sort((a,b)=>(b[1].total.MYR||0)-(a[1].total.MYR||0)).map(([p,s],ri)=>[
    cell(p, { bold:true, color:C.ACC, ...altRow(ri) }),
    cell(s.items.length, { align:'center', ...altRow(ri) }),
    cell(fmtLines(s.total), { align:'right', bold:true, color:C.AMBER, ...altRow(ri) }),
    cell(s.items.map(i=>i.category).filter((v,i,a)=>a.indexOf(v)===i).slice(0,3).join(', '), { color:C.MUTED, fontSize:9, ...altRow(ri) }),
  ])
  const grand=sumCur(d.expenses,e=>e.amount)
  rows.push([cell('GRAND TOTAL',{bold:true,color:C.WHITE}),cell(''),cell(fmtLines(grand),{align:'right',bold:true,color:C.AMBER}),cell('')])
  sl.addTable([[hdr('PLATFORM'),hdr('Line Items'),hdr('Total Amount'),hdr('Categories')], ...rows], {
    x:0.25,y:0.75,w:9.5,colW:[1.8,1.5,2.5,3.7],rowH:0.5, border:{type:'solid',color:'2A3F6F',pt:0.5},
  })
}

function slide31_budget(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, `Budget Planning — ${mLabel(d.nextMonth)}`, 'Review & Update in Budget Module')
  const actual=sumCur(d.expenses,e=>e.amount)
  kpiTile(sl,0.25,0.72,4.6,0.85,'This Month Actual Spend', fmtCur(actual), `${mLabel(d.month)} total expenses`, C.AMBER)
  kpiTile(sl,5.0, 0.72,4.75,0.85,'Next Month Budget', '— set in Budget module —', `/budget → ${mLabel(d.nextMonth)}`, C.MUTED)
  if(d.expenses.length>0) {
    // Build per-category breakdown with blank next-month column for manual entry during meeting
    const byCat={}
    d.expenses.forEach(e=>{ const k=e.category||'Other'; if(!byCat[k])byCat[k]={}; byCat[k][curOf(e)]=(byCat[k][curOf(e)]||0)+(Number(e.amount)||0) })
    const catEntries=Object.entries(byCat).sort((a,b)=>(b[1].MYR||0)-(a[1].MYR||0))
    const rows=catEntries.map(([cat,amt],ri)=>[
      cell(cat, { bold:true, ...altRow(ri) }),
      cell(fmtLines(amt), { align:'right', color:C.AMBER, bold:true, ...altRow(ri) }),
      cell(ratioCur(amt,Object.fromEntries(usedCurs(amt).map(c=>[c,actual[c]]))), { align:'center', ...altRow(ri) }),
      cell('___________', { color:'2A3F6F', align:'right', fontSize:9, ...altRow(ri) }),
    ])
    rows.push([
      cell('TOTAL', { bold:true, color:C.WHITE }),
      cell(fmtLines(actual), { align:'right', bold:true, color:C.AMBER }),
      cell('100%', { align:'center', bold:true }),
      cell('___________', { color:'2A3F6F', align:'right', fontSize:9 }),
    ])
    sl.addTable([[hdr('CATEGORY'),hdr(`${mLabel(d.month)} Actual`),hdr('% Share'),hdr(`${mLabel(d.nextMonth)} Budget`)], ...rows], {
      x:0.25,y:1.72,w:9.5,colW:[3.2,2.2,1.7,2.4],rowH:0.44, border:{type:'solid',color:'2A3F6F',pt:0.5},
    })
    sl.addText('✏  Fill in the next month budget column during the meeting — or update via Budget module at /budget', { x:0.25,y:5.22,w:9.5,h:0.22, fontSize:8.5,color:C.MUTED,isTextBox:true })
  } else {
    placeholder(sl, `💰  No expense records for ${mLabel(d.month)}.\n\nAdd expenses via the Expenses module first.\n\nBreakdown by category will appear here automatically.`)
  }
}

function slide32_health_summary(pptx, d) {
  const sl = pptx.addSlide(); bg(sl)
  header(sl, 'Member Health — 3-Month Summary', `${mLabel(d.prev2Month)} → ${mLabel(d.month)}`)
  const months=[d.prev2Month,d.prevMonth,d.month]
  // Fix: currAllRows = [Jul, Aug, Sep], prevAllRows = [Jun, Jul, Aug]
  const currAllRows=[d.prev2Rows,d.prevRows,d.currRows]
  const prevAllRows=[d.prev3Rows,d.prev2Rows,d.prevRows]
  const results=months.map((m,i)=>retention(currAllRows[i]||[],prevAllRows[i]||[], []))
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
  await loadCampaignRoi(d, supabase)
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
  // Campaign slides: one per campaign, then the summary and ROI
  d.campaigns.forEach((c,i)=>slide16_17_campaign(pptx, d, i))
  if(!d.campaigns.length) { const sl=pptx.addSlide(); bg(sl); header(sl,'Campaign Report',mLabel(month)); placeholder(sl,'No campaigns found for this month') }
  slide18_19_campaigns_summary(pptx, d)
  slide19_campaign_roi(pptx, d)
  slide20_review(pptx, d)
  slide21_churn_calibration(pptx, d)
  slide22_retention_analytics(pptx, d)
  slide24_ggr_concentration(pptx, d)
  slide25_intramonth_trend(pptx, d)
  slide26_action_plan(pptx, d)
  slide27_strategy(pptx, d)
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
