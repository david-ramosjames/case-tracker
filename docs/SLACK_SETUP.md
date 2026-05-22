# Slack integration

The case tracker can notify each case’s Slack channel for reviews, missing fields, comments, and stage changes.

## 1. Run database migration

Apply `supabase/sql/006_slack_integration.sql` in the Supabase SQL editor.

## 2. Create a Slack app

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → From scratch.
2. **OAuth & Permissions** → Bot Token Scopes:
   - `chat:write`
   - `channels:read`
   - `groups:read`
   - `groups:write` (if case channels are **private** — required to post)
3. Install to workspace and copy **Bot User OAuth Token** → `SLACK_BOT_TOKEN`.
4. **Basic Information** → copy **Signing Secret** → `SLACK_SIGNING_SECRET`.
5. Set `NEXT_PUBLIC_SLACK_WORKSPACE_URL` to your workspace URL (e.g. `https://ramosjameslaw.slack.com`) so case detail pages show **Open in Slack** links.

## 3. Event Subscriptions (thread replies)

1. Enable **Event Subscriptions**.
2. Request URL: `https://YOUR_DOMAIN/api/slack/events` (e.g. `https://rjl-case-tracker.vercel.app/api/slack/events`)
3. Set `SLACK_SIGNING_SECRET` on your host (Vercel → Environment Variables) and redeploy before clicking **Retry**.
4. Subscribe to bot event: `message.channels` (and `message.groups` if private case channels).
5. Reinstall the app if prompted.

If verification fails with “didn't respond with the challenge”, the app was likely redirecting Slack to `/login` — ensure the latest deploy includes the public `/api/slack/*` middleware exception.

Thread replies on reminder messages can update the tracker using lines like:

```text
Quarter: 2026 Q3
Minimum: 75000
Sources: Updated treatment plan...
```

## 4. Case channel mapping (Google Sheet only — no manual entry)

**You never type Slack channels into the case tracker.** The app reads your existing Google Sheet and stores Case # → channel name, Slack channel ID, and optional Status.

**Client Contact Status** workbook, tab **Sheet1** (default range `Sheet1!A:H`):

| A Slack Channel | B Case No | C Case | D Lead Attorney | E Paralegal | F Status | G Slack Channel ID |
|-----------------|-----------|--------|-----------------|-------------|----------|---------------------|
| jessicagutierrez-153 | 153 | Jessicagutierrez | Eric Cuellar | Giselle | Litigation | C0123456789 |

Sync uses **Slack Channel** (A), **Case No** (B), **Status** (F), and **Slack Channel ID** (G). IDs are stored in Supabase (`case_slack_channels`); posting and reminders read from the database only — not the sheet or Slack channel list on each save. Re-import when the sheet changes. Client name and attorney/paralegal columns are ignored for mapping.

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

## 5. Scheduled sync + reminders

One cron job syncs the sheet and sends reminders:

```bash
curl "https://YOUR_DOMAIN/api/cron/slack-reminders" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

**Test one case** (bypasses reminder rules and cooldown; sends even if fields are complete):

```bash
curl "https://YOUR_DOMAIN/api/cron/slack-reminders?caseNumber=99999&force=true&syncSheet=false" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Set `NEXT_PUBLIC_SITE_URL=https://YOUR_DOMAIN` on Vercel (then redeploy) so Slack messages use production links, not `localhost`.

Response includes `sheetSync: { synced, configured }` and `reminders: { sent, skipped }`.

**Channel topics:** the app does **not** change Slack channel topics (Attorney/Paralegal mentions stay as you set them in Slack).

Set `CRON_SECRET` in env. Optional: `SLACK_REMINDER_COOLDOWN_DAYS=3` (default) to avoid spamming the same case.

## What triggers Slack

| Trigger | Channel message |
|--------|------------------|
| 90-day review / missing quarter, minimum, or stale Sources & Lit | Reminder + thread template |
| Other missing required fields | Included in reminder |
| Case stage saved | Short message in channel |
| Sources & Litigation saved | Confirmation message |
| Comment / Manager note / Attorney update posted | Full note text |

Client, attorney, and paralegal are never changed from Slack.
