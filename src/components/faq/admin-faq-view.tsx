import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function FaqSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">{children}</CardContent>
    </Card>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function AdminFaqView() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <FaqSection title="What is Case Tracker?" description="A forecasting and workflow layer on top of DocketFlow.">
        <p>
          DocketFlow owns case identity (client, case #, assignments). Case Tracker owns pipeline forecasting,
          settlement workflow, attorney-entered fields, Slack automation, and firm output reporting.
        </p>
        <p>Attorneys and paralegals update cases in the tracker. Admins configure goals, sheet sync, and integrations in Settings.</p>
      </FaqSection>

      <FaqSection title="App pages">
        <BulletList
          items={[
            "Dashboard — firm snapshot, Case Tracker Score rollups, cases needing check-ins.",
            "Cases — active pipeline; inline edit attorney fields, stages, and minimum value.",
            "Results — disbursed cases; result quarter and fees come from the settlements sheet.",
            "Output — firm fee/gross progress vs attorney goals for the commission year.",
            "Goals — per-attorney quarterly fee targets and commission-year performance tables.",
            "Settings — admin only: CSV backfill, Google Sheet sync, goals, score explainer.",
          ]}
        />
      </FaqSection>

      <FaqSection title="Two kinds of data">
        <p className="font-medium text-navy-950">From DocketFlow (read-only in tracker)</p>
        <BulletList items={["Case #, client name, attorney, paralegal, date signed, date of incident, case type."]} />
        <p className="font-medium text-navy-950">Entered in Case Tracker (attorney / admin)</p>
        <BulletList
          items={[
            "Liability, expected disbursement quarter, minimum value, policy limits, expected lit, referral fee.",
            "Sources, injuries, description — optional, no scheduled reminders.",
            "Settlement results — mostly auto-filled from the RJL Cases Disbursing Google Sheet.",
          ]}
        />
      </FaqSection>

      <FaqSection title="Expected disbursement quarter vs result quarter">
        <BulletList
          items={[
            "Expected disbursement quarter — attorney forecast of when the case will disburse; confirmed every 90 days via Slack or the app.",
            "Result quarter — actual quarter from the disburse date on the settlements sheet; read-only on Results.",
          ]}
        />
      </FaqSection>

      <FaqSection title="Case Tracker Score (0–100%)">
        <BulletList
          items={[
            "40% completeness — eight fields filled in (case type, liability, quarter, minimum, referral fee, policy limits, expected lit, sources).",
            "60% freshness — liability (only when Pending), quarter, minimum, and policy limits confirmed within 90 days.",
            "Shown on each case, cases table, and dashboard attorney rollups.",
          ]}
        />
      </FaqSection>

      <FaqSection title="Case stages — what updates automatically">
        <BulletList
          items={[
            "Onboarding — default when a case is created / signed.",
            "Treatment — auto-promoted 10+ days after date signed.",
            "Settled — auto when a settlement date appears on the disbursing sheet.",
            "Disbursed — not a stage; result fields (disburse date, fees) update from the sheet. Case stays Settled.",
            "Demand, Lit, Disengaged, Terminated, Referred — suggested from #daily-pulse; attorney confirms in the case Slack channel (✅ or thread reply).",
          ]}
        />
      </FaqSection>

      <FaqSection title="Slack — daily cron (13:00 UTC ≈ 8 AM Central)">
        <p>One cron job (`/api/cron/slack-reminders`) runs sheet sync, stage workflow, and field reminders.</p>
        <p className="font-medium text-navy-950">Per-field reminders (one post per field)</p>
        <BulletList
          items={[
            "Liability — only when value is Pending; every 90 days.",
            "Expected disbursement quarter, minimum value, policy limits — every 90 days.",
            "Expected lit — every 90 days unless the case is or was Litigation (then locked to Lit).",
            "Each post shows Case Tracker Score and which fields still need attention.",
            "Attorney confirms with ✅ or replies confirmed / yes, or posts an update (e.g. Minimum: 85000).",
          ]}
        />
        <p className="font-medium text-navy-950">Stage confirmations</p>
        <p>
          Pulse recap in #daily-pulse is parsed; the bot posts in each case channel. Thread reply or ✅ updates the
          tracker.
        </p>
        <p>Full setup details are in `docs/SLACK_SETUP.md` in the repo (Slack scopes, env vars, migrations 017 and 018).</p>
      </FaqSection>

      <FaqSection title="Google Sheets sync">
        <BulletList
          items={[
            "Client Contact Status (Sheet1) — maps case # → Slack channel, date signed, sheet status. Synced daily and via Settings → Sync now.",
            "RJL Cases Disbursing — settlement dates, disburse dates, fees, multi-party disbursements. Drives Results tab and auto-Settled stage.",
          ]}
        />
        <p>Requires service account env vars (see Settings cards and .env.example).</p>
      </FaqSection>

      <FaqSection title="Commission year & goals">
        <BulletList
          items={[
            "Each attorney has a commission year start month (Settings / user roles).",
            "Goals tab holds quarterly fee targets for that commission year.",
            "Output and Goals performance tables count disbursed fees in the attorney's commission year only.",
          ]}
        />
      </FaqSection>

      <FaqSection title="Admin checklist">
        <BulletList
          items={[
            "Run SQL migrations in supabase/sql through 018 in Supabase SQL editor.",
            "Set Vercel env: Supabase, Google Sheets, Slack, CRON_SECRET, NEXT_PUBLIC_SITE_URL.",
            "Install Slack app scopes (chat:write, channels:history, reactions:read, etc.) and event subscriptions.",
            "Map cases to Slack channels via the Client Contact Status sheet.",
            "Set attorney goals in Settings; attorneys confirm fields via Slack or the case detail page.",
          ]}
        />
      </FaqSection>
    </div>
  );
}
