import { NextResponse } from "next/server";

export const maxDuration = 800;
export const dynamic = "force-dynamic";

import {
  getCentralHour,
  getCentralWeekdayShort,
  isSettledUndisbursedSendWindow,
} from "@/lib/cron/daily-cron-run";
import { runDailyJobStep } from "@/lib/cron/daily-jobs";
import { sendSettledUndisbursedSlackNotices } from "@/lib/slack/settled-undisbursed-notify";
import { getCronSecret } from "@/lib/slack/config";
import { getAttorneyGoals, getCases } from "@/lib/supabase/services";
import { errorMessage } from "@/lib/utils";

/**
 * Settled-not-disbursed Slack notices.
 * Schedule: Monday 10:00 and Wednesday 12:00 America/Chicago
 * (vercel.json fires both CST and CDT UTC equivalents; this gate picks the right hour).
 */
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
  const dryRun = searchParams.get("dryRun") === "true";
  const caseNumber = searchParams.get("caseNumber")?.trim();

  if (!force && !isSettledUndisbursedSendWindow()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Outside Mon 10:00 / Wed 12:00 Central send window",
      centralWeekday: getCentralWeekdayShort(),
      centralHour: getCentralHour(),
    });
  }

  try {
    const [records, goals] = await Promise.all([getCases(), getAttorneyGoals()]);
    const result = await runDailyJobStep("settledUndisbursed", () =>
      sendSettledUndisbursedSlackNotices(records, {
        goals,
        dryRun,
        caseNumber,
        scheduleOnly: !force,
        force,
      }),
    );
    if (result.error) {
      return NextResponse.json({ ok: false, ...result.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true, settledUndisbursed: result.data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}
