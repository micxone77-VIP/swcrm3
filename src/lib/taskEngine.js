// src/lib/taskEngine.js
// Auto-task generation engine — produces tasks from live DB signals
// Manual tasks use supabase directly in MyTasks.jsx
// Call generateAutoTasks() from Today page on refresh

import { supabase } from './supabase'

const TODAY = () => new Date().toISOString().slice(0, 10)
const MONTH = () => new Date().toISOString().slice(0, 7)

// Core upsert — source_key is UNIQUE, so this silently skips duplicates
async function upsertTask(task) {
  if (!task.source_key) return
  const { error } = await supabase
    .from('tasks')
    .upsert(task, { onConflict: 'source_key', ignoreDuplicates: true })
  if (error) console.warn('[taskEngine]', task.source_key, error.message)
}

// ─── 1. Birthdays today ───────────────────────────────────────────────────────
async function genBirthdayTasks() {
  const today = new Date()
  const mm = String(today.getMonth() + 1).padStart(2, '0')
  const dd = String(today.getDate()).padStart(2, '0')
  const pattern = `%-${mm}-${dd}`

  const { data } = await supabase
    .from('vip_members')
    .select('id, username, full_name, tier')
    .filter('birthday', 'like', pattern)
    .neq('is_excluded', true)

  await Promise.all((data || []).map(v => upsertTask({
    title: `🎂 Birthday greeting — ${v.username}`,
    task_type: 'Birthday',
    vip_id: v.id,
    vip_username: v.username,
    vip_tier: v.tier,
    priority: 'Urgent',
    status: 'Open',
    due_date: new Date().toISOString(),
    source: 'auto_birthday',
    source_key: `birthday:${v.username}:${TODAY()}`,
    notes: `Today is ${v.full_name || v.username}'s birthday. Send a greeting message.`,
  })))
  return (data || []).length
}

// ─── 3. Churn snapshot saved (called externally from RetentionWorkspace) ──────
export async function genChurnSnapshotTask(month = MONTH()) {
  await upsertTask({
    title: `📊 Review monthly churn snapshot — ${month}`,
    task_type: 'Review',
    priority: 'High',
    status: 'Open',
    due_date: new Date().toISOString(),
    source: 'auto_churn_snapshot',
    source_key: `churn_snapshot:${month}`,
    notes: `Monthly churn snapshot for ${month} has been saved. Review churned players and plan reactivation strategy.`,
  })
}

// ─── 4. Upgrade-ready players ─────────────────────────────────────────────────
async function genUpgradeTasks() {
  const month = MONTH()
  const { data } = await supabase
    .from('vip_members')
    .select('id, username, full_name, tier, monthly_valid_bet')
    .in('tier', ['GOLD', 'PLATINUM'])
    .neq('is_excluded', true)

  const ready = (data || []).filter(v => {
    const mvb = Number(v.monthly_valid_bet || 0)
    return (v.tier === 'GOLD' && mvb >= 2_000_000) ||
           (v.tier === 'PLATINUM' && mvb >= 6_000_000)
  })

  await Promise.all(ready.map(v => {
    const nextTier = v.tier === 'GOLD' ? 'PLATINUM' : 'DIAMOND'
    return upsertTask({
      title: `⬆️ Upgrade ready — ${v.username} → ${nextTier}`,
      task_type: 'Upgrade',
      vip_id: v.id,
      vip_username: v.username,
      vip_tier: v.tier,
      priority: 'High',
      status: 'Open',
      due_date: new Date().toISOString(),
      source: 'auto_upgrade',
      source_key: `upgrade_ready:${v.username}:${month}`,
      notes: `${v.username} has met the monthly valid bet threshold for ${nextTier}. Process their tier upgrade now.`,
    })
  }))
  return ready.length
}

// ─── 5. Campaign deadlines (expiring within 3 days) ───────────────────────────
async function genCampaignDeadlineTasks() {
  const now = new Date()
  const in3 = new Date(now.getTime() + 3 * 86400000)

  const { data } = await supabase
    .from('campaigns')
    .select('id, campaign_name, campaign_code, end_date')
    .lte('end_date', in3.toISOString())
    .gte('end_date', now.toISOString())

  await Promise.all((data || []).map(c => upsertTask({
    title: `📢 Campaign ending soon — ${c.campaign_name}`,
    task_type: 'Campaign',
    priority: 'High',
    status: 'Open',
    due_date: new Date(c.end_date).toISOString(),
    source: 'auto_campaign_deadline',
    source_key: `campaign_deadline:${c.id}:${in3.toISOString().slice(0, 10)}`,
    notes: `Campaign "${c.campaign_name}" (${c.campaign_code}) ends within 3 days. Confirm eligible players are enrolled and rewards are ready to process.`,
  })))
  return (data || []).length
}

// ─── 6. KPI entry reminder — no entry yet for current month ──────────────────
async function genKpiReminderTask() {
  const month = MONTH()
  const { data } = await supabase
    .from('kpi_entries')
    .select('id')
    .eq('month', month)
    .limit(1)

  if ((data || []).length === 0) {
    // Deadline: 5th of the following month
    const [y, m] = month.split('-').map(Number)
    const nextM = m === 12 ? 1 : m + 1
    const nextY = m === 12 ? y + 1 : y
    const due = new Date(`${nextY}-${String(nextM).padStart(2,'0')}-05T00:00:00Z`)

    await upsertTask({
      title: `🏆 Log monthly KPIs — ${month}`,
      task_type: 'Review',
      priority: 'Medium',
      status: 'Open',
      due_date: due.toISOString(),
      source: 'auto_kpi_reminder',
      source_key: `kpi_reminder:${month}`,
      notes: `No KPI data entered for ${month} yet. Open KPI Progress and log this month's performance numbers before the 5th.`,
    })
    return 1
  }
  return 0
}

// ─── Display localisation (render-time only; stored titles stay English) ─────
export const TASK_TYPE_ZH = {
  'Follow Up': '跟进', 'VIP Contact': 'VIP联系', 'Campaign': '活动', 'Upgrade': '升级',
  'Birthday': '生日', 'Review': '审阅', 'Other': '其他',
}
export const TASK_PRIORITY_ZH = { Urgent: '紧急', High: '高', Medium: '中', Low: '低' }
export const TASK_STATUS_ZH = { Open: '待办', 'In Progress': '进行中', Completed: '已完成', Snoozed: '已暂缓', Cancelled: '已取消' }

const TITLE_RULES = [
  [/^🎂 Birthday greeting — (.+)$/, m => `🎂 生日祝福 — ${m[1]}`],
  [/^📞 (P\d) (Active|Resting|At Risk|Churn|Dormant|Unknown) — (.+)$/, m => `📞 ${m[1]} ${STATUS_ZH[m[2]] || m[2]} — ${m[3]}`],
  [/^⚠️ At-risk follow-up — (.+)$/, m => `⚠️ 风险跟进 — ${m[1]}`],
  [/^📊 Review monthly churn snapshot — (.+)$/, m => `📊 审阅月度流失快照 — ${m[1]}`],
  [/^⬆️ Upgrade ready — (.+)$/, m => `⬆️ 可升级 — ${m[1]}`],
  [/^📢 Campaign ending soon — (.+)$/, m => `📢 活动即将结束 — ${m[1]}`],
  [/^🏆 Log monthly KPIs — (.+)$/, m => `🏆 录入月度KPI — ${m[1]}`],
]
// Daily host task notes (generate_daily_tasks) are ' · ' separated parts
const STATUS_ZH = { Active: '活跃', Resting: '休息中', 'At Risk': '有风险', Churn: '流失', Dormant: '休眠', Unknown: '未知' }
const DAILY_PART_RULES = [
  [/^(\d+) days since last real deposit$/, m => `${m[1]}天未真实存款`],
  [/^last bet (.+)$/, m => `最后投注 ${m[1]}`],
  [/^never contacted$/, () => '从未联系'],
  [/^last contact (\d+)d ago$/, m => `${m[1]}天前联系`],
  [/^big 3-day loss → care call$/, () => '3天大额亏损 → 关怀电话'],
  [/^unreachable \(3 no-replies\) → try another channel$/, () => '联系不上（3次未回复）→ 换渠道'],
  [/^score (.+)$/, m => `分数 ${m[1]}`],
  [/^Missed: not done on (.+)$/, m => `未完成：${m[1]} 未处理`],
]
const localizeDailyParts = text => text.split(' · ').map(part => {
  for (const [re, fn] of DAILY_PART_RULES) { const m = part.match(re); if (m) return fn(m) }
  return part
}).join(' · ')

const NOTES_RULES = [
  [/^\d+ days since last real deposit( · .*)?$/, m => localizeDailyParts(m[0])],
  [/^Today is (.+)'s birthday\. Send a greeting message\.$/, m => `今天是 ${m[1]} 的生日，请发送祝福信息。`],
  [/^(.+) is (\S+) churn risk this month\. Reach out urgently to retain them\.$/, m => `${m[1]} 本月流失风险为 ${m[2]}，请尽快联系挽留。`],
  [/^Monthly churn snapshot for (.+) has been saved\. Review churned players and plan reactivation strategy\.$/, m => `${m[1]} 月度流失快照已保存。请审阅流失玩家并制定召回策略。`],
  [/^(.+) has met the monthly valid bet threshold for (\S+)\. Process their tier upgrade now\.$/, m => `${m[1]} 已达到 ${m[2]} 的月有效投注门槛，请立即处理等级升级。`],
  [/^Campaign "(.+)" \((.*)\) ends within 3 days\. Confirm eligible players are enrolled and rewards are ready to process\.$/, m => `活动「${m[1]}」(${m[2]}) 将在3天内结束。请确认合资格玩家已报名，奖励已准备好发放。`],
  [/^No KPI data entered for (.+) yet\. Open KPI Progress and log this month's performance numbers before the 5th\.$/, m => `${m[1]} 尚未录入KPI数据。请在5号前打开KPI进度录入本月业绩。`],
]
function applyRules(rules, text) {
  if (!text) return text
  for (const [re, fn] of rules) { const m = String(text).match(re); if (m) return fn(m) }
  return text
}
// Translate an auto-generated task title / notes for display. Unknown text is returned unchanged.
export function localizeTaskTitle(title, lang = 'en') { return lang === 'zh' ? applyRules(TITLE_RULES, title) : title }
export function localizeTaskNotes(notes, lang = 'en') { return lang === 'zh' ? applyRules(NOTES_RULES, notes) : notes }

// ─── Main entry point ─────────────────────────────────────────────────────────
// ─── 0. Expire auto tasks from past months (they were never closed and only pile up) ──
// Follow-up tasks also auto-close when a contact is logged (DB trigger trg_close_tasks_on_contact).
async function expireOldAutoTasks() {
  const now = new Date(Date.now() + 8 * 3600e3)   // Malaysia time
  const monthStart = `${now.toISOString().slice(0, 7)}-01T00:00:00+08:00`
  const { error } = await supabase.from('tasks')
    .update({ status: 'Cancelled', updated_at: new Date().toISOString() })
    .like('source', 'auto_%').in('status', ['Open', 'In Progress', 'Snoozed']).lt('created_at', monthStart)
  if (error) console.warn('[taskEngine] expire', error.message)
}

export async function generateAutoTasks() {
  await expireOldAutoTasks()
  // Churn follow-ups now come from the database: generate_daily_tasks() makes each host's daily list
  // after every import (source 'auto_daily'), so genChurnRiskTasks is no longer run here.
  const results = await Promise.allSettled([
    genBirthdayTasks(),
    Promise.resolve(0),
    genUpgradeTasks(),
    genCampaignDeadlineTasks(),
    genKpiReminderTask(),
  ])
  const [birthdays, churnRisk, upgrades, campaignDeadlines, kpiReminders] =
    results.map(r => r.status === 'fulfilled' ? (r.value || 0) : 0)

  return { birthdays, churnRisk, upgrades, campaignDeadlines, kpiReminders,
    total: birthdays + churnRisk + upgrades + campaignDeadlines + kpiReminders }
}
