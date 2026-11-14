import { daysInMonth } from "@/lib/performance/weeks";

export type SignedCasePacing = {
  signedMtd: number;
  daysElapsed: number;
  daysInMonth: number;
  monthlyGoal: number;
  projectedMonthEnd: number | null;
  projectedAttainment: number | null;
  variance: number | null;
};

/** Jon's linear monthly signed-case pacing. */
export function computeSignedCasePacing(input: {
  signedMtd: number;
  year: number;
  month1to12: number;
  dayOfMonth: number;
  monthlyGoal: number;
}): SignedCasePacing {
  const dim = daysInMonth(input.year, input.month1to12);
  const daysElapsed = Math.max(1, Math.min(input.dayOfMonth, dim));
  const projectedMonthEnd =
    daysElapsed > 0 ? (input.signedMtd / daysElapsed) * dim : null;
  const projectedAttainment =
    projectedMonthEnd != null && input.monthlyGoal > 0
      ? projectedMonthEnd / input.monthlyGoal
      : null;
  const variance =
    projectedMonthEnd != null ? projectedMonthEnd - input.monthlyGoal : null;
  return {
    signedMtd: input.signedMtd,
    daysElapsed,
    daysInMonth: dim,
    monthlyGoal: input.monthlyGoal,
    projectedMonthEnd,
    projectedAttainment,
    variance,
  };
}

export type SettledUndisbursedCase = {
  caseId: string;
  caseNumber: string;
  clientName: string;
  attorneyName: string;
  expectedAttorneyFees: number;
  settlementDate: string;
  daysOutstanding: number;
};

export type QuarterlyFeeProjection = {
  feesDisbursedInQuarter: number;
  eligibleSettledUndisbursedFees: number;
  projectedQuarterlyFees: number;
  quarterlyGoal: number;
  attainment: number | null;
  variance: number | null;
  lagDays: number;
  eligibleCases: SettledUndisbursedCase[];
  excludedCases: SettledUndisbursedCase[];
};

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Estimated disburse date = settlement date + lag; eligible if est <= quarter end. */
export function isEligibleForQuarterProjection(input: {
  settlementDate: string;
  quarterEndYmd: string;
  lagDays: number;
}) {
  const estimated = addDaysYmd(input.settlementDate, input.lagDays);
  return estimated <= input.quarterEndYmd;
}

/**
 * Jon fee pacing: disbursed in quarter + eligible fully settled undisbursed.
 * Distinct from /goals plan (pipeline targetResolutionQuarter).
 */
export function computeJonQuarterlyFeeProjection(input: {
  feesDisbursedInQuarter: number;
  settledUndisbursed: SettledUndisbursedCase[];
  quarterlyGoal: number;
  quarterEndYmd: string;
  lagDays: number;
}): QuarterlyFeeProjection {
  const eligibleCases: SettledUndisbursedCase[] = [];
  const excludedCases: SettledUndisbursedCase[] = [];
  for (const row of input.settledUndisbursed) {
    if (
      isEligibleForQuarterProjection({
        settlementDate: row.settlementDate,
        quarterEndYmd: input.quarterEndYmd,
        lagDays: input.lagDays,
      })
    ) {
      eligibleCases.push(row);
    } else {
      excludedCases.push(row);
    }
  }
  const eligibleSettledUndisbursedFees = eligibleCases.reduce(
    (sum, row) => sum + row.expectedAttorneyFees,
    0,
  );
  const projectedQuarterlyFees = input.feesDisbursedInQuarter + eligibleSettledUndisbursedFees;
  const attainment =
    input.quarterlyGoal > 0 ? projectedQuarterlyFees / input.quarterlyGoal : null;
  return {
    feesDisbursedInQuarter: input.feesDisbursedInQuarter,
    eligibleSettledUndisbursedFees,
    projectedQuarterlyFees,
    quarterlyGoal: input.quarterlyGoal,
    attainment,
    variance: projectedQuarterlyFees - input.quarterlyGoal,
    lagDays: input.lagDays,
    eligibleCases,
    excludedCases,
  };
}

export function daysBetweenYmd(startYmd: string, endYmd: string) {
  const [ys, ms, ds] = startYmd.split("-").map(Number);
  const [ye, me, de] = endYmd.split("-").map(Number);
  const a = Date.UTC(ys, ms - 1, ds);
  const b = Date.UTC(ye, me - 1, de);
  return Math.floor((b - a) / 86_400_000);
}
