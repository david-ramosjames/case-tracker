import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { syncAllSlackChannelTopicSummaries } from "@/lib/slack/channel-topic";

export const maxDuration = 800;

export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    let outdatedOnly = false;
    let skipRead = false;
    let neverSyncedOnly = false;
    try {
      const body = (await request.json()) as {
        outdatedOnly?: boolean;
        skipRead?: boolean;
        neverSyncedOnly?: boolean;
      };
      outdatedOnly = Boolean(body.outdatedOnly);
      skipRead = Boolean(body.skipRead);
      neverSyncedOnly = Boolean(body.neverSyncedOnly);
    } catch {
      // empty body is fine — sync all
    }

    const result = await syncAllSlackChannelTopicSummaries({
      outdatedOnly,
      skipRead,
      neverSyncedOnly,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync Slack topics.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
