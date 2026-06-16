import {
  getCommissionYearLabel,
  getCurrentCommissionYear,
  getRecordDisburseDate,
  isDateInCommissionYear,
} from "@/lib/commission-year";
import { type CaseDisbursement, type CaseRecord, type DisbursedStatus, type ReductionsStatus, type TrackerEntry } from "@/lib/types";

export function disbursementWeight(expectedCount: number) {
  const count = Math.max(1, Math.trunc(expectedCount));
  return 1 / count;
}

export function getExpectedDisbursementCount(tracker: Pick<TrackerEntry, "expectedDisbursementCount">) {
  return Math.max(1, tracker.expectedDisbursementCount ?? 1);
}

export function getCaseAttorneyFees(record: Pick<CaseRecord, "tracker">) {
  return record.tracker.result.attorneyFees ?? record.tracker.actualFeeValue ?? 0;
}

export function getWeightedAttorneyFees(record: Pick<CaseRecord, "tracker">, weight: number) {
  return getCaseAttorneyFees(record) * weight;
}

/** Fees for one disbursement party — uses sheet row fees when synced, else splits case total by weight. */
export function getDisbursementAttorneyFees(
  item: Pick<CaseDisbursement, "attorneyFees" | "weight">,
  record: Pick<CaseRecord, "tracker">,
) {
  if (item.attorneyFees != null) return item.attorneyFees;
  return getCaseAttorneyFees(record) * item.weight;
}

export function getDisbursementSettlementAmount(
  item: Pick<CaseDisbursement, "settlementAmount" | "weight">,
  record: Pick<CaseRecord, "tracker">,
) {
  if (item.settlementAmount != null) return item.settlementAmount;
  return (record.tracker.result.settlementAmount ?? 0) * item.weight;
}

export function hasMultipleDisbursements(tracker: Pick<TrackerEntry, "multipleDisbursementsEnabled" | "disbursements" | "expectedDisbursementCount">) {
  return (
    tracker.multipleDisbursementsEnabled ||
    tracker.disbursements.length > 1 ||
    getExpectedDisbursementCount(tracker) > 1
  );
}

function sumDefinedAmounts(values: Array<number | null | undefined>) {
  let total = 0;
  let seen = false;
  for (const value of values) {
    if (value == null) continue;
    total += value;
    seen = true;
  }
  return seen ? total : null;
}

/** When multiple sheet-synced parties exist, roll their amounts up into case-level results. */
export function shouldAggregateResultsFromDisbursements(
  tracker: Pick<TrackerEntry, "multipleDisbursementsEnabled" | "disbursements" | "expectedDisbursementCount">,
) {
  return hasMultipleDisbursements(tracker) && tracker.disbursements.length > 0;
}

function deriveResultQuarterFromDisburseDate(disburseDate: string | null) {
  if (!disburseDate?.trim()) return null;
  const parsed = new Date(disburseDate);
  if (Number.isNaN(parsed.getTime())) return null;
  const quarter = Math.floor(parsed.getMonth() / 3) + 1;
  return `${parsed.getFullYear()} Q${quarter}`;
}

export function areAllDisbursementPartiesOnSheet(
  tracker: Pick<TrackerEntry, "disbursements" | "expectedDisbursementCount">,
) {
  return tracker.disbursements.length >= getExpectedDisbursementCount(tracker);
}

export function areAllDisbursementPartiesSettled(
  tracker: Pick<TrackerEntry, "disbursements" | "expectedDisbursementCount">,
) {
  if (!areAllDisbursementPartiesOnSheet(tracker)) return false;
  return tracker.disbursements.every((item) => Boolean(item.settlementDate));
}

export function areAllDisbursementPartiesDisbursed(
  tracker: Pick<TrackerEntry, "disbursements" | "expectedDisbursementCount">,
) {
  if (!areAllDisbursementPartiesOnSheet(tracker)) return false;
  return tracker.disbursements.every((item) => Boolean(item.disburseDate) && !item.pendingRemaining);
}

export function getAggregatedResultFromDisbursements(
  tracker: Pick<TrackerEntry, "multipleDisbursementsEnabled" | "disbursements" | "expectedDisbursementCount" | "result">,
) {
  if (!shouldAggregateResultsFromDisbursements(tracker)) return null;

  const record = { tracker } as Pick<CaseRecord, "tracker">;
  const settlementAmount = sumDefinedAmounts(
    tracker.disbursements.map((item) =>
      item.settlementAmount != null ? item.settlementAmount : getDisbursementSettlementAmount(item, record),
    ),
  );
  const attorneyFees = sumDefinedAmounts(
    tracker.disbursements.map((item) =>
      item.attorneyFees != null ? item.attorneyFees : getDisbursementAttorneyFees(item, record),
    ),
  );

  if (settlementAmount == null && attorneyFees == null) return null;

  const feePercent =
    settlementAmount != null && attorneyFees != null && settlementAmount > 0 ? attorneyFees / settlementAmount : null;

  const allSettled = areAllDisbursementPartiesSettled(tracker);
  const allDisbursed = areAllDisbursementPartiesDisbursed(tracker);

  const settlementDates = tracker.disbursements.map((item) => item.settlementDate).filter(Boolean) as string[];
  const settlementDate = allSettled && settlementDates.length
    ? settlementDates.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0]
    : null;

  const disburseDates = getCompletedDisbursements(tracker)
    .map((item) => item.disburseDate)
    .filter(Boolean) as string[];
  const disburseDate =
    allDisbursed && disburseDates.length
      ? disburseDates.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0]
      : null;

  const disbursedStatus: DisbursedStatus = allDisbursed ? "Yes" : "No";
  const checkDisbursedAt = allDisbursed && disburseDate ? new Date(disburseDate).toISOString() : null;
  const resultQuarter = disburseDate ? deriveResultQuarterFromDisburseDate(disburseDate) : null;
  const reductionsStatus: ReductionsStatus = allDisbursed ? "Deposited" : "Not Complete";

  return {
    settlementAmount,
    attorneyFees,
    feePercent,
    settlementDate,
    disburseDate,
    disbursedStatus,
    checkDisbursedAt,
    resultQuarter,
    reductionsStatus,
  };
}

export function getPartyDisbursementStatus(item: Pick<CaseDisbursement, "disburseDate" | "pendingRemaining">) {
  if (item.disburseDate) return { label: "Disbursed", variant: "default" as const };
  if (item.pendingRemaining) return { label: "Awaiting disbursement", variant: "secondary" as const };
  return { label: "Missing disburse date", variant: "outline" as const };
}

export function getDisbursementSyncStatus(tracker: Pick<TrackerEntry, "disbursements" | "expectedDisbursementCount">) {
  const expected = getExpectedDisbursementCount(tracker);
  const onSheet = tracker.disbursements.filter((item) => Boolean(item.sheetRowKey)).length;
  const manual = tracker.disbursements.filter((item) => !item.sheetRowKey).length;
  const total = tracker.disbursements.length;
  const awaitingSheet = Math.max(0, expected - total);
  return {
    expected,
    onSheet,
    manual,
    total,
    awaitingSheet,
    matched: total > 0 && total >= expected,
    partiallyMatched: total > 0 && total < expected,
  };
}

/** Disbursed for commission: has a disburse date (column Z). Sheet clears column B when done. */
export function getCompletedDisbursements(tracker: Pick<TrackerEntry, "disbursements">) {
  return tracker.disbursements.filter((item) => Boolean(item.disburseDate));
}

export function getPendingDisbursements(tracker: Pick<TrackerEntry, "disbursements">) {
  return tracker.disbursements.filter((item) => item.pendingRemaining);
}

export function recordHasDisbursementInCommissionYear(
  record: Pick<CaseRecord, "tracker">,
  commissionYear: number,
  startMonth: number,
) {
  const completed = getCompletedDisbursements(record.tracker);
  if (completed.length > 0) {
    return completed.some(
      (item) => item.disburseDate && isDateInCommissionYear(item.disburseDate, commissionYear, startMonth),
    );
  }

  const legacyDate = getRecordDisburseDate(record.tracker.result);
  return legacyDate ? isDateInCommissionYear(legacyDate, commissionYear, startMonth) : false;
}

export function getWeightedGrossDisbursedInCommissionYear(
  record: Pick<CaseRecord, "tracker">,
  commissionYear: number,
  startMonth: number,
) {
  const completed = getCompletedDisbursements(record.tracker);

  if (completed.length > 0) {
    return completed
      .filter((item) => item.disburseDate && isDateInCommissionYear(item.disburseDate, commissionYear, startMonth))
      .reduce((total, item) => total + getDisbursementSettlementAmount(item, record), 0);
  }

  const baseSettlement = record.tracker.result.settlementAmount ?? 0;
  const legacyDate = getRecordDisburseDate(record.tracker.result);
  if (legacyDate && isDateInCommissionYear(legacyDate, commissionYear, startMonth)) {
    return baseSettlement;
  }

  return 0;
}

export function getWeightedDisbursedFeesInCommissionYear(
  record: Pick<CaseRecord, "tracker">,
  commissionYear: number,
  startMonth: number,
) {
  const baseFees = getCaseAttorneyFees(record);
  const completed = getCompletedDisbursements(record.tracker);

  if (completed.length > 0) {
    return completed
      .filter((item) => item.disburseDate && isDateInCommissionYear(item.disburseDate, commissionYear, startMonth))
      .reduce((total, item) => total + getDisbursementAttorneyFees(item, record), 0);
  }

  const legacyDate = getRecordDisburseDate(record.tracker.result);
  if (legacyDate && isDateInCommissionYear(legacyDate, commissionYear, startMonth)) {
    return baseFees;
  }

  return 0;
}

export function getWeightedDisbursedFeesInCommissionQuarter(
  record: Pick<CaseRecord, "tracker">,
  commissionYear: number,
  startMonth: number,
  quarter: number,
  getQuarterForDate: (dateValue: string, year: number, month: number) => number | null,
) {
  const baseFees = getCaseAttorneyFees(record);
  const completed = getCompletedDisbursements(record.tracker);

  if (completed.length > 0) {
    return completed
      .filter((item) => {
        if (!item.disburseDate) return false;
        return getQuarterForDate(item.disburseDate, commissionYear, startMonth) === quarter;
      })
      .reduce((total, item) => total + getDisbursementAttorneyFees(item, record), 0);
  }

  const legacyDate = getRecordDisburseDate(record.tracker.result);
  if (!legacyDate) return 0;
  if (getQuarterForDate(legacyDate, commissionYear, startMonth) !== quarter) return 0;
  return baseFees;
}

export function getWeightedSettlementInCommissionQuarter(
  record: Pick<CaseRecord, "tracker">,
  commissionYear: number,
  startMonth: number,
  quarter: number,
  getQuarterForDate: (dateValue: string, year: number, month: number) => number | null,
) {
  const completed = getCompletedDisbursements(record.tracker);

  if (completed.length > 0) {
    return completed
      .filter((item) => {
        if (!item.disburseDate) return false;
        return getQuarterForDate(item.disburseDate, commissionYear, startMonth) === quarter;
      })
      .reduce((total, item) => total + getDisbursementSettlementAmount(item, record), 0);
  }

  const baseSettlement = record.tracker.result.settlementAmount ?? 0;

  const legacyDate = getRecordDisburseDate(record.tracker.result);
  if (!legacyDate) return 0;
  if (getQuarterForDate(legacyDate, commissionYear, startMonth) !== quarter) return 0;
  return baseSettlement;
}

export function isRecordFullyDisbursed(tracker: Pick<TrackerEntry, "disbursements" | "expectedDisbursementCount">) {
  return areAllDisbursementPartiesDisbursed(tracker);
}

/** Attorney visibility when a case can have multiple partial disbursements. */
export function getAttorneyDisbursementVisibility(
  tracker: Pick<TrackerEntry, "disbursements" | "expectedDisbursementCount" | "result">,
  startMonth: number,
  refDate = new Date(),
) {
  const completed = getCompletedDisbursements(tracker);

  if (completed.length === 0) {
    const legacyDate = getRecordDisburseDate(tracker.result);
    if (!legacyDate) return { hidden: false, historical: false };
    const currentCommissionYear = getCurrentCommissionYear(startMonth, refDate);
    const inCurrentYear = isDateInCommissionYear(legacyDate, currentCommissionYear, startMonth);
    const caseCommissionYear = getCommissionYearLabel(new Date(legacyDate), startMonth);
    return {
      hidden: !inCurrentYear,
      historical: caseCommissionYear < currentCommissionYear,
    };
  }

  if (!isRecordFullyDisbursed(tracker)) {
    return { hidden: false, historical: false };
  }

  const currentCommissionYear = getCurrentCommissionYear(startMonth, refDate);
  const anyInCurrentYear = completed.some(
    (item) => item.disburseDate && isDateInCommissionYear(item.disburseDate, currentCommissionYear, startMonth),
  );
  const allPriorYear = completed.every((item) => {
    if (!item.disburseDate) return false;
    return getCommissionYearLabel(new Date(item.disburseDate), startMonth) < currentCommissionYear;
  });

  return {
    hidden: !anyInCurrentYear,
    historical: allPriorYear,
  };
}
