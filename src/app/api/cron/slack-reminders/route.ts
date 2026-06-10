import { NextResponse } from "next/server";
import { runDailyJob } from "@/lib/cron/daily-jobs";
import { getCronSecret, isNineAmCentral } from "@/lib/slack/config";

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

  const result = await runDailyJob("all", {
    force,
    skipSheetSync,
    caseNumber: caseNumberParam,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
