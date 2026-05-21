import { NextResponse } from "next/server";
import { syncSlackChannelsFromGoogleSheetIfConfigured } from "@/lib/google/sheets-sync";
import { getCronSecret } from "@/lib/slack/config";
import { sendSlackCaseReminders } from "@/lib/slack/notify";
import { getCases, getSettings } from "@/lib/supabase/services";

export async function GET(request: Request) {
  const secret = getCronSecret();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sheetSync = await syncSlackChannelsFromGoogleSheetIfConfigured();
    const [records, settings] = await Promise.all([getCases(), getSettings()]);
    const reminders = await sendSlackCaseReminders(records, settings);
    return NextResponse.json({ ok: true, sheetSync, reminders });
  } catch (error) {
    console.error("Slack reminder cron failed", error);
    const message = error instanceof Error ? error.message : "Slack reminder cron failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
