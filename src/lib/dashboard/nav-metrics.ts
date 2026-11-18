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
import { getOpenStageSuggestions } from "@/lib/calculations";
import { caseRequiresOngoingUpdates } from "@/lib/case-status";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { isLitigationTabCase } from "@/lib/litigation-events";
import { type NavBadges } from "@/lib/navigation/nav-config";
import { listOpenNeedsResponse } from "@/lib/needs-response/repository";
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
 * Uses the same open-matter definition as Contact (ongoing updates).
 */
export async function getDashboardNavMetrics(
  records: CaseRecord[],
  options?: { needsResponseFirmwide?: boolean },
): Promise<DashboardNavMetrics> {
  const open = records.filter((record) => caseRequiresOngoingUpdates(record));
  const caseNumbers = open.map((record) => record.shared.caseNumber);
  const openByCase = new Map(open.map((record) => [cleanCaseNumber(record.shared.caseNumber), record]));

  const [summaries, sentiments, needsRows, qualifyingRule] = await Promise.all([
    listClientContactSummaries(caseNumbers),
    listLatestClientSentiments(caseNumbers),
    listOpenNeedsResponse(options?.needsResponseFirmwide ? undefined : caseNumbers).catch(() => []),
    isQualifyingContactRuleReady(),
  ]);

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
