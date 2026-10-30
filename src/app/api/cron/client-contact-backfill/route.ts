import { NextResponse } from "next/server";
import { syncClientContactLineBackfill } from "@/lib/client-contact/sync-quo";
import { getCentralHour, isDailyCronSlot, isDailyCronSlotDue } from "@/lib/cron/daily-cron-run";
import { getCronSecret } from "@/lib/slack/config";
import { errorMessage } from "@/lib/utils";

export const maxDuration = 800;
export const dynamic = "force-dynamic";

/**
 * Slow Quo line-by-phone backfill for webhook orphans (client phone / contactIds
 * missing on the ledger row). Runs morning + afternoon (same Central slots as
 * contact sync) with a persistent cursor so yesterday’s calls are caught by
 * the next day’s review without an hourly job.
 */
export async function GET(request: Request) {
  const secret = getCronSecret();
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const slot = new URL(request.url).searchParams.get("slot");
  if (isDailyCronSlot(slot) && !isDailyCronSlotDue(slot)) {
    return NextResponse.json({ ok: true, skipped: true, slot, centralHour: getCentralHour() });
  }

  try {
    const result = await syncClientContactLineBackfill();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error) || "Client contact backfill failed." },
      { status: 500 },
    );
  }
}
