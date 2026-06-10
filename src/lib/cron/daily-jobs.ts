import { cleanCaseNumber } from "@/lib/csv/parse";
import { syncSettlementsFromGoogleSheetIfConfigured } from "@/lib/google/settlements-sync";
import { syncSlackChannelsFromGoogleSheetIfConfigured } from "@/lib/google/sheets-sync";
import { sendSlackFieldReminders } from "@/lib/slack/field-reminder-notify";
import { processDailyPulseRecap } from "@/lib/slack/stage-confirmation";
import { promoteOnboardingToTreatment, runDailyStageWorkflow } from "@/lib/slack/stage-workflow";
import { getCases } from "@/lib/supabase/services";

export type DailyJobStep =
  | "sheetSync"
  | "settlementSync"
  | "treatmentPromotion"
  | "dailyPulse"
  | "fieldReminders"
  | "all";

export type DailyJobStepError = { step: string; error: string };

export type DailyJobOptions = {
  force?: boolean;
  skipSheetSync?: boolean;
  caseNumber?: string;
};

export async function runDailyJobStep<T>(
  step: string,
  fn: () => Promise<T>,
): Promise<{ data?: T; error?: DailyJobStepError }> {
  try {
    return { data: await fn() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Daily job step failed: ${step}`, message, error);
    return { error: { step, error: message } };
  }
}

async function runFieldReminders(options: DailyJobOptions) {
  const force = options.force ?? true;
  const caseNumberParam = options.caseNumber?.trim();

  let records = await getCases();
  if (caseNumberParam) {
    const key = cleanCaseNumber(caseNumberParam);
    records = records.filter((record) => cleanCaseNumber(record.shared.caseNumber) === key);
  }

  return sendSlackFieldReminders(records, {
    force,
    forceSend: force && Boolean(caseNumberParam),
  });
}

export async function runDailyJob(step: DailyJobStep, options: DailyJobOptions = {}) {
  const force = options.force ?? true;
  const skipSheetSync = options.skipSheetSync ?? false;
  const errors: DailyJobStepError[] = [];

  if (step === "all") {
    const sheetSyncResult = skipSheetSync
      ? { data: { synced: 0, configured: false, dateSignedUpdated: 0 } }
      : await runDailyJobStep("sheetSync", syncSlackChannelsFromGoogleSheetIfConfigured);
    if (sheetSyncResult.error) errors.push(sheetSyncResult.error);

    const settlementSyncResult = skipSheetSync
      ? {
          data: {
            configured: false,
            casesProcessed: 0,
            disbursementsSynced: 0,
            settlementsUpdated: 0,
            stagesAutoSettled: 0,
            skippedNoTracker: 0,
          },
        }
      : await runDailyJobStep("settlementSync", syncSettlementsFromGoogleSheetIfConfigured);
    if (settlementSyncResult.error) errors.push(settlementSyncResult.error);

    const stageWorkflowResult = await runDailyJobStep("stageWorkflow", () =>
      runDailyStageWorkflow({ forcePulse: force }),
    );
    if (stageWorkflowResult.error) errors.push(stageWorkflowResult.error);

    const fieldRemindersResult = await runDailyJobStep("fieldReminders", () => runFieldReminders(options));
    if (fieldRemindersResult.error) errors.push(fieldRemindersResult.error);

    const slackRan = Boolean(fieldRemindersResult.data || stageWorkflowResult.data);
    const ok = errors.length === 0 || slackRan;

    return {
      ok,
      step,
      sheetSync: sheetSyncResult.data ?? { synced: 0, configured: false, error: sheetSyncResult.error?.error },
      settlementSync:
        settlementSyncResult.data ??
        ({
          configured: false,
          casesProcessed: 0,
          disbursementsSynced: 0,
          settlementsUpdated: 0,
          stagesAutoSettled: 0,
          skippedNoTracker: 0,
          error: settlementSyncResult.error?.error,
        } as const),
      stageWorkflow: stageWorkflowResult.data ?? { error: stageWorkflowResult.error?.error },
      fieldReminders:
        fieldRemindersResult.data ??
        ({ posted: 0, skipped: 0, fields: 0, error: fieldRemindersResult.error?.error } as const),
      errors: errors.length > 0 ? errors : undefined,
      filter: options.caseNumber ? { caseNumber: options.caseNumber, force } : null,
    };
  }

  if (step === "sheetSync") {
    const result = await runDailyJobStep("sheetSync", syncSlackChannelsFromGoogleSheetIfConfigured);
    if (result.error) {
      return { ok: false, step, error: result.error.error, errors: [result.error] };
    }
    return { ok: true, step, result: result.data };
  }

  if (step === "settlementSync") {
    const result = await runDailyJobStep("settlementSync", syncSettlementsFromGoogleSheetIfConfigured);
    if (result.error) {
      return { ok: false, step, error: result.error.error, errors: [result.error] };
    }
    return { ok: true, step, result: result.data };
  }

  if (step === "treatmentPromotion") {
    const result = await runDailyJobStep("treatmentPromotion", promoteOnboardingToTreatment);
    if (result.error) {
      return { ok: false, step, error: result.error.error, errors: [result.error] };
    }
    return { ok: true, step, result: result.data };
  }

  if (step === "dailyPulse") {
    const result = await runDailyJobStep("dailyPulse", () => processDailyPulseRecap({ force }));
    if (result.error) {
      return { ok: false, step, error: result.error.error, errors: [result.error] };
    }
    return { ok: true, step, result: result.data };
  }

  if (step === "fieldReminders") {
    const result = await runDailyJobStep("fieldReminders", () => runFieldReminders(options));
    if (result.error) {
      return { ok: false, step, error: result.error.error, errors: [result.error] };
    }
    return {
      ok: true,
      step,
      result: result.data,
      filter: options.caseNumber ? { caseNumber: options.caseNumber, force } : null,
    };
  }

  return { ok: false, step, error: `Unknown step: ${step}` };
}
