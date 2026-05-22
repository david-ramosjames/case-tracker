import { getAppOriginForNotifications } from "@/lib/auth/redirect-url";
import { fetchSlackChannelTopic, normalizeSlackChannelId, postSlackMessage, updateSlackChannelTopic } from "@/lib/slack/client";
import { getSlackChannelForCaseNumber, saveReminderThread } from "@/lib/slack/channels";
import { SLACK_REMINDER_COOLDOWN_DAYS, isSlackEnabled } from "@/lib/slack/config";
import { buildTopicFromPrefix, extractTopicPrefix, resolveTopicStatusLabel } from "@/lib/slack/topic";
import {
  buildSlackReminderMessage,
  getSlackReminderReasons,
  trackerTouchesSourcesLit,
} from "@/lib/slack/reminders";
import {
  type CaseRecord,
  type CaseTrackerSettings,
  type CommentType,
  type TrackerUpdateInput,
} from "@/lib/types";
import { daysSince } from "@/lib/utils";

function requireAppUrl() {
  const appUrl = getAppOriginForNotifications();
  if (!appUrl) {
    throw new Error("Set NEXT_PUBLIC_SITE_URL (e.g. https://rjl-case-tracker.vercel.app) for Slack links.");
  }
  return appUrl;
}

async function getSlackContextForRecord(record: CaseRecord) {
  if (!isSlackEnabled()) {
    console.warn("Slack skipped: SLACK_BOT_TOKEN not configured");
    return null;
  }

  const mapping = await getSlackChannelForCaseNumber(record.shared.caseNumber);
  if (!mapping?.slackChannelId) {
    console.warn("Slack skipped: no slack_channel_id in database", {
      caseNumber: record.shared.caseNumber,
    });
    return null;
  }

  const channelId = normalizeSlackChannelId(mapping.slackChannelId);
  if (!channelId) {
    console.warn("Slack skipped: invalid slack_channel_id", {
      caseNumber: record.shared.caseNumber,
      slackChannelId: mapping.slackChannelId,
    });
    return null;
  }

  return { channelId, mapping };
}

async function syncSlackTopicForCase(record: CaseRecord, options?: { fromTrackerStage?: boolean }) {
  const context = await getSlackContextForRecord(record);
  if (!context) return;

  const liveTopic = await fetchSlackChannelTopic(context.channelId);
  const prefix = liveTopic ? extractTopicPrefix(liveTopic) : "";

  if (!prefix) {
    console.warn("Slack topic update skipped — could not read channel topic from Slack", {
      caseNumber: record.shared.caseNumber,
      channelId: context.channelId,
    });
    return;
  }

  const statusLabel = resolveTopicStatusLabel(record.tracker.caseStage, context.mapping, options);
  const topic = buildTopicFromPrefix(prefix, statusLabel);
  if (!topic) return;

  await updateSlackChannelTopic(context.channelId, topic);
}

export async function notifySlackCaseStageUpdated(record: CaseRecord, previousStage: string | undefined) {
  if (!isSlackEnabled() || record.tracker.caseStage === previousStage) return;

  const context = await getSlackContextForRecord(record);
  if (!context) return;

  try {
    await postSlackMessage({
      channel: context.channelId,
      text: `Case stage updated to *${record.tracker.caseStage}* for ${record.shared.caseNumber} (${record.shared.clientName}).`,
    });
    try {
      await syncSlackTopicForCase(record, { fromTrackerStage: true });
    } catch (topicError) {
      console.warn("Slack topic update failed after stage message", {
        caseNumber: record.shared.caseNumber,
        error: topicError instanceof Error ? topicError.message : topicError,
      });
    }
  } catch (error) {
    console.error("Slack stage notification failed", {
      caseNumber: record.shared.caseNumber,
      channelId: context.channelId,
      error: error instanceof Error ? error.message : error,
    });
  }
}

export async function notifySlackTrackerSaved(record: CaseRecord, patch: TrackerUpdateInput) {
  if (!isSlackEnabled()) return;

  const context = await getSlackContextForRecord(record);
  if (!context) return;

  try {
    if (trackerTouchesSourcesLit(patch)) {
      const appUrl = requireAppUrl();
      await postSlackMessage({
        channel: context.channelId,
        text: `Sources & Litigation Detail updated for *${record.shared.caseNumber}* by the case tracker.\n<${appUrl}/cases/${record.shared.id}|View case>`,
      });
    }

    if ("caseStage" in patch && patch.caseStage) {
      try {
        await syncSlackTopicForCase(record, { fromTrackerStage: true });
      } catch (topicError) {
        console.warn("Slack topic update failed after tracker save", {
          caseNumber: record.shared.caseNumber,
          error: topicError instanceof Error ? topicError.message : topicError,
        });
      }
    }
  } catch (error) {
    console.error("Slack tracker notification failed", {
      caseNumber: record.shared.caseNumber,
      channelId: context.channelId,
      error: error instanceof Error ? error.message : error,
    });
  }
}

export async function notifySlackCommentPosted(
  record: CaseRecord,
  input: { type: CommentType; body: string; authorName: string },
) {
  if (!isSlackEnabled()) return;
  const slackCommentTypes = new Set<CommentType>([
    "general_note",
    "manager_note",
    "attorney_update",
    "risk_flag",
  ]);
  if (!slackCommentTypes.has(input.type)) return;

  const context = await getSlackContextForRecord(record);
  if (!context) return;

  const label =
    input.type === "manager_note"
      ? "Manager Note"
      : input.type === "attorney_update"
        ? "Attorney Update"
        : input.type === "risk_flag"
          ? "Risk Flag"
          : "Comment";

  const appUrl = requireAppUrl();
  await postSlackMessage({
    channel: context.channelId,
    text: [
      `*${label}* on ${record.shared.caseNumber} — ${input.authorName}`,
      input.body,
      `<${appUrl}/cases/${record.shared.id}|Open case>`,
    ].join("\n"),
  });
}

function buildForcedReminderMessage(record: CaseRecord, appUrl: string) {
  const caseLink = `${appUrl}/cases/${record.shared.id}`;
  return [
    `*Case tracker test reminder* — ${record.shared.caseNumber} (${record.shared.clientName})`,
    `<${caseLink}|Open in Case Tracker>`,
    "",
    "_Forced send for testing (cron ?caseNumber=…&force=true)._",
  ].join("\n");
}

export async function sendSlackCaseReminders(
  records: CaseRecord[],
  settings: CaseTrackerSettings,
  options?: { force?: boolean; forceSend?: boolean },
) {
  if (!isSlackEnabled()) return { sent: 0, skipped: 0 };

  const appUrl = requireAppUrl();
  let sent = 0;
  let skipped = 0;

  for (const record of records) {
    if (!options?.forceSend && (!record.tracker.isActive || record.shared.status !== "Active")) {
      skipped += 1;
      continue;
    }

    const reasons = getSlackReminderReasons(record, settings);
    if (reasons.length === 0 && !options?.forceSend) {
      skipped += 1;
      continue;
    }

    if (!options?.force && record.tracker.lastSlackReminderAt && daysSince(record.tracker.lastSlackReminderAt) < SLACK_REMINDER_COOLDOWN_DAYS) {
      skipped += 1;
      continue;
    }

    const context = await getSlackContextForRecord(record);
    if (!context) {
      skipped += 1;
      continue;
    }

    const text =
      reasons.length > 0
        ? buildSlackReminderMessage(record, reasons, appUrl)
        : buildForcedReminderMessage(record, appUrl);
    const posted = await postSlackMessage({ channel: context.channelId, text });
    if (posted?.ts && record.shared.id) {
      await saveReminderThread(record.shared.id, posted.ts);
    }
    sent += 1;
  }

  return { sent, skipped };
}
