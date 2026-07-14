# RJL Cases Disbursing — Google Sheet sync

The tracker imports **settlement date**, **disburse dates**, and **multi-disbursement weighting** from the **RJL Cases Disbursing** workbook (separate from Client Contact Status / Slack).

## How rows work (disbursement parties within one case)

- **One case #** in the tracker — same forecast, attorney, Slack channel, etc.
- **Each sheet row** = one disbursement **party** (e.g. parent + minor). Column D names the party — often not the firm’s primary client.
- **Attorney sets expected parties** on the case (Results → Disbursement parties) before the sheet row exists; sync matches by Case #.
- **Commission weight** = **1 ÷ max(attorney expected, sheet rows)** per party.
- **Column B** = filled while that party is still waiting; **blank** once disbursed.
- **Column Z** = Date Disbursed (commission year/quarter).

## Sheet columns

| Column | Field |
|--------|--------|
| B | Count — filled while pending, **blank when disbursed** |
| C | Case # |
| D | Client / party name (e.g. minor) |
| G | Full Settlement — **Y** when the case has a full settlement (stage → Settled when column H is also set, even if not all disbursement rows exist yet) |
| H | Settlement Date |
| J | Gross Settlement |
| K | Net Attorney Fees |
| Z | Date Disbursed |

## Environment variables

Same Google **service account** as the Slack channel sheet:

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=

GOOGLE_SHEETS_SETTLEMENT_SPREADSHEET_ID=1FxPc2lu6eCFqFw-lDGSc0NChEFq531-yApvTcovwH2M
GOOGLE_SHEETS_SETTLEMENT_RANGE=RJL Cases Disbursing!A:Z
```

Use your tab name in `GOOGLE_SHEETS_SETTLEMENT_RANGE` (the workbook title is often the tab name).

1. Share the spreadsheet with the service account email as **Viewer**.
2. Run migrations `013` through `015` and `019_disbursement_sheet_row_key_unique.sql` in Supabase.

## Sync

- **Settings → Import settlements sheet** (manual)
- **Daily cron** with Slack sheet sync

Cases must already exist in the tracker (matched by Case #).

When **Settlement Date (H)** is set and **Full Settlement (G)** is **Y** on any party row for the case, the tracker sets case stage to **Settled** on sync — even when additional disbursement parties are still incomplete.

A second party row with blank G or **N** does **not** reopen the case while another row for that case still has **Y**. Sync only restores the prior stage when **no** party row has Y and at least one has an explicit **N**.

## Case detail

Shows total rows per case, per-slot status (awaiting vs disbursed), disburse date, and weighted fee share when column Z is set.
