// src/lib/campaignWaTemplates.js — WhatsApp messages per campaign STAGE and LANGUAGE (EN / MY / 中文)
// for the normal campaign types (gold bar, %, fixed, tiered, dual tier, leaderboard).
// Stored in campaigns.wa_templates = { intro|near|won|paid|streak|ended: { en, my, zh } }; empty → built-in text below.
// Used by the Campaigns page (Chase list picks the stage per player, Payout uses "paid", Streak tab uses "streak")
// and filled by Ask Data when it drafts a campaign. Daily Milestone has its own set in dailyMilestone.js.

export const WA_STAGES = ['intro', 'near', 'won', 'paid', 'streak', 'ended']
export const WA_LANGS = ['en', 'my', 'zh']
export const WA_LANG_LABEL = { en: '🇬🇧 EN', my: '🇲🇾 MY', zh: '🇨🇳 中文' }

export const STAGE_INFO = {
  intro:  { icon: '📣', en: 'New / not active yet',       zh: '新加入 / 还没参与' },
  near:   { icon: '😬', en: 'Almost — not at target yet', zh: '差一点 — 还没达标' },
  won:    { icon: '🎉', en: 'Reached — reward processing', zh: '已达标 — 奖励处理中' },
  paid:   { icon: '💰', en: 'Paid — angpow credited',     zh: '已派彩 — 红包已到账' },
  streak: { icon: '🔥', en: '1 day to streak bonus',      zh: '差1天拿连续奖励' },
  ended:  { icon: '🏁', en: 'Campaign ended — thank you', zh: '活动结束 — 感谢' },
}

// Placeholders. A line whose placeholder has no value (e.g. {turnover} with no multiplier) is dropped.
export const WA_VARS = ['username', 'agent', 'campaign', 'start', 'end', 'days_left', 'cur', 'gap', 'next_reward', 'reward', 'turnover', 'tier_list', 'streak', 'streak_n', 'streak_pct']

export const DEFAULT_WA = {
  intro: {
    en: "Yo {username}! I'm {agent} from sureWin VIP department 😄\n\nGot something nice for you bro — 🎯 {campaign} is on from {start} to {end}!\n{tier_list}\n\nJom join, good luck bro 🍀",
    my: "Hai {username}! Saya {agent} dari jabatan VIP sureWin 😄\n\nAda benda best untuk bro — 🎯 {campaign} dah bermula dari {start} hingga {end}!\n{tier_list}\n\nJom join, semoga ong selalu bro 🍀",
    zh: "哈咯 {username}～我是sureWin VIP部门的 {agent} 😄\n\n跟你讲个好东西 🎯 {campaign} 开跑了（{start} – {end}）\n{tier_list}\n\n有空来玩一下，祝你旺 🍀",
  },
  near: {
    en: "Yo {username}! {agent} here from sureWin VIP department~\n\nBro you're close already 💪 Only {cur}{gap} more and you get {next_reward} in {campaign}!\nStill got {days_left} day(s), jom go!",
    my: "Hai {username}! {agent} dari jabatan VIP sureWin~\n\nBro dah dekat sangat 💪 Tinggal {cur}{gap} lagi untuk dapat {next_reward} dalam {campaign}!\nMasih ada {days_left} hari, jom!",
    zh: "哈咯 {username}，我是sureWin VIP部门的 {agent}～\n\n你差一点点就到了 💪 再 {cur}{gap} 就可以拿 {next_reward}（{campaign}）！\n还有 {days_left} 天，加油！",
  },
  won: {
    en: "Yo {username}! {agent} here from sureWin VIP department~\n\nSteady bro 🎉 You hit the target in {campaign} — {reward} is yours! I'm processing it now, will bank in soon ✅\n\nKeep going, can still get more 💪",
    my: "Hai {username}! {agent} dari jabatan VIP sureWin~\n\nPower bro 🎉 Bro dah capai sasaran {campaign} — {reward} untuk bro! Saya tengah proses, nanti masuk ✅\n\nTeruskan, boleh dapat lagi 💪",
    zh: "哈咯 {username}，我是sureWin VIP部门的 {agent}～\n\n你可以哦 🎉 {campaign} 你达标了，{reward} 是你的！我正在帮你处理，很快派进去 ✅\n\n继续加油，还可以拿更多 💪",
  },
  paid: {
    en: "Yo {username}! I'm {agent} from sureWin VIP department 🎉\n\nYour {campaign} angpow {reward} already banked in, check your balance ya ✅\n⚠️ Need {turnover} turnover before withdraw.\n\nThanks bro, good luck 🍀",
    my: "Hai {username}! Saya {agent} dari jabatan VIP sureWin 🎉\n\nAngpow {campaign} bro sebanyak {reward} dah masuk, check baki ya ✅\n⚠️ Perlu turnover {turnover} sebelum withdraw.\n\nTerima kasih bro, semoga ong 🍀",
    zh: "哈咯 {username}，我是sureWin VIP部门的 {agent} 🎉\n\n你的 {campaign} 红包 {reward} 已经派进去了，看一下余额哦 ✅\n⚠️ 提款前需要完成 {turnover} 流水。\n\n谢谢你，祝你旺 🍀",
  },
  streak: {
    en: "Yo {username}! {agent} here from sureWin VIP department~\n\nBro {streak} days in a row already 🔥🔥 One more day and you get the streak bonus ({streak_pct}% extra)! Don't break it ah 💪",
    my: "Hai {username}! {agent} dari jabatan VIP sureWin~\n\nBro dah {streak} hari berturut-turut 🔥🔥 Satu hari lagi dapat bonus streak ({streak_pct}% extra)! Jangan putus ya 💪",
    zh: "哈咯 {username}，我是sureWin VIP部门的 {agent}～\n\n你已经连续 {streak} 天了 🔥🔥 再一天就拿连续奖励（多 {streak_pct}%）！别断掉啊 💪",
  },
  ended: {
    en: "Yo {username}! I'm {agent} from sureWin VIP department~\n\n🎯 {campaign} ({start} – {end}) has ended 🏁\nThanks a lot for being with us the whole way bro 🙏 More campaigns coming soon — I'll let you know first!\n\nWish you good luck always and win more more 🍀💰",
    my: "Hai {username}! Saya {agent} dari jabatan VIP sureWin~\n\n🎯 {campaign} ({start} – {end}) dah tamat 🏁\nTerima kasih banyak sebab bersama kami dari awal bro 🙏 Kempen baru akan datang tak lama lagi — saya bagitahu bro dulu!\n\nSemoga ong selalu dan menang lebih banyak 🍀💰",
    zh: "哈咯 {username}，我是sureWin VIP部门的 {agent}～\n\n🎯 {campaign}（{start} – {end}）已经圆满结束啦 🏁\n谢谢你这段时间一路的支持 🙏 我们很快会有新活动，第一时间通知你！\n\n祝你天天好运，赢多多 🍀💰",
  },
}

// Campaign's own text → older single-template fields → built-in text
export function templateFor(campaign, stage, lang) {
  const custom = campaign?.wa_templates?.[stage]?.[lang]
  if (custom && custom.trim()) return custom
  if (stage === 'paid') {
    const legacy = campaign?.[{ en: 'payout_template_en', my: 'payout_template_my', zh: 'payout_template_cn' }[lang]]
    if (legacy && legacy.trim()) return legacy
  }
  if (stage === 'intro') {
    const legacy = lang === 'zh' ? campaign?.whatsapp_template_zh : lang === 'en' ? campaign?.whatsapp_template : null
    if (legacy && legacy.trim()) return legacy
  }
  return DEFAULT_WA[stage]?.[lang] || DEFAULT_WA[stage]?.en || ''
}

export function fillWa(tpl, vars) {
  const has = k => vars[k] !== undefined && vars[k] !== null && String(vars[k]) !== ''
  return String(tpl || '').split('\n')
    .filter(line => !(line.match(/\{(\w+)\}/g) || []).some(m => WA_VARS.includes(m.slice(1, -1)) && !has(m.slice(1, -1))))
    .join('\n')
    .replace(/\{(\w+)\}/g, (m, k) => (has(k) ? String(vars[k]) : m))
    .replace(/\n{3,}/g, '\n\n').trim()
}

export function waMessage(campaign, stage, lang, vars) {
  return fillWa(templateFor(campaign, stage, lang), vars)
}

// {x} placeholders the system does not know (Ask Data rejects these, e.g. {current_deposit})
export function unknownVars(text) {
  return [...new Set((String(text || '').match(/\{(\w+)\}/g) || []).map(m => m.slice(1, -1)).filter(k => !WA_VARS.includes(k)))]
}

const n = v => Math.round(Number(v) || 0).toLocaleString('en-US')
const W = {
  dep: { en: 'Deposit', my: 'Deposit', zh: '存款' }, to: { en: 'turnover', my: 'turnover', zh: '流水' },
  daily: { en: '(every day counted on its own)', my: '(setiap hari dikira semula)', zh: '（每天独立计算）' },
  total: { en: '(total of the whole campaign)', my: '(jumlah sepanjang kempen)', zh: '（整个活动累计）' },
  above: { en: 'and above', my: 'ke atas', zh: '以上' }, top: { en: 'Top', my: 'Top', zh: '前' },
  streak: { en: '🔥 {n} days in a row → extra {p}%', my: '🔥 {n} hari berturut-turut → extra {p}%', zh: '🔥 连续 {n} 天 → 再多 {p}%' },
}

// "• Deposit RM30,000 → RM900 Credit" lines for {tier_list}, in the message language
export function tierList(c, levels = [], lang = 'en') {
  const cur = c?.platform === 'SG' ? 'SGD ' : 'RM'
  const label = c?.reward_delivery === 'wcash' ? 'WCash' : 'Credit'
  const t = x => W[x][lang] || W[x].en
  const lines = []
  const type = c?.campaign_type
  if (type === 'dual_tier') {
    for (const r of c.reward_tiers || []) {
      const cond = [Number(r.depositThreshold) > 0 ? `${t('dep')} ${cur}${n(r.depositThreshold)}` : null, Number(r.turnoverThreshold) > 0 ? `${t('to')} ${cur}${n(r.turnoverThreshold)}` : null].filter(Boolean).join(' + ')
      const pay = [Number(r.creditAmount) > 0 ? `${cur}${n(r.creditAmount)} Credit` : null, Number(r.wcashAmount) > 0 ? `${cur}${n(r.wcashAmount)} WCash` : null].filter(Boolean).join(' + ')
      lines.push(`• ${cond} → ${pay}`)
    }
    lines.push(t(c.settlement_frequency === 'daily' ? 'daily' : 'total'))
    if (c.streak_enabled) {
      const line = t('streak').replace('{n}', c.streak_days || 3)
      lines.push(c.streak_bonus_type === 'fixed' ? line.replace('{p}%', `${cur}${n(c.streak_bonus_fixed)}`) : line.replace('{p}', Number(c.streak_bonus_pct ?? 1)))
    }
  } else if (type === 'tiered_reward') {
    for (const r of c.reward_tiers || []) lines.push(`• ${t('dep')} ${cur}${n(r.min)}${r.max ? ` – ${cur}${n(r.max)}` : ` ${t('above')}`} → ${r.pct}%`)
  } else if (type === 'fixed_reward' && c.is_multi_level) {
    for (const l of levels) lines.push(`• ${t('dep')} ${cur}${n(l.deposit_threshold)} → ${cur}${n(l.reward_amount)} ${label}`)
  } else if (type === 'pct_reward') {
    lines.push(`• ${t('dep')} ${cur}${n(c.deposit_target)} → ${c.reward_pct}%${Number(c.reward_cap) > 0 ? ` (max ${cur}${n(c.reward_cap)})` : ''}`)
  } else if (type === 'fixed_reward') {
    lines.push(`• ${t('dep')} ${cur}${n(c.deposit_target)} → ${cur}${n(c.reward_fixed)} ${label}`)
  } else if (type === 'gold_bar') {
    lines.push(`• ${t('dep')} ${cur}${n(c.deposit_target)} → 🥇 ${cur}${n(c.gold_bar_value)}`)
  } else if (type === 'leaderboard') {
    lines.push(`🏆 ${t('top')} ${c.top_n || 3}: ` + (c.rank_rewards || []).map(r => `#${r.rank} ${cur}${n(r.amount)}`).join(' · '))
  }
  return lines.join('\n')
}
