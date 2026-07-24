import { getAppOriginForNotifications } from "@/lib/auth/redirect-url";
import { syncSlackChannelTopicForStage, syncSlackChannelTopicSummary } from "@/lib/slack/channel-topic";
import { normalizeSlackChannelId, postSlackMessage } from "@/lib/slack/client";
import { getSlackChannelForCaseNumber, saveReminderThread, saveStageUpdateThread } from "@/lib/slack/channels";
import { getStageSlackOptions } from "@/lib/slack/enum-replies";
import { SLACK_REMINDER_COOLDOWN_DAYS, isSlackEnabled, isSlackTopicAutoSyncEnabled } from "@/lib/slack/config";
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

export async function notifySlackCaseStageUpdated(record: CaseRecord, previousStage: string | undefined) {
  if (!isSlackEnabled() || record.tracker.caseStage === previousStage) return;

  const context = await getSlackContextForRecord(record);
  if (!context) return;

  try {
    if (isSlackTopicAutoSyncEnabled()) {
      await syncSlackChannelTopicSummary(record);
    } else {
      // Legacy: only patch trailing (Status) until full topic auto-sync is enabled.
      await syncSlackChannelTopicForStage({
        channelId: context.channelId,
        caseNumber: record.shared.caseNumber,
        stage: record.tracker.caseStage,
      });
    }

    const posted = await postSlackMessage({
      channel: context.channelId,
      text: [
        `Case stage updated to *${record.tracker.caseStage}* for ${record.shared.caseNumber} (${record.shared.clientName}).`,
        "Reply in this thread to correct the stage (e.g. `status: Litigation`).",
        `Valid stages: ${getStageSlackOptions().map((option) => `\`${option}\``).join(" · ")}`,
      ].join("\n"),
    });
    if (posted?.ts) {
      await saveStageUpdateThread(record.shared.id, record.shared.caseNumber, posted.ts);
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

  if (!trackerTouchesSourcesLit(patch)) return;

  try {
    const appUrl = requireAppUrl();
    await postSlackMessage({
      channel: context.channelId,
      text: `Sources & Litigation Detail updated for *${record.shared.caseNumber}* by the case tracker.\n<${appUrl}/cases/${record.shared.id}|View case>`,
    });
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
    if (posted?.ts) {
      const saved = await saveReminderThread(record.shared.id, record.shared.caseNumber, posted.ts);
      if (!saved) {
        console.warn("Slack reminder posted but thread id was not saved to tracker", {
          caseNumber: record.shared.caseNumber,
          caseId: record.shared.id,
          threadTs: posted.ts,
        });
      }
    }
    sent += 1;
  }

  return { sent, skipped };
}
