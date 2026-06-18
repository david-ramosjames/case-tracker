import { getAttorneyCommissionStartMonth } from "@/lib/auth/access";
import { isCaseFullyDisbursed } from "@/lib/case-status";
import { formatCommissionYearPeriod, getCurrentCommissionYear } from "@/lib/commission-year";
import { getAttorneyOnlyGoals } from "@/lib/firm-goals";
import {
  getWeightedDisbursedFeesInCommissionYear,
  getWeightedGrossDisbursedInCommissionYear,
  getWeightedGrossSettledInCommissionYear,
} from "@/lib/disbursements";
import { type AttorneyGoal, type CaseRecord } from "@/lib/types";

/** Cases with open/partial settlement activity or disbursement parties on the sheet. */
export function isResultsTabCase(record: CaseRecord) {
  const { tracker } = record;
  const result = tracker.result;

  if (tracker.disbursements.length > 0) return true;
  if (result.settlementDate || result.disburseDate) return true;
  if ((result.settlementAmount ?? 0) > 0 || (result.attorneyFees ?? 0) > 0) return true;

  return false;
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
