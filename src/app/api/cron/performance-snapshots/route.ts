import { NextResponse } from "next/server";
import { chicagoDateParts, weekStartMondayCt } from "@/lib/performance/weeks";
import {
  captureMondayPlanSnapshot,
  captureWeekCloseActualsSnapshot,
} from "@/lib/performance/snapshots";
import { getCronSecret } from "@/lib/slack/config";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Monday 9:30 CT checkpoint and Sunday EOW actuals.
 * Snapshots are immutable; live plans stay editable.
 */
export async function GET(request: Request) {
  try {
    const secret = getCronSecret();
    if (!secret) {
      return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
    }
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const kind = searchParams.get("kind") ?? "auto";
    const parts = chicagoDateParts();
    const weekStart = weekStartMondayCt();

    if (kind === "monday" || (kind === "auto" && parts.hour === 9)) {
      const snapshot = await captureMondayPlanSnapshot(weekStart);
      return NextResponse.json({ ok: true, kind: "monday_plan", snapshot });
    }

    if (kind === "eow" || (kind === "auto" && parts.hour === 23)) {
      // Close the week that is ending (Monday of current week if Sunday night).
      const snapshot = await captureWeekCloseActualsSnapshot(weekStart);
      return NextResponse.json({ ok: true, kind: "week_close_actuals", snapshot });
    }

    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "No snapshot kind matched; pass kind=monday|eow",
      centralHour: parts.hour,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
