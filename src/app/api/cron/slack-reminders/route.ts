import { NextResponse } from "next/server";

export const maxDuration = 300;
import { triggerDailyCronGroup } from "@/lib/cron/daily-cron-chain";
import { clearDailyCronRun, getDailyCronRunId, saveDailyCronGroupResult } from "@/lib/cron/daily-cron-run";
import { runDailyCronGroup } from "@/lib/cron/daily-jobs";
import { getCronSecret } from "@/lib/slack/config";
import { errorMessage } from "@/lib/utils";

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
  const force = searchParams.get("force") === "true";
  const skipSheetSync = searchParams.get("syncSheet") === "false";
  const caseNumber = searchParams.get("caseNumber")?.trim();

  const runId = getDailyCronRunId();

  try {
    await clearDailyCronRun(runId);

    const syncResult = await runDailyCronGroup("sync", {
      force,
      skipSheetSync,
      caseNumber,
    });
    await saveDailyCronGroupResult(runId, "sync", syncResult);

    triggerDailyCronGroup(request, "stage", runId);

    return NextResponse.json({
      ok: syncResult.ok,
      runId,
      sync: syncResult,
      chained: "stage",
      message: "Sync completed; remaining steps run in follow-up requests.",
    });
  } catch (error) {
    const message = errorMessage(error) || "Daily cron failed during sync.";
    console.error("Daily cron sync step failed", error);
    return NextResponse.json({ ok: false, runId, error: message, step: "sync" }, { status: 500 });
  }
}
