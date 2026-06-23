"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type DailyJobStep } from "@/lib/cron/daily-jobs";
import {
  formatPulseFanOutResult,
  type PulseItemOutcome,
} from "@/lib/slack/pulse-outcomes";
import { type SettlementSheetSyncCaseDetail, filterSettlementSyncPreviewDetails } from "@/lib/google/settlements-sync";
import { type SlackSheetSyncPreviewItem } from "@/lib/google/sheets-sync";
import { type FieldReminderPreviewItem } from "@/lib/slack/field-reminder-notify";
import { type MissingFieldPreviewItem } from "@/lib/slack/missing-field-notify";
import { type TreatmentPromotionPreviewItem } from "@/lib/slack/stage-workflow";
import { cn, errorMessage, formatOptionalDate } from "@/lib/utils";

type JobRow = {
  step: DailyJobStep;
  title: string;
  description: string;
};

const FULL_JOB_STEPS: DailyJobStep[] = [
  "sheetSync",
  "settlementSync",
  "treatmentPromotion",
  "dailyPulse",
  "missingFields",
  "fieldReminders",
];

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
    step: "missingFields",
    title: "Missing fields",
    description: "One Slack post per case listing empty completeness fields (type, liability, sources, etc.).",
  },
  {
    step: "fieldReminders",
    title: "Field reminders",
    description: "Post one Slack reminder per overdue validation field (quarter, minimum, policy limits, etc.).",
  },
];

function formatJobResult(step: DailyJobStep, body: Record<string, unknown>): string {
  if (!body.ok) {
    if (body.error) return errorMessage(body.error);
    const errors = body.errors as { step: string; error: unknown }[] | undefined;
    if (errors?.length) {
      return errors.map((entry) => `${entry.step}: ${errorMessage(entry.error)}`).join("; ");
    }
  }

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
    const missingFields = body.missingFields as { posted?: number } | undefined;
    if (missingFields) {
      parts.push(`${missingFields.posted ?? 0} missing-field notice(s)`);
    }
    const fieldReminders = body.fieldReminders as { posted?: number; fields?: number } | undefined;
    if (fieldReminders) {
      parts.push(`${fieldReminders.posted ?? 0} field reminder(s) (${fieldReminders.fields ?? 0} fields)`);
    }
    const errors = body.errors as { step: string; error: unknown }[] | undefined;
    if (errors?.length) {
      parts.push(`Errors: ${errors.map((entry) => `${entry.step}: ${errorMessage(entry.error)}`).join("; ")}`);
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
      return `Could not read pulse channel: ${errorMessage(result.error) || "unknown error"}.`;
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
        const headers = Number(result.recapHeadersFound ?? 0);
        if (headers > 0) {
          return `${summary} Found ${headers} status-change recap(s) but no case lines parsed — Slack may be omitting bullet text from the API response.`;
        }
        return `${summary} Scanned ${scanned} message(s) in the last ${lookback}h but none matched the Pulse recap format.`;
      }
    }
    const skipReasons = result.skipReasons as Record<string, number> | undefined;
    if (skipReasons && Object.keys(skipReasons).length > 0 && !(result.itemOutcomes as unknown[] | undefined)?.length) {
      const detail = Object.entries(skipReasons)
        .map(([reason, count]) => `${reason.replace(/^skipped_/, "")} ${count}`)
        .join(", ");
      return `${summary} Skipped: ${detail}.`;
    }
    return summary;
  }

  if (step === "missingFields" && result) {
    const filter = body.filter as { caseNumber?: string } | null | undefined;
    const scope = filter?.caseNumber ? ` for case ${filter.caseNumber}` : "";
    return `Posted ${result.posted ?? 0} missing-field notice(s)${scope} (${result.skipped ?? 0} cases skipped).`;
  }

  if (step === "fieldReminders" && result) {
    const filter = body.filter as { caseNumber?: string } | null | undefined;
    const scope = filter?.caseNumber ? ` for case ${filter.caseNumber}` : "";
    return `Posted ${result.posted ?? 0} reminder(s)${scope} (${result.fields ?? 0} fields, ${result.skipped ?? 0} cases skipped).`;
  }

  return "Completed.";
}

function formatJobPreviewSummary(step: DailyJobStep, body: Record<string, unknown>): string {
  const result = body.result as Record<string, unknown> | undefined;
  if (!body.ok) return formatJobResult(step, body);

  if (step === "sheetSync" && result) {
    if (!result.configured) return "Preview: Google Sheets channel sync is not configured.";
    const wouldSync = result.wouldSync ?? result.synced ?? 0;
    const dateSigned = result.dateSignedWouldUpdate ?? 0;
    return `Preview: would update ${wouldSync} channel mapping(s) and ${dateSigned} Date Signed value(s). No changes saved.`;
  }

  if (step === "settlementSync" && result) {
    if (!result.configured) return "Preview: Google Sheets settlement sync is not configured.";
    return `Preview: would sync ${result.disbursementsSynced ?? 0} disbursement row(s) across ${result.casesProcessed ?? 0} case(s), update ${result.settlementsUpdated ?? 0} settlement field(s), auto-settle ${result.stagesAutoSettled ?? 0} case(s). No changes saved.`;
  }

  if (step === "treatmentPromotion" && result) {
    return `Preview: would promote ${result.eligible ?? 0} Onboarding case(s) to Treatment (${result.minimumDays ?? 10}+ days since signed). No changes saved.`;
  }

  if (step === "dailyPulse" && result) {
    const base = formatJobResult(step, body).replace(/^Processed/, "Would process").replace(/posted/, "would post");
    return base.startsWith("Preview:") ? base : `Preview: ${base}`;
  }

  if (step === "missingFields" && result) {
    const filter = body.filter as { caseNumber?: string } | null | undefined;
    const scope = filter?.caseNumber ? ` for case ${filter.caseNumber}` : "";
    return `Preview: would post ${result.posted ?? 0} missing-field notice(s)${scope} (${result.skipped ?? 0} skipped). Nothing posted.`;
  }

  if (step === "fieldReminders" && result) {
    const filter = body.filter as { caseNumber?: string } | null | undefined;
    const scope = filter?.caseNumber ? ` for case ${filter.caseNumber}` : "";
    return `Preview: would post ${result.posted ?? 0} reminder(s)${scope} (${result.fields ?? 0} fields, ${result.skipped ?? 0} skipped). Nothing posted.`;
  }

  return "Preview complete. No changes saved.";
}

function parsePulseItemOutcomes(result: Record<string, unknown> | undefined): PulseItemOutcome[] {
  if (!result?.itemOutcomes || !Array.isArray(result.itemOutcomes)) return [];
  return result.itemOutcomes as PulseItemOutcome[];
}

function PulseOutcomeTable({ outcomes, preview = false }: { outcomes: PulseItemOutcome[]; preview?: boolean }) {
  if (outcomes.length === 0) return null;

  return (
    <div className="mt-2 overflow-x-auto rounded-md border border-border/60 bg-white">
      <Table className="min-w-[52rem] text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>Channel</TableHead>
            <TableHead>Pulse</TableHead>
            <TableHead>On confirm</TableHead>
            <TableHead>Case #</TableHead>
            <TableHead>Tracker stage</TableHead>
            <TableHead>Disbursed</TableHead>
            <TableHead>{preview ? "Would" : "Result"}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {outcomes.map((row) => (
            <TableRow key={`${row.channelRef}-${row.pulseLabel}-${row.result}`}>
              <TableCell className="font-mono">#{row.channelRef}</TableCell>
              <TableCell>{row.pulseLabel}</TableCell>
              <TableCell>{row.applyAs}</TableCell>
              <TableCell>{row.caseNumber ?? "—"}</TableCell>
              <TableCell>{row.trackerStage ?? "—"}</TableCell>
              <TableCell>{row.trackerDisbursed ?? "—"}</TableCell>
              <TableCell
                className={cn(
                  row.result === "posted" ? "font-medium text-emerald-700" : "text-amber-800",
                )}
              >
                {preview && row.result === "posted" ? "would post" : formatPulseFanOutResult(row.result)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DailyJobPreviewPanel({
  step,
  result,
}: {
  step: DailyJobStep;
  result: Record<string, unknown>;
}) {
  if (step === "sheetSync") {
    const items = (result.previewItems as SlackSheetSyncPreviewItem[] | undefined) ?? [];
    const changed = items.filter((item) => item.status !== "unchanged");
    if (changed.length === 0) return <p className="mt-2 text-sm text-muted-foreground">No channel mapping changes detected.</p>;
    return (
      <PreviewTable
        headers={["Case #", "Channel", "Status", "Changes"]}
        rows={changed.map((item) => [
          item.caseNumber,
          item.channelName,
          item.status,
          item.changes.join(", ") || "—",
        ])}
      />
    );
  }

  if (step === "settlementSync") {
    const details = filterSettlementSyncPreviewDetails(
      (result.details as SettlementSheetSyncCaseDetail[] | undefined) ?? [],
    );
    if (details.length === 0) {
      return <p className="mt-2 text-sm text-muted-foreground">No settlement changes detected.</p>;
    }
    return (
      <PreviewTable
        headers={["Case #", "Status", "Summary", "Disburse", "Disbursed"]}
        rows={details.map((item) => [
          item.caseNumber,
          item.status,
          item.summary,
          item.disburseDate ? formatOptionalDate(item.disburseDate) : "—",
          item.disbursedStatus ?? "—",
        ])}
      />
    );
  }

  if (step === "treatmentPromotion") {
    const items = (result.items as TreatmentPromotionPreviewItem[] | undefined) ?? [];
    if (items.length === 0) return <p className="mt-2 text-sm text-muted-foreground">No cases eligible for treatment promotion.</p>;
    return (
      <PreviewTable
        headers={["Case #", "Client", "Days signed", "Stage change"]}
        rows={items.map((item) => [
          item.caseNumber,
          item.clientName,
          item.daysSinceSigned != null ? String(item.daysSinceSigned) : "—",
          `${item.currentStage} → ${item.newStage}`,
        ])}
      />
    );
  }

  if (step === "dailyPulse") {
    const outcomes = parsePulseItemOutcomes(result);
    if (outcomes.length === 0) return <p className="mt-2 text-sm text-muted-foreground">No pulse items parsed in the lookback window.</p>;
    return <PulseOutcomeTable outcomes={outcomes} preview />;
  }

  if (step === "missingFields") {
    const items = (result.previewItems as MissingFieldPreviewItem[] | undefined) ?? [];
    const actionable = items.filter((item) => item.action === "post");
    if (actionable.length === 0) return <p className="mt-2 text-sm text-muted-foreground">No missing-field notices would be posted.</p>;
    return (
      <PreviewTable
        headers={["Case #", "Client", "Missing fields"]}
        rows={actionable.map((item) => [item.caseNumber, item.clientName, item.missingFields.join(", ") || "—"])}
      />
    );
  }

  if (step === "fieldReminders") {
    const items = (result.previewItems as FieldReminderPreviewItem[] | undefined) ?? [];
    const actionable = items.filter((item) => item.action === "post");
    if (actionable.length === 0) return <p className="mt-2 text-sm text-muted-foreground">No field reminders would be posted.</p>;
    return (
      <PreviewTable
        headers={["Case #", "Client", "Fields"]}
        rows={actionable.map((item) => [item.caseNumber, item.clientName, item.fields.join(", ")])}
      />
    );
  }

  return null;
}

function PreviewTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="mt-2 max-h-72 overflow-auto rounded-md border border-border/60 bg-white">
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            {headers.map((header) => (
              <TableHead key={header}>{header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={index}>
              {row.map((cell, cellIndex) => (
                <TableCell key={cellIndex} className={cellIndex === 2 ? "max-w-md whitespace-normal" : undefined}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function DailyJobsCard() {
  const [activeStep, setActiveStep] = useState<DailyJobStep | "preview" | null>(null);
  const [activeJobStep, setActiveJobStep] = useState<DailyJobStep | null>(null);
  const [caseNumber, setCaseNumber] = useState("");
  const [messages, setMessages] = useState<Partial<Record<DailyJobStep, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<DailyJobStep, string>>>({});
  const [previews, setPreviews] = useState<Partial<Record<DailyJobStep, Record<string, unknown>>>>({});
  const [previewMessages, setPreviewMessages] = useState<Partial<Record<DailyJobStep, string>>>({});
  const [previewErrors, setPreviewErrors] = useState<Partial<Record<DailyJobStep, string>>>({});
  const [pulseOutcomes, setPulseOutcomes] = useState<PulseItemOutcome[] | null>(null);

  async function runStep(step: DailyJobStep, options?: { keepActive?: boolean; dryRun?: boolean }) {
    const dryRun = Boolean(options?.dryRun);
    setActiveStep(dryRun ? "preview" : step);
    setActiveJobStep(step);
    if (dryRun) {
      setPreviewMessages((prev) => ({ ...prev, [step]: undefined }));
      setPreviewErrors((prev) => ({ ...prev, [step]: undefined }));
    } else {
      setMessages((prev) => ({ ...prev, [step]: undefined }));
      setErrors((prev) => ({ ...prev, [step]: undefined }));
      setPreviews((prev) => ({ ...prev, [step]: undefined }));
    }
    if (step === "dailyPulse" && !dryRun) setPulseOutcomes(null);

    try {
      const response = await fetch("/api/admin/daily-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step,
          force: true,
          dryRun,
          caseNumber:
            step === "fieldReminders" || step === "missingFields" ? caseNumber.trim() || undefined : undefined,
        }),
      });

      const body = (await response.json()) as Record<string, unknown> & { error?: string };
      if (!response.ok && body.error && !body.step) {
        throw new Error(errorMessage(body.error));
      }

      const message = dryRun ? formatJobPreviewSummary(step, body) : formatJobResult(step, body);
      if (body.ok === false) {
        if (dryRun) setPreviewErrors((prev) => ({ ...prev, [step]: message }));
        else setErrors((prev) => ({ ...prev, [step]: message }));
        return false;
      }

      if (dryRun) {
        setPreviewMessages((prev) => ({ ...prev, [step]: message }));
        setPreviews((prev) => ({ ...prev, [step]: (body.result as Record<string, unknown>) ?? {} }));
      } else {
        setMessages((prev) => ({ ...prev, [step]: message }));
        if (step === "dailyPulse") {
          setPulseOutcomes(parsePulseItemOutcomes(body.result as Record<string, unknown> | undefined));
        }
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : dryRun ? "Preview failed." : "Job failed.";
      if (dryRun) setPreviewErrors((prev) => ({ ...prev, [step]: message }));
      else setErrors((prev) => ({ ...prev, [step]: message }));
      return false;
    } finally {
      if (!options?.keepActive) {
        setActiveStep(null);
        setActiveJobStep(null);
      }
    }
  }

  async function previewStep(step: DailyJobStep) {
    await runStep(step, { dryRun: true });
  }

  async function runFullDailyJob() {
    setActiveStep("all");
    for (const step of FULL_JOB_STEPS) {
      const ok = await runStep(step, { keepActive: true });
      if (!ok) break;
    }
    setActiveStep(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily cron jobs</CardTitle>
        <CardDescription>
          Manual triggers for each step in the 9:00 AM Central cron (`/api/cron/slack-reminders`). Preview shows what
          would change without saving or posting. Run full job executes each step separately to avoid server timeouts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
          <label className="min-w-[12rem] flex-1">
            <span className="mb-1 block text-sm font-medium text-navy-950">Case # (optional)</span>
            <Input
              value={caseNumber}
              onChange={(event) => setCaseNumber(event.target.value)}
              placeholder="Limit Slack field jobs to one case"
            />
          </label>
          <Button
            variant="default"
            disabled={activeStep !== null}
            onClick={() => void runFullDailyJob()}
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
                {previewMessages[row.step] ? (
                  <p className="mt-1 text-sm text-sky-800">{previewMessages[row.step]}</p>
                ) : null}
                {previewErrors[row.step] ? <p className="mt-1 text-sm text-rose-700">{previewErrors[row.step]}</p> : null}
                {previews[row.step] ? <DailyJobPreviewPanel step={row.step} result={previews[row.step]!} /> : null}
                {row.step === "dailyPulse" && pulseOutcomes ? (
                  <PulseOutcomeTable outcomes={pulseOutcomes} />
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={activeStep !== null}
                  onClick={() => void previewStep(row.step)}
                >
                  {activeStep === "preview" && activeJobStep === row.step ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Preview
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={activeStep !== null}
                  onClick={() => void runStep(row.step)}
                >
                  {activeStep === row.step ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Run
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
