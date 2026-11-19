import {
  clientContactDates,
  contactNeedsFollowUp,
  contactSentimentLabel,
} from "@/lib/client-contact/types";
import {
  isQualifyingContactRuleReady,
  listClientContactSummaries,
  listLatestClientSentiments,
  worstSentimentByCaseNumber,
} from "@/lib/client-contact/repository";
import { isReferredCase } from "@/lib/client-contact/referred";
import { getOpenStageSuggestions } from "@/lib/calculations";
import { caseRequiresOngoingUpdates } from "@/lib/case-status";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { isLitigationTabCase } from "@/lib/litigation-events";
import { type NavBadges } from "@/lib/navigation/nav-config";
import { listOpenNeedsResponse } from "@/lib/needs-response/repository";
import { loadSlackChannelMapByCaseNumber } from "@/lib/slack/channels";
import { type CaseRecord } from "@/lib/types";

export type DashboardNavMetrics = {
  litigationCases: number;
  clientsNeedingContact: number;
  negativeSentiment: number;
  needsResponse: number;
  stageSuggestionsOpen: number;
};

/**
 * Counts for top-nav destinations that aren't already covered by pipeline metrics.
 * Contact badge uses the same open set as /client-contact (ongoing updates, no referred-out).
 */
export async function getDashboardNavMetrics(
  records: CaseRecord[],
  options?: { needsResponseFirmwide?: boolean },
): Promise<DashboardNavMetrics> {
  const ongoing = records.filter((record) => caseRequiresOngoingUpdates(record));
  const ongoingCaseNumbers = ongoing.map((record) => record.shared.caseNumber);

  const [summaries, sentiments, needsRows, qualifyingRule, slackChannels] = await Promise.all([
    listClientContactSummaries(ongoingCaseNumbers),
    listLatestClientSentiments(ongoingCaseNumbers),
    listOpenNeedsResponse(options?.needsResponseFirmwide ? undefined : ongoingCaseNumbers).catch(() => []),
    isQualifyingContactRuleReady(),
    loadSlackChannelMapByCaseNumber().catch(() => new Map()),
  ]);

  const open = ongoing.filter((record) => {
    const topicStage = slackChannels.get(cleanCaseNumber(record.shared.caseNumber))?.topicStage;
    return !isReferredCase(record, topicStage);
  });
  const openByCase = new Map(open.map((record) => [cleanCaseNumber(record.shared.caseNumber), record]));

  let clientsNeedingContact = 0;
  for (const record of open) {
    const caseNumber = cleanCaseNumber(record.shared.caseNumber);
    const dates = clientContactDates(summaries.get(caseNumber) ?? null, { qualifying: qualifyingRule });
    if (contactNeedsFollowUp(dates.lastInteraction)) clientsNeedingContact += 1;
  }

  let negativeSentiment = 0;
  for (const reading of worstSentimentByCaseNumber(sentiments.values()).values()) {
    if (!openByCase.has(cleanCaseNumber(reading.caseNumber))) continue;
    const dates = clientContactDates(summaries.get(cleanCaseNumber(reading.caseNumber)) ?? null, { qualifying: qualifyingRule });
    if (contactSentimentLabel(dates.lastInteraction, reading.sentiment) === "Negative") {
      negativeSentiment += 1;
    }
  }

  const stageSuggestionsOpen = records.reduce(
    (total, record) => total + getOpenStageSuggestions(record).length,
    0,
  );

  return {
    litigationCases: records.filter(isLitigationTabCase).length,
    clientsNeedingContact,
    negativeSentiment,
    needsResponse: needsRows.length,
    stageSuggestionsOpen,
  };
}

/** Compact badge map for the app sidebar / mobile drawer. */
export function toNavBadges(metrics: DashboardNavMetrics): NavBadges {
  return {
    suggestions: metrics.stageSuggestionsOpen,
    contact: metrics.clientsNeedingContact,
    needsResponse: metrics.needsResponse,
  };
}
