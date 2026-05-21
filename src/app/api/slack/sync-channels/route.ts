import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { syncSlackChannelsFromGoogleSheet } from "@/lib/google/sheets-sync";

export async function POST() {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const result = await syncSlackChannelsFromGoogleSheet();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Slack channel sync failed", error);
    const message = error instanceof Error ? error.message : "Slack channel sync failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
