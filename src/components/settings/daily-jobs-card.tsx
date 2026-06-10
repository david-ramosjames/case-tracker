"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { type DailyJobStep } from "@/lib/cron/daily-jobs";

type JobRow = {
  step: DailyJobStep;
  title: string;
  description: string;
};

const JOB_ROWS: JobRow[] = [
  {
    step: "sheetSync",
    title: "Slack channels sheet",
    description: "Client Contact Status → case channel mappings and Date Signed.",
  },
  {
    step: "settlementSync",
    title: "Settlements sheet",
    description: "RJL Cases Disbursing → disbursements, settlement fields, auto-Settled stages.",
  },
  {
    step: "treatmentPromotion",
    title: "Treatment promotion",
    description: "Move Onboarding cases to Treatment after 10+ days.",
  },
  {
    step: "dailyPulse",
    title: "Daily pulse recap",
    description: "Parse #daily-pulse and post stage confirmation threads.",
  },
  {
    step: "fieldReminders",
    title: "Field reminders",
    description: "Post one Slack reminder per overdue tracked field (Case Tracker Score fields).",
  },
];

function formatJobResult(step: DailyJobStep, body: Record<string, unknown>): string {
  if (!body.ok && body.error) return String(body.error);

  if (step === "all") {
    const parts: string[] = [];
    const sheetSync = body.sheetSync as { synced?: number; configured?: boolean } | undefined;
    if (sheetSync?.configured) parts.push(`${sheetSync.synced ?? 0} channel row(s) synced`);
    const settlementSync = body.settlementSync as { disbursementsSynced?: number; stagesAutoSettled?: number } | undefined;
    if (settlementSync) {
      parts.push(
        `${settlementSync.disbursementsSynced ?? 0} disbursement row(s), ${settlementSync.stagesAutoSettled ?? 0} auto-settled`,
      );
    }
    const stageWorkflow = body.stageWorkflow as
      | { treatment?: { promoted?: number }; pulse?: { posted?: number; processed?: number } }
      | undefined;
    if (stageWorkflow?.treatment) {
      parts.push(`${stageWorkflow.treatment.promoted ?? 0} promoted to Treatment`);
    }
    if (stageWorkflow?.pulse) {
      parts.push(`${stageWorkflow.pulse.posted ?? 0} pulse confirmation(s) posted`);
    }
    const fieldReminders = body.fieldReminders as { posted?: number; fields?: number } | undefined;
    if (fieldReminders) {
      parts.push(`${fieldReminders.posted ?? 0} field reminder(s) (${fieldReminders.fields ?? 0} fields)`);
    }
    const errors = body.errors as { step: string; error: string }[] | undefined;
    if (errors?.length) {
      parts.push(`Errors: ${errors.map((entry) => `${entry.step}: ${entry.error}`).join("; ")}`);
    }
    return parts.length > 0 ? parts.join(". ") + "." : "Completed.";
  }

  const result = body.result as Record<string, unknown> | undefined;

  if (step === "sheetSync" && result) {
    const duplicateNote =
      result.duplicatesRemoved && Number(result.duplicatesRemoved) > 0
        ? ` (${result.duplicatesRemoved} duplicate sheet rows collapsed.)`
        : "";
    const dateSignedNote =
      result.dateSignedUpdated && Number(result.dateSignedUpdated) > 0
        ? ` Updated Date Signed on ${result.dateSignedUpdated} case(s).`
        : "";
    if (!result.configured) return "Google Sheets channel sync is not configured.";
    return `Imported ${result.synced ?? 0} channel mapping(s).${duplicateNote}${dateSignedNote}`;
  }

  if (step === "settlementSync" && result) {
    if (!result.configured) return "Google Sheets settlement sync is not configured.";
    const skippedNote =
      result.skippedNoTracker && Number(result.skippedNoTracker) > 0
        ? ` ${result.skippedNoTracker} sheet case(s) had no tracker row.`
        : "";
    return `Synced ${result.disbursementsSynced ?? 0} disbursement row(s) across ${result.casesProcessed ?? 0} case(s). Updated ${result.settlementsUpdated ?? 0} settlement field(s). Auto-settled ${result.stagesAutoSettled ?? 0} case(s).${skippedNote}`;
  }

  if (step === "treatmentPromotion" && result) {
    return `Promoted ${result.promoted ?? 0} of ${result.eligible ?? 0} eligible case(s) to Treatment.`;
  }

  if (step === "dailyPulse" && result) {
    if (result.reason === "slack_disabled") return "Slack is not enabled.";
    if (result.reason === "no_pulse_channel") return "SLACK_DAILY_PULSE_CHANNEL_ID is not set.";
    if (result.reason === "pulse_history_failed") {
      return `Could not read pulse channel: ${result.error ?? "unknown error"}.`;
    }
    const summary = `Processed ${result.processed ?? 0} pulse item(s), posted ${result.posted ?? 0} confirmation(s), skipped ${result.skipped ?? 0}.`;
    if ((result.processed ?? 0) === 0) {
      const scanned = result.messagesScanned ?? 0;
      const found = result.pulseMessagesFound ?? 0;
      const lookback = result.lookbackHours ?? 48;
      if (scanned === 0) {
        return `${summary} No messages in #daily-pulse for the last ${lookback}h — check SLACK_DAILY_PULSE_CHANNEL_ID.`;
      }
      if (found === 0) {
        return `${summary} Scanned ${scanned} message(s) in the last ${lookback}h but none matched the Pulse recap format.`;
      }
    }
    return summary;
  }

  if (step === "fieldReminders" && result) {
    const filter = body.filter as { caseNumber?: string } | null | undefined;
    const scope = filter?.caseNumber ? ` for case ${filter.caseNumber}` : "";
    return `Posted ${result.posted ?? 0} reminder(s)${scope} (${result.fields ?? 0} fields, ${result.skipped ?? 0} cases skipped).`;
  }

  return "Completed.";
}

export function DailyJobsCard() {
  const [activeStep, setActiveStep] = useState<DailyJobStep | null>(null);
  const [caseNumber, setCaseNumber] = useState("");
  const [messages, setMessages] = useState<Partial<Record<DailyJobStep, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<DailyJobStep, string>>>({});

  async function runStep(step: DailyJobStep) {
    setActiveStep(step);
    setMessages((prev) => ({ ...prev, [step]: undefined }));
    setErrors((prev) => ({ ...prev, [step]: undefined }));

    try {
      const response = await fetch("/api/admin/daily-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step,
          force: true,
          caseNumber: step === "fieldReminders" || step === "all" ? caseNumber.trim() || undefined : undefined,
        }),
      });

      const body = (await response.json()) as Record<string, unknown> & { error?: string };
      if (!response.ok && body.error && !body.step) {
        throw new Error(body.error);
      }

      const message = formatJobResult(step, body);
      if (body.ok === false) {
        setErrors((prev) => ({ ...prev, [step]: message }));
      } else {
        setMessages((prev) => ({ ...prev, [step]: message }));
      }
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [step]: err instanceof Error ? err.message : "Job failed.",
      }));
    } finally {
      setActiveStep(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily cron jobs</CardTitle>
        <CardDescription>
          Manual triggers for each step in the 9:00 AM Central cron (`/api/cron/slack-reminders`). Sheet sync cards above
          use the same imports; use these to run stage workflow and field reminders on demand.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
          <label className="min-w-[12rem] flex-1">
            <span className="mb-1 block text-sm font-medium text-navy-950">Case # (optional)</span>
            <Input
              value={caseNumber}
              onChange={(event) => setCaseNumber(event.target.value)}
              placeholder="Limit field reminders to one case"
            />
          </label>
          <Button
            variant="default"
            disabled={activeStep !== null}
            onClick={() => void runStep("all")}
          >
            {activeStep === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Run full daily job
          </Button>
        </div>

        <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
          {JOB_ROWS.map((row) => (
            <li key={row.step} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-navy-950">{row.title}</p>
                <p className="text-sm text-muted-foreground">{row.description}</p>
                {messages[row.step] ? <p className="mt-1 text-sm text-emerald-700">{messages[row.step]}</p> : null}
                {errors[row.step] ? <p className="mt-1 text-sm text-rose-700">{errors[row.step]}</p> : null}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={activeStep !== null}
                onClick={() => void runStep(row.step)}
              >
                {activeStep === row.step ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Run
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
