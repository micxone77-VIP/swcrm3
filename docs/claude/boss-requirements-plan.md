# Boss's 10 VIP-CRM requirements — gap review and plan (2026-10-23)

Plan only, nothing built yet. Review done read-only against code + live Supabase.

## Answers from Marcus (2026-10-23)
- **Company brain** has its own database and AI agent. Their boss will have a **Hub** that connects to us and **reads our Supabase and CRM**. → we expose a read-only, curated data layer; they pull.
- **Crisp** is a chat tool; an API may be given later so we can read chats and judge sentiment — same idea as reading WhatsApp replies, just more chat data.
- **Both**: a sidebar page the boss can open himself **and** data the Hub can read.
- **WhatsApp stays manual** (sent by the host via wa.me). No WhatsApp Business API for sending.

## Gap review
| # | Requirement | Status | Have | Missing |
|---|---|---|---|---|
| 1 | Segmentation (lifecycle + value + behaviour + preference) | partial | status, 90-day value band (v_vip_priority), deposit style/segment + ROI class, game type (v_vip_auto_profile) | one combined segment label + overview page |
| 2 | Churn warning (rules + AI model) | partial | status 3/7/15, v_vip_early_warning (123 VIPs, suggested action), priority | predictive model (P(churn in 7 days)) |
| 3 | Abnormal behaviour (big win / loss / withdrawal) | partial | big win/loss alerts | big withdrawal (max 7d RM 202K, no alert), deposit spike/drop |
| 4 | Sentiment warning (Crisp) | missing | contact_logs.emotion_tag exists but all 1,424 = 'neutral' (default) | chat source, AI sentiment, alerts |
| 5 | 1v1 profile (birthday/family/hobbies/preferences/contact time/last 10 interactions) | partial | VIP360 profile tab (auto + manual), profile card, contact tab | family field, last-10 interaction timeline, data gaps (birthday 22%) |
| 6 | Rule-based care triggers (if-then) | partial | daily tasks, follow-up-date tasks, birthday tasks, contact closes task | rules editable by Marcus |
| 7 | Multi-channel (WA + TG + email + call tasks) | partial | WA popup with auto-log | call tasks; TG/email sending (122 emails, 5 TG on file) |
| 8 | Campaign ROI per person / campaign / channel | partial | campaign_impact (comparison group), scorecard, payouts, VIP360 all-in spending | per-channel attribution, per-person across campaigns |
| 9 | VIP manager KPI board (contacts, retention, ARPU, sentiment) | partial | contacts, retention, recall by layer, reactivation | ARPU (per currency), sentiment score, one board |
| 10 | Company-brain hookup (AI agent next-step advice) | missing | internal AI (Ask Data / VIP360, OpenAI via functions/api/chat.js), get_daily_brief(), v_vip_next_step | external read access for the Hub |

## Plan
### Phase 1 — existing data, no outside help
1. Segment overview page (lifecycle × value × behaviour × preference matrix → click to list).
2. Abnormal alerts: big withdrawal, deposit spike/drop, bet-pattern change; thresholds in crm_rules.
3. 1v1 profile: family field, "last 10 interactions" timeline (contacts, campaigns, deposits, tier changes).
4. Call tasks (task type Call, one-click log).
5. VIP manager KPI board: contacts, retention, recall by layer, ARPU (MYR/SGD separate), sentiment slot.
6. Boss sidebar page (read-only account) pulling 1–5 together.
7. Mood tag in the WA popup "Replied" step (😊 / 😐 / 😠) → first real sentiment data before Crisp.

**Phase 1 done 2026-10-24** (all live):
1. `/segments` Player Segments — `v_vip_segments` (lifecycle × value band × deposit style × game type).
2. Money alerts — `get_money_alerts()` (big withdrawal / deposit spike / deposit drop), thresholds per tier in app_settings `big_winloss_thresholds`; Alerts page, Today banner, bell.
3. 1v1 profile — `get_vip_timeline()` (last 10 interactions), `vip_profiles.family_tags/family_notes`, `mask_long_numbers()` masks 7+ digit runs (also on v_vip_auto_profile notes).
4. Call tasks — task_type 'Call', CallLogModal, close trigger includes Call, unreachable VIPs get Call tasks in `generate_daily_tasks`.
5. `/manager-kpi` — `get_manager_kpi(month)` (contacts, coverage, reply, retention, recall, ARPU per currency, daily tasks) + `get_sentiment_kpi(month)`.
6. `/exec` Executive Overview (read-only, sidebar group "Management"); boss account still to be created by Marcus in Manage Users (readonly + exec, segments, manager-kpi, alerts, host-performance, vips).
7. Mood tags — `contact_logs.emotion_tag` (default now NULL = not rated; old 1,436 default 'neutral' reset to NULL), MoodPicker in WA popup (after Replied) and call log (after Answered).

### Phase 2 — needs Marcus's rules
8. Editable care rules (if conditions → task/template), evaluated daily in the DB.
9. AI churn model: daily P(churn in 7 days) per VIP beside the rule status.
10. Per-channel / per-person campaign ROI (log channel on every contact).
11. Telegram bot / email (optional; few contacts on file).

### Phase 3 — outside access
12. **Hub read access (company brain).** Build a dedicated `brain` schema of curated, documented views (daily brief, VIP profile + segment, status + next step, alerts, KPI, campaign ROI) — no full IC, no bank numbers, phones masked. Give the Hub its own read-only credential limited to that schema (a Postgres role for direct DB, or a PostgREST/JWT role, or a key-protected `/api/brain/*` endpoint — pick when we know the Hub's tech). Never hand out the service-role key.
13. **Crisp sentiment.** Generic `chat_messages` table (source = crisp | whatsapp_manual | …) + daily AI sentiment per message/VIP → alerts + KPI sentiment score. Needs: Crisp API token, and how a Crisp contact maps to a username. Personal WhatsApp chats can't be read automatically (sent from phones); WA sentiment comes from the host's mood tag (item 7) unless WhatsApp Business API is added later.

## Open questions
- Hub tech: direct Postgres connection, REST, or our API? Who on their side holds the credential?
- Crisp: API token owner; field that identifies the player (email / nickname / custom data = username?).
