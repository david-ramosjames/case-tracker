import { NextResponse } from "next/server";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { authorizeDocketFlowInternalRequest } from "@/lib/docketflow/internal-auth";
import { inviteCaseRecordTeamToSlackChannel } from "@/lib/slack/channel-members";
import { getSlackChannelForCaseNumber } from "@/lib/slack/channels";
import { isSlackEnabled, isSlackTopicAutoSyncEnabled } from "@/lib/slack/config";
import { syncSlackChannelTopicSummary } from "@/lib/slack/channel-topic";
import { getCaseById } from "@/lib/supabase/services";
import { type CaseRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

type SyncBody = {
  caseId?: string;
  caseNumber?: string;
  source?: string;
};

async function loadRecordForSync(caseId: string, caseNumber: string): Promise<CaseRecord | null> {
  if (caseId) return getCaseById(caseId);
  if (!caseNumber) return null;

  const { getCases } = await import("@/lib/supabase/services");
  const records = await getCases();
  return records.find((item) => cleanCaseNumber(item.shared.caseNumber) === caseNumber) ?? null;
}

/**
 * DocketFlow → Case Tracker: invite reassigned team members to the case Slack channel
 * and optionally rewrite the channel topic after contact reassignment.
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
    const record = await loadRecordForSync(caseId, caseNumber);
    if (!record) {
      return NextResponse.json({ error: "Case not found.", caseId: caseId || null, caseNumber: caseNumber || null }, { status: 404 });
    }

    const mapping = await getSlackChannelForCaseNumber(record.shared.caseNumber);
    const channelInvite = mapping?.slackChannelId
      ? await inviteCaseRecordTeamToSlackChannel(record, mapping.slackChannelId)
      : null;

    if (!isSlackTopicAutoSyncEnabled()) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "auto_sync_disabled",
        caseId: record.shared.id,
        caseNumber: record.shared.caseNumber,
        channelId: mapping?.slackChannelId ?? null,
        channelInvite,
        source: body.source ?? "docketflow",
      });
    }

    const result = await syncSlackChannelTopicSummary(record);
    if (result.reason === "no_channel" || result.reason === "missing_channel_id" || result.reason === "invalid_channel") {
      return NextResponse.json(
        {
          ok: false,
          caseId: record.shared.id,
          caseNumber: record.shared.caseNumber,
          reason: result.reason,
          error:
            result.reason === "missing_channel_id"
              ? `Case has Slack channel name “${"channelName" in result ? result.channelName : "?"}” but no Slack Channel ID.`
              : `No Slack channel mapped for case ${record.shared.caseNumber}.`,
          channelInvite,
        },
        { status: 404 },
      );
    }
    if (result.reason === "set_failed") {
      return NextResponse.json(
        {
          ok: false,
          caseId: record.shared.id,
          caseNumber: record.shared.caseNumber,
          reason: result.reason,
          error: "Slack rejected the topic update.",
          topic: result.topic ?? null,
          previousTopic: result.previousTopic ?? null,
          channelInvite,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      caseId: record.shared.id,
      caseNumber: record.shared.caseNumber,
      updated: result.updated,
      reason: result.reason,
      topic: result.topic ?? null,
      previousTopic: result.previousTopic ?? null,
      stageLabel: result.stageLabel ?? null,
      channelId: result.channelId ?? null,
      channelInvite,
      source: body.source ?? "docketflow",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync Slack topic.";
    console.error("DocketFlow sync-slack-topic failed", { caseId, caseNumber, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
