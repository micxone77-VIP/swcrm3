// src/lib/surveyImport.js — turn the Google Form "VIP Member Experience Survey" CSV into rows for
// vip_survey_responses. Multiple-choice answers become short English labels (the form's bilingual
// option text is matched by its English part); anything else is kept as "Other: …".
// Emails are only used to match a player and are never returned.

// CSV with quoted fields that can contain commas and new lines
export function parseCsv(text) {
  const rows = []
  let row = [], field = '', q = false
  const s = String(text || '').replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') q = false
      else field += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(x => x.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); if (row.some(x => x.trim() !== '')) rows.push(row) }
  return rows
}

// [label, regex on the answer text]
const OPT = {
  reason: [
    ['Busy recently', /busy recently|最近比较忙/i], ['Taking a break', /take a break for a while|暂时想休息一下/i],
    ['Using other platforms', /using other platforms|更多使用其他平台/i], ['Managing budget', /managing my spending|控制消费/i],
    ['Benefits do not match', /do not match my preference|不太符合我的需求/i], ['Lost all money', /亏完钱|lost all/i], ['Still active', /都有上线/i],
  ],
  returnDrivers: [
    ['Higher deposit bonus', /Higher Deposit Bonus/i], ['More cashback / rebate', /More Cashback \/ Rebate/i], ['Free credit', /Free Credit/i],
    ['Personalised VIP offers', /Personalised VIP Offers/i], ['More VIP exclusive rewards', /More VIP Exclusive Rewards/i],
    ['Faster transactions', /Faster \/ More Convenient Transactions/i],
  ],
  rewards: [
    ['Cashback / rebate', /Cashback \/ Rebate/i], ['Free credit', /Free Credit/i], ['VIP exclusive rewards', /VIP Exclusive Rewards/i],
    ['Birthday rewards', /Birthday Rewards/i], ['Physical gifts', /Physical Gifts/i], ['Personalised offers', /Personalised VIP Offers/i],
    ['Exclusive events', /Exclusive Events/i], ['Deposit bonus', /Deposit Bonus/i],
  ],
  manager: [
    ['Early promo notice', /Early notification of exclusive promotions/i], ['Personalised rewards', /Personalised VIP rewards based on my preferences/i],
    ['More cashback offers', /More Cashback offers/i], ['More exclusive bonuses', /More exclusive bonuses/i],
    ['Birthday / festival rewards', /Birthday \/ Special Occasion Rewards/i], ['Faster help', /Faster assistance when I need help/i],
  ],
  drop: [
    ['Lost a lot, taking a break', /Lost quite a lot of money, want to take a break/i], ['Other platforms better', /Other platforms offer better benefits/i],
    ['Personal reasons', /Personal reasons \(work, funds, time\)/i], ['Upgrade / keep-tier pressure', /Upgrade or maintenance pressure is high, feels not worth it/i],
    ['Bank tracking transactions', /Bank is tracking/i], ['Still active', /都有上线/i],
  ],
  factor: [
    ['Withdrawal', /Withdrawal|提款/i], ['Cashback / rebate', /Cashback \/ Rebate/i], ['Platform stability', /Platform Stability/i],
    ['Deposit bonus', /Deposit Bonus/i], ['Physical gifts', /Physical Gifts/i], ['Exclusive promotions', /Exclusive Promotions/i],
  ],
  better: [
    ['Faster deposit / withdrawal', /Faster deposit\/withdrawal/i], ['Higher rebate', /Higher rebate \/ commission/i],
    ['Better loss care', /Better compensation or care after losses/i], ['More attractive promotions', /More attractive exclusive promotions/i],
    ['Easier upgrade / keep-tier', /Easier upgrade or maintenance/i], ['No cash withdrawal fee', /[^,]*(5％服务费|5% service)/i], ['sureWin is steady', /surewin 稳/i],
  ],
}

const maskDigits = t => String(t || '').replace(/\d{7,}/g, m => '****' + m.slice(-4))
const clean = t => maskDigits(String(t || '').replace(/\s+/g, ' ').trim())
const NOTHING = /^(-|x|nope|no|没有|暂无.*|我也不知道|不方便说|none|n\/a)$/i

// All options found in the answer; leftover text that is not an option → "Other: …"
function pick(answer, opts) {
  let rest = String(answer || '')
  const out = []
  for (const [label, re] of opts) if (re.test(rest)) { out.push(label); rest = rest.replace(new RegExp(re.source + '[^,]*', re.flags), '') }
  const left = clean(rest.replace(/[,，]/g, ' '))
  if (left && !NOTHING.test(left) && /[A-Za-z一-鿿]{2,}/.test(left)) out.push('Other: ' + left.slice(0, 120))
  return out
}
const one = (answer, opts) => pick(answer, opts)[0] || null

function benefitFeeling(a) {
  if (/Benefits are good/i.test(a)) return 'good'
  if (/Benefits are average/i.test(a)) return 'average'
  if (/decreased|不如以前/i.test(a)) return 'decreased'
  if (/Not clear what benefits/i.test(a)) return 'unclear'
  return clean(a) || null
}

function platforms(a) {
  const t = clean(a)
  if (!t || NOTHING.test(t)) return []
  if (/surewin/i.test(t)) return ['sureWin only']
  return t.split(/[,，、/]+/).map(x => x.trim().toLowerCase()).filter(x => x && !NOTHING.test(x))
}

// Known typos in usernames typed into the form → CRM username
const USERNAME_FIX = { jasobkoh8082: 'jasonkoh8082' }

// rows: CSV rows incl. header. members: [{ username, email, tier }] to match against.
export function surveyRows(csvRows, members, surveyName) {
  const byUser = new Map(members.map(m => [String(m.username).toLowerCase(), m]))
  const byEmail = new Map(members.filter(m => m.email).map(m => [String(m.email).toLowerCase(), m]))
  const out = []
  for (const r of csvRows.slice(1)) {
    const [ts, email, user, tier, reason, ret, rew, mgr, improve, channel, drop, feeling, loss, factor, plat, better] = r.map(x => String(x || '').trim())
    if (!ts) continue
    const [d, mo, y, hh = '0', mi = '0', ss = '0'] = ts.split(/[/ :]/).map(Number)
    const typed = user.toLowerCase()
    let m = byUser.get(USERNAME_FIX[typed] || typed), how = m ? (USERNAME_FIX[typed] ? 'fixed_typo' : 'exact') : null
    if (!m && email) { m = byEmail.get(email.toLowerCase()); if (m) how = 'email' }
    out.push({
      survey_name: surveyName,
      submitted_at: new Date(Date.UTC(y, mo - 1, d, hh - 8, mi, ss)).toISOString(),   // form time is Malaysia time
      username: m ? m.username : null, match_method: how || 'none',
      reported_tier: tier || null, tier_at_import: m ? m.tier : null,
      reason_less_use: one(reason, OPT.reason),
      return_drivers: pick(ret, OPT.returnDrivers), preferred_rewards: pick(rew, OPT.rewards), manager_wants: pick(mgr, OPT.manager),
      improve_one: NOTHING.test(clean(improve)) ? null : clean(improve).slice(0, 500) || null,
      channel: /whatsapp/i.test(channel) ? 'WhatsApp' : /App/i.test(channel) ? 'App notification' : clean(channel) || null,
      drop_reasons: pick(drop, OPT.drop), benefit_feeling: benefitFeeling(feeling),
      loss_care: clean(loss) || null, deposit_factor: one(factor, OPT.factor) || (NOTHING.test(clean(factor)) ? null : clean(factor).slice(0, 200) || null),
      other_platforms: platforms(plat), better_elsewhere: pick(better, OPT.better),
    })
  }
  return out
}
