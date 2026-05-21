import { getConfiguredSiteOrigin } from "@/lib/auth/redirect-url";
import { syncSlackChannelsFromGoogleSheetIfConfigured } from "@/lib/google/sheets-sync";
import { postSlackMessage, resolveSlackChannelId, setSlackChannelTopic } from "@/lib/slack/client";
import { getSlackChannelForCaseNumber, saveReminderThread } from "@/lib/slack/channels";
import { SLACK_REMINDER_COOLDOWN_DAYS, isGoogleSheetsSyncConfigured, isSlackEnabled } from "@/lib/slack/config";
import {
  buildCaseStageTopic,
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

  const topic = buildCaseStageTopic(record);
  await setSlackChannelTopic(channelId, topic);

  await postSlackMessage({
    channel: channelId,
    text: `Case stage updated to *${record.tracker.caseStage}* for ${record.shared.caseNumber} (${record.shared.clientName}).`,
  });
}

export async function notifySlackTrackerSaved(record: CaseRecord, patch: TrackerUpdateInput) {
  if (!isSlackEnabled()) return;

  const channelId = await getChannelIdForRecord(record);
  if (!channelId) return;

  if ("caseStage" in patch && patch.caseStage) {
    const topic = buildCaseStageTopic(record);
    await setSlackChannelTopic(channelId, topic);
  }

  if (trackerTouchesSourcesLit(patch)) {
    const appUrl = getConfiguredSiteOrigin() ?? "http://localhost:3000";
    await postSlackMessage({
      channel: channelId,
      text: `Sources & Litigation Detail updated for *${record.shared.caseNumber}* by the case tracker.\n<${appUrl}/cases/${record.shared.id}|View case>`,
    });
  }
}

export async function notifySlackCommentPosted(
  record: CaseRecord,
  input: { type: CommentType; body: string; authorName: string },
) {
  if (!isSlackEnabled()) return;
  if (input.type !== "general_note" && input.type !== "manager_note" && input.type !== "attorney_update") return;

  const channelId = await getChannelIdForRecord(record);
  if (!channelId) return;

  const label =
    input.type === "manager_note" ? "Manager Note" : input.type === "attorney_update" ? "Attorney Update" : "Comment";

  const appUrl = getConfiguredSiteOrigin() ?? "http://localhost:3000";
  await postSlackMessage({
    channel: channelId,
    text: [
      `*${label}* on ${record.shared.caseNumber} — ${input.authorName}`,
      input.body,
      `<${appUrl}/cases/${record.shared.id}|Open case>`,
    ].join("\n"),
  });
}

export async function sendSlackCaseReminders(
  records: CaseRecord[],
  settings: CaseTrackerSettings,
  options?: { force?: boolean },
) {
  if (!isSlackEnabled()) return { sent: 0, skipped: 0 };

  const appUrl = getConfiguredSiteOrigin() ?? "http://localhost:3000";
  let sent = 0;
  let skipped = 0;

  for (const record of records) {
    if (!record.tracker.isActive || record.shared.status !== "Active") {
      skipped += 1;
      continue;
    }

    const reasons = getSlackReminderReasons(record, settings);
    if (reasons.length === 0) {
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

    const text = buildSlackReminderMessage(record, reasons, appUrl);
    const posted = await postSlackMessage({ channel: channelId, text });
    if (posted?.ts && record.shared.id) {
      await saveReminderThread(record.shared.id, posted.ts);
    }
    sent += 1;
  }

  return { sent, skipped };
}
