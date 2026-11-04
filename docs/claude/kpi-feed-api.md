# VIP KPI score: guide for the hub

Read-only link that returns the final monthly VIP KPI score and the 4 KPI totals. No player names or lists.

## Request

```
GET https://utopskwciorvooronpwg.supabase.co/functions/v1/kpi-feed?month=2026-11
x-api-key: <your key>
```

- `month` is optional (`YYYY-MM`). Without it you get the latest month.
- `Authorization: Bearer <your key>` also works instead of `x-api-key`.
- Call it from your server when the user clicks Update. Do not put the key in the link or in a browser page.
- Allow at least 60 seconds before timing out. Most calls take under a second, some take several seconds.
- Numbers change after each daily import.

## Answer

```json
{
  "ok": true,
  "month": "2026-11",
  "score": 65.4,
  "updated_at": "2026-11-04T05:10:00.000Z",
  "is_complete": false,
  "month_status": "in_progress",
  "data_through": "2026-11-03",
  "items": [
    { "key": "retention_rate", "label": "① VIP 月留存率", "weight": 20, "actual": 55.6, "target": 85, "excellent": null, "unit": "%", "is_scored": true, "score": 65.4,
      "detail": { "kept": 178, "base": 320, "by_currency": [{ "currency": "MYR", "base": 307, "kept": 173 }, { "currency": "SGD", "base": 13, "kept": 5 }] } },
    { "key": "ngr_total", "label": "② VIP 月 NGR 总额", "weight": 20, "actual": 215473.04, "target": null, "excellent": null, "unit": "RM", "is_scored": false, "score": null, "note": "...",
      "detail": { "source": "daily_import", "myr": { "currency": "MYR", "ngr": 215473.04, "ngr_before_offline": 215473.04, "offline": 0, "players": 236 }, "sgd": { "currency": "SGD", "ngr": 27083.16, "ngr_before_offline": 27083.16, "offline": 0, "players": 7 }, "target_sgd": null } },
    { "key": "churn_recovery", "label": "③ 流失 VIP 挽回数", "weight": 30, "actual": 6, "target": null, "excellent": null, "unit": "人", "is_scored": false, "score": null, "note": "...",
      "detail": { "recovered_count": 6, "came_back_count": 29, "recovery_amount_rm": 0, "recovery_amount_sgd": 0 } },
    { "key": "vip_turnover", "label": "④ VIP 月有效流水", "weight": 30, "actual": 12345678.9, "target": null, "excellent": null, "unit": "RM", "is_scored": false, "score": null, "note": "...",
      "detail": { "source": "daily_import", "myr": { "currency": "MYR", "turnover": 12345678.9, "players": 60 }, "sgd": { "currency": "SGD", "turnover": 123456.7, "players": 2 }, "target_sgd": null } }
  ]
}
```

The figures above are an example. Always read them from the answer.

## Fields

| Field | Meaning |
|---|---|
| `score` | Final score out of 100, from the CRM. `null` = no score yet |
| `is_complete` | `false` = not all 4 KPIs are in the score yet |
| `month_status` | `in_progress` = month not finished, numbers will still move. `ended` = month is over |
| `data_through` | Latest daily data these numbers include |
| `items[].key` | Stable ID: `retention_rate`, `ngr_total`, `churn_recovery`, `vip_turnover` |
| `items[].weight` | Weight in % |
| `items[].actual` | Actual figure. `null` = not available yet |
| `items[].target` | Target. `null` = not set yet |
| `items[].excellent` | Always `null` for now: the CRM has no "excellent" level |
| `items[].is_scored` | `true` = counted in `score`. `false` = display only |
| `items[].score` | KPI score, 0 to 100 (the CRM caps it at 100). `null` when not scored |

The total follows your formula: sum(weight × score) / sum(weight), using only items with `is_scored = true`. Small rounding differences of 0.1 are possible, so use the top-level `score` as the final figure.

## Important

- **All 4 KPIs count Platinum, Diamond and Black only.** Gold is not included. A player's tier is the one they had in that month.
- **② NGR already has offline spending deducted.** Do not deduct offline costs from it again. `detail.myr.ngr_before_offline` and `detail.myr.offline` show the two parts (same for `sgd`).
- **② `actual` is MYR only.** SGD is a different platform and is in `detail.sgd`. Never add the two together.
- **② `detail.source`:** `provider_report` = full-month provider report. `daily_import` = daily data, some bets may be missing.
- **③ `recovery_amount_*`** = deposits by recovered players from the day they came back to the end of the month.
- **③ `came_back_count`** = VIPs who came back after 7+ days without a deposit, with or without contact. Only those a host contacted in the 14 days before count as recovered.
- **④ `vip_turnover`** = total valid bets this month, higher is better. `actual` is MYR only; SGD is in `detail.sgd`. Never add the two together. It replaced `new_promotion`, which is no longer sent. `detail.source` works the same as in ②.
- A finished month can still change, for example when the provider report arrives.

## Errors

| HTTP | `error` | Meaning |
|---|---|---|
| 401 | `unauthorized` | Key missing or wrong |
| 400 | `month_format` | Month is not `YYYY-MM` |
| 404 | `no_data_for_month` | No score for that month |
| 503 | `calculation_failed` / `no_data` | Temporary problem, try again later |
| 500 | `server` | Server problem, try again later |
