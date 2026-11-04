import {
  clientContactDates,
  contactNeedsFollowUp,
  contactSentimentLabel,
} from "@/lib/client-contact/types";
import {
  listClientContactSummaries,
  listLatestClientSentiments,
  worstSentimentByCaseNumber,
} from "@/lib/client-contact/repository";
import { caseRequiresOngoingUpdates } from "@/lib/case-status";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { isLitigationTabCase } from "@/lib/litigation-events";
import { listOpenNeedsResponse } from "@/lib/needs-response/repository";
import { type CaseRecord } from "@/lib/types";

export type DashboardNavMetrics = {
  litigationCases: number;
  clientsNeedingContact: number;
  negativeSentiment: number;
  needsResponse: number;
};

/**
 * Counts for top-nav destinations that aren't already covered by pipeline metrics.
 * Uses the same open-matter definition as Contact (ongoing updates).
 */
export async function getDashboardNavMetrics(records: CaseRecord[]): Promise<DashboardNavMetrics> {
  const open = records.filter((record) => caseRequiresOngoingUpdates(record));
  const caseNumbers = open.map((record) => record.shared.caseNumber);
  const openByCase = new Map(open.map((record) => [cleanCaseNumber(record.shared.caseNumber), record]));

  const [summaries, sentiments, needsRows] = await Promise.all([
    listClientContactSummaries(caseNumbers),
    listLatestClientSentiments(caseNumbers),
    listOpenNeedsResponse(caseNumbers).catch(() => []),
  ]);

  let clientsNeedingContact = 0;
  for (const record of open) {
    const caseNumber = cleanCaseNumber(record.shared.caseNumber);
    const dates = clientContactDates(summaries.get(caseNumber) ?? null);
    if (contactNeedsFollowUp(dates.lastInteraction)) clientsNeedingContact += 1;
  }

  let negativeSentiment = 0;
  for (const reading of worstSentimentByCaseNumber(sentiments.values()).values()) {
    if (!openByCase.has(cleanCaseNumber(reading.caseNumber))) continue;
    const dates = clientContactDates(summaries.get(cleanCaseNumber(reading.caseNumber)) ?? null);
    if (contactSentimentLabel(dates.lastInteraction, reading.sentiment) === "Negative") {
      negativeSentiment += 1;
    }
  }

  return {
    litigationCases: records.filter(isLitigationTabCase).length,
    clientsNeedingContact,
    negativeSentiment,
    needsResponse: needsRows.length,
  };
}
