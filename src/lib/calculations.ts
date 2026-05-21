import {
  type AttorneyGoal,
  type CaseStage,
  type CaseRecord,
  type CaseTrackerSettings,
  type DashboardMetrics,
  type DataQualityFlag,
} from "@/lib/types";
import { daysSince, getCurrentQuarter, getQuarterElapsedPercentage, getYearElapsedPercentage } from "@/lib/utils";

const QUARTERLY_CHECK_IN_FIELDS = ["targetResolutionQuarter", "minimumValue", "caseDescription"] as const;

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
    stageSuggestionsOpen: records.reduce((total, record) => total + getOpenStageSuggestions(record).length, 0),
  };
}

export function getAttorneyGoalProgress(records: CaseRecord[], goals: AttorneyGoal[]) {
  const currentQuarter = getCurrentQuarter();
  const currentQuarterNumber = Number(currentQuarter.slice(-1));
  const yearElapsed = getYearElapsedPercentage();
  const quarterElapsed = getQuarterElapsedPercentage();

  return goals.map((goal) => {
    const attorneyRecords = records.filter((record) => record.shared.attorneyId === goal.attorneyId);
    const forecastedFees = sum(attorneyRecords.map((record) => getProjectedFeeValue(record)));
    const actualSettledFees = sum(attorneyRecords.map((record) => record.tracker.actualFeeValue));
    const actualDisbursedFees = sum(attorneyRecords.map((record) => record.tracker.disbursedAmount));
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
  return missingQuarterlyField || daysSince(record.tracker.lastQuarterlyCheckInAt) >= 90;
}

export function getOpenStageSuggestions(record: CaseRecord) {
  return record.tracker.detectedStageSignals.filter((signal) => !signal.confirmedAt && !signal.dismissedAt);
}

export function getFirmOutputMetrics(records: CaseRecord[], goals: AttorneyGoal[]) {
  const annualFeeGoal = sum(goals.map((goal) => goal.annualFeeGoal));
  const yearElapsed = getYearElapsedPercentage();
  const pacingFeeGoal = Math.round(annualFeeGoal * (yearElapsed / 100));
  const annualGrossGoal = Math.round(annualFeeGoal / 0.36);
  const pacingGrossGoal = Math.round(annualGrossGoal * (yearElapsed / 100));

  const settledRecords = records.filter((record) => record.tracker.result.settlementAmount);
  const disbursedRecords = records.filter((record) => record.tracker.result.checkDisbursedAt);
  const grossSettled = sum(settledRecords.map((record) => record.tracker.result.settlementAmount));
  const grossDisbursed = sum(disbursedRecords.map((record) => record.tracker.result.settlementAmount));
  const feesSettled = sum(settledRecords.map((record) => record.tracker.result.attorneyFees ?? record.tracker.actualFeeValue));
  const feesDisbursed = sum(disbursedRecords.map((record) => record.tracker.result.attorneyFees ?? record.tracker.actualFeeValue));
  const commissionThreshold = Math.round(annualFeeGoal * 0.5);
  const commissionableAmount = Math.max(feesDisbursed - commissionThreshold, 0);
  const completedDisbursementGoal = Math.max(1, Math.ceil(records.length * 0.55));

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
      completedDisbursements: disbursedRecords.length,
      completedDisbursementGoal,
    },
    caseStatuses: getCaseStatusRollup(records),
    grossQuarterRows: getQuarterRows(records, annualGrossGoal, "gross"),
    feeQuarterRows: getQuarterRows(records, annualFeeGoal, "fees"),
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

function getQuarterRows(records: CaseRecord[], annualGoal: number, mode: "gross" | "fees") {
  const quarters = Array.from(
    new Set(
      records
        .flatMap((record) => [record.tracker.targetResolutionQuarter, record.tracker.result.resultQuarter])
        .filter(Boolean) as string[],
    ),
  ).sort(compareQuarters);
  const target = Math.round(annualGoal / Math.max(quarters.length, 1));

  return quarters.map((quarter) => {
    const plannedRecords = records.filter((record) => record.tracker.targetResolutionQuarter === quarter);
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
