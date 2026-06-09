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
2. Run migrations `013_case_disbursements.sql` and `014_disbursement_pending_remaining.sql` in Supabase.

## Sync

- **Settings → Import settlements sheet** (manual)
- **Daily cron** with Slack sheet sync

Cases must already exist in the tracker (matched by Case #).

## Case detail

Shows total rows per case, per-slot status (awaiting vs disbursed), disburse date, and weighted fee share when column Z is set.
