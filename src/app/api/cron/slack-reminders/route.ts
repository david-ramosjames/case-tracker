import { NextResponse } from "next/server";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { syncSettlementsFromGoogleSheetIfConfigured } from "@/lib/google/settlements-sync";
import { syncSlackChannelsFromGoogleSheetIfConfigured } from "@/lib/google/sheets-sync";
import { getCronSecret } from "@/lib/slack/config";
import { sendSlackCaseReminders } from "@/lib/slack/notify";
import { runDailyStageWorkflow } from "@/lib/slack/stage-workflow";
import { getCases, getSettings } from "@/lib/supabase/services";

export async function GET(request: Request) {
  const secret = getCronSecret();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const caseNumberParam = searchParams.get("caseNumber")?.trim();
    const force = searchParams.get("force") === "true";
    const skipSheetSync = searchParams.get("syncSheet") === "false";

    const sheetSync = skipSheetSync
      ? { synced: 0, configured: false, dateSignedUpdated: 0 }
      : await syncSlackChannelsFromGoogleSheetIfConfigured();
    const settlementSync = skipSheetSync
      ? {
          configured: false,
          casesProcessed: 0,
          disbursementsSynced: 0,
          settlementsUpdated: 0,
          stagesAutoSettled: 0,
          skippedNoTracker: 0,
        }
      : await syncSettlementsFromGoogleSheetIfConfigured();

    const stageWorkflow = await runDailyStageWorkflow({ forcePulse: force });

    let records = await getCases();
    const settings = await getSettings();

    if (caseNumberParam) {
      const key = cleanCaseNumber(caseNumberParam);
      records = records.filter((record) => cleanCaseNumber(record.shared.caseNumber) === key);
    }

    const reminders = await sendSlackCaseReminders(records, settings, {
      force,
      forceSend: force && Boolean(caseNumberParam),
    });

    return NextResponse.json({
      ok: true,
      sheetSync,
      settlementSync,
      stageWorkflow,
      reminders,
      filter: caseNumberParam ? { caseNumber: caseNumberParam, force } : null,
    });
  } catch (error) {
    console.error("Slack reminder cron failed", error);
    const message = error instanceof Error ? error.message : "Slack reminder cron failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
