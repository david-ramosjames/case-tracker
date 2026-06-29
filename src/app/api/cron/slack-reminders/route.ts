import { NextResponse } from "next/server";

export const maxDuration = 60;
import { triggerDailyCronGroup } from "@/lib/cron/daily-cron-chain";
import { clearDailyCronRun, getDailyCronRunId } from "@/lib/cron/daily-cron-run";
import { getCronSecret } from "@/lib/slack/config";

export async function GET(request: Request) {
  const secret = getCronSecret();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = getDailyCronRunId();
  await clearDailyCronRun(runId);
  triggerDailyCronGroup(request, "sync", runId);

  return NextResponse.json({
    ok: true,
    runId,
    started: "sync",
    message: "Daily cron chain started. Steps run in separate requests to avoid the 300s serverless limit.",
  });
}
