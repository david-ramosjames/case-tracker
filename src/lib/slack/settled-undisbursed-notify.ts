import { getAppOriginForNotifications } from "@/lib/auth/redirect-url";
import { isCaseFullyDisbursed } from "@/lib/case-status";
import { cleanCaseNumber } from "@/lib/csv/parse";
import {
  coerceCheckStatus,
  coerceClosingStatus,
  coerceReductionsStatus,
} from "@/lib/case-options";
import { isSettledUndisbursedSendWindow } from "@/lib/cron/daily-cron-run";
import { isResultsTabCase } from "@/lib/results-commission-year";
import { resolveChannelUserMentions } from "@/lib/slack/channel-topic";
import { fetchChannelTopic, normalizeSlackChannelId, postSlackMessage } from "@/lib/slack/client";
import { loadSlackChannelMapByCaseNumber } from "@/lib/slack/channels";
import { isSlackEnabled } from "@/lib/slack/config";
import { type AttorneyGoal, type CaseRecord } from "@/lib/types";

/**
 * Settled cases still open for disbursement — same population as Results with
 * Disbursed = No (and on the Results tab when goals are available).
 */
export function isSettledNotDisbursedResultsCase(record: CaseRecord, goals: AttorneyGoal[] = []) {
  if (record.tracker.caseStage !== "Settled") return false;
  if (isCaseFullyDisbursed(record.tracker.result)) return false;
  // Prefer Results-tab membership when goals are loaded; otherwise use Settled + open.
  if (goals.length > 0) return isResultsTabCase(record, goals);
  return Boolean(record.tracker.result.settlementDate) || (record.tracker.result.attorneyFees ?? 0) > 0;
}

export function buildSettledUndisbursedProgressMessage(
  record: CaseRecord,
  appUrl: string,
  options?: { topicMentions?: string },
) {
  const result = record.tracker.result;
  const caseLink = `${appUrl}/cases/${record.shared.id}`;
  const resultsLink = `${appUrl}/results?disbursed=No`;
  const lines: string[] = [];

  if (options?.topicMentions) {
    lines.push(options.topicMentions);
  }

  lines.push(
    `*Settled — not yet disbursed* — Case #${record.shared.caseNumber} (${record.shared.clientName})`,
    "Current disbursement progress:",
    `• *Release:* ${result.releaseStatus}`,
    `• *Reductions:* ${coerceReductionsStatus(result.reductionsStatus)}`,
    `• *Check:* ${coerceCheckStatus(result.checkStatus)}`,
    `• *Closing:* ${coerceClosingStatus(result.closingStatus)}`,
    `• *Disbursed:* ${result.disbursedStatus}`,
    `• *Result quarter:* ${result.resultQuarter?.trim() || "—"}`,
    "",
    `<${caseLink}|Open case> · <${resultsLink}|Results (Disbursed = No)>`,
  );

  return lines.join("\n");
}

export type SettledUndisbursedPreviewItem = {
  caseNumber: string;
  clientName: string;
  action: "post" | "skip";
  reason?: string;
};

export async function sendSettledUndisbursedSlackNotices(
  records: CaseRecord[],
  options?: {
    goals?: AttorneyGoal[];
    dryRun?: boolean;
    /**
     * When true (default for cron), only send in the Mon 10:00 / Wed 12:00 Central windows.
     * Force/manual runs set force=true (or scheduleOnly=false) to send anytime.
     */
    scheduleOnly?: boolean;
    /** @deprecated Use scheduleOnly. Kept so older callers keep working. */
    morningOnly?: boolean;
    caseNumber?: string;
    force?: boolean;
  },
) {
  const scheduleOnly = options?.scheduleOnly ?? options?.morningOnly ?? true;
  if (scheduleOnly && !options?.force && !isSettledUndisbursedSendWindow()) {
    return {
      posted: 0,
      skipped: 0,
      eligible: 0,
      dryRun: Boolean(options?.dryRun),
      skippedReason: "Outside Mon 10:00 / Wed 12:00 Central send window" as const,
      previewItems: [] as SettledUndisbursedPreviewItem[],
    };
  }

  if (!isSlackEnabled()) {
    return {
      posted: 0,
      skipped: 0,
      eligible: 0,
      dryRun: Boolean(options?.dryRun),
      skippedReason: "slack_disabled" as const,
      previewItems: [] as SettledUndisbursedPreviewItem[],
    };
  }

  const appUrl = getAppOriginForNotifications();
  if (!appUrl) throw new Error("Set NEXT_PUBLIC_SITE_URL for Slack links.");

  const goals = options?.goals ?? [];
  const caseFilter = options?.caseNumber?.trim()
    ? cleanCaseNumber(options.caseNumber.trim())
    : null;

  const eligible = records.filter((record) => {
    if (caseFilter && cleanCaseNumber(record.shared.caseNumber) !== caseFilter) return false;
    return isSettledNotDisbursedResultsCase(record, goals);
  });

  const channelMap = await loadSlackChannelMapByCaseNumber();
  let posted = 0;
  let skipped = 0;
  const previewItems: SettledUndisbursedPreviewItem[] = [];

  for (const record of eligible) {
    const mapping = channelMap.get(cleanCaseNumber(record.shared.caseNumber));
    const channelId = mapping?.slackChannelId
      ? normalizeSlackChannelId(mapping.slackChannelId)
      : null;

    if (!channelId) {
      skipped += 1;
      if (options?.dryRun) {
        previewItems.push({
          caseNumber: record.shared.caseNumber,
          clientName: record.shared.clientName,
          action: "skip",
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
      });
      posted += 1;
      continue;
    }

    const topic = await fetchChannelTopic(channelId);
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

    const text = buildSettledUndisbursedProgressMessage(record, appUrl, {
      topicMentions: topicMentions || undefined,
    });
    const message = await postSlackMessage({ channel: channelId, text });
    if (!message?.ts) {
      skipped += 1;
      continue;
    }
    posted += 1;
  }

  return {
    posted,
    skipped,
    eligible: eligible.length,
    dryRun: Boolean(options?.dryRun),
    previewItems,
  };
}
