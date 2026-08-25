import { caseRequiresOngoingUpdates } from "@/lib/case-status";
import { getOutdatedValidationFields, getValidationFieldLabel } from "@/lib/attorney-score";
import { getAttorneyCommissionStartMonth, isActivePipelineCase } from "@/lib/auth/access";
import {
  getCurrentFirmOutperformGoal,
  getFirmOutperformGoalForCalendarYear,
  getFirmOutperformGoalForYear,
  getAttorneyOnlyGoals,
} from "@/lib/firm-goals";
import {
  formatCommissionQuarterPeriod,
  getCalendarYearElapsedPercentage,
  getCommissionQuarterForDate,
  getCommissionPeriodEndDate,
  getCommissionYearQuarterWindows,
  getCommissionYearStartDate,
  getCurrentCommissionYear,
  isTargetQuarterInCommissionYear,
  parseTargetQuarterYear,
  type CommissionYearQuarter,
} from "@/lib/commission-year";
import {
  getWeightedDisbursedFeesInCommissionQuarter,
  getWeightedSettlementInCommissionQuarter,
  recordHasDisbursementInCommissionYear,
} from "@/lib/disbursements";
import {
  getCommissionYearDisbursedAmounts,
  getOutputDisbursedAmounts,
  getOutputSettledAmounts,
  resolveOutputPeriodContextForRecord,
} from "@/lib/results-commission-year";
import {
  type AttorneyGoal,
  type CaseStage,
  type CaseRecord,
  type CaseCompletionScore,
  type CaseTrackerSettings,
  type DashboardMetrics,
  type DataQualityFlag,
  type ExpectedLitigationStatus,
} from "@/lib/types";
import { daysSince, getCurrentQuarter, getQuarterElapsedPercentage, getYearElapsedPercentage } from "@/lib/utils";

import {
  goalOverlapsCalendarYear,
  sumAttorneyFeeGoalsInCalendarYear,
  sumAttorneyGrossGoalsInCalendarYear,
} from "@/lib/attorney-goal-months";
import { deriveForecastFeePercent, deriveResultFeePercent, resolveSettledFeePercent } from "@/lib/fee-percent";
import { QUARTERLY_REVIEW_DAYS, SOURCES_LIT_REVIEW_DAYS } from "@/lib/slack/config";
import { normalizeTargetQuarter } from "@/lib/target-quarter";

export { deriveFeePercentFromSettlement, deriveForecastFeePercent, deriveResultFeePercent, referralFeeToDecimal, resolveSettledFeePercent, wasEverInLitigation } from "@/lib/fee-percent";

const QUARTERLY_CHECK_IN_FIELDS = ["targetResolutionQuarter", "minimumValue"] as const;
const SOURCES_LIT_FIELDS = ["injuries", "caseDescription"] as const;

export function sourcesLitNeedsReview(record: CaseRecord) {
  if (!caseRequiresOngoingUpdates(record)) return false;
  const { tracker } = record;
  const hasContent = SOURCES_LIT_FIELDS.some((field) => Boolean(tracker[field]?.trim()));
  if (!hasContent) return true;
  return daysSince(tracker.lastSourcesLitUpdatedAt) >= SOURCES_LIT_REVIEW_DAYS;
}

export function getDataQualityFlags(
  record: CaseRecord,
  settings: Pick<CaseTrackerSettings, "staleReviewThresholdDays">,
): DataQualityFlag[] {
  const flags: DataQualityFlag[] = [];
  const { tracker, shared } = record;

  if (tracker.minimumValue == null) {
    flags.push({ id: "missing-minimum-value", label: "Missing minimum value", severity: "danger" });
  }

  if (!shared.clientName || !shared.dateSigned || !shared.dateOfIncident || !shared.caseType) {
    flags.push({ id: "missing-setup", label: "Missing setup field", severity: "danger" });
  }

  if (!tracker.referralFeeArrangement) {
    flags.push({ id: "missing-referral-arrangement", label: "Missing referral fee arrangement", severity: "warning" });
  }

  if (!tracker.balanceCtaInfo) {
    flags.push({ id: "missing-balance-cta", label: "Missing balance/CTA info", severity: "warning" });
  }

  if (tracker.policyLimits == null) {
    flags.push({ id: "missing-policy-limits", label: "Missing policy limits", severity: "warning" });
  }

  if (!tracker.policyInfoSource) {
    flags.push({ id: "missing-policy-source", label: "Missing policy source", severity: "warning" });
  }

  if (!tracker.targetResolutionQuarter) {
    flags.push({ id: "missing-quarter", label: "Missing expected disbursement quarter", severity: "warning" });
  }

  if (caseRequiresOngoingUpdates(record)) {
    if (daysSince(tracker.lastReviewedAt) > settings.staleReviewThresholdDays) {
      flags.push({ id: "stale-review", label: "Review stale", severity: "warning" });
    }

    if (needsQuarterlyCheckIn(record)) {
      flags.push({ id: "quarterly-check-in", label: "Quarterly check-in due", severity: "danger" });
    }

    for (const fieldId of getOutdatedValidationFields(record)) {
      flags.push({
        id: `validation-stale-${fieldId}`,
        label: `${getValidationFieldLabel(fieldId)} needs validation (90d)`,
        severity: "danger",
      });
    }
  }

  if (getOpenStageSuggestions(record).length > 0) {
    flags.push({ id: "stage-suggestion", label: "Stage confirmation suggested", severity: "warning" });
  }

  if (tracker.isActive && shared.status === "Closed") {
    flags.push({ id: "status-mismatch", label: "Active tracker/status mismatch", severity: "danger" });
  }

  if (tracker.caseStage === "Settled" && !tracker.result.checkDisbursedAt) {
    flags.push({ id: "missing-disbursement", label: "Settled, missing disbursement", severity: "warning" });
  }

  return flags;
}

export function isMissingInfo(record: CaseRecord, settings: Pick<CaseTrackerSettings, "staleReviewThresholdDays">) {
  return getDataQualityFlags(record, settings).some((flag) => flag.id.startsWith("missing"));
}

export function isStale(record: CaseRecord, settings: Pick<CaseTrackerSettings, "staleReviewThresholdDays">) {
  return getDataQualityFlags(record, settings).some((flag) => flag.id === "stale-review");
}

type CompletionCheck = { id: string; complete: boolean };

export function getCaseCompletionChecks(record: CaseRecord): CompletionCheck[] {
  const { shared, tracker } = record;

  return [
    { id: "client", complete: Boolean(shared.clientName?.trim()) },
    { id: "date-signed", complete: Boolean(shared.dateSigned) },
    { id: "dol", complete: Boolean(shared.dateOfIncident) },
    { id: "case-type", complete: Boolean(shared.caseType?.trim()) },
    { id: "minimum", complete: tracker.minimumValue != null },
    { id: "quarter", complete: Boolean(tracker.targetResolutionQuarter?.trim()) },
    { id: "policy-limits", complete: tracker.policyLimits != null },
    { id: "policy-source", complete: Boolean(tracker.policyInfoSource?.trim()) },
    { id: "referral", complete: Boolean(tracker.referralFeeArrangement?.trim()) },
    { id: "balance-cta", complete: Boolean(tracker.balanceCtaInfo?.trim()) },
    { id: "injuries", complete: Boolean(tracker.injuries?.trim()) },
    { id: "description", complete: Boolean(tracker.caseDescription?.trim()) },
    { id: "confidence", complete: Boolean(tracker.confidenceLevel) },
  ];
}

export function getCaseCompletionScore(
  record: CaseRecord,
  _settings?: Pick<CaseTrackerSettings, "staleReviewThresholdDays">,
): CaseCompletionScore {
  const checks = getCaseCompletionChecks(record);
  const completed = checks.filter((check) => check.complete).length;
  const total = checks.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  let level: CaseCompletionScore["level"] = "critical";
  if (percent >= 100) level = "complete";
  else if (percent >= 85) level = "good";
  else if (percent >= 60) level = "attention";

  return { percent, level, completed, total };
}

function isRecordInGoalCommissionYear(record: CaseRecord, goal: AttorneyGoal) {
  const startMonth = goal.commissionYearStartMonth;
  const commissionYear = goal.year;
  const monthCount = goal.commissionMonthCount ?? 12;

  if (recordHasDisbursementInCommissionYear(record, commissionYear, startMonth, monthCount)) {
    return true;
  }

  return isTargetQuarterInCommissionYear(record.tracker.targetResolutionQuarter, commissionYear, startMonth);
}

function getCommissionYearElapsedPercentage(goal: AttorneyGoal, refDate = new Date()) {
  const monthCount = goal.commissionMonthCount ?? 12;
  const start = getCommissionYearStartDate(goal.year, goal.commissionYearStartMonth);
  const end = getCommissionPeriodEndDate(goal.year, goal.commissionYearStartMonth, monthCount);
  if (refDate <= start) return 0;
  if (refDate >= end) return 100;
  const total = end.getTime() - start.getTime();
  const elapsed = refDate.getTime() - start.getTime();
  return total > 0 ? (elapsed / total) * 100 : 0;
}

export function getDashboardMetrics(
  records: CaseRecord[],
  settings: Pick<CaseTrackerSettings, "staleReviewThresholdDays">,
  goals: AttorneyGoal[] = [],
): DashboardMetrics {
  const activeRecords = records.filter((record) => isActivePipelineCase(record, goals));

  return {
    totalActiveCases: activeRecords.length,
    totalForecastSettlementValue: sum(activeRecords.map((record) => record.tracker.minimumValue)),
    totalForecastFeeValue: sum(activeRecords.map((record) => getProjectedFeeValue(record))),
    settledNotDisbursedAmount: sum(
      records
        .filter((record) => record.tracker.caseStage === "Settled" && !record.tracker.result.checkDisbursedAt)
        .map((record) => record.tracker.result.settlementAmount),
    ),
    casesMissingRequiredFields: activeRecords.filter((record) => isMissingInfo(record, settings)).length,
    casesNotReviewedRecently: activeRecords.filter((record) => isStale(record, settings)).length,
    casesNeedingQuarterlyCheckIn: activeRecords.filter(needsQuarterlyCheckIn).length,
    casesWithOutdatedValidation: activeRecords.filter((record) => getOutdatedValidationFields(record).length > 0).length,
    stageSuggestionsOpen: records.reduce((total, record) => total + getOpenStageSuggestions(record).length, 0),
  };
}

export function getAttorneyGoalProgress(records: CaseRecord[], goals: AttorneyGoal[]) {
  const currentQuarter = getCurrentQuarter();
  const currentQuarterNumber = Number(currentQuarter.slice(-1));
  const quarterElapsed = getQuarterElapsedPercentage();
  const attorneyGoals = getAttorneyOnlyGoals(goals);

  return attorneyGoals.map((goal) => {
    const attorneyRecords = records.filter(
      (record) => record.shared.attorneyId === goal.attorneyId && isRecordInGoalCommissionYear(record, goal),
    );
    const yearElapsed = getCommissionYearElapsedPercentage(goal);
    const activeRecords = attorneyRecords.filter((record) => record.tracker.isActive);
    const planGross = sum(activeRecords.map((record) => record.tracker.minimumValue));
    const planFees = sum(activeRecords.map((record) => getProjectedFeeValue(record)));
    const actualGrossDisbursed = sum(
      attorneyRecords.map((record) => getCommissionYearDisbursedAmounts(record, goal).grossDisbursed),
    );
    const actualDisbursedFees = sum(
      attorneyRecords.map((record) => getCommissionYearDisbursedAmounts(record, goal).disbursedFees),
    );
    const quarterGoal = [goal.q1Goal, goal.q2Goal, goal.q3Goal, goal.q4Goal][currentQuarterNumber - 1];
    const annualProgress = goal.annualGrossGoal > 0 ? (actualGrossDisbursed / goal.annualGrossGoal) * 100 : 0;
    const feeProgress = goal.annualRjlFeesGoal > 0 ? (actualDisbursedFees / goal.annualRjlFeesGoal) * 100 : 0;
    const quarterProgress = quarterGoal > 0 ? (actualGrossDisbursed / quarterGoal) * 100 : 0;
    const commissionableAmount = Math.max(actualDisbursedFees - goal.commissionThreshold, 0);

    return {
      goal,
      planGross,
      planFees,
      actualGrossDisbursed,
      actualDisbursedFees,
      commissionableAmount,
      annualProgress,
      feeProgress,
      quarterProgress,
      yearElapsed,
      quarterElapsed,
      pace: annualProgress >= yearElapsed ? "ahead" : "behind",
      thresholdMet: actualDisbursedFees >= goal.commissionThreshold,
    };
  });
}

export function sum(values: Array<number | null | undefined>) {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

export function getFeePercent(record: CaseRecord) {
  if (record.tracker.caseStage === "Settled") {
    return resolveSettledFeePercent({
      feePercent: record.tracker.result.feePercent,
      expectedLitigation: record.tracker.expectedLitigation,
      referralFee: record.tracker.referralFee,
    });
  }
  return deriveForecastFeePercent(record.tracker);
}

export function getProjectedFeeValue(record: CaseRecord) {
  // 0 is a valid minimum — do not fall back to a stale estimatedFeeValue.
  if (record.tracker.minimumValue == null) return record.tracker.estimatedFeeValue;
  return Math.round(record.tracker.minimumValue * getFeePercent(record));
}

export function needsQuarterlyCheckIn(record: CaseRecord) {
  if (!caseRequiresOngoingUpdates(record)) return false;
  const missingQuarterlyField = QUARTERLY_CHECK_IN_FIELDS.some((field) => !record.tracker[field]);
  const reviewStale = daysSince(record.tracker.lastQuarterlyCheckInAt) >= QUARTERLY_REVIEW_DAYS;
  return missingQuarterlyField || reviewStale;
}

export function getOpenStageSuggestions(record: CaseRecord) {
  return record.tracker.detectedStageSignals.filter((signal) => !signal.confirmedAt && !signal.dismissedAt);
}

export type OpenStageSuggestionItem = {
  record: CaseRecord;
  signal: CaseRecord["tracker"]["detectedStageSignals"][number];
};

export function getOpenStageSuggestionItems(records: CaseRecord[]): OpenStageSuggestionItem[] {
  return records
    .flatMap((record) => getOpenStageSuggestions(record).map((signal) => ({ record, signal })))
    .sort((a, b) => b.signal.detectedAt.localeCompare(a.signal.detectedAt));
}

export type CommissionQuarterPerformanceRow = {
  label: string;
  period: string;
  target: number;
  plan: number;
  actual: number;
};

function calendarQuarterAnchorDate(quarterValue: string): Date | null {
  const canonical = normalizeTargetQuarter(quarterValue);
  if (!canonical) return null;
  const match = canonical.match(/^(\d{4}) Q([1-4])$/);
  if (!match) return null;
  const year = Number(match[1]);
  const calendarQuarter = Number(match[2]);
  const month = (calendarQuarter - 1) * 3;
  return new Date(year, month, 15);
}

/** Quarterly target/plan/actual using commission-year quarters (CY Q1–Q4), not calendar Q1–Q4. */
export function getAttorneyCommissionQuarterRows(
  records: CaseRecord[],
  goal: AttorneyGoal,
  mode: "gross" | "fees",
): CommissionQuarterPerformanceRow[] {
  const monthCount = goal.commissionMonthCount ?? 12;
  const windows = getCommissionYearQuarterWindows(goal.year, goal.commissionYearStartMonth, monthCount);
  const grossQuarterTargets = [goal.q1Goal, goal.q2Goal, goal.q3Goal, goal.q4Goal];
  const feeQuarterTargets = [goal.feeQ1Goal, goal.feeQ2Goal, goal.feeQ3Goal, goal.feeQ4Goal];
  const attorneyRecords = records.filter(
    (record) => record.shared.attorneyId === goal.attorneyId && isRecordInGoalCommissionYear(record, goal),
  );

  return windows.map((window) => {
    const planRecords = attorneyRecords.filter((record) => {
      if (!record.tracker.isActive || !record.tracker.targetResolutionQuarter) return false;
      const anchor = calendarQuarterAnchorDate(record.tracker.targetResolutionQuarter);
      if (!anchor) return false;
      return getCommissionQuarterForDate(anchor, goal.year, goal.commissionYearStartMonth, monthCount) === window.quarter;
    });

    const plan =
      mode === "gross"
        ? sum(planRecords.map((record) => record.tracker.minimumValue))
        : sum(planRecords.map((record) => getProjectedFeeValue(record)));
    const getQuarterForDate = (dateValue: string, year: number, month: number) =>
      getCommissionQuarterForDate(dateValue, year, month, monthCount);

    const actual =
      mode === "gross"
        ? sum(
            attorneyRecords.map((record) =>
              getWeightedSettlementInCommissionQuarter(
                record,
                goal.year,
                goal.commissionYearStartMonth,
                window.quarter,
                getQuarterForDate,
              ),
            ),
          )
        : sum(
            attorneyRecords.map((record) =>
              getWeightedDisbursedFeesInCommissionQuarter(
                record,
                goal.year,
                goal.commissionYearStartMonth,
                window.quarter,
                getQuarterForDate,
              ),
            ),
          );

    return {
      label: `CY Q${window.quarter}` as const,
      period: formatCommissionQuarterPeriod(
        goal.year,
        goal.commissionYearStartMonth,
        window.quarter as CommissionYearQuarter,
        monthCount,
      ),
      target: mode === "gross" ? (grossQuarterTargets[window.quarter - 1] ?? 0) : (feeQuarterTargets[window.quarter - 1] ?? 0),
      plan,
      actual,
    };
  });
}

export function getCurrentCommissionYearGoals(goals: AttorneyGoal[], attorneyIds?: string[]): AttorneyGoal[] {
  const attorneyGoals = getAttorneyOnlyGoals(goals);
  const ids = attorneyIds?.length ? attorneyIds : [...new Set(attorneyGoals.map((goal) => goal.attorneyId))];
  const now = new Date();
  return ids.flatMap((attorneyId) => {
    const startMonth = getAttorneyCommissionStartMonth(attorneyGoals, attorneyId);
    const currentYear = getCurrentCommissionYear(startMonth, now);
    const exact = attorneyGoals.find((item) => item.attorneyId === attorneyId && item.year === currentYear);
    if (exact) return [exact];

    // Extended (13/14-month) periods can still be active after the next label year starts.
    const stillActive = attorneyGoals
      .filter((item) => item.attorneyId === attorneyId)
      .find((item) => {
        const start = getCommissionYearStartDate(item.year, item.commissionYearStartMonth);
        const end = getCommissionPeriodEndDate(item.year, item.commissionYearStartMonth, item.commissionMonthCount ?? 12);
        return now >= start && now <= end;
      });
    return stillActive ? [stillActive] : [];
  });
}

export function getFirmOutperformProgress(records: CaseRecord[], firmGoal: AttorneyGoal) {
  const yearElapsed = getCommissionYearElapsedPercentage(firmGoal);
  const scopedRecords = records.filter((record) => isRecordInGoalCommissionYear(record, firmGoal));
  const actualGrossDisbursed = sum(
    scopedRecords.map((record) => getCommissionYearDisbursedAmounts(record, firmGoal).grossDisbursed),
  );
  const actualDisbursedFees = sum(
    scopedRecords.map((record) => getCommissionYearDisbursedAmounts(record, firmGoal).disbursedFees),
  );
  const annualProgress = firmGoal.annualGrossGoal > 0 ? (actualGrossDisbursed / firmGoal.annualGrossGoal) * 100 : 0;
  const feeProgress = firmGoal.annualRjlFeesGoal > 0 ? (actualDisbursedFees / firmGoal.annualRjlFeesGoal) * 100 : 0;

  return {
    goal: firmGoal,
    actualGrossDisbursed,
    actualDisbursedFees,
    annualProgress,
    feeProgress,
    yearElapsed,
    pace: annualProgress >= yearElapsed ? ("ahead" as const) : ("behind" as const),
  };
}

export type OutputPeriodMode = "commission" | "calendar";

/** How firm-wide calendar-year targets are totaled on the Output page. */
export type FirmCalendarGoalMode = "outperform" | "attorneys" | "combined";

export type FirmOutputMetricsOptions = {
  periodMode?: OutputPeriodMode;
  periodYear?: number;
  goalYear?: number;
  pipelineGoals?: AttorneyGoal[];
  /** When set, goals and thresholds are limited to these attorneys (e.g. Output page filters). */
  scopedAttorneyIds?: string[];
  /** @deprecated Use firmCalendarGoalMode instead. */
  preferFirmOutperformGoal?: boolean;
  /** Firm-wide calendar year goal rollup when periodMode is calendar. */
  firmCalendarGoalMode?: FirmCalendarGoalMode;
};

function sumOutputActuals(
  records: CaseRecord[],
  periodMode: OutputPeriodMode,
  periodYear: number,
  goalsByAttorney: Map<string, AttorneyGoal>,
  attorneyGoals: AttorneyGoal[],
) {
  let grossSettled = 0;
  let grossDisbursed = 0;
  let feesSettled = 0;
  let feesDisbursed = 0;
  let completedDisbursements = 0;

  const outputMode = periodMode === "calendar" ? "calendar" : "commission";

  for (const record of records) {
    const context = resolveOutputPeriodContextForRecord(
      record,
      outputMode,
      periodYear,
      goalsByAttorney,
      attorneyGoals,
    );
    const disbursed = getOutputDisbursedAmounts(record, context);
    const settled = getOutputSettledAmounts(record, context);

    grossDisbursed += disbursed.settlementAmount;
    feesDisbursed += disbursed.attorneyFees;
    grossSettled += settled.settlementAmount;
    feesSettled += settled.attorneyFees;

    if (disbursed.settlementAmount > 0 || disbursed.attorneyFees > 0) {
      completedDisbursements += 1;
    }
  }

  return { grossSettled, grossDisbursed, feesSettled, feesDisbursed, completedDisbursements };
}

export function getFirmOutputMetrics(
  records: CaseRecord[],
  goals: AttorneyGoal[],
  options: FirmOutputMetricsOptions = {},
) {
  const allGoals = options.pipelineGoals ?? goals;
  const periodMode = options.periodMode ?? "commission";
  const refDate = new Date();
  const calendarYear = options.periodYear ?? refDate.getFullYear();
  const commissionGoalYear =
    periodMode === "commission" ? (options.periodYear ?? options.goalYear) : options.goalYear;
  const scopedAttorneyIds = options.scopedAttorneyIds?.filter(Boolean);

  const attorneyScopedGoals = getAttorneyOnlyGoals(
    commissionGoalYear != null ? goals.filter((goal) => goal.year === commissionGoalYear) : goals,
  ).filter((goal) => !scopedAttorneyIds?.length || scopedAttorneyIds.includes(goal.attorneyId));
  const firmOutperformGoal =
    periodMode === "calendar"
      ? getFirmOutperformGoalForCalendarYear(allGoals, calendarYear)
      : commissionGoalYear != null
        ? getFirmOutperformGoalForYear(allGoals, commissionGoalYear)
        : getCurrentFirmOutperformGoal(allGoals);
  const goalsByAttorney = new Map(attorneyScopedGoals.map((goal) => [goal.attorneyId, goal]));

  const calendarAttorneyGoals =
    periodMode === "calendar"
      ? getAttorneyOnlyGoals(allGoals).filter((goal) => {
          if (scopedAttorneyIds?.length && !scopedAttorneyIds.includes(goal.attorneyId)) {
            return false;
          }
          return goalOverlapsCalendarYear(goal, calendarYear);
        })
      : [];

  const firmCalendarGoalMode: FirmCalendarGoalMode =
    options.firmCalendarGoalMode ??
    (options.preferFirmOutperformGoal === true ? "outperform" : "attorneys");

  const attorneyCalendarGross = sumAttorneyGrossGoalsInCalendarYear(calendarAttorneyGoals, calendarYear);
  const attorneyCalendarFees = sumAttorneyFeeGoalsInCalendarYear(calendarAttorneyGoals, calendarYear);
  const outperformCalendarGross =
    firmOutperformGoal && goalOverlapsCalendarYear(firmOutperformGoal, calendarYear)
      ? sumAttorneyGrossGoalsInCalendarYear([firmOutperformGoal], calendarYear)
      : 0;
  const outperformCalendarFees =
    firmOutperformGoal && goalOverlapsCalendarYear(firmOutperformGoal, calendarYear)
      ? sumAttorneyFeeGoalsInCalendarYear([firmOutperformGoal], calendarYear)
      : 0;

  const attorneyCommissionGross = sum(attorneyScopedGoals.map((goal) => goal.annualGrossGoal));
  const attorneyCommissionFees = sum(attorneyScopedGoals.map((goal) => goal.annualRjlFeesGoal));

  // Commission-year mode is only used when an attorney is selected on Output.
  // Never substitute the firm Outperform target for that attorney's own goals —
  // Jan–Dec attorneys should match calendar year when their commission year is Jan–Dec.
  const usesFirmOutperformTarget =
    periodMode === "calendar" &&
    ((firmCalendarGoalMode === "outperform" && outperformCalendarGross > 0) ||
      firmCalendarGoalMode === "combined");

  const annualGrossGoal =
    periodMode === "calendar"
      ? firmCalendarGoalMode === "combined"
        ? attorneyCalendarGross + outperformCalendarGross
        : firmCalendarGoalMode === "outperform" && outperformCalendarGross > 0
          ? outperformCalendarGross
          : attorneyCalendarGross
      : attorneyCommissionGross;

  const annualRjlFeesGoal =
    periodMode === "calendar"
      ? firmCalendarGoalMode === "combined"
        ? attorneyCalendarFees + outperformCalendarFees
        : firmCalendarGoalMode === "outperform" && outperformCalendarFees > 0
          ? outperformCalendarFees
          : attorneyCalendarFees
      : attorneyCommissionFees;

  const yearElapsed =
    periodMode === "calendar"
      ? getCalendarYearElapsedPercentage(calendarYear, refDate)
      : attorneyScopedGoals.length === 1
        ? getCommissionYearElapsedPercentage(attorneyScopedGoals[0], refDate)
        : attorneyScopedGoals.length > 1
          ? attorneyScopedGoals.reduce(
              (total, goal) => total + getCommissionYearElapsedPercentage(goal, refDate),
              0,
            ) / attorneyScopedGoals.length
          : getYearElapsedPercentage(refDate);

  const pacingGrossGoal = Math.round(annualGrossGoal * (yearElapsed / 100));
  const pacingFeesGoal = Math.round(annualRjlFeesGoal * (yearElapsed / 100));

  const { grossSettled, grossDisbursed, feesSettled, feesDisbursed, completedDisbursements } = sumOutputActuals(
    records,
    periodMode,
    periodMode === "calendar" ? calendarYear : commissionGoalYear ?? attorneyScopedGoals[0]?.year ?? calendarYear,
    goalsByAttorney,
    getAttorneyOnlyGoals(allGoals),
  );

  const planRecords = records.filter((record) => {
    if (!record.tracker.isActive) return false;
    if (periodMode === "calendar") {
      return parseTargetQuarterYear(record.tracker.targetResolutionQuarter) === calendarYear;
    }
    return attorneyScopedGoals.some(
      (goal) =>
        record.shared.attorneyId === goal.attorneyId &&
        isTargetQuarterInCommissionYear(record.tracker.targetResolutionQuarter, goal.year, goal.commissionYearStartMonth),
    );
  });

  const commissionThreshold = Math.round(sum(attorneyScopedGoals.map((goal) => goal.commissionThreshold)));
  const commissionableAmount = Math.max(feesDisbursed - commissionThreshold, 0);
  const planGross = sum(planRecords.map((record) => record.tracker.minimumValue));
  const planFees = sum(planRecords.map((record) => getProjectedFeeValue(record)));

  const commissionAnchorGoal = attorneyScopedGoals[0] ?? null;
  const scopedRecords =
    periodMode === "commission" && commissionAnchorGoal != null
      ? records.filter((record) => isRecordInGoalCommissionYear(record, commissionAnchorGoal))
      : records;

  return {
    results: {
      grossSettled,
      grossDisbursed,
      feesSettled,
      feesDisbursed,
      annualGrossGoal,
      annualRjlFeesGoal,
      pacingGrossGoal,
      pacingFeesGoal,
      yearElapsed,
      commissionThreshold,
      commissionableAmount,
      planGross,
      planFees,
      completedDisbursements,
      firmOutperformGoal: usesFirmOutperformTarget,
      firmCalendarGoalMode: periodMode === "calendar" ? firmCalendarGoalMode : null,
      periodMode,
      periodYear:
        periodMode === "calendar" ? calendarYear : commissionGoalYear ?? attorneyScopedGoals[0]?.year ?? calendarYear,
    },
    caseStatuses: getCaseStatusRollup(records, getAttorneyOnlyGoals(allGoals)),
    grossQuarterRows: getQuarterRows(scopedRecords, annualGrossGoal, "gross", attorneyScopedGoals),
    feeQuarterRows: getQuarterRows(scopedRecords, annualRjlFeesGoal, "fees", attorneyScopedGoals),
  };
}

export function getCaseStatusRollup(records: CaseRecord[], goals: AttorneyGoal[]) {
  const activeRecords = records.filter((record) => isActivePipelineCase(record, goals));
  const labels = ["Onboarding", "Txt", "Dmd", "Lit", "Settled"];
  const total = activeRecords.length || 1;
  const counts = new Map(labels.map((label) => [label, 0]));

  activeRecords.forEach((record) => {
    const label = getStatusRollupLabel(record.tracker.caseStage);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });

  const rows = labels.map((label) => {
    const count = counts.get(label) ?? 0;
    return {
      label,
      count,
      percentOfTotal: (count / total) * 100,
    };
  });

  return {
    rows,
    total: activeRecords.length,
  };
}

function toCalendarQuarterLabel(calendarYear: number, quarter: 1 | 2 | 3 | 4) {
  const yy = String(calendarYear % 100).padStart(2, "0");
  return `Q${quarter}-${yy}`;
}

function calendarQuartersForYear(calendarYear: number) {
  return ([1, 2, 3, 4] as const).map((quarter) => toCalendarQuarterLabel(calendarYear, quarter));
}

function calendarQuartersInCommissionYear(commissionYear: number, startMonth: number, monthCount = 12) {
  const start = getCommissionYearStartDate(commissionYear, startMonth);
  const end = getCommissionPeriodEndDate(commissionYear, startMonth, monthCount);
  const labels = new Set<string>();
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const endCursor = new Date(end.getFullYear(), end.getMonth(), 1);

  while (cursor <= endCursor) {
    const calendarQuarter = (Math.floor(cursor.getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
    labels.add(toCalendarQuarterLabel(cursor.getFullYear(), calendarQuarter));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return [...labels];
}

/** Quarters shown on output tables: current calendar year + attorney commission year (past and future). */
export function getOutputQuarterLabels(goals: AttorneyGoal[], refDate = new Date()) {
  const labels = new Set(calendarQuartersForYear(refDate.getFullYear()));
  for (const goal of goals) {
    for (const quarter of calendarQuartersInCommissionYear(
      goal.year,
      goal.commissionYearStartMonth,
      goal.commissionMonthCount ?? 12,
    )) {
      labels.add(quarter);
    }
  }
  return [...labels].sort(compareQuarters);
}

function toCanonicalQuarter(value: string) {
  return normalizeTargetQuarter(value);
}

function quarterMatches(recordQuarter: string | null | undefined, canonicalQuarter: string) {
  if (!recordQuarter) return false;
  return toCanonicalQuarter(recordQuarter) === canonicalQuarter;
}

function toDisplayQuarter(canonicalQuarter: string) {
  const match = canonicalQuarter.match(/^(\d{4}) Q([1-4])$/);
  if (!match) return canonicalQuarter;
  return toCalendarQuarterLabel(Number(match[1]), Number(match[2]) as 1 | 2 | 3 | 4);
}

function collectOutputQuarterKeys(records: CaseRecord[], goals: AttorneyGoal[], refDate = new Date()) {
  const keys = new Set<string>();

  for (const quarter of getOutputQuarterLabels(goals, refDate)) {
    const canonical = toCanonicalQuarter(quarter);
    if (canonical) keys.add(canonical);
  }

  for (const record of records) {
    for (const quarter of [record.tracker.targetResolutionQuarter, record.tracker.result.resultQuarter]) {
      const canonical = quarter ? toCanonicalQuarter(quarter) : null;
      if (canonical) keys.add(canonical);
    }
  }

  return [...keys].sort((a, b) => compareQuarters(a, b));
}

function getQuarterRows(
  records: CaseRecord[],
  annualGoal: number,
  mode: "gross" | "fees",
  goals: AttorneyGoal[] = [],
  refDate = new Date(),
) {
  const quarters = collectOutputQuarterKeys(records, goals, refDate);
  const target = Math.round(annualGoal / Math.max(quarters.length, 4));

  return quarters.map((quarter) => {
    const plannedRecords = records.filter((record) => {
      if (!quarterMatches(record.tracker.targetResolutionQuarter, quarter)) return false;
      if (goals.length === 0) return true;
      const goal = goals.find((item) => item.attorneyId === record.shared.attorneyId);
      if (!goal) return false;
      return isTargetQuarterInCommissionYear(quarter, goal.year, goal.commissionYearStartMonth);
    });
    const actualRecords = records.filter(
      (record) => quarterMatches(record.tracker.result.resultQuarter, quarter) && record.tracker.result.checkDisbursedAt,
    );
    const plan =
      mode === "gross"
        ? sum(plannedRecords.map((record) => record.tracker.minimumValue))
        : sum(plannedRecords.map((record) => getProjectedFeeValue(record)));
    const actual =
      mode === "gross"
        ? sum(actualRecords.map((record) => record.tracker.result.settlementAmount))
        : sum(actualRecords.map((record) => record.tracker.result.attorneyFees ?? record.tracker.actualFeeValue));

    return {
      quarter: toDisplayQuarter(quarter),
      months: getQuarterMonths(quarter),
      target,
      plan,
      actual,
    };
  });
}

function getStatusRollupLabel(stage: CaseStage) {
  return stage;
}

function getQuarterMonths(quarter: string) {
  const q = quarter.match(/Q([1-4])/i)?.[1];
  if (q === "1") return "Jan-Mar";
  if (q === "2") return "Apr-Jun";
  if (q === "3") return "Jul-Sep";
  if (q === "4") return "Oct-Dec";
  if (/1H/i.test(quarter)) return "Jan-Jun";
  if (/2H/i.test(quarter)) return "Jul-Dec";
  return "TBD";
}

function compareQuarters(a: string, b: string) {
  const parse = (value: string) => {
    const canonical = toCanonicalQuarter(value) ?? value;
    const match = canonical.match(/^(\d{4}) Q([1-4])$/);
    if (match) return Number(match[1]) * 10 + Number(match[2]);
    const twoDigitYear = value.match(/(?:Q[1-4]|[12]H)-(\d{2})/i)?.[1];
    const year = Number(value.match(/20\d{2}/)?.[0] ?? (twoDigitYear ? `20${twoDigitYear}` : "9999"));
    const quarter = Number(value.match(/Q([1-4])/i)?.[1] ?? (value.match(/1H/i) ? "2" : value.match(/2H/i) ? "4" : "9"));
    return year * 10 + quarter;
  };

  return parse(a) - parse(b);
}
