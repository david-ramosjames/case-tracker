import { cleanCaseNumber } from "@/lib/csv/parse";
import { type DailyCronGroup } from "@/lib/cron/daily-cron-run";
import { syncSettlementsFromGoogleSheetIfConfigured } from "@/lib/google/settlements-sync";
import { syncSlackChannelsFromGoogleSheetIfConfigured } from "@/lib/google/sheets-sync";
import { sendSlackFieldReminders } from "@/lib/slack/field-reminder-notify";
import { sendSlackMissingFieldNotices } from "@/lib/slack/missing-field-notify";
import { processDailyPulseRecap } from "@/lib/slack/stage-confirmation";
import { promoteOnboardingToTreatment, runDailyStageWorkflow } from "@/lib/slack/stage-workflow";
import { syncQuoPhonesToTrackerIfConfigured, processSmsTimeInStageAutomations } from "@/lib/sms/workflow";
import { getCases } from "@/lib/supabase/services";
import { errorMessage } from "@/lib/utils";

export type DailyJobStep =
  | "sheetSync"
  | "settlementSync"
  | "quoPhoneSync"
  | "treatmentPromotion"
  | "dailyPulse"
  | "missingFields"
  | "fieldReminders"
  | "smsTimeTriggers"
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

async function runSheetSyncStep(options: DailyJobOptions) {
  const skipSheetSync = options.skipSheetSync ?? false;
  if (skipSheetSync) {
    return { data: { synced: 0, configured: false, dateSignedUpdated: 0 } };
  }
  return runDailyJobStep("sheetSync", syncSlackChannelsFromGoogleSheetIfConfigured);
}

async function runSettlementSyncStep(options: DailyJobOptions) {
  const skipSheetSync = options.skipSheetSync ?? false;
  if (skipSheetSync) {
    return {
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
    };
  }
  return runDailyJobStep("settlementSync", syncSettlementsFromGoogleSheetIfConfigured);
}

function emptySettlementSyncResult(error?: string) {
  return {
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
    error,
  } as const;
}

export async function runDailyCronGroup(group: DailyCronGroup, options: DailyJobOptions = {}) {
  const force = options.force ?? true;
  const errors: DailyJobStepError[] = [];

  if (group === "sync") {
    const sheetSyncResult = await runSheetSyncStep(options);
    if (sheetSyncResult.error) errors.push(sheetSyncResult.error);

    const settlementSyncResult = await runSettlementSyncStep(options);
    if ("error" in settlementSyncResult && settlementSyncResult.error) errors.push(settlementSyncResult.error);

    const quoPhoneSyncResult = await runDailyJobStep("quoPhoneSync", syncQuoPhonesToTrackerIfConfigured);
    if (quoPhoneSyncResult.error) errors.push(quoPhoneSyncResult.error);

    return {
      ok: errors.length === 0,
      group,
      sheetSync: sheetSyncResult.data ?? { synced: 0, configured: false, error: sheetSyncResult.error?.error },
      settlementSync:
        settlementSyncResult.data ??
        emptySettlementSyncResult(
          "error" in settlementSyncResult ? settlementSyncResult.error?.error : undefined,
        ),
      quoPhoneSync:
        quoPhoneSyncResult.data ??
        ({
          configured: false,
          totalContacts: 0,
          matched: 0,
          updated: 0,
          skipped: 0,
          conversationLinks: 0,
          error: quoPhoneSyncResult.error?.error,
        } as const),
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  if (group === "stage") {
    const stageWorkflowResult = await runDailyJobStep("stageWorkflow", () =>
      runDailyStageWorkflow({ forcePulse: force }),
    );
    if (stageWorkflowResult.error) errors.push(stageWorkflowResult.error);

    return {
      ok: errors.length === 0,
      group,
      stageWorkflow: stageWorkflowResult.data ?? { error: stageWorkflowResult.error?.error },
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  if (group === "missingFields") {
    const missingFieldsResult = await runDailyJobStep("missingFields", () => runMissingFields(options));
    if (missingFieldsResult.error) errors.push(missingFieldsResult.error);

    return {
      ok: errors.length === 0,
      group,
      missingFields:
        missingFieldsResult.data ??
        ({ posted: 0, skipped: 0, error: missingFieldsResult.error?.error } as const),
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  if (group === "fieldReminders") {
    const fieldRemindersResult = await runDailyJobStep("fieldReminders", () => runFieldReminders(options));
    if (fieldRemindersResult.error) errors.push(fieldRemindersResult.error);

    return {
      ok: errors.length === 0,
      group,
      fieldReminders:
        fieldRemindersResult.data ??
        ({ posted: 0, skipped: 0, fields: 0, error: fieldRemindersResult.error?.error } as const),
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  const smsTimeTriggersResult = await runDailyJobStep("smsTimeTriggers", () =>
    processSmsTimeInStageAutomations({ dryRun: Boolean(options.dryRun), caseNumber: options.caseNumber }),
  );
  if (smsTimeTriggersResult.error) errors.push(smsTimeTriggersResult.error);

  return {
    ok: errors.length === 0,
    group: "sms" as const,
    smsTimeTriggers:
      smsTimeTriggersResult.data ??
      ({ queued: 0, matched: 0, skipped: 0, automations: 0, error: smsTimeTriggersResult.error?.error } as const),
    errors: errors.length > 0 ? errors : undefined,
  };
}

export async function runDailyJob(step: DailyJobStep, options: DailyJobOptions = {}) {
  const force = options.force ?? true;
  const dryRun = Boolean(options.dryRun);
  const errors: DailyJobStepError[] = [];

  if (step === "all") {
    const sheetSyncResult = await runSheetSyncStep(options);
    if (sheetSyncResult.error) errors.push(sheetSyncResult.error);

    const settlementSyncResult = await runSettlementSyncStep(options);
    if ("error" in settlementSyncResult && settlementSyncResult.error) errors.push(settlementSyncResult.error);

    const quoPhoneSyncResult = await runDailyJobStep("quoPhoneSync", syncQuoPhonesToTrackerIfConfigured);
    if (quoPhoneSyncResult.error) errors.push(quoPhoneSyncResult.error);

    const stageWorkflowResult = await runDailyJobStep("stageWorkflow", () =>
      runDailyStageWorkflow({ forcePulse: force }),
    );
    if (stageWorkflowResult.error) errors.push(stageWorkflowResult.error);

    const missingFieldsResult = await runDailyJobStep("missingFields", () => runMissingFields(options));
    if (missingFieldsResult.error) errors.push(missingFieldsResult.error);

    const fieldRemindersResult = await runDailyJobStep("fieldReminders", () => runFieldReminders(options));
    if (fieldRemindersResult.error) errors.push(fieldRemindersResult.error);

    const smsTimeTriggersResult = await runDailyJobStep("smsTimeTriggers", () =>
      processSmsTimeInStageAutomations({ dryRun, caseNumber: options.caseNumber }),
    );
    if (smsTimeTriggersResult.error) errors.push(smsTimeTriggersResult.error);

    const slackRan = Boolean(missingFieldsResult.data || fieldRemindersResult.data || stageWorkflowResult.data);
    const ok = errors.length === 0 || slackRan;

    return {
      ok,
      step,
      sheetSync: sheetSyncResult.data ?? { synced: 0, configured: false, error: sheetSyncResult.error?.error },
      settlementSync:
        settlementSyncResult.data ??
        emptySettlementSyncResult(
          "error" in settlementSyncResult ? settlementSyncResult.error?.error : undefined,
        ),
      quoPhoneSync:
        quoPhoneSyncResult.data ??
        ({
          configured: false,
          totalContacts: 0,
          matched: 0,
          updated: 0,
          skipped: 0,
          conversationLinks: 0,
          error: quoPhoneSyncResult.error?.error,
        } as const),
      stageWorkflow: stageWorkflowResult.data ?? { error: stageWorkflowResult.error?.error },
      missingFields:
        missingFieldsResult.data ??
        ({ posted: 0, skipped: 0, error: missingFieldsResult.error?.error } as const),
      fieldReminders:
        fieldRemindersResult.data ??
        ({ posted: 0, skipped: 0, fields: 0, error: fieldRemindersResult.error?.error } as const),
      smsTimeTriggers:
        smsTimeTriggersResult.data ??
        ({ queued: 0, matched: 0, skipped: 0, automations: 0, error: smsTimeTriggersResult.error?.error } as const),
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

  if (step === "quoPhoneSync") {
    const result = await runDailyJobStep("quoPhoneSync", syncQuoPhonesToTrackerIfConfigured);
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

  if (step === "smsTimeTriggers") {
    const result = await runDailyJobStep("smsTimeTriggers", () =>
      processSmsTimeInStageAutomations({ dryRun, caseNumber: options.caseNumber }),
    );
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
