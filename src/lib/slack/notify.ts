import { getAppOriginForNotifications } from "@/lib/auth/redirect-url";
import {
  getSlackChannelTopicFromList,
  normalizeSlackChannelId,
  postSlackMessage,
  updateSlackChannelTopic,
} from "@/lib/slack/client";
import { getSlackChannelForCaseNumber, saveReminderThread, saveSlackTopicPrefix } from "@/lib/slack/channels";
import { buildTopicFromPrefix, extractTopicPrefix, resolveTopicStatusLabel } from "@/lib/slack/topic";
import { SLACK_REMINDER_COOLDOWN_DAYS, isSlackEnabled } from "@/lib/slack/config";
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
  const mapping = await getSlackChannelForCaseNumber(record.shared.caseNumber);
  if (!mapping?.slackChannelId) return null;
  const channelId = normalizeSlackChannelId(mapping.slackChannelId);
  if (!channelId) return null;
  return { channelId, mapping };
}

async function syncSlackTopicForCase(record: CaseRecord, options?: { fromTrackerStage?: boolean }) {
  const context = await getSlackContextForRecord(record);
  if (!context) return;

  let prefix = context.mapping.topicPrefix?.trim() ?? "";

  if (!prefix) {
    const liveTopic = await getSlackChannelTopicFromList(context.channelId);
    if (liveTopic) {
      prefix = extractTopicPrefix(liveTopic);
      if (prefix) {
        await saveSlackTopicPrefix(record.shared.caseNumber, prefix);
      }
    }
  }

  if (!prefix) {
    console.warn("Slack topic update skipped — no cached prefix with mentions", {
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
    await syncSlackTopicForCase(record, { fromTrackerStage: true });
    await postSlackMessage({
      channel: context.channelId,
      text: `Case stage updated to *${record.tracker.caseStage}* for ${record.shared.caseNumber} (${record.shared.clientName}).`,
    });
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
    if ("caseStage" in patch && patch.caseStage) {
      await syncSlackTopicForCase(record, { fromTrackerStage: true });
    }

    if (trackerTouchesSourcesLit(patch)) {
      const appUrl = requireAppUrl();
      await postSlackMessage({
        channel: context.channelId,
        text: `Sources & Litigation Detail updated for *${record.shared.caseNumber}* by the case tracker.\n<${appUrl}/cases/${record.shared.id}|View case>`,
      });
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
