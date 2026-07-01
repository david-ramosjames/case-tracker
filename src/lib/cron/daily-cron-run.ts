import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { type DailyJobStepError } from "@/lib/cron/daily-jobs";

export type DailyCronGroup =
  | "quoSync"
  | "slackChannels"
  | "settlementSync"
  | "treatmentPromotion"
  | "dailyPulse"
  | "missingFields"
  | "fieldReminders"
  | "sms";

export const DAILY_CRON_GROUP_ORDER: DailyCronGroup[] = [
  "quoSync",
  "slackChannels",
  "settlementSync",
  "treatmentPromotion",
  "dailyPulse",
  "missingFields",
  "fieldReminders",
  "sms",
];

/** Batched to stay under Vercel's self-fetch infinite-loop limit (~5 hops). Order preserved within each batch. */
export const DAILY_CRON_BATCHES: DailyCronGroup[][] = [
  ["quoSync", "slackChannels", "settlementSync"],
  ["treatmentPromotion", "dailyPulse"],
  ["missingFields", "fieldReminders"],
  ["sms"],
];

export function getBatch(batchIndex: number): DailyCronGroup[] | null {
  return DAILY_CRON_BATCHES[batchIndex] ?? null;
}

export function getFirstGroupOfBatch(batchIndex: number): DailyCronGroup | null {
  return DAILY_CRON_BATCHES[batchIndex]?.[0] ?? null;
}

export function getNextDailyCronBatchIndex(currentBatchIndex: number): number | null {
  if (currentBatchIndex < 0 || currentBatchIndex >= DAILY_CRON_BATCHES.length - 1) return null;
  return currentBatchIndex + 1;
}

export function getBatchIndexForGroup(group: DailyCronGroup): number {
  return DAILY_CRON_BATCHES.findIndex((batch) => batch.includes(group));
}

export type DailyCronRunState = {
  runId: string;
  startedAt: string;
  groups: Partial<Record<DailyCronGroup, Record<string, unknown>>>;
};

function settingsKey(runId: string) {
  return `daily_cron_run:${runId}`;
}

export function getDailyCronRunId(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function getNextDailyCronGroup(current: DailyCronGroup): DailyCronGroup | null {
  const index = DAILY_CRON_GROUP_ORDER.indexOf(current);
  if (index < 0 || index >= DAILY_CRON_GROUP_ORDER.length - 1) return null;
  return DAILY_CRON_GROUP_ORDER[index + 1] ?? null;
}

export async function clearDailyCronRun(runId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return;

  await admin.from("case_tracker_settings").delete().eq("key", settingsKey(runId));
}

export async function loadDailyCronRun(runId: string): Promise<DailyCronRunState | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const { data } = await admin
    .from("case_tracker_settings")
    .select("value")
    .eq("key", settingsKey(runId))
    .maybeSingle();

  const value = data?.value;
  if (!value || typeof value !== "object") return null;
  return value as DailyCronRunState;
}

export async function saveDailyCronGroupResult(
  runId: string,
  group: DailyCronGroup,
  result: Record<string, unknown>,
) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required to save daily cron run state.");

  const existing = (await loadDailyCronRun(runId)) ?? {
    runId,
    startedAt: new Date().toISOString(),
    groups: {},
  };

  const next: DailyCronRunState = {
    ...existing,
    runId,
    groups: {
      ...existing.groups,
      [group]: result,
    },
  };

  const { error } = await admin.from("case_tracker_settings").upsert(
    {
      key: settingsKey(runId),
      value: next,
      description: "In-progress daily cron run state for chained serverless steps.",
    },
    { onConflict: "key" },
  );
  if (error) throw new Error(error.message);
}

export function mergeDailyCronRunToAllResult(run: DailyCronRunState | null) {
  const errors: DailyJobStepError[] = [];
  let ok = true;

  for (const group of DAILY_CRON_GROUP_ORDER) {
    const groupResult = run?.groups[group];
    if (!groupResult) {
      ok = false;
      errors.push({ step: group, error: "Step did not run." });
      continue;
    }
    if (groupResult.ok === false) ok = false;
    const groupErrors = groupResult.errors as DailyJobStepError[] | undefined;
    if (groupErrors?.length) {
      ok = false;
      errors.push(...groupErrors);
    }
  }

  const quoSync = run?.groups.quoSync;
  const slackChannels = run?.groups.slackChannels;
  const settlement = run?.groups.settlementSync;
  const treatment = run?.groups.treatmentPromotion;
  const pulse = run?.groups.dailyPulse;
  const missingFields = run?.groups.missingFields;
  const fieldReminders = run?.groups.fieldReminders;
  const sms = run?.groups.sms;

  return {
    ok,
    step: "all" as const,
    quoPhoneSync:
      (quoSync?.quoPhoneSync as Record<string, unknown>) ??
      ({
        configured: false,
        totalContacts: 0,
        matched: 0,
        updated: 0,
        skipped: 0,
        conversationLinks: 0,
      } as const),
    sheetSync: (slackChannels?.sheetSync as Record<string, unknown>) ?? { synced: 0, configured: false },
    settlementSync:
      (settlement?.settlementSync as Record<string, unknown>) ??
      ({
        configured: false,
        casesProcessed: 0,
        disbursementsSynced: 0,
        settlementsUpdated: 0,
        stagesAutoSettled: 0,
        stagesRestored: 0,
        skippedNoTracker: 0,
        skippedFinancialLocked: 0,
        sheetCasesFound: 0,
        details: [],
      } as const),
    stageWorkflow: {
      treatment: (treatment?.treatmentPromotion as Record<string, unknown>) ?? {},
      pulse: (pulse?.dailyPulse as Record<string, unknown>) ?? {},
    },
    missingFields: (missingFields?.missingFields as Record<string, unknown>) ?? { posted: 0, skipped: 0 },
    fieldReminders:
      (fieldReminders?.fieldReminders as Record<string, unknown>) ?? { posted: 0, skipped: 0, fields: 0 },
    smsTimeTriggers:
      (sms?.smsTimeTriggers as Record<string, unknown>) ?? { queued: 0, matched: 0, skipped: 0, automations: 0 },
    errors: errors.length > 0 ? errors : undefined,
    runId: run?.runId,
  };
}
