import { type DailyJobStep } from "@/lib/cron/daily-jobs";
import { postSlackMessage } from "@/lib/slack/client";
import { getDailyPulseChannelId, isSlackEnabled } from "@/lib/slack/config";
import { errorMessage } from "@/lib/utils";

function formatCentralTimestamp(now = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(now);
}

function formatAllJobLines(body: Record<string, unknown>): string[] {
  const lines: string[] = [];

  const sheetSync = body.sheetSync as
    | { synced?: number; configured?: boolean; dateSignedUpdated?: number; error?: string }
    | undefined;
  if (sheetSync?.error) {
    lines.push(`Sheet sync failed: ${sheetSync.error}`);
  } else if (sheetSync?.configured) {
    const dateSigned =
      sheetSync.dateSignedUpdated && sheetSync.dateSignedUpdated > 0
        ? `, ${sheetSync.dateSignedUpdated} date signed changed`
        : "";
    lines.push(`Sheet sync: ${sheetSync.synced ?? 0} channel row(s)${dateSigned}`);
  } else {
    lines.push("Sheet sync: not configured");
  }

  const settlementSync = body.settlementSync as
    | {
        configured?: boolean;
        disbursementsSynced?: number;
        settlementsUpdated?: number;
        stagesAutoSettled?: number;
        error?: string;
      }
    | undefined;
  if (settlementSync?.error) {
    lines.push(`Settlement sync failed: ${settlementSync.error}`);
  } else if (settlementSync?.configured) {
    lines.push(
      `Settlement sync: ${settlementSync.disbursementsSynced ?? 0} disbursement row(s), ${settlementSync.settlementsUpdated ?? 0} field update(s), ${settlementSync.stagesAutoSettled ?? 0} auto-settled`,
    );
  } else {
    lines.push("Settlement sync: not configured");
  }

  const quoPhoneSync = body.quoPhoneSync as
    | { configured?: boolean; matched?: number; updated?: number; error?: string }
    | undefined;
  if (quoPhoneSync?.error) {
    lines.push(`Quo phone sync failed: ${quoPhoneSync.error}`);
  } else if (quoPhoneSync?.configured) {
    lines.push(`Quo phone sync: ${quoPhoneSync.updated ?? 0} case(s) updated (${quoPhoneSync.matched ?? 0} matched)`);
  } else {
    lines.push("Quo phone sync: not configured");
  }

  const stageWorkflow = body.stageWorkflow as
    | {
        error?: string;
        treatment?: { promoted?: number; eligible?: number };
        pulse?: { posted?: number; processed?: number; skipped?: number; reason?: string };
      }
    | undefined;
  if (stageWorkflow?.error) {
    lines.push(`Stage workflow failed: ${stageWorkflow.error}`);
  } else {
    const promoted = stageWorkflow?.treatment?.promoted ?? 0;
    lines.push(`Treatment promotion: ${promoted} case(s) promoted`);
    const pulse = stageWorkflow?.pulse;
    if (pulse?.reason === "slack_disabled") {
      lines.push("Pulse recap: Slack disabled");
    } else if (pulse?.reason === "no_pulse_channel") {
      lines.push("Pulse recap: daily-pulse channel not configured");
    } else if (pulse?.reason === "pulse_history_failed") {
      lines.push(`Pulse recap failed: ${errorMessage(pulse.error) || "could not read channel"}`);
    } else if (pulse) {
      lines.push(
        `Pulse recap: ${pulse.posted ?? 0} confirmation(s) posted (${pulse.processed ?? 0} item(s), ${pulse.skipped ?? 0} skipped)`,
      );
    }
  }

  const missingFields = body.missingFields as { posted?: number; skipped?: number; error?: string } | undefined;
  if (missingFields?.error) {
    lines.push(`Missing-field notices failed: ${missingFields.error}`);
  } else if (missingFields) {
    lines.push(`Missing-field notices: ${missingFields.posted ?? 0} posted (${missingFields.skipped ?? 0} skipped)`);
  }

  const fieldReminders = body.fieldReminders as
    | { posted?: number; skipped?: number; fields?: number; error?: string }
    | undefined;
  if (fieldReminders?.error) {
    lines.push(`Field reminders failed: ${fieldReminders.error}`);
  } else if (fieldReminders) {
    lines.push(
      `Field reminders: ${fieldReminders.posted ?? 0} posted, ${fieldReminders.fields ?? 0} field(s) (${fieldReminders.skipped ?? 0} cases skipped)`,
    );
  }

  const smsTimeTriggers = body.smsTimeTriggers as
    | { queued?: number; matched?: number; skipped?: number; error?: string }
    | undefined;
  if (smsTimeTriggers?.error) {
    lines.push(`SMS time-in-stage failed: ${smsTimeTriggers.error}`);
  } else if (smsTimeTriggers) {
    lines.push(
      `SMS time-in-stage: ${smsTimeTriggers.queued ?? 0} queued (${smsTimeTriggers.matched ?? 0} matched, ${smsTimeTriggers.skipped ?? 0} skipped)`,
    );
  }

  const errors = body.errors as { step: string; error: unknown }[] | undefined;
  if (errors?.length) {
    for (const entry of errors) {
      lines.push(`${entry.step}: ${errorMessage(entry.error)}`);
    }
  }

  return lines;
}

function formatSingleStepLine(step: DailyJobStep, body: Record<string, unknown>): string {
  if (body.error) return errorMessage(body.error);

  const result = body.result as Record<string, unknown> | undefined;
  if (!result) return "No result returned.";

  switch (step) {
    case "sheetSync":
      return `Sheet sync: ${result.synced ?? 0} channel row(s)`;
    case "settlementSync":
      return `Settlement sync: ${result.disbursementsSynced ?? 0} disbursement row(s)`;
    case "quoPhoneSync":
      return `Quo phone sync: ${result.updated ?? 0} case(s) updated`;
    case "treatmentPromotion":
      return `Treatment promotion: ${result.promoted ?? 0} of ${result.eligible ?? 0} eligible`;
    case "dailyPulse":
      return `Pulse recap: ${result.posted ?? 0} posted (${result.processed ?? 0} processed)`;
    case "missingFields":
      return `Missing-field notices: ${result.posted ?? 0} posted`;
    case "fieldReminders":
      return `Field reminders: ${result.posted ?? 0} posted`;
    case "smsTimeTriggers":
      return `SMS time-in-stage: ${result.queued ?? 0} queued`;
    default:
      return "Completed.";
  }
}

export function formatDailyJobSlackMessage(
  step: DailyJobStep,
  body: Record<string, unknown>,
  options?: { source?: "cron" | "manual"; fatalError?: string },
): string {
  const errors = body.errors as { step: string; error: unknown }[] | undefined;
  const stepError = body.error ? errorMessage(body.error) : null;
  const hasErrors = Boolean(options?.fatalError) || Boolean(stepError) || (errors?.length ?? 0) > 0;
  const ok = Boolean(body.ok) && !hasErrors;
  const partial = Boolean(body.ok) && hasErrors && !options?.fatalError;

  const icon = ok ? ":white_check_mark:" : partial ? ":warning:" : ":x:";
  const status = options?.fatalError ? "failed" : ok ? "completed" : partial ? "completed with errors" : "failed";
  const source = options?.source === "manual" ? " (manual)" : "";
  const stepLabel = step === "all" ? "Daily cron" : `Daily job (${step})`;
  const when = formatCentralTimestamp();

  const header = `${icon} *${stepLabel} ${status}${source}* — ${when} CT`;
  const detailLines =
    options?.fatalError != null
      ? [options.fatalError]
      : step === "all"
        ? formatAllJobLines(body)
        : [formatSingleStepLine(step, body)];

  if (detailLines.length === 0) {
    return `${header}\n• No step details returned.`;
  }

  return [header, ...detailLines.map((line) => `• ${line}`)].join("\n");
}

export async function notifyDailyJobResult(
  step: DailyJobStep,
  body: Record<string, unknown>,
  options?: { source?: "cron" | "manual"; fatalError?: string },
) {
  if (!isSlackEnabled()) {
    return { posted: false as const, reason: "slack_disabled" as const };
  }

  const channelId = await getDailyPulseChannelId();
  if (!channelId) {
    return { posted: false as const, reason: "no_pulse_channel" as const };
  }

  const text = formatDailyJobSlackMessage(step, body, options);

  try {
    await postSlackMessage({ channel: channelId, text });
    return { posted: true as const };
  } catch (error) {
    console.error("Daily job Slack notification failed", errorMessage(error), error);
    return { posted: false as const, reason: "post_failed" as const, error: errorMessage(error) };
  }
}
