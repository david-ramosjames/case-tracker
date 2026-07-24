import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { syncSlackChannelTopicSummaryForCaseNumber } from "@/lib/slack/channel-topic";

export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const body = (await request.json()) as { caseNumber?: string };
    const caseNumber = cleanCaseNumber(body.caseNumber ?? "");
    if (!caseNumber) {
      return NextResponse.json({ error: "Case number is required." }, { status: 400 });
    }

    const result = await syncSlackChannelTopicSummaryForCaseNumber(caseNumber);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, reason: result.reason, caseNumber },
        { status: result.reason === "no_case" ? 404 : 400 },
      );
    }

    return NextResponse.json({
      caseNumber,
      updated: result.updated,
      reason: result.reason,
      topic: result.topic,
      previousTopic: result.previousTopic,
      stageLabel: result.stageLabel,
      channelId: result.channelId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update Slack topic.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
