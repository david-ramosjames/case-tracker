import {
  formatCommissionPeriod,
  formatCommissionQuarterPeriod,
  getCommissionYearLabel,
  getCommissionYearQuarterWindows,
  getCommissionYearStartDate,
  normalizeCommissionMonthCount,
  type CommissionPeriodMonthCount,
} from "@/lib/commission-year";
import { type AttorneyGoal } from "@/lib/types";
import { formatNumberInput, parseNumberInput } from "@/lib/utils";

export type MonthlyGoals = Record<string, number>;

export function monthKeyFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthKeyToParts(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 0 };
}

export function getCommissionPeriodMonthKeys(
  commissionYear: number,
  startMonth: number,
  monthCount: number = 12,
) {
  const start = getCommissionYearStartDate(commissionYear, startMonth);
  const periodMonths = normalizeCommissionMonthCount(monthCount);
  const keys: string[] = [];
  for (let index = 0; index < periodMonths; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth() + index, 1);
    keys.push(monthKeyFromDate(date));
  }
  return keys;
}

/** @deprecated Use getCommissionPeriodMonthKeys */
export function getCommissionYearMonthKeys(commissionYear: number, startMonth: number) {
  return getCommissionPeriodMonthKeys(commissionYear, startMonth, 12);
}

export function getCommissionPeriodFromEnd(endMonth: number, endYear: number, monthCount: number = 12) {
  const periodMonths = normalizeCommissionMonthCount(monthCount);
  const end = new Date(endYear, endMonth - 1, 1);
  const start = new Date(end.getFullYear(), end.getMonth() - (periodMonths - 1), 1);
  const startMonth = start.getMonth() + 1;
  const commissionYear = getCommissionYearLabel(start, startMonth);
  const monthKeys = getCommissionPeriodMonthKeys(commissionYear, startMonth, periodMonths);

  return {
    commissionYear,
    startMonth,
    monthCount: periodMonths,
    monthKeys,
    endMonth,
    endYear,
  };
}

export function getCommissionPeriodEndFromStart(
  commissionYear: number,
  startMonth: number,
  monthCount: number = 12,
) {
  const monthKeys = getCommissionPeriodMonthKeys(commissionYear, startMonth, monthCount);
  const lastKey = monthKeys[monthKeys.length - 1] ?? monthKeyFromDate(getCommissionYearStartDate(commissionYear, startMonth));
  const { year: endYear, month: endMonth } = monthKeyToParts(lastKey);
  return { endYear, endMonth };
}

export function formatMonthKeyLabel(monthKey: string) {
  const { year, month } = monthKeyToParts(monthKey);
  if (!year || !month) return monthKey;
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(new Date(year, month - 1, 1));
}

export function sumMonthlyGoals(monthlyGoals: MonthlyGoals) {
  return Object.values(monthlyGoals).reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

export function deriveQuarterGoalsFromMonthly(
  monthlyGoals: MonthlyGoals,
  commissionYear: number,
  startMonth: number,
  monthCount: number = 12,
) {
  const windows = getCommissionYearQuarterWindows(commissionYear, startMonth, monthCount);
  const quarterSums = windows.map((window) => {
    let total = 0;
    const cursor = new Date(window.start);
    while (cursor <= window.end) {
      total += monthlyGoals[monthKeyFromDate(cursor)] ?? 0;
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return total;
  });

  return {
    q1Goal: quarterSums[0] ?? 0,
    q2Goal: quarterSums[1] ?? 0,
    q3Goal: quarterSums[2] ?? 0,
    q4Goal: quarterSums[3] ?? 0,
    annualGrossGoal: quarterSums.reduce((total, value) => total + value, 0),
  };
}

export function monthlyGoalsFromQuarterGoals(
  goal: Pick<
    AttorneyGoal,
    | "year"
    | "commissionYearStartMonth"
    | "commissionMonthCount"
    | "q1Goal"
    | "q2Goal"
    | "q3Goal"
    | "q4Goal"
  >,
): MonthlyGoals {
  return monthlyGoalsFromQuarterAmounts(goal, [goal.q1Goal, goal.q2Goal, goal.q3Goal, goal.q4Goal]);
}

export function monthlyFeeGoalsFromQuarterGoals(
  goal: Pick<
    AttorneyGoal,
    | "year"
    | "commissionYearStartMonth"
    | "commissionMonthCount"
    | "feeQ1Goal"
    | "feeQ2Goal"
    | "feeQ3Goal"
    | "feeQ4Goal"
  >,
): MonthlyGoals {
  return monthlyGoalsFromQuarterAmounts(goal, [goal.feeQ1Goal, goal.feeQ2Goal, goal.feeQ3Goal, goal.feeQ4Goal]);
}

function monthlyGoalsFromQuarterAmounts(
  goal: Pick<AttorneyGoal, "year" | "commissionYearStartMonth" | "commissionMonthCount">,
  quarterGoals: number[],
) {
  const monthCount = goal.commissionMonthCount ?? 12;
  const windows = getCommissionYearQuarterWindows(goal.year, goal.commissionYearStartMonth, monthCount);
  const monthly: MonthlyGoals = {};

  windows.forEach((window, quarterIndex) => {
    const quarterAmount = quarterGoals[quarterIndex] ?? 0;
    const monthsInQuarter =
      quarterIndex < 3
        ? 3
        : normalizeCommissionMonthCount(monthCount) - 9;
    const perMonth = monthsInQuarter > 0 ? quarterAmount / monthsInQuarter : 0;
    const cursor = new Date(window.start);
    for (let index = 0; index < monthsInQuarter; index += 1) {
      monthly[monthKeyFromDate(cursor)] = perMonth;
      cursor.setMonth(cursor.getMonth() + 1);
    }
  });

  return monthly;
}

export function resolveMonthlyGoals(goal: AttorneyGoal): MonthlyGoals {
  if (goal.monthlyGoals && Object.keys(goal.monthlyGoals).length > 0) {
    return goal.monthlyGoals;
  }
  return monthlyGoalsFromQuarterGoals(goal);
}

export function resolveMonthlyFeeGoals(goal: AttorneyGoal): MonthlyGoals {
  if (goal.monthlyFeeGoals && Object.keys(goal.monthlyFeeGoals).length > 0) {
    return goal.monthlyFeeGoals;
  }
  return monthlyFeeGoalsFromQuarterGoals(goal);
}

export function inferCommissionMonthCount(goal: AttorneyGoal): CommissionPeriodMonthCount {
  if (goal.commissionMonthCount === 13) return 13;
  const storedCount = Object.keys(goal.monthlyGoals ?? {}).length;
  if (storedCount >= 13) return 13;
  return 12;
}

export function parseMonthlyGoalsInput(values: Record<string, string>) {
  const monthlyGoals: MonthlyGoals = {};
  for (const [monthKey, raw] of Object.entries(values)) {
    const numeric = parseNumberInput(String(raw));
    if (numeric > 0) {
      monthlyGoals[monthKey] = numeric;
    }
  }
  return monthlyGoals;
}

export function monthlyGoalInputFromResolved(monthlyGoals: MonthlyGoals) {
  return Object.fromEntries(
    Object.entries(monthlyGoals).map(([key, value]) => [key, value > 0 ? formatNumberInput(value) : ""]),
  );
}

export function spreadEvenMonthlyGoals(total: number, monthKeys: string[]) {
  const count = monthKeys.length;
  const roundedTotal = Math.round(total);
  if (count === 0 || !Number.isFinite(roundedTotal) || roundedTotal <= 0) {
    return Object.fromEntries(monthKeys.map((monthKey) => [monthKey, ""]));
  }

  const perMonth = Math.floor(roundedTotal / count);
  const remainder = roundedTotal - perMonth * count;
  const values: Record<string, string> = {};

  monthKeys.forEach((monthKey, index) => {
    const amount = index === count - 1 ? perMonth + remainder : perMonth;
    values[monthKey] = formatNumberInput(amount);
  });

  return values;
}

export function getCommissionQuarterSummaries(
  commissionYear: number,
  startMonth: number,
  monthlyGoals: MonthlyGoals,
  monthCount: number = 12,
) {
  const windows = getCommissionYearQuarterWindows(commissionYear, startMonth, monthCount);
  return windows.map((window) => {
    let total = 0;
    const cursor = new Date(window.start);
    while (cursor <= window.end) {
      total += monthlyGoals[monthKeyFromDate(cursor)] ?? 0;
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return {
      quarter: window.quarter,
      period: formatCommissionQuarterPeriod(commissionYear, startMonth, window.quarter, monthCount),
      total,
    };
  });
}

export function formatGoalPeriodLabel(commissionYear: number, startMonth: number, monthCount: number = 12) {
  return formatCommissionPeriod(commissionYear, startMonth, monthCount);
}
