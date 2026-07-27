import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { syncAllSlackChannelTopicSummaries } from "@/lib/slack/channel-topic";

export const maxDuration = 800;

export async function POST() {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const result = await syncAllSlackChannelTopicSummaries();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync Slack topics.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
