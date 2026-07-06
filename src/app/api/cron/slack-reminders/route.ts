import { NextResponse } from "next/server";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

import { startDailyCronChain } from "@/lib/cron/daily-cron-executor";
import { getDailyCronRunId } from "@/lib/cron/daily-cron-run";
import { getCronSecret } from "@/lib/slack/config";
import { errorMessage } from "@/lib/utils";

export async function GET(request: Request) {
  const secret = getCronSecret();
  if (!secret) {
    console.error("Daily cron rejected: CRON_SECRET is not configured");
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    console.error("Daily cron rejected: unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "true";
  const skipSheetSync = searchParams.get("syncSheet") === "false";
  const caseNumber = searchParams.get("caseNumber")?.trim();
  const runId = getDailyCronRunId();

  console.info("Daily cron request accepted", {
    runId,
    force,
    skipSheetSync,
    caseNumber: caseNumber || null,
    host: request.headers.get("host"),
  });

  try {
    const outcome = await startDailyCronChain(request, runId, { force, skipSheetSync, caseNumber });
    return NextResponse.json(outcome, { status: outcome.ok === false ? 500 : 200 });
  } catch (error) {
    const message = errorMessage(error) || "Daily cron failed.";
    console.error("Daily cron unhandled failure", { runId, message }, error);
    return NextResponse.json({ ok: false, runId, error: message }, { status: 500 });
  }
}
