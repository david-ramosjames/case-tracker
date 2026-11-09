import { NextResponse } from "next/server";
import {
  getCentralWeekdayShort,
  isSaturdayEvidenceEnrichmentDue,
  notifySaturdayEvidenceEnrichment,
  runSaturdayEvidenceEnrichment,
} from "@/lib/cron/saturday-evidence-enrichment";
import { getCentralHour } from "@/lib/cron/daily-cron-run";
import { getCronSecret } from "@/lib/slack/config";
import { errorMessage } from "@/lib/utils";

export const maxDuration = 800;
export const dynamic = "force-dynamic";

/**
 * Saturday-night Quo conversation enrichment + Sentiment evidence Slack caching.
 * Weekly sentiment lands Friday evening; this job fills conversation ids / permalinks
 * afterward and can re-run for several Saturday night hours until budgets finish.
 *
 * Schedules both CDT/CST UTC times in vercel.json; gate keeps only Saturday 9–11pm CT.
 * Pass ?force=1 to run outside that window (admin/manual).
 */
export async function GET(request: Request) {
  const secret = getCronSecret();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true";
  if (!force && !isSaturdayEvidenceEnrichmentDue()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "outside_saturday_night_window",
      weekday: getCentralWeekdayShort(),
      centralHour: getCentralHour(),
    });
  }

  try {
    console.info("Saturday evidence enrichment starting", {
      force,
      weekday: getCentralWeekdayShort(),
      centralHour: getCentralHour(),
    });
    const result = await runSaturdayEvidenceEnrichment();
    const notify = await notifySaturdayEvidenceEnrichment(result);
    console.info("Saturday evidence enrichment finished", {
      ok: result.ok,
      inboxLookups: result.phoneSync.inboxLookups,
      partial: result.phoneSync.partial,
      evidenceResolved: result.evidenceLinks?.resolved,
      notify,
    });
    return NextResponse.json({ ok: result.ok !== false, ...result, notify });
  } catch (error) {
    const message = errorMessage(error) || "Saturday evidence enrichment failed.";
    console.error("Saturday evidence enrichment failed", message, error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
