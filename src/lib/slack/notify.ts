import { getAppOriginForNotifications } from "@/lib/auth/redirect-url";
import { syncSlackChannelsFromGoogleSheetIfConfigured } from "@/lib/google/sheets-sync";
import { postSlackMessage, resolveSlackChannelId, updateSlackChannelStageTopic } from "@/lib/slack/client";
import { getSlackChannelForCaseNumber, saveReminderThread } from "@/lib/slack/channels";
import { SLACK_REMINDER_COOLDOWN_DAYS, isGoogleSheetsSyncConfigured, isSlackEnabled } from "@/lib/slack/config";
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

async function getChannelIdForRecord(record: CaseRecord, allowSheetSync = true) {
  const mapping = await getSlackChannelForCaseNumber(record.shared.caseNumber);
  if (!mapping) {
    if (allowSheetSync && isGoogleSheetsSyncConfigured()) {
      await syncSlackChannelsFromGoogleSheetIfConfigured();
      return getChannelIdForRecord(record, false);
    }
    return null;
  }
  const channelId = mapping.slackChannelId ?? (await resolveSlackChannelId(mapping.slackChannelName));
  return channelId;
}

export async function notifySlackCaseStageUpdated(record: CaseRecord, previousStage: string | undefined) {
  if (!isSlackEnabled() || record.tracker.caseStage === previousStage) return;

  const channelId = await getChannelIdForRecord(record);
  if (!channelId) return;

  try {
    await updateSlackChannelStageTopic(channelId, record.tracker.caseStage);
    await postSlackMessage({
      channel: channelId,
      text: `Case stage updated to *${record.tracker.caseStage}* for ${record.shared.caseNumber} (${record.shared.clientName}).`,
    });
  } catch (error) {
    console.error("Slack stage notification failed", {
      caseNumber: record.shared.caseNumber,
      channelId,
      error: error instanceof Error ? error.message : error,
    });
  }
}

export async function notifySlackTrackerSaved(record: CaseRecord, patch: TrackerUpdateInput) {
  if (!isSlackEnabled()) return;

  const channelId = await getChannelIdForRecord(record);
  if (!channelId) return;

  try {
    if ("caseStage" in patch && patch.caseStage) {
      await updateSlackChannelStageTopic(channelId, record.tracker.caseStage);
    }

    if (trackerTouchesSourcesLit(patch)) {
      const appUrl = requireAppUrl();
      await postSlackMessage({
        channel: channelId,
        text: `Sources & Litigation Detail updated for *${record.shared.caseNumber}* by the case tracker.\n<${appUrl}/cases/${record.shared.id}|View case>`,
      });
    }
  } catch (error) {
    console.error("Slack tracker notification failed", {
      caseNumber: record.shared.caseNumber,
      channelId,
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

  const channelId = await getChannelIdForRecord(record);
  if (!channelId) return;

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
    channel: channelId,
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

    const channelId = await getChannelIdForRecord(record);
    if (!channelId) {
      skipped += 1;
      continue;
    }

    const text =
      reasons.length > 0
        ? buildSlackReminderMessage(record, reasons, appUrl)
        : buildForcedReminderMessage(record, appUrl);
    const posted = await postSlackMessage({ channel: channelId, text });
    if (posted?.ts && record.shared.id) {
      await saveReminderThread(record.shared.id, posted.ts);
    }
    sent += 1;
  }

  return { sent, skipped };
}
