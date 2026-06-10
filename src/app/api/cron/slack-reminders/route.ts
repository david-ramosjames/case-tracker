import { NextResponse } from "next/server";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { syncSettlementsFromGoogleSheetIfConfigured } from "@/lib/google/settlements-sync";
import { syncSlackChannelsFromGoogleSheetIfConfigured } from "@/lib/google/sheets-sync";
import { getCronSecret, isNineAmCentral } from "@/lib/slack/config";
import { sendSlackFieldReminders } from "@/lib/slack/field-reminder-notify";
import { runDailyStageWorkflow } from "@/lib/slack/stage-workflow";
import { getCases } from "@/lib/supabase/services";

type CronStepError = { step: string; error: string };

async function runCronStep<T>(step: string, fn: () => Promise<T>): Promise<{ data?: T; error?: CronStepError }> {
  try {
    return { data: await fn() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Cron step failed: ${step}`, message, error);
    return { error: { step, error: message } };
  }
}

export async function GET(request: Request) {
  const secret = getCronSecret();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const caseNumberParam = searchParams.get("caseNumber")?.trim();
  const force = searchParams.get("force") === "true";
  const skipSheetSync = searchParams.get("syncSheet") === "false";

  if (!force && !isNineAmCentral()) {
    return NextResponse.json({
      ok: true,
      skipped: "outside_9am_central_window",
      hint: "Runs daily at 9:00 AM America/Chicago. Use ?force=true to run now.",
    });
  }

  const errors: CronStepError[] = [];

  const sheetSyncResult = skipSheetSync
    ? { data: { synced: 0, configured: false, dateSignedUpdated: 0 } }
    : await runCronStep("sheetSync", syncSlackChannelsFromGoogleSheetIfConfigured);
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
    : await runCronStep("settlementSync", syncSettlementsFromGoogleSheetIfConfigured);
  if (settlementSyncResult.error) errors.push(settlementSyncResult.error);

  const stageWorkflowResult = await runCronStep("stageWorkflow", () => runDailyStageWorkflow({ forcePulse: force }));
  if (stageWorkflowResult.error) errors.push(stageWorkflowResult.error);

  let records: Awaited<ReturnType<typeof getCases>> = [];
  const casesResult = await runCronStep("getCases", getCases);
  if (casesResult.error) {
    errors.push(casesResult.error);
  } else {
    records = casesResult.data ?? [];
  }

  if (caseNumberParam && records.length > 0) {
    const key = cleanCaseNumber(caseNumberParam);
    records = records.filter((record) => cleanCaseNumber(record.shared.caseNumber) === key);
  }

  const fieldRemindersResult = await runCronStep("fieldReminders", () =>
    sendSlackFieldReminders(records, {
      force,
      forceSend: force && Boolean(caseNumberParam),
    }),
  );
  if (fieldRemindersResult.error) errors.push(fieldRemindersResult.error);

  const sheetSync = sheetSyncResult.data ?? { synced: 0, configured: false, error: sheetSyncResult.error?.error };
  const settlementSync =
    settlementSyncResult.data ??
    ({
      configured: false,
      casesProcessed: 0,
      disbursementsSynced: 0,
      settlementsUpdated: 0,
      stagesAutoSettled: 0,
      skippedNoTracker: 0,
      error: settlementSyncResult.error?.error,
    } as const);
  const stageWorkflow = stageWorkflowResult.data ?? { error: stageWorkflowResult.error?.error };
  const fieldReminders = fieldRemindersResult.data ?? { posted: 0, skipped: 0, fields: 0, error: fieldRemindersResult.error?.error };

  const slackRan = Boolean(fieldRemindersResult.data || stageWorkflowResult.data);
  const ok = errors.length === 0 || slackRan;

  return NextResponse.json(
    {
      ok,
      sheetSync,
      settlementSync,
      stageWorkflow,
      fieldReminders,
      errors: errors.length > 0 ? errors : undefined,
      filter: caseNumberParam ? { caseNumber: caseNumberParam, force } : null,
    },
    { status: ok ? 200 : 500 },
  );
}
