import { getAttorneyCommissionStartMonth } from "@/lib/auth/access";
import { formatCommissionYearPeriod, getCurrentCommissionYear } from "@/lib/commission-year";
import {
  getWeightedDisbursedFeesInCommissionYear,
  getWeightedGrossDisbursedInCommissionYear,
} from "@/lib/disbursements";
import { getAttorneyOnlyGoals } from "@/lib/firm-goals";
import {
  getOutputDisbursedAmounts,
  getOutputSettledAmounts,
  getPartyResultsPeriodStatus,
  getResultsPeriodAmounts,
  recordQualifiesForResultsTab,
  resolveOutputPeriodContextForRecord,
  resolveResultsPeriodContext,
} from "@/lib/results-period";
import { type AttorneyGoal, type CaseRecord } from "@/lib/types";

/** Whether a case belongs on the Results tab (disbursed in period or open undisbursed). */
export function isResultsTabCase(record: CaseRecord, goals: AttorneyGoal[] = []) {
  return recordQualifiesForResultsTab(record, goals);
}

export function resolveAttorneyCommissionYearGoal(
  record: CaseRecord,
  goals: AttorneyGoal[],
): AttorneyGoal | null {
  const attorneyGoals = getAttorneyOnlyGoals(goals);
  const startMonth = getAttorneyCommissionStartMonth(attorneyGoals, record.shared.attorneyId);
  const currentYear = getCurrentCommissionYear(startMonth);
  const exact =
    attorneyGoals.find(
      (goal) => goal.attorneyId === record.shared.attorneyId && goal.year === currentYear,
    ) ?? null;
  if (exact) return exact;

  const now = new Date();
  return (
    attorneyGoals
      .filter((goal) => goal.attorneyId === record.shared.attorneyId)
      .find((goal) => {
        const start = new Date(goal.year, goal.commissionYearStartMonth - 1, 1);
        const months = goal.commissionMonthCount ?? 12;
        const end = new Date(start.getFullYear(), start.getMonth() + months, 0, 23, 59, 59, 999);
        return now >= start && now <= end;
      }) ?? null
  );
}

/** Per-party gross settlement and RJL fees for the Results tab period. */
export function getCommissionYearResultAmounts(record: CaseRecord, goals: AttorneyGoal[]) {
  return getResultsPeriodAmounts(record, goals);
}

export function formatAttorneyCommissionYearLabel(goal: AttorneyGoal | null) {
  if (!goal) return "commission year";
  return formatCommissionYearPeriod(goal.year, goal.commissionYearStartMonth, goal.commissionMonthCount ?? 12);
}


/** Goal actuals — disburse date in commission year only. */
export function getCommissionYearDisbursedAmounts(record: CaseRecord, goal: AttorneyGoal) {
  const monthCount = goal.commissionMonthCount ?? 12;
  return {
    grossDisbursed: getWeightedGrossDisbursedInCommissionYear(
      record,
      goal.year,
      goal.commissionYearStartMonth,
      monthCount,
    ),
    disbursedFees: getWeightedDisbursedFeesInCommissionYear(
      record,
      goal.year,
      goal.commissionYearStartMonth,
      monthCount,
    ),
  };
}

export function hasOpenSettlementActivity(record: CaseRecord, goals: AttorneyGoal[] = []) {
  const context = resolveResultsPeriodContext(record, goals);
  const slices =
    record.tracker.disbursements.length > 0
      ? record.tracker.disbursements.map((party) => ({ party, legacy: false as const }))
      : [{ party: null, legacy: true as const }];

  return slices.some(
    (slice) => getPartyResultsPeriodStatus(slice, record, context) === "open_undisbursed",
  );
}

export {
  getOutputDisbursedAmounts,
  getOutputSettledAmounts,
  resolveOutputPeriodContextForRecord,
};
