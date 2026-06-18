import { cleanCaseNumber } from "@/lib/csv/parse";
import { syncSettlementsFromGoogleSheetIfConfigured } from "@/lib/google/settlements-sync";
import { syncSlackChannelsFromGoogleSheetIfConfigured } from "@/lib/google/sheets-sync";
import { sendSlackFieldReminders } from "@/lib/slack/field-reminder-notify";
import { sendSlackMissingFieldNotices } from "@/lib/slack/missing-field-notify";
import { processDailyPulseRecap } from "@/lib/slack/stage-confirmation";
import { promoteOnboardingToTreatment, runDailyStageWorkflow } from "@/lib/slack/stage-workflow";
import { getCases } from "@/lib/supabase/services";
import { errorMessage } from "@/lib/utils";

export type DailyJobStep =
  | "sheetSync"
  | "settlementSync"
  | "treatmentPromotion"
  | "dailyPulse"
  | "missingFields"
  | "fieldReminders"
  | "all";

export type DailyJobStepError = { step: string; error: string };

export type DailyJobOptions = {
  force?: boolean;
  skipSheetSync?: boolean;
  caseNumber?: string;
  dryRun?: boolean;
};

export async function runDailyJobStep<T>(
  step: string,
  fn: () => Promise<T>,
): Promise<{ data?: T; error?: DailyJobStepError }> {
  try {
    return { data: await fn() };
  } catch (error) {
    const message = errorMessage(error);
    console.error(`Daily job step failed: ${step}`, message, error);
    return { error: { step, error: message } };
  }
}

function filterRecordsForCaseNumber(records: Awaited<ReturnType<typeof getCases>>, caseNumberParam?: string) {
  const trimmed = caseNumberParam?.trim();
  if (!trimmed) return records;
  const key = cleanCaseNumber(trimmed);
  return records.filter((record) => cleanCaseNumber(record.shared.caseNumber) === key);
}

async function runMissingFields(options: DailyJobOptions) {
  const force = options.force ?? true;
  const records = filterRecordsForCaseNumber(await getCases(), options.caseNumber);

  return sendSlackMissingFieldNotices(records, {
    force,
    forceSend: force && Boolean(options.caseNumber?.trim()),
    dryRun: options.dryRun,
  });
}

async function runFieldReminders(options: DailyJobOptions) {
  const force = options.force ?? true;
  const records = filterRecordsForCaseNumber(await getCases(), options.caseNumber);

  return sendSlackFieldReminders(records, {
    force,
    forceSend: force && Boolean(options.caseNumber?.trim()),
    dryRun: options.dryRun,
  });
}

export async function runDailyJob(step: DailyJobStep, options: DailyJobOptions = {}) {
  const force = options.force ?? true;
  const skipSheetSync = options.skipSheetSync ?? false;
  const dryRun = Boolean(options.dryRun);
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
            stagesRestored: 0,
            skippedNoTracker: 0,
            skippedFinancialLocked: 0,
            sheetCasesFound: 0,
            details: [],
          },
        }
      : await runDailyJobStep("settlementSync", syncSettlementsFromGoogleSheetIfConfigured);
    if ("error" in settlementSyncResult && settlementSyncResult.error) errors.push(settlementSyncResult.error);

    const stageWorkflowResult = await runDailyJobStep("stageWorkflow", () =>
      runDailyStageWorkflow({ forcePulse: force }),
    );
    if (stageWorkflowResult.error) errors.push(stageWorkflowResult.error);

    const missingFieldsResult = await runDailyJobStep("missingFields", () => runMissingFields(options));
    if (missingFieldsResult.error) errors.push(missingFieldsResult.error);

    const fieldRemindersResult = await runDailyJobStep("fieldReminders", () => runFieldReminders(options));
    if (fieldRemindersResult.error) errors.push(fieldRemindersResult.error);

    const slackRan = Boolean(missingFieldsResult.data || fieldRemindersResult.data || stageWorkflowResult.data);
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
          stagesRestored: 0,
          skippedNoTracker: 0,
          skippedFinancialLocked: 0,
          sheetCasesFound: 0,
          details: [],
          error: "error" in settlementSyncResult ? settlementSyncResult.error?.error : undefined,
        } as const),
      stageWorkflow: stageWorkflowResult.data ?? { error: stageWorkflowResult.error?.error },
      missingFields:
        missingFieldsResult.data ??
        ({ posted: 0, skipped: 0, error: missingFieldsResult.error?.error } as const),
      fieldReminders:
        fieldRemindersResult.data ??
        ({ posted: 0, skipped: 0, fields: 0, error: fieldRemindersResult.error?.error } as const),
      errors: errors.length > 0 ? errors : undefined,
      filter: options.caseNumber ? { caseNumber: options.caseNumber, force } : null,
    };
  }

  if (step === "sheetSync") {
    const result = await runDailyJobStep("sheetSync", () =>
      syncSlackChannelsFromGoogleSheetIfConfigured({ dryRun }),
    );
    if (result.error) {
      return { ok: false, step, dryRun, error: result.error.error, errors: [result.error] };
    }
    return { ok: true, step, dryRun, result: result.data };
  }

  if (step === "settlementSync") {
    const result = await runDailyJobStep("settlementSync", () =>
      syncSettlementsFromGoogleSheetIfConfigured({ dryRun }),
    );
    if (result.error) {
      return { ok: false, step, dryRun, error: result.error.error, errors: [result.error] };
    }
    return { ok: true, step, dryRun, result: result.data };
  }

  if (step === "treatmentPromotion") {
    const result = await runDailyJobStep("treatmentPromotion", () => promoteOnboardingToTreatment(undefined, { dryRun }));
    if (result.error) {
      return { ok: false, step, dryRun, error: result.error.error, errors: [result.error] };
    }
    return { ok: true, step, dryRun, result: result.data };
  }

  if (step === "dailyPulse") {
    const result = await runDailyJobStep("dailyPulse", () => processDailyPulseRecap({ force, dryRun }));
    if (result.error) {
      return { ok: false, step, dryRun, error: result.error.error, errors: [result.error] };
    }
    return { ok: true, step, dryRun, result: result.data };
  }

  if (step === "missingFields") {
    const result = await runDailyJobStep("missingFields", () => runMissingFields(options));
    if (result.error) {
      return { ok: false, step, dryRun, error: result.error.error, errors: [result.error] };
    }
    return {
      ok: true,
      step,
      dryRun,
      result: result.data,
      filter: options.caseNumber ? { caseNumber: options.caseNumber, force } : null,
    };
  }

  if (step === "fieldReminders") {
    const result = await runDailyJobStep("fieldReminders", () => runFieldReminders(options));
    if (result.error) {
      return { ok: false, step, dryRun, error: result.error.error, errors: [result.error] };
    }
    return {
      ok: true,
      step,
      dryRun,
      result: result.data,
      filter: options.caseNumber ? { caseNumber: options.caseNumber, force } : null,
    };
  }

  return { ok: false, step, error: `Unknown step: ${step}` };
}
