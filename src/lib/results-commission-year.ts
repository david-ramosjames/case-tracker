import { getAttorneyCommissionStartMonth } from "@/lib/auth/access";
import { deriveCaseStatusFromTracker, isCaseFullyDisbursed } from "@/lib/case-status";
import {
  formatCommissionYearPeriod,
  getCurrentCommissionYear,
  getRecordDisburseDate,
  isDateInCommissionYear,
} from "@/lib/commission-year";
import { getAttorneyOnlyGoals } from "@/lib/firm-goals";
import {
  getWeightedDisbursedFeesInCommissionYear,
  getWeightedGrossDisbursedInCommissionYear,
  getWeightedGrossSettledInCommissionYear,
} from "@/lib/disbursements";
import { type AttorneyGoal, type CaseRecord } from "@/lib/types";

/** Cases with open/partial settlement activity or disbursement parties on the sheet. */
function hasResultsSettlementOrDisbursementActivity(record: CaseRecord) {
  const { tracker } = record;
  const result = tracker.result;

  if (tracker.disbursements.length > 0) return true;
  if (result.settlementDate || result.disburseDate) return true;
  if ((result.settlementAmount ?? 0) > 0 || (result.attorneyFees ?? 0) > 0) return true;

  return false;
}

export function hasSettlementOrDisbursementInCommissionYear(
  record: CaseRecord,
  commissionYear: number,
  startMonth: number,
) {
  const { tracker } = record;
  const result = tracker.result;

  for (const party of tracker.disbursements) {
    if (party.settlementDate && isDateInCommissionYear(party.settlementDate, commissionYear, startMonth)) {
      return true;
    }
    if (party.disburseDate && isDateInCommissionYear(party.disburseDate, commissionYear, startMonth)) {
      return true;
    }
  }

  if (result.settlementDate && isDateInCommissionYear(result.settlementDate, commissionYear, startMonth)) {
    return true;
  }

  const legacyDisburseDate = getRecordDisburseDate(result);
  if (legacyDisburseDate && isDateInCommissionYear(legacyDisburseDate, commissionYear, startMonth)) {
    return true;
  }

  return false;
}

/** Whether a case belongs on the Results tab for the attorney's current commission year. */
export function isResultsTabCase(record: CaseRecord, goals: AttorneyGoal[] = []) {
  if (!hasResultsSettlementOrDisbursementActivity(record)) return false;

  const status = deriveCaseStatusFromTracker(record.tracker.caseStage, record.tracker.result);
  if (status === "Active") return true;

  const goal = resolveAttorneyCommissionYearGoal(record, goals);
  if (!goal) {
    const attorneyGoals = getAttorneyOnlyGoals(goals);
    const startMonth = getAttorneyCommissionStartMonth(attorneyGoals, record.shared.attorneyId);
    const commissionYear = getCurrentCommissionYear(startMonth);
    return hasSettlementOrDisbursementInCommissionYear(record, commissionYear, startMonth);
  }

  return hasSettlementOrDisbursementInCommissionYear(
    record,
    goal.year,
    goal.commissionYearStartMonth,
  );
}

export function hasOpenSettlementActivity(record: CaseRecord) {
  const result = record.tracker.result;
  const hasSettlement =
    Boolean(result.settlementDate) ||
    (result.settlementAmount ?? 0) > 0 ||
    record.tracker.disbursements.some(
      (party) => Boolean(party.settlementDate) || (party.settlementAmount ?? 0) > 0,
    );

  if (!hasSettlement) return false;

  if (record.tracker.disbursements.length > 0) {
    return record.tracker.disbursements.some((party) => party.pendingRemaining || !party.disburseDate);
  }

  return !isCaseFullyDisbursed(result);
}

export function resolveAttorneyCommissionYearGoal(
  record: CaseRecord,
  goals: AttorneyGoal[],
): AttorneyGoal | null {
  const attorneyGoals = getAttorneyOnlyGoals(goals);
  const startMonth = getAttorneyCommissionStartMonth(attorneyGoals, record.shared.attorneyId);
  const currentYear = getCurrentCommissionYear(startMonth);
  return (
    attorneyGoals.find(
      (goal) => goal.attorneyId === record.shared.attorneyId && goal.year === currentYear,
    ) ?? null
  );
}

/** Per-party amounts dated in the attorney's commission year (settled gross + disbursed fees). */
export function getCommissionYearResultAmounts(record: CaseRecord, goal: AttorneyGoal | null) {
  if (!goal) {
    return { settlementAmount: 0, attorneyFees: 0, feePercent: null as number | null };
  }

  const settlementAmount = getWeightedGrossSettledInCommissionYear(
    record,
    goal.year,
    goal.commissionYearStartMonth,
  );
  const attorneyFees = getWeightedDisbursedFeesInCommissionYear(
    record,
    goal.year,
    goal.commissionYearStartMonth,
  );
  const feePercent = settlementAmount > 0 ? attorneyFees / settlementAmount : null;

  return { settlementAmount, attorneyFees, feePercent };
}

export function formatAttorneyCommissionYearLabel(goal: AttorneyGoal | null) {
  if (!goal) return "commission year";
  return formatCommissionYearPeriod(goal.year, goal.commissionYearStartMonth, goal.commissionMonthCount ?? 12);
}

export function getCommissionYearDisbursedAmounts(record: CaseRecord, goal: AttorneyGoal) {
  return {
    grossDisbursed: getWeightedGrossDisbursedInCommissionYear(
      record,
      goal.year,
      goal.commissionYearStartMonth,
    ),
    disbursedFees: getWeightedDisbursedFeesInCommissionYear(
      record,
      goal.year,
      goal.commissionYearStartMonth,
    ),
  };
}
