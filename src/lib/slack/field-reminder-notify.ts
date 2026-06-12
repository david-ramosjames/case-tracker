import { getAppOriginForNotifications } from "@/lib/auth/redirect-url";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { resolveChannelUserMentions } from "@/lib/slack/channel-topic";
import { fetchChannelTopic, normalizeSlackChannelId, postSlackMessage } from "@/lib/slack/client";
import { loadSlackChannelMapByCaseNumber } from "@/lib/slack/channels";
import { isSlackEnabled } from "@/lib/slack/config";
import {
  FIELD_REMINDER_COOLDOWN_DAYS,
  buildFieldReminderMessage,
  getDueFieldReminders,
} from "@/lib/slack/field-reminders";
import {
  createFieldReminder,
  dismissFieldReminder,
  getOpenFieldReminder,
} from "@/lib/supabase/field-reminders";
import { type CaseRecord } from "@/lib/types";
import { daysSince } from "@/lib/utils";

function getSlackContextForRecord(
  record: CaseRecord,
  channelMap: Map<string, { slackChannelId: string | null }>,
) {
  if (!isSlackEnabled()) return null;

  const mapping = channelMap.get(cleanCaseNumber(record.shared.caseNumber));
  if (!mapping?.slackChannelId) return null;

  const channelId = normalizeSlackChannelId(mapping.slackChannelId);
  if (!channelId) return null;

  return { channelId };
}

export async function sendSlackFieldReminders(
  records: CaseRecord[],
  options?: { force?: boolean; forceSend?: boolean; caseNumber?: string },
) {
  if (!isSlackEnabled()) return { posted: 0, skipped: 0, fields: 0 };

  const appUrl = getAppOriginForNotifications();
  if (!appUrl) throw new Error("Set NEXT_PUBLIC_SITE_URL for Slack links.");

  const channelMap = await loadSlackChannelMapByCaseNumber();
  let posted = 0;
  let skipped = 0;
  let fields = 0;

  for (const record of records) {
    if (!options?.forceSend && (!record.tracker.isActive || record.shared.status !== "Active")) {
      skipped += 1;
      continue;
    }

    const dueFields = getDueFieldReminders(record);
    const fieldsToPost =
      dueFields.length > 0
        ? dueFields
        : options?.forceSend
          ? (["targetResolutionQuarter"] as const)
          : [];

    if (fieldsToPost.length === 0) {
      skipped += 1;
      continue;
    }

    const context = getSlackContextForRecord(record, channelMap);
    if (!context) {
      skipped += 1;
      continue;
    }

    const topic = await fetchChannelTopic(context.channelId);
    const topicMentions = await resolveChannelUserMentions({
      topic,
      attorneyEmail: record.attorney.email,
      paralegalEmail: record.paralegal.email,
      attorneyName: record.attorney.name,
      paralegalName: record.paralegal.name,
    });

    for (const [index, fieldKey] of fieldsToPost.entries()) {
      fields += 1;

      const open = await getOpenFieldReminder(record.shared.id, fieldKey);
      if (open?.postedAt && !options?.force && daysSince(open.postedAt) < FIELD_REMINDER_COOLDOWN_DAYS) {
        skipped += 1;
        continue;
      }
      if (open) {
        await dismissFieldReminder(open.id, record.shared.id, "Replaced by new field reminder");
      }

      const text = buildFieldReminderMessage(record, fieldKey, appUrl, {
        includeCaseSummary: index === 0,
        topicMentions: index === 0 ? topicMentions : undefined,
      });
      const message = await postSlackMessage({ channel: context.channelId, text });
      if (!message?.ts) {
        skipped += 1;
        continue;
      }

      await createFieldReminder({
        caseId: record.shared.id,
        trackerEntryId: record.tracker.id,
        fieldKey,
        slackThreadTs: message.ts,
      });

      posted += 1;
    }
  }

  return { posted, skipped, fields };
}
