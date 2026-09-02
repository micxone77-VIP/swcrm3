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

// ─── 2. HIGH / CRITICAL churn risk ───────────────────────────────────────────
async function genChurnRiskTasks() {
  const month = MONTH()
  const { data } = await supabase
    .from('vip_members')
    .select('id, username, full_name, tier, churn_risk')
    .in('churn_risk', ['HIGH', 'CRITICAL'])
    .neq('is_excluded', true)

  await Promise.all((data || []).map(v => upsertTask({
    title: `⚠️ At-risk follow-up — ${v.username} (${v.churn_risk})`,
    task_type: 'Follow Up',
    vip_id: v.id,
    vip_username: v.username,
    vip_tier: v.tier,
    priority: v.churn_risk === 'CRITICAL' ? 'Urgent' : 'High',
    status: 'Open',
    due_date: new Date().toISOString(),
    source: 'auto_churn_risk',
    source_key: `churn_risk:${v.username}:${month}`,
    notes: `${v.username} is ${v.churn_risk} churn risk this month. Reach out urgently to retain them.`,
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

// ─── Main entry point ─────────────────────────────────────────────────────────
export async function generateAutoTasks() {
  const results = await Promise.allSettled([
    genBirthdayTasks(),
    genChurnRiskTasks(),
    genUpgradeTasks(),
    genCampaignDeadlineTasks(),
    genKpiReminderTask(),
  ])
  const [birthdays, churnRisk, upgrades, campaignDeadlines, kpiReminders] =
    results.map(r => r.status === 'fulfilled' ? (r.value || 0) : 0)

  return { birthdays, churnRisk, upgrades, campaignDeadlines, kpiReminders,
    total: birthdays + churnRisk + upgrades + campaignDeadlines + kpiReminders }
}
