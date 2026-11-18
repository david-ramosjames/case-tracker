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

/**
 * Jon's linear monthly signed-case pacing.
 * Today counts as incomplete, so rate uses completed prior days only
 * (e.g. Nov 16 → 15 days): signed / completed × daysInMonth.
 */
export function computeSignedCasePacing(input: {
  signedMtd: number;
  year: number;
  month1to12: number;
  dayOfMonth: number;
  monthlyGoal: number;
}): SignedCasePacing {
  const dim = daysInMonth(input.year, input.month1to12);
  const cappedDay = Math.max(1, Math.min(input.dayOfMonth, dim));
  // Exclude today until the day is over (day 1 still uses 1 so we have a rate).
  const daysElapsed = Math.max(1, cappedDay - 1);
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
  /** Tracker expected disbursement quarter (planning field). */
  targetResolutionQuarter: string | null;
  /** Party/disbursement row id when outstanding is tracked per individual. */
  disbursementId?: string | null;
};

/** Active cases planned to disburse in a given expected-disbursement quarter. */
export type ExpectedDisbursementQuarterCase = {
  caseId: string;
  caseNumber: string;
  clientName: string;
  attorneyName: string;
  caseStage: string;
  expectedAttorneyFees: number;
  targetResolutionQuarter: string | null;
  settlementDate: string | null;
};

export type QuarterlyFeeProjection = {
  feesDisbursedInQuarter: number;
  /** Settled, not disbursed, with Exp. disburse Q = current quarter (stack segment 2). */
  eligibleSettledUndisbursedFees: number;
  /** Expected this quarter but not yet settled (stack segment 3). */
  unsettledExpectedFees: number;
  projectedQuarterlyFees: number;
  quarterlyGoal: number;
  attainment: number | null;
  variance: number | null;
  lagDays: number;
  /** Current Exp. disburse quarter label used for the settled segment filter (e.g. Q4-26). */
  currentQuarterLabel: string;
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
 * Normalize Exp. disburse labels like `Q4-26` / `2026 Q4` for equality checks.
 * Kept local so pacing stays free of case-options imports.
 */
export function normalizeQuarterLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const short = trimmed.match(/^Q([1-4])[-/]?(\d{2})$/i);
  if (short) return `Q${short[1]}-${short[2]}`;
  const long = trimmed.match(/^(\d{4})\s*Q([1-4])$/i);
  if (long) return `Q${long[2]}-${String(Number(long[1]) % 100).padStart(2, "0")}`;
  return trimmed.toUpperCase();
}

/**
 * Jon fee pacing: disbursed + settled planned this quarter (not disbursed)
 * + unsettled expected this quarter.
 * Settled stack segment uses Exp. disburse Q (targetResolutionQuarter), not lag-only.
 */
export function computeJonQuarterlyFeeProjection(input: {
  feesDisbursedInQuarter: number;
  settledUndisbursed: SettledUndisbursedCase[];
  /** Fees for active cases with Exp. disburse Q = current that are not Settled. */
  unsettledExpectedFees?: number;
  quarterlyGoal: number;
  quarterEndYmd: string;
  lagDays: number;
  /** Current calendar quarter as Exp. disburse label (e.g. Q4-26). */
  currentQuarterLabel: string;
}): QuarterlyFeeProjection {
  const current = normalizeQuarterLabel(input.currentQuarterLabel);
  const eligibleCases: SettledUndisbursedCase[] = [];
  const excludedCases: SettledUndisbursedCase[] = [];
  for (const row of input.settledUndisbursed) {
    const planned = normalizeQuarterLabel(row.targetResolutionQuarter);
    if (current && planned && planned === current) {
      eligibleCases.push(row);
    } else {
      excludedCases.push(row);
    }
  }
  const eligibleSettledUndisbursedFees = eligibleCases.reduce(
    (sum, row) => sum + row.expectedAttorneyFees,
    0,
  );
  const unsettledExpectedFees = Math.max(0, input.unsettledExpectedFees ?? 0);
  const projectedQuarterlyFees =
    input.feesDisbursedInQuarter + eligibleSettledUndisbursedFees + unsettledExpectedFees;
  const attainment =
    input.quarterlyGoal > 0 ? projectedQuarterlyFees / input.quarterlyGoal : null;
  return {
    feesDisbursedInQuarter: input.feesDisbursedInQuarter,
    eligibleSettledUndisbursedFees,
    unsettledExpectedFees,
    projectedQuarterlyFees,
    quarterlyGoal: input.quarterlyGoal,
    attainment,
    variance: projectedQuarterlyFees - input.quarterlyGoal,
    lagDays: input.lagDays,
    currentQuarterLabel: current ?? input.currentQuarterLabel,
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
