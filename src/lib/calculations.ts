import { getOutdatedValidationFields, getValidationFieldLabel } from "@/lib/attorney-score";
import {
  getCommissionYearEndDate,
  getCommissionYearStartDate,
  isDateInCommissionYear,
  isTargetQuarterInCommissionYear,
} from "@/lib/commission-year";
import {
  type AttorneyGoal,
  type CaseStage,
  type CaseRecord,
  type CaseCompletionScore,
  type CaseTrackerSettings,
  type DashboardMetrics,
  type DataQualityFlag,
} from "@/lib/types";
import { daysSince, getCurrentQuarter, getQuarterElapsedPercentage, getYearElapsedPercentage } from "@/lib/utils";

import { QUARTERLY_REVIEW_DAYS, SOURCES_LIT_REVIEW_DAYS } from "@/lib/slack/config";

const QUARTERLY_CHECK_IN_FIELDS = ["targetResolutionQuarter", "minimumValue"] as const;
const SOURCES_LIT_FIELDS = ["sources", "litEventsNeeded", "litEventsTimeline", "injuries", "caseDescription"] as const;

export function sourcesLitNeedsReview(record: CaseRecord) {
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

  if (!tracker.minimumValue) {
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

  if (!tracker.injuries) {
    flags.push({ id: "missing-injuries", label: "Missing injuries", severity: "danger" });
  }

  if (!tracker.policyLimits) {
    flags.push({ id: "missing-policy-limits", label: "Missing policy limits", severity: "warning" });
  }

  if (!tracker.policyInfoSource) {
    flags.push({ id: "missing-policy-source", label: "Missing policy source", severity: "warning" });
  }

  if (!tracker.targetResolutionQuarter) {
    flags.push({ id: "missing-quarter", label: "Missing target quarter", severity: "warning" });
  }

  if (!tracker.sources) {
    flags.push({ id: "missing-source", label: "Missing sources", severity: "warning" });
  }

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
    { id: "minimum", complete: tracker.minimumValue != null && tracker.minimumValue > 0 },
    { id: "quarter", complete: Boolean(tracker.targetResolutionQuarter?.trim()) },
    { id: "policy-limits", complete: tracker.policyLimits != null && tracker.policyLimits > 0 },
    { id: "policy-source", complete: Boolean(tracker.policyInfoSource?.trim()) },
    { id: "referral", complete: Boolean(tracker.referralFeeArrangement?.trim()) },
    { id: "balance-cta", complete: Boolean(tracker.balanceCtaInfo?.trim()) },
    { id: "injuries", complete: Boolean(tracker.injuries?.trim()) },
    { id: "sources", complete: Boolean(tracker.sources?.trim()) },
    { id: "description", complete: Boolean(tracker.caseDescription?.trim()) },
    { id: "confidence", complete: Boolean(tracker.confidenceLevel) },
    { id: "expected-lit", complete: Boolean(tracker.expectedLitigation) },
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

  if (isDateInCommissionYear(record.shared.dateSigned, commissionYear, startMonth)) return true;
  if (isTargetQuarterInCommissionYear(record.tracker.targetResolutionQuarter, commissionYear, startMonth)) return true;
  if (isDateInCommissionYear(record.tracker.result.checkDisbursedAt, commissionYear, startMonth)) return true;
  if (isDateInCommissionYear(record.tracker.result.settlementDate, commissionYear, startMonth)) return true;

  return false;
}

function getCommissionYearElapsedPercentage(goal: AttorneyGoal, refDate = new Date()) {
  const start = getCommissionYearStartDate(goal.year, goal.commissionYearStartMonth);
  const end = getCommissionYearEndDate(goal.year, goal.commissionYearStartMonth);
  if (refDate <= start) return 0;
  if (refDate >= end) return 100;
  const total = end.getTime() - start.getTime();
  const elapsed = refDate.getTime() - start.getTime();
  return total > 0 ? (elapsed / total) * 100 : 0;
}

export function getDashboardMetrics(
  records: CaseRecord[],
  settings: Pick<CaseTrackerSettings, "staleReviewThresholdDays">,
): DashboardMetrics {
  const activeRecords = records.filter((record) => record.tracker.isActive);

  return {
    totalActiveCases: activeRecords.length,
    totalForecastSettlementValue: sum(activeRecords.map((record) => record.tracker.minimumValue)),
    totalForecastFeeValue: sum(activeRecords.map((record) => getProjectedFeeValue(record))),
    settledNotDisbursedAmount: sum(
      records
        .filter((record) => record.tracker.caseStage === "Settled" && !record.tracker.result.checkDisbursedAt)
        .map((record) => record.tracker.result.settlementAmount),
    ),
    casesMissingRequiredFields: records.filter((record) => isMissingInfo(record, settings)).length,
    casesNotReviewedRecently: records.filter((record) => isStale(record, settings)).length,
    casesNeedingQuarterlyCheckIn: records.filter(needsQuarterlyCheckIn).length,
    casesWithOutdatedValidation: records.filter((record) => getOutdatedValidationFields(record).length > 0).length,
    stageSuggestionsOpen: records.reduce((total, record) => total + getOpenStageSuggestions(record).length, 0),
  };
}

export function getAttorneyGoalProgress(records: CaseRecord[], goals: AttorneyGoal[]) {
  const currentQuarter = getCurrentQuarter();
  const currentQuarterNumber = Number(currentQuarter.slice(-1));
  const quarterElapsed = getQuarterElapsedPercentage();

  return goals.map((goal) => {
    const attorneyRecords = records.filter(
      (record) => record.shared.attorneyId === goal.attorneyId && isRecordInGoalCommissionYear(record, goal),
    );
    const yearElapsed = getCommissionYearElapsedPercentage(goal);
    const forecastedFees = sum(
      attorneyRecords
        .filter((record) => record.tracker.isActive)
        .map((record) => getProjectedFeeValue(record)),
    );
    const actualSettledFees = sum(
      attorneyRecords
        .filter((record) => record.tracker.result.settlementAmount)
        .map((record) => record.tracker.result.attorneyFees ?? record.tracker.actualFeeValue),
    );
    const actualDisbursedFees = sum(
      attorneyRecords
        .filter((record) => record.tracker.result.checkDisbursedAt)
        .map((record) => record.tracker.result.attorneyFees ?? record.tracker.disbursedAmount),
    );
    const quarterGoal = [goal.q1Goal, goal.q2Goal, goal.q3Goal, goal.q4Goal][currentQuarterNumber - 1];
    const annualProgress = goal.annualFeeGoal > 0 ? (actualSettledFees / goal.annualFeeGoal) * 100 : 0;
    const quarterProgress = quarterGoal > 0 ? (actualSettledFees / quarterGoal) * 100 : 0;

    return {
      goal,
      forecastedFees,
      actualSettledFees,
      actualDisbursedFees,
      annualProgress,
      quarterProgress,
      yearElapsed,
      quarterElapsed,
      pace: annualProgress >= yearElapsed ? "ahead" : "behind",
    };
  });
}

export function sum(values: Array<number | null | undefined>) {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

export function getFeePercent(record: CaseRecord) {
  return record.tracker.expectedLitigation === "Pre" ? 0.3 : 0.4;
}

export function getProjectedFeeValue(record: CaseRecord) {
  if (!record.tracker.minimumValue) return record.tracker.estimatedFeeValue;
  return Math.round(record.tracker.minimumValue * getFeePercent(record));
}

export function needsQuarterlyCheckIn(record: CaseRecord) {
  const missingQuarterlyField = QUARTERLY_CHECK_IN_FIELDS.some((field) => !record.tracker[field]);
  const sourcesLitDue = sourcesLitNeedsReview(record);
  const reviewStale = daysSince(record.tracker.lastQuarterlyCheckInAt) >= QUARTERLY_REVIEW_DAYS;
  return missingQuarterlyField || sourcesLitDue || reviewStale;
}

export function getOpenStageSuggestions(record: CaseRecord) {
  return record.tracker.detectedStageSignals.filter((signal) => !signal.confirmedAt && !signal.dismissedAt);
}

export function getFirmOutputMetrics(records: CaseRecord[], goals: AttorneyGoal[], goalYear?: number) {
  const scopedGoals = goalYear != null ? goals.filter((goal) => goal.year === goalYear) : goals;
  const scopedRecords =
    goalYear != null && scopedGoals.length > 0
      ? records.filter((record) => scopedGoals.some((goal) => isRecordInGoalCommissionYear(record, goal)))
      : records;

  const annualFeeGoal = sum(scopedGoals.map((goal) => goal.annualFeeGoal));
  const yearElapsed =
    scopedGoals.length === 1
      ? getCommissionYearElapsedPercentage(scopedGoals[0])
      : getYearElapsedPercentage();
  const pacingFeeGoal = Math.round(annualFeeGoal * (yearElapsed / 100));
  const annualGrossGoal = Math.round(annualFeeGoal / 0.36);
  const pacingGrossGoal = Math.round(annualGrossGoal * (yearElapsed / 100));

  const settledRecords = scopedRecords.filter((record) => record.tracker.result.settlementAmount);
  const disbursedRecords = scopedRecords.filter((record) => record.tracker.result.checkDisbursedAt);
  const planRecords = scopedRecords.filter(
    (record) =>
      record.tracker.isActive &&
      scopedGoals.some(
        (goal) =>
          record.shared.attorneyId === goal.attorneyId &&
          isTargetQuarterInCommissionYear(record.tracker.targetResolutionQuarter, goal.year, goal.commissionYearStartMonth),
      ),
  );
  const grossSettled = sum(settledRecords.map((record) => record.tracker.result.settlementAmount));
  const grossDisbursed = sum(disbursedRecords.map((record) => record.tracker.result.settlementAmount));
  const feesSettled = sum(settledRecords.map((record) => record.tracker.result.attorneyFees ?? record.tracker.actualFeeValue));
  const feesDisbursed = sum(disbursedRecords.map((record) => record.tracker.result.attorneyFees ?? record.tracker.actualFeeValue));
  const commissionThreshold = Math.round(sum(scopedGoals.map((goal) => goal.commissionThreshold)));
  const commissionableAmount = Math.max(feesDisbursed - commissionThreshold, 0);
  const completedDisbursementGoal = Math.max(1, Math.ceil(scopedRecords.length * 0.55));
  const planFees = sum(planRecords.map((record) => getProjectedFeeValue(record)));

  return {
    results: {
      grossSettled,
      grossDisbursed,
      feesSettled,
      feesDisbursed,
      annualGrossGoal,
      annualFeeGoal,
      pacingGrossGoal,
      pacingFeeGoal,
      yearElapsed,
      commissionThreshold,
      commissionableAmount,
      planFees,
      completedDisbursements: disbursedRecords.length,
      completedDisbursementGoal,
    },
    caseStatuses: getCaseStatusRollup(scopedRecords),
    grossQuarterRows: getQuarterRows(scopedRecords, annualGrossGoal, "gross", scopedGoals),
    feeQuarterRows: getQuarterRows(scopedRecords, annualFeeGoal, "fees", scopedGoals),
  };
}

export function getCaseStatusRollup(records: CaseRecord[]) {
  const labels = ["Onboarding", "Txt", "Dmd", "Lit", "Settled", "Disengaged", "Referred", "Terminated"];
  const total = records.length || 1;
  const counts = new Map(labels.map((label) => [label, 0]));

  records.forEach((record) => {
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
    total: records.length,
  };
}

function getQuarterRows(records: CaseRecord[], annualGoal: number, mode: "gross" | "fees", goals: AttorneyGoal[] = []) {
  const quarters = Array.from(
    new Set(
      records
        .flatMap((record) => [record.tracker.targetResolutionQuarter, record.tracker.result.resultQuarter])
        .filter(Boolean) as string[],
    ),
  ).sort(compareQuarters);
  const target = Math.round(annualGoal / Math.max(quarters.length, 4));

  return quarters.map((quarter) => {
    const plannedRecords = records.filter((record) => {
      if (record.tracker.targetResolutionQuarter !== quarter) return false;
      if (goals.length === 0) return true;
      const goal = goals.find((item) => item.attorneyId === record.shared.attorneyId);
      if (!goal) return false;
      return isTargetQuarterInCommissionYear(quarter, goal.year, goal.commissionYearStartMonth);
    });
    const actualRecords = records.filter((record) => record.tracker.result.resultQuarter === quarter && record.tracker.result.checkDisbursedAt);
    const plan =
      mode === "gross"
        ? sum(plannedRecords.map((record) => record.tracker.minimumValue))
        : sum(plannedRecords.map((record) => getProjectedFeeValue(record)));
    const actual =
      mode === "gross"
        ? sum(actualRecords.map((record) => record.tracker.result.settlementAmount))
        : sum(actualRecords.map((record) => record.tracker.result.attorneyFees ?? record.tracker.actualFeeValue));

    return {
      quarter,
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
    const twoDigitYear = value.match(/(?:Q[1-4]|[12]H)-(\d{2})/i)?.[1];
    const year = Number(value.match(/20\d{2}/)?.[0] ?? (twoDigitYear ? `20${twoDigitYear}` : "9999"));
    const quarter = Number(value.match(/Q([1-4])/i)?.[1] ?? (value.match(/1H/i) ? "2" : value.match(/2H/i) ? "4" : "9"));
    return year * 10 + quarter;
  };

  return parse(a) - parse(b);
}
