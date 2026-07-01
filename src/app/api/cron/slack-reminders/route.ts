import { NextResponse } from "next/server";

export const maxDuration = 300;
import { triggerDailyCronBatch } from "@/lib/cron/daily-cron-chain";
import { clearDailyCronRun, getDailyCronRunId, getNextDailyCronBatchIndex } from "@/lib/cron/daily-cron-run";
import { runDailyCronBatch } from "@/lib/cron/daily-cron-executor";
import { getCronSecret } from "@/lib/slack/config";
import { errorMessage } from "@/lib/utils";

const FIRST_BATCH_INDEX = 0;

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

    const firstResult = await runDailyCronBatch(FIRST_BATCH_INDEX, runId, {
      force,
      skipSheetSync,
      caseNumber,
    });

    const nextBatch = getNextDailyCronBatchIndex(FIRST_BATCH_INDEX);
    if (nextBatch != null) {
      triggerDailyCronBatch(request, nextBatch, runId);
    }

    return NextResponse.json({
      ok: firstResult.ok,
      runId,
      batch: FIRST_BATCH_INDEX,
      groups: firstResult.groups,
      results: firstResult.results,
      chained: nextBatch,
      message: "First batch completed; remaining batches run in follow-up requests.",
    });
  } catch (error) {
    const message = errorMessage(error) || "Daily cron failed during first batch.";
    console.error("Daily cron first batch failed", error);
    return NextResponse.json({ ok: false, runId, error: message, batch: FIRST_BATCH_INDEX }, { status: 500 });
  }
}
