import { NextResponse } from "next/server";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { authorizeDocketFlowInternalRequest } from "@/lib/docketflow/internal-auth";
import { isSlackEnabled, isSlackTopicAutoSyncEnabled } from "@/lib/slack/config";
import { syncSlackChannelTopicSummary, syncSlackChannelTopicSummaryForCaseNumber } from "@/lib/slack/channel-topic";
import { getCaseById } from "@/lib/supabase/services";

export const dynamic = "force-dynamic";

type SyncBody = {
  caseId?: string;
  caseNumber?: string;
  source?: string;
};

/**
 * DocketFlow → Case Tracker: rewrite Slack channel topic after contact reassignment.
 *
 * POST /api/internal/docketflow/sync-slack-topic
 * Authorization: Bearer $DOCKETFLOW_INTERNAL_API_SECRET (or CRON_SECRET fallback)
 * Body: { caseId?: string, caseNumber?: string, source?: "docketflow" }
 */
export async function POST(request: Request) {
  const auth = authorizeDocketFlowInternalRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!isSlackEnabled()) {
    return NextResponse.json({ ok: true, skipped: true, reason: "slack_disabled" });
  }

  if (!isSlackTopicAutoSyncEnabled()) {
    return NextResponse.json({ ok: true, skipped: true, reason: "auto_sync_disabled" });
  }

  let body: SyncBody = {};
  try {
    body = (await request.json()) as SyncBody;
  } catch {
    body = {};
  }

  const caseId = body.caseId?.trim() || "";
  const caseNumber = cleanCaseNumber(body.caseNumber ?? "");

  if (!caseId && !caseNumber) {
    return NextResponse.json({ error: "caseId or caseNumber is required." }, { status: 400 });
  }

  try {
    if (caseId) {
      const record = await getCaseById(caseId);
      if (!record) {
        return NextResponse.json({ error: "Case not found.", caseId }, { status: 404 });
      }

      const result = await syncSlackChannelTopicSummary(record);
      if (result.reason === "no_channel" || result.reason === "invalid_channel") {
        return NextResponse.json(
          {
            ok: false,
            caseId,
            caseNumber: record.shared.caseNumber,
            reason: result.reason,
            error: `No Slack channel mapped for case ${record.shared.caseNumber}.`,
          },
          { status: 404 },
        );
      }
      if (result.reason === "set_failed") {
        return NextResponse.json(
          {
            ok: false,
            caseId,
            caseNumber: record.shared.caseNumber,
            reason: result.reason,
            error: "Slack rejected the topic update.",
            topic: result.topic ?? null,
            previousTopic: result.previousTopic ?? null,
          },
          { status: 502 },
        );
      }

      return NextResponse.json({
        ok: true,
        caseId,
        caseNumber: record.shared.caseNumber,
        updated: result.updated,
        reason: result.reason,
        topic: result.topic ?? null,
        previousTopic: result.previousTopic ?? null,
        stageLabel: result.stageLabel ?? null,
        channelId: result.channelId ?? null,
        source: body.source ?? "docketflow",
      });
    }

    const result = await syncSlackChannelTopicSummaryForCaseNumber(caseNumber);
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          caseNumber,
          reason: result.reason,
          error: result.error,
          topic: "topic" in result ? result.topic : null,
          previousTopic: "previousTopic" in result ? result.previousTopic : null,
        },
        { status: result.reason === "no_case" || result.reason === "no_channel" ? 404 : 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      caseNumber,
      updated: result.updated,
      reason: result.reason,
      topic: result.topic ?? null,
      previousTopic: result.previousTopic ?? null,
      stageLabel: result.stageLabel ?? null,
      channelId: result.channelId ?? null,
      source: body.source ?? "docketflow",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync Slack topic.";
    console.error("DocketFlow sync-slack-topic failed", { caseId, caseNumber, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
