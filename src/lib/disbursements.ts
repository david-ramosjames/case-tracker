import {
  getCommissionYearLabel,
  getCurrentCommissionYear,
  getRecordDisburseDate,
  isDateInCommissionYear,
} from "@/lib/commission-year";
import { type CaseDisbursement, type CaseRecord, type TrackerEntry } from "@/lib/types";

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

export function getDisbursementSyncStatus(tracker: Pick<TrackerEntry, "disbursements" | "expectedDisbursementCount">) {
  const expected = getExpectedDisbursementCount(tracker);
  const onSheet = tracker.disbursements.length;
  const awaitingSheet = Math.max(0, expected - onSheet);
  return {
    expected,
    onSheet,
    awaitingSheet,
    matched: onSheet > 0 && onSheet >= expected,
    partiallyMatched: onSheet > 0 && onSheet < expected,
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
  if (tracker.disbursements.length === 0) return false;
  return getPendingDisbursements(tracker).length === 0;
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
