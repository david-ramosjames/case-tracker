import { getAppOriginForNotifications } from "@/lib/auth/redirect-url";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { resolveChannelUserMentions } from "@/lib/slack/channel-topic";
import { fetchChannelTopic, normalizeSlackChannelId, postSlackMessage } from "@/lib/slack/client";
import { loadSlackChannelMapByCaseNumber, saveReminderThread } from "@/lib/slack/channels";
import { SLACK_REMINDER_COOLDOWN_DAYS, isSlackEnabled } from "@/lib/slack/config";
import {
  COMPLETENESS_FIELDS,
  getCaseAttorneyScore,
  hasCompletenessField,
  type CompletenessFieldId,
} from "@/lib/attorney-score";
import { getIncompleteCompletenessLabels } from "@/lib/slack/field-reminders";
import { type CaseRecord } from "@/lib/types";
import { daysSince } from "@/lib/utils";

function completenessFieldExampleLine(fieldId: CompletenessFieldId) {
  switch (fieldId) {
    case "caseType":
      return "Type: Auto Accident";
    case "liability":
      return "Liability: Clear";
    case "quarter":
      return "Expected disbursement quarter: 2026 Q3";
    case "minimumValue":
      return "Minimum: 75000";
    case "referralFee":
      return "Referral fee: 33%";
    case "policyLimits":
      return "Policy limits: 100000";
    case "expectedLit":
      return "Expected lit: Pre";
    case "sources":
      return "Sources: Updated treatment status...";
  }
}

function missingFieldExampleLines(record: CaseRecord) {
  return COMPLETENESS_FIELDS.filter((field) => !hasCompletenessField(record, field.id))
    .map((field) => completenessFieldExampleLine(field.id))
    .slice(0, 6);
}

export function buildMissingFieldsMessage(
  record: CaseRecord,
  appUrl: string,
  options?: { topicMentions?: string },
) {
  const missing = getIncompleteCompletenessLabels(record);
  const score = getCaseAttorneyScore(record);
  const caseLink = `${appUrl}/cases/${record.shared.id}`;
  const lines: string[] = [];

  if (options?.topicMentions) {
    lines.push(options.topicMentions);
  }

  lines.push(
    `*Case #${record.shared.caseNumber}* (${record.shared.clientName})`,
    `Case Tracker Score: *${score.percent}%* (completeness ${score.completenessPercent}% · freshness ${score.freshnessPercent}%)`,
    `Empty fields still needed: *${missing.join(", ")}*`,
    "",
  );

  const examples = missingFieldExampleLines(record);
  if (examples.length > 0) {
    lines.push("_Reply in this thread with updates, for example:_", "```", ...examples, "```", "");
  } else {
    lines.push("Please fill these in on Case Tracker or reply in this thread with updates.", "");
  }

  lines.push(`<${caseLink}|Open in Case Tracker>`);
  return lines.join("\n");
}

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

export async function sendSlackMissingFieldNotices(
  records: CaseRecord[],
  options?: { force?: boolean; forceSend?: boolean },
) {
  if (!isSlackEnabled()) return { posted: 0, skipped: 0 };

  const appUrl = getAppOriginForNotifications();
  if (!appUrl) throw new Error("Set NEXT_PUBLIC_SITE_URL for Slack links.");

  const channelMap = await loadSlackChannelMapByCaseNumber();
  let posted = 0;
  let skipped = 0;

  for (const record of records) {
    if (!options?.forceSend && (!record.tracker.isActive || record.shared.status !== "Active")) {
      skipped += 1;
      continue;
    }

    const missing = getIncompleteCompletenessLabels(record);
    if (missing.length === 0 && !options?.forceSend) {
      skipped += 1;
      continue;
    }

    if (
      !options?.force &&
      record.tracker.lastSlackReminderAt &&
      daysSince(record.tracker.lastSlackReminderAt) < SLACK_REMINDER_COOLDOWN_DAYS
    ) {
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

    const text =
      missing.length > 0
        ? buildMissingFieldsMessage(record, appUrl, { topicMentions })
        : [
            ...(topicMentions ? [topicMentions] : []),
            `*Case #${record.shared.caseNumber}* (${record.shared.clientName})`,
            "_Test missing-fields notice — this case has no empty completeness fields._",
            `<${appUrl}/cases/${record.shared.id}|Open in Case Tracker>`,
          ].join("\n");

    const message = await postSlackMessage({ channel: context.channelId, text });
    if (!message?.ts) {
      skipped += 1;
      continue;
    }

    await saveReminderThread(record.shared.id, record.shared.caseNumber, message.ts);
    posted += 1;
  }

  return { posted, skipped };
}
