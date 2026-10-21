# SureWin VIP CRM — Business Logic Guide (for team + AI)

Live Supabase: **VIP Retention Hub** (`utopskwciorvooronpwg`). Applied 2026-10-01.
All objects are read-only views/functions on top of existing tables (`vip_daily_snapshots`, `vip_members`, `contact_logs`, `exclude_list`). Only new table: `crm_rules`.
Full current SQL of any view: `select pg_get_viewdef('public.<view>', true);`

## How it fits together
```
vip_daily_snapshots ─► v_vip_daily_activity (clean daily fact)
                              │
         vip_members + contact_logs + exclude_list
                              ▼
                     v_vip_status_base (one row per VIP: status + facts)
          ┌──────────────┬───────────────┬──────────────┐
   v_vip_priority  v_vip_early_warning  v_vip_next_step   (+ v_recall_attribution, v_bonus_dependency, v_data_quality_daily)
          └──────────────┴───────────────┴──────────────┘
                              ▼
                     get_daily_brief()  → one JSON for AI / dashboard
```

## Rules (`crm_rules` table — change numbers here, everything follows)
| Rule | Value | Meaning |
|---|---|---|
| active_days | 2 | Deposited within 2 days = Active |
| at_risk_days / churn_days / dormant_days | 3 / 7 / 15 | VIP inactivity rules |
| balance_play_days | 2 | Bet in last 2 days but no deposit = Balance play (not churn) |
| recall_window_days | 2 | Recall = deposit on contact day or next day; first deposit day only |
| unreachable_attempts | 3 | 3 "Contacted" logs since last reply = Unreachable |
| contact_cooldown_days | 2 | Contacted within 2 days = lower priority |
| big_loss_care_3d / big_win_3d | 10,000 | 3-day net loss → care call; 3-day net win then gone → win-back |
| deposit_drop_pct | 50 | Week-over-week deposit drop warning |
| gift_loss_tracked | 100,000 | Tracked net loss since data start → big-loss gift |
| value_band_5/4/3/2 | 100k/30k/10k/3k | 90-day deposit value bands |
| p1/p2/p3_score | 18/10/5 | Priority level cut-offs (max score 25) |
| dq_low_ratio / dq_high_ratio | 0.5 / 2 | Import sanity check vs 7-day average |
| tier_maint_gold/platinum/diamond_vb | 250k / 1M / 3M | Rolling 3-month valid bet to keep the tier (v_tier_downgrade_risk, process_tier_review()) |

## Key definitions
- **Active day** = `monthly_valid_bet > 0`. **Deposit day** = active day AND `total_deposit > 0`.
- **base_date** = latest snapshot date, not today's calendar date.
- **Status**: Active → Balance play → At risk (3–6d) → Churn (7–14d) → Dormant (15d+) → No deposit (180d).
- **Priority score** = value (max of tier score and 90-day deposit band, 1–5) × return chance (≤7d 5, ≤15d 4, ≤60d 3, ≤90d 2, else 1) × reach (unreachable 0.3, contacted ≤2d 0.5, 1–2 unanswered 0.7, else 1). Active / Balance play = "No action".
- **Recall layers**: Active 0–2d, Maintain 3–7d, Rescue 8–15d / 16–30d, Recall 31d+. Report recall rate per layer — never blended.

## Objects
| Object | One row per | Use it for |
|---|---|---|
| `v_vip_daily_activity` | VIP × day | Any daily/weekly/monthly calc |
| `v_vip_status_base` | VIP | Status, last deposit/active, week vs prev week, 3-day W/L, tracked loss, last contact, unanswered attempts |
| `v_vip_priority` | VIP | Today's call list (P1/P2/P3), flags `unreachable`, `big_loss_care` |
| `v_vip_early_warning` | VIP with ≥1 signal | `reasons` text + `suggested_action` (Care call / Gift / Contact today / Win-back / Monitor) |
| `v_vip_next_step` | VIP contacted in last 30d | Stage S0–S5 + `next_action` advice |
| `v_recall_attribution` | contact log | Was it a real recall? layer, recall date & deposit |
| `v_recall_summary_monthly` | month × host × layer | Recall KPI by host |
| `v_bonus_dependency` | VIP × month | Natural / Mixed / Bonus dependent / Bonus hunter |
| `v_data_quality_daily` | day | Import check: MISSING DAY / NO DEPOSIT DATA / LOW / HIGH |
| `v_tier_downgrade_risk` | VIP | Rolling 3-month VB vs maintenance threshold |
| `get_daily_brief(top)` | — | One JSON for AI / dashboard |

## Next-step stages
S0 no reply yet · S0X unreachable (switch channel) · S1 replied, no deposit · S2 deposited once → push 2nd within 24–48h · S3 2–3 deposit days → raise size · S4 core → relationship/upgrade · S5 came back then stopped ≥3 days → contact today.
