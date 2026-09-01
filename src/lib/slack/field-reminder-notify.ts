import { getAppOriginForNotifications } from "@/lib/auth/redirect-url";
import { caseRequiresOngoingUpdates } from "@/lib/case-status";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { resolveChannelUserMentions } from "@/lib/slack/channel-topic";
import { fetchChannelTopic, normalizeSlackChannelId, postSlackMessage } from "@/lib/slack/client";
import { loadSlackChannelMapByCaseNumber } from "@/lib/slack/channels";
import { isSlackEnabled } from "@/lib/slack/config";
import { getSlackFieldAlertSkipReason } from "@/lib/slack/field-alert-guards";
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
import { type CaseRecord, type CaseTrackerSettings } from "@/lib/types";
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

export type FieldReminderPreviewItem = {
  caseNumber: string;
  clientName: string;
  action: "post" | "skip";
  fields: string[];
  reason?: string;
};

export async function sendSlackFieldReminders(
  records: CaseRecord[],
  options?: {
    force?: boolean;
    forceSend?: boolean;
    caseNumber?: string;
    dryRun?: boolean;
    settings?: Pick<
      CaseTrackerSettings,
      "slackFieldAlertGraceDays" | "attorneySlackFieldAlertsDisabled"
    >;
  },
) {
  if (!isSlackEnabled()) return { posted: 0, skipped: 0, fields: 0, dryRun: Boolean(options?.dryRun), previewItems: [] as FieldReminderPreviewItem[] };

  const appUrl = getAppOriginForNotifications();
  if (!appUrl) throw new Error("Set NEXT_PUBLIC_SITE_URL for Slack links.");

  const alertSettings = options?.settings ?? {
    slackFieldAlertGraceDays: 7,
    attorneySlackFieldAlertsDisabled: [],
  };

  const channelMap = await loadSlackChannelMapByCaseNumber();
  let posted = 0;
  let skipped = 0;
  let fields = 0;
  const previewItems: FieldReminderPreviewItem[] = [];

  for (const record of records) {
    if (!options?.forceSend && (!record.tracker.isActive || !caseRequiresOngoingUpdates(record))) {
      skipped += 1;
      if (options?.dryRun) {
        previewItems.push({
          caseNumber: record.shared.caseNumber,
          clientName: record.shared.clientName,
          action: "skip",
          fields: [],
          reason: record.tracker.caseStage === "Referred" ? "referred case" : "inactive case",
        });
      }
      continue;
    }

    const alertSkipReason = getSlackFieldAlertSkipReason(record, alertSettings);
    if (!options?.forceSend && alertSkipReason) {
      skipped += 1;
      if (options?.dryRun) {
        previewItems.push({
          caseNumber: record.shared.caseNumber,
          clientName: record.shared.clientName,
          action: "skip",
          fields: [],
          reason: alertSkipReason,
        });
      }
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
      if (options?.dryRun) {
        previewItems.push({
          caseNumber: record.shared.caseNumber,
          clientName: record.shared.clientName,
          action: "skip",
          fields: [],
          reason: "no due fields",
        });
      }
      continue;
    }

    const context = getSlackContextForRecord(record, channelMap);
    if (!context) {
      skipped += 1;
      if (options?.dryRun) {
        previewItems.push({
          caseNumber: record.shared.caseNumber,
          clientName: record.shared.clientName,
          action: "skip",
          fields: [...fieldsToPost],
          reason: "no Slack channel",
        });
      }
      continue;
    }

    if (options?.dryRun) {
      previewItems.push({
        caseNumber: record.shared.caseNumber,
        clientName: record.shared.clientName,
        action: "post",
        fields: [...fieldsToPost],
      });
      posted += 1;
      fields += fieldsToPost.length;
      continue;
    }

    const topic = await fetchChannelTopic(context.channelId);
    const topicMentions = await resolveChannelUserMentions({
      topic,
      attorneyEmail: record.attorney.email,
      paralegalEmail: record.paralegal.email,
      attorneyName: record.attorney.name,
      paralegalName: record.paralegal.name,
      attorneySlackUserId: record.attorney.slackUserId,
      paralegalSlackUserId: record.paralegal.slackUserId,
      mentionRoles: "attorney",
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

  return { posted, skipped, fields, dryRun: Boolean(options?.dryRun), previewItems };
}
