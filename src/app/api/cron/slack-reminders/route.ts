import { NextResponse } from "next/server";

export const maxDuration = 300;
import { getNextDailyCronGroup, triggerDailyCronGroup } from "@/lib/cron/daily-cron-chain";
import { clearDailyCronRun, getDailyCronRunId, saveDailyCronGroupResult } from "@/lib/cron/daily-cron-run";
import { runDailyCronGroup } from "@/lib/cron/daily-jobs";
import { getCronSecret } from "@/lib/slack/config";
import { errorMessage } from "@/lib/utils";

const FIRST_CRON_GROUP = "quoSync" as const;

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

    const firstResult = await runDailyCronGroup(FIRST_CRON_GROUP, {
      force,
      skipSheetSync,
      caseNumber,
    });
    await saveDailyCronGroupResult(runId, FIRST_CRON_GROUP, firstResult);

    const next = getNextDailyCronGroup(FIRST_CRON_GROUP);
    if (next) {
      triggerDailyCronGroup(request, next, runId);
    }

    return NextResponse.json({
      ok: firstResult.ok,
      runId,
      [FIRST_CRON_GROUP]: firstResult,
      chained: next,
      message: "First step completed; remaining steps run in follow-up requests.",
    });
  } catch (error) {
    const message = errorMessage(error) || `Daily cron failed during ${FIRST_CRON_GROUP}.`;
    console.error(`Daily cron ${FIRST_CRON_GROUP} step failed`, error);
    return NextResponse.json({ ok: false, runId, error: message, step: FIRST_CRON_GROUP }, { status: 500 });
  }
}
