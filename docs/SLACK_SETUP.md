# Slack integration

The case tracker can notify each case’s Slack channel for reviews, missing fields, comments, and stage changes.

## 1. Run database migration

Apply `supabase/sql/006_slack_integration.sql` in the Supabase SQL editor.

## 2. Create a Slack app

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → From scratch.
2. **OAuth & Permissions** → Bot Token Scopes:
   - `chat:write`
   - `channels:read`
   - `channels:join` (auto-join **public** case channels before posting)
   - `channels:history` (read `#daily-pulse` recaps)
   - `groups:read`
   - `groups:history` (if `#daily-pulse` or case channels are **private**)
   - `groups:write` (if case channels are **private** — required to post)
   - `reactions:read` (✅ confirmations on stage prompts)
   - `users:read` (resolve `@Ryan`-style topic mentions to user IDs)
   - `users:read.email` (fallback: tag attorney/paralegal by DocketFlow email when topic has no mentions)
3. Install to workspace and copy **Bot User OAuth Token** → `SLACK_BOT_TOKEN`.
4. **Basic Information** → copy **Signing Secret** → `SLACK_SIGNING_SECRET`.
5. Set `NEXT_PUBLIC_SLACK_WORKSPACE_URL` to your workspace URL (e.g. `https://ramosjameslaw.slack.com`) so case detail pages show **Open in Slack** links.

## 3. Event Subscriptions (thread replies)

1. Enable **Event Subscriptions**.
2. Request URL: `https://YOUR_DOMAIN/api/slack/events` (e.g. `https://rjl-case-tracker.vercel.app/api/slack/events`)
3. Set `SLACK_SIGNING_SECRET` on your host (Vercel → Environment Variables) and redeploy before clicking **Retry**.
4. Subscribe to bot events:
   - `message.channels` (and `message.groups` if private case channels)
   - `reaction_added` (stage confirmation ✅)
5. Reinstall the app if prompted.

If verification fails with “didn't respond with the challenge”, the app was likely redirecting Slack to `/login` — ensure the latest deploy includes the public `/api/slack/*` middleware exception.

Thread replies on reminder messages can update the tracker using lines like:

```text
Expected disbursement quarter: 2026 Q3
Minimum: 75000
Sources: Updated treatment plan...
```

## 4. Case channel mapping (Google Sheet only — no manual entry)

**You never type Slack channels into the case tracker.** The app reads your existing Google Sheet and stores Case # → channel name, Slack channel ID, optional Status, and **Date Signed** (from column H).

**Client Contact Status** workbook, tab **Sheet1** (default range `Sheet1!A:H`):

| A Slack Channel | B Case No | C Case | D Lead Attorney | E Paralegal | F Status | G Slack Channel ID | H Date Created |
|-----------------|-----------|--------|-----------------|-------------|----------|---------------------|----------------|
| jessicagutierrez-153 | 153 | Jessicagutierrez | Eric Cuellar | Giselle | Litigation | C0123456789 | 11/30/2018 |

Sync uses **Slack Channel** (A), **Case No** (B), **Status** (F), **Slack Channel ID** (G), and **Date Created** (H) as the tracker’s Date Signed. Column H accepts `MM/DD/YYYY` or timestamps (e.g. `7/1/2019 9:51:15`). Dates are written to `case_tracker_entries.date_signed_override` and take precedence over DocketFlow `created_at`. IDs are stored in Supabase (`case_slack_channels`); posting and reminders read from the database only — not the sheet or Slack channel list on each save. Re-import when the sheet changes. Client name and attorney/paralegal columns are ignored for mapping.

Set env vars:

```env
GOOGLE_SHEETS_SPREADSHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEETS_CHANNEL_RANGE=Sheet1!A:H
```

1. Create a [Google Cloud service account](https://cloud.google.com/iam/docs/service-account-create) with no extra roles.
2. Create a JSON key; put `client_email` and `private_key` in env (see above).
3. Share the spreadsheet with the service account email as **Viewer**.

**Automatic sync:** the daily cron (below) pulls the sheet before sending reminders.

**Manual refresh (optional):** Settings → **Sync now from Google Sheet**, or:

```bash
curl -X POST https://YOUR_DOMAIN/api/slack/sync-channels \
  -H "Cookie: <admin session>"
```

When you add a new case row to the sheet, the next cron run (or Sync now) picks it up.

## 5. Scheduled sync + field reminders (9 AM Central)

`vercel.json` defines **one cron job** (`/api/cron/slack-reminders` at **14:00 UTC** ≈ 9 AM Central during daylight saving). The route checks `America/Chicago` so only the 9 AM hour runs. In standard time (CST), change the schedule to `0 15 * * *` in `vercel.json`.

Set `CRON_SECRET` in Vercel env (Vercel cron sends `Authorization: Bearer CRON_SECRET` automatically).

Manual run:

```bash
curl "https://YOUR_DOMAIN/api/cron/slack-reminders" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

**Test one case** (bypasses 9 AM window and field cooldown):

```bash
curl "https://YOUR_DOMAIN/api/cron/slack-reminders?caseNumber=99999&force=true&syncSheet=false" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Set `NEXT_PUBLIC_SITE_URL=https://YOUR_DOMAIN` on Vercel (then redeploy) so Slack messages use production links, not `localhost`.

Response includes `sheetSync`, `settlementSync`, `stageWorkflow`, and `fieldReminders: { posted, skipped, fields }`.

**Channel topics:** the app does **not** change Slack channel topics (Attorney/Paralegal mentions stay as you set them in Slack).

### Per-field attorney reminders

Apply `supabase/sql/018_field_reminder_workflow.sql`.

Each overdue field gets **its own Slack post** in the case channel (not one bundled message). Every post includes the **Case Tracker Score** and which fields still need attention.

**No Slack reminders** for Sources, Injuries, Description, or Referral fee (optional / set-once fields).

| Field | Reminder rule |
|-------|----------------|
| **Liability** | Only when value is `Pending` — confirm every 90 days |
| **Expected disbursement quarter** | When you expect the case to disburse — missing or not confirmed in 90 days |
| **Minimum value** | Missing or not confirmed in 90 days |
| **Policy limits** | Missing or not confirmed in 90 days |
| **Expected lit** | Confirm every 90 days unless case is/was **Litigation** (then auto-set to Lit, no prompts) |

**Confirm unchanged:** react ✅ or reply `confirmed` / `yes` in the thread.

**Update value:** reply in thread, e.g. `Expected disbursement quarter: Q3-26` (or shorthand `Quarter: Q3-26`), `Minimum: 85000`, `Liability: Accepted 100%`, `Policy limits: 100000`, `Expected lit: Pre-lit`. The bot confirms what was saved.

**Result quarter** on the Results tab is separate — it is auto-set from the actual disburse date on the settlements sheet.

Field posts respect a **3-day cooldown** per field (`FIELD_REMINDER_COOLDOWN_DAYS`) so the same field is not reposted daily while waiting for a reply.

## 6. Stage confirmation workflow (#daily-pulse)

Apply `supabase/sql/017_stage_confirmation_workflow.sql` in the Supabase SQL editor.

The daily cron (after sheet sync) also:

1. **Auto-promotes** Onboarding → Treatment (`Txt`) when date signed is 10+ days ago
2. **Auto-sets Settled** when the disbursing spreadsheet has a settlement date (disburse dates update result fields only — there is no separate “Disbursed” stage)
3. **Reads `#daily-pulse`** for Pulse recaps and posts a confirmation prompt in each mapped case channel

Set either:

```env
SLACK_DAILY_PULSE_CHANNEL_ID=C0123456789
```

or resolve by name (default `daily-pulse`):

```env
SLACK_DAILY_PULSE_CHANNEL_NAME=daily-pulse
```

Non-case channels in the recap (e.g. `#lead-calls`) are ignored. Add more with `SLACK_PULSE_IGNORED_CHANNELS=lead-calls,other-channel` (comma-separated).

**Pulse format** (example):

```text
Pulse — Potential case status changes

#abelperez-835 → Settled
(medium confidence) (*release signed*)
"Release was signed yesterday" — …
```

The bot posts in `#abelperez-835` (tags attorney/paralegal from the channel topic when set):

> @Jesus @Adrian Bot suggests case status is: Settled (high confidence)  
> Reply with ✅, `confirmed`, or `Stage: Demand`.

**Bot must be in each case channel.** Public channels: the app auto-joins when `channels:join` is granted. **Private case channels** (most firms): in each channel run `/invite @Case Tracker` once (same as you did for `#daily-pulse`). Without this, posts fail with `not_in_channel`.

Confirm in the **thread** (or react ✅ on the bot message). The tracker updates and the bot replies `Updated case tracker: Settled.`

Pending suggestions also appear on the case detail page (Confirm / Dismiss persists to the database).

**Reprocess pulse** (ignore cursor):

```bash
curl "https://YOUR_DOMAIN/api/cron/slack-reminders?force=true&syncSheet=false" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## What triggers Slack

| Trigger | Channel message |
|--------|------------------|
| Overdue attorney field (liability, quarter, minimum, policy limits, expected lit) | One Slack post per field with score + options |
| ✅ / thread reply on field post | Confirms or updates tracker |
| Case stage saved | Short message in channel |
| `#daily-pulse` recap item | Confirmation prompt in case channel |
| ✅ / thread reply on stage prompt | Tracker stage updated |
| Sources & Litigation saved | Confirmation message |
| Comment / Manager note / Attorney update posted | Full note text |

Client, attorney, and paralegal are never changed from Slack.
