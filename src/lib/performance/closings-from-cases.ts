import { isCaseFullyDisbursed } from "@/lib/case-status";
import { countClientsInName } from "@/lib/performance/client-share";
import { type PerformanceWeekPair } from "@/lib/performance/week-pairs";
import { weekEndFromStart } from "@/lib/performance/weeks";
import { type CaseRecord } from "@/lib/types";

export type ClosingCaseRef = {
  caseId: string;
  caseNumber: string;
  clientName: string;
  date: string;
  credit: number;
  note?: string;
};

export type PairClosingDetails = {
  pairId: string;
  settlements: ClosingCaseRef[];
  disbursements: ClosingCaseRef[];
};

/**
 * Closings from Case Tracker financial dates, attributed by *current* case
 * attorney/paralegal assignment. Financial rows do not store historical staffing;
 * reassignments can mis-attribute older events — surfaced in the UI.
 */
export function buildPairClosingsFromCases(input: {
  weekStart: string;
  weekPairs: PerformanceWeekPair[];
  records: CaseRecord[];
}): {
  byPairId: Record<string, { settlement: number; disbursement: number }>;
  details: PairClosingDetails[];
} {
  const weekEnd = weekEndFromStart(input.weekStart);
  const byPairId: Record<string, { settlement: number; disbursement: number }> = {};
  const detailsMap = new Map<string, PairClosingDetails>();

  for (const pair of input.weekPairs) {
    byPairId[pair.id] = { settlement: 0, disbursement: 0 };
    detailsMap.set(pair.id, { pairId: pair.id, settlements: [], disbursements: [] });
  }

  function matchPair(attorneyId: string, paralegalId: string): PerformanceWeekPair | null {
    return (
      input.weekPairs.find(
        (pair) =>
          !pair.isVacant &&
          pair.attorneyContactId === attorneyId &&
          pair.paralegalContactId === paralegalId,
      ) ?? null
    );
  }

  for (const record of input.records) {
    const attorneyId = record.shared.attorneyId;
    const paralegalId = record.shared.paralegalId;
    if (!attorneyId || !paralegalId) continue;
    const pair = matchPair(attorneyId, paralegalId);
    if (!pair) continue;
    const bucket = byPairId[pair.id];
    const details = detailsMap.get(pair.id);
    if (!bucket || !details) continue;

    const clientName = record.shared.clientName;
    const defaultCredit = countClientsInName(clientName);

    const settlementDate =
      record.tracker.result.settlementDate ??
      record.tracker.disbursements.find((d) => d.settlementDate)?.settlementDate ??
      null;
    if (
      settlementDate &&
      settlementDate >= input.weekStart &&
      settlementDate <= weekEnd &&
      (record.tracker.caseStage === "Settled" || (record.tracker.result.attorneyFees ?? 0) > 0)
    ) {
      // Prefer party weights when present (multi-client / multi-party sheet rows).
      const partyWeights = record.tracker.disbursements
        .filter((d) => d.settlementDate === settlementDate)
        .map((d) => (typeof d.weight === "number" && d.weight > 0 ? d.weight : 0));
      const credit =
        partyWeights.length > 0 ? partyWeights.reduce((a, b) => a + b, 0) : defaultCredit;
      bucket.settlement += credit;
      details.settlements.push({
        caseId: record.shared.id,
        caseNumber: record.shared.caseNumber,
        clientName,
        date: settlementDate,
        credit,
        note: "Attributed by current case assignment",
      });
    }

    let disburseHit = false;
    for (const d of record.tracker.disbursements) {
      if (!d.disburseDate) continue;
      if (d.disburseDate < input.weekStart || d.disburseDate > weekEnd) continue;
      const credit = typeof d.weight === "number" && d.weight > 0 ? d.weight : defaultCredit;
      bucket.disbursement += credit;
      details.disbursements.push({
        caseId: record.shared.id,
        caseNumber: record.shared.caseNumber,
        clientName: d.partyLabel || clientName,
        date: d.disburseDate,
        credit,
        note: "Attributed by current case assignment",
      });
      disburseHit = true;
    }
    if (
      !disburseHit &&
      record.tracker.disbursements.length === 0 &&
      isCaseFullyDisbursed(record.tracker.result) &&
      record.tracker.result.disburseDate
    ) {
      const day = record.tracker.result.disburseDate;
      if (day >= input.weekStart && day <= weekEnd) {
        bucket.disbursement += defaultCredit;
        details.disbursements.push({
          caseId: record.shared.id,
          caseNumber: record.shared.caseNumber,
          clientName,
          date: day,
          credit: defaultCredit,
          note: "Attributed by current case assignment",
        });
      }
    }
  }

  return { byPairId, details: [...detailsMap.values()] };
}
