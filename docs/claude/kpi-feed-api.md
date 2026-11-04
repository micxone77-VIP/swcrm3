# VIP KPI score: guide for the hub

Read-only link that returns the final monthly VIP KPI score.

## Request

```
GET https://utopskwciorvooronpwg.supabase.co/functions/v1/kpi-feed?month=2026-11
x-api-key: <your key>
```

- `month` is optional (`YYYY-MM`). Without it you get the latest month.
- `Authorization: Bearer <your key>` also works instead of `x-api-key`.
- Call it from your server when the user clicks Update. Do not put the key in the link or in a browser page.
- Allow at least 60 seconds before timing out. Most calls take under a second, some take several seconds.

## Answer

```json
{ "ok": true, "month": "2026-11", "score": 65.4, "updated_at": "2026-11-04T04:35:00.548Z" }
```

| Field | Meaning |
|---|---|
| `month` | The month of this score |
| `score` | Final score out of 100. `null` = no score available yet |
| `updated_at` | When this score was last updated (UTC) |

## Errors

| HTTP | `error` | Meaning |
|---|---|---|
| 401 | `unauthorized` | Key missing or wrong |
| 400 | `month_format` | Month is not `YYYY-MM` |
| 404 | `no_data_for_month` | No score for that month |
| 503 | `calculation_failed` / `no_data` | Temporary problem, try again later |
| 500 | `server` | Server problem, try again later |
