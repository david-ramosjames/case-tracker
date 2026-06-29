import { NextResponse } from "next/server";

export const maxDuration = 300;
import { runDailyJob } from "@/lib/cron/daily-jobs";
import { notifyDailyJobResult } from "@/lib/slack/daily-job-notify";
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
  const caseNumberParam = searchParams.get("caseNumber")?.trim();
  const force = searchParams.get("force") === "true";
  const skipSheetSync = searchParams.get("syncSheet") === "false";

  try {
    const result = await runDailyJob("all", {
      force,
      skipSheetSync,
      caseNumber: caseNumberParam,
    });

    const notify = await notifyDailyJobResult("all", result, { source: "cron" });

    return NextResponse.json({ ...result, slackNotify: notify }, { status: result.ok ? 200 : 500 });
  } catch (error) {
    const message = errorMessage(error) || "Daily job failed.";
    console.error("Daily cron failed", error);
    const notify = await notifyDailyJobResult("all", { ok: false, step: "all" }, { source: "cron", fatalError: message });
    return NextResponse.json({ ok: false, step: "all", error: message, slackNotify: notify }, { status: 500 });
  }
}
