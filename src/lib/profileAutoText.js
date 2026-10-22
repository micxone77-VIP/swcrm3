// src/lib/profileAutoText.js — 中文 for the auto Profile-tab text from get_vip_profile_auto() (2026-10-22)
// The database writes these short English phrases; this turns them into Chinese when the UI is in 中文.
const RULES = [
  [/Deposits more after a losing day \((\d+)% vs (\d+)% after a win\)/g, '输钱后更常存款（输后 $1% vs 赢后 $2%）'],
  [/Deposits more after a winning day \((\d+)% vs (\d+)% after a loss\)/g, '赢钱后更常存款（赢后 $1% vs 输后 $2%）'],
  [/Deposits when there is a bonus \((\d+)% of deposit days\)/g, '有优惠时才存款（$1% 的存款日）'],
  [/came back after contact in last 30 days/g, '近30天联系后回来了'],
  [/(\d+) contacts, no reply/g, '联系 $1 次都没回复'],
  [/bonus hunter last month/g, '上月是优惠猎人'],
  [/deposits mostly with bonus/g, '大多有优惠才存'],
  [/big-ticket deposits/g, '大额存款'],
  [/big daily win\/loss swings/g, '每天输赢起伏大'],
  [/first upgrade to Gold\+/g, '第一次升到 Gold'],
  [/registration date/g, '注册日期'],
  [/replies (\d+)%/g, '回复率 $1%'],
  [/reply (\d+)%/g, '回复率 $1%'],
  [/deposits (stable|growing)/g, (m, x) => (x === 'stable' ? '存款稳定' : '存款增长')],
  [/every ~([\d.]+) days/g, '约每 $1 天一次'],
  [/mostly weekends/g, '多在周末'],
  [/avg (MYR|SGD|KHUSD) /g, (m, c) => `平均 ${c === 'MYR' ? 'RM' : c === 'SGD' ? 'S$' : c} `],
  [/peak /g, '高峰 '],
  [/~(\d+):00/g, '$1点'],
  [/\bSmall & frequent\b/gi, '小额多次'], [/\bBig ticket\b/gi, '大额型'], [/\bRegular\b/gi, '常规型'],
  [/\bStable\b/gi, '稳定'], [/\bGrowing\b/gi, '增长中'], [/\bDeclining\b/gi, '下滑中'], [/\bSilent\b/gi, '沉默'], [/\bNew\b/g, '新玩家'],
  [/\bDormant (\d+)d\b/g, '休眠 $1 天'], [/\bChurn (\d+)d\b/g, '流失 $1 天'], [/\bAt Risk (\d+)d\b/g, '有风险 $1 天'],
  [/\bActive\b/g, '活跃'], [/\bResting\b/g, '休息中'],
  [/\blate night\b/gi, '深夜'], [/\bmorning\b/gi, '早上'], [/\bafternoon\b/gi, '下午'], [/\bevening\b/gi, '晚上'],
  [/\bMon\b/g, '周一'], [/\bTue\b/g, '周二'], [/\bWed\b/g, '周三'], [/\bThu\b/g, '周四'], [/\bFri\b/g, '周五'], [/\bSat\b/g, '周六'], [/\bSun\b/g, '周日'],
  [/; /g, '；'],
]

export function autoText(text, lang = 'en') {
  if (!text || lang !== 'zh') return text
  return RULES.reduce((s, [re, to]) => s.replace(re, to), String(text))
}
