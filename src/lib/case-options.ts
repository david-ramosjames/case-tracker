import { getAggregatedResultFromDisbursements } from "@/lib/disbursements";
import { deriveForecastFeePercent, resolveSettledFeePercent } from "@/lib/fee-percent";
import {
  type CaseStage,
  type CaseStatus,
  type CheckStatus,
  type ClosingStatus,
  type DisbursedStatus,
  type ExpectedLitigationStatus,
  type ReductionsStatus,
  type ReleaseStatus,
  type SettlementResult,
  type TrackerEntry,
} from "@/lib/types";
import { getCalculatedAttorneyFees } from "@/lib/utils";
import { normalizeTargetQuarter } from "@/lib/target-quarter";

export { EXPECTED_DISBURSEMENT_QUARTER_LABEL } from "@/lib/case-labels";
export { normalizeTargetQuarter } from "@/lib/target-quarter";

export type ClientPreferredLanguage = "en" | "es";

export const CLIENT_PREFERRED_LANGUAGE_OPTIONS = [
  { value: "en" as const, label: "English" },
  { value: "es" as const, label: "Spanish" },
] as const;

/** DocketFlow cases.preferred_language / secondary_language check constraint values. */
export const DOCKETFLOW_PREFERRED_LANGUAGE_BY_CODE: Record<ClientPreferredLanguage, string> = {
  en: "English",
  es: "Spanish",
};

/** Normalize DocketFlow cases.preferred_language to en | es (defaults to English). */
export function normalizePreferredLanguage(value: string | null | undefined): ClientPreferredLanguage {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) return "en";
  if (normalized === "es" || normalized === "spanish" || normalized.startsWith("span")) return "es";
  return "en";
}

/** Optional secondary language — null when unset. */
export function normalizeSecondaryLanguage(value: string | null | undefined): ClientPreferredLanguage | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return normalizePreferredLanguage(trimmed);
}

/** Map tracker language code to the value DocketFlow stores on cases.preferred_language. */
export function toDocketFlowPreferredLanguage(value: ClientPreferredLanguage) {
  return DOCKETFLOW_PREFERRED_LANGUAGE_BY_CODE[value];
}

/** Map optional secondary language for cases.secondary_language (null clears). */
export function toDocketFlowSecondaryLanguage(value: ClientPreferredLanguage | null) {
  if (value == null) return null;
  return DOCKETFLOW_PREFERRED_LANGUAGE_BY_CODE[value];
}

export const CASE_STATUS_OPTIONS = ["Active", "Closed"] satisfies CaseStatus[];

export const CASE_TYPE_OPTIONS = [
  "Auto Accident",
  "Commercial / 18 Wheeler",
  "Dog Bite",
  "Pedestrian / Bicycle / Scooter",
  "Premises Liability",
  "Sexual Assault / Child Abuse",
  "Work Injury",
  "Wrongful Death",
  "Other Injury",
] as const;

/** Maps CallRail, DocketFlow, and legacy tracker values to a standard case type. */
export function normalizeCaseType(value: string | null | undefined): (typeof CASE_TYPE_OPTIONS)[number] | string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "Other Injury";

  const normalized = trimmed.toLowerCase();
  const exact = CASE_TYPE_OPTIONS.find((option) => option.toLowerCase() === normalized);
  if (exact) return exact;

  if (normalized === "car" || normalized === "auto" || normalized.includes("auto accident")) return "Auto Accident";
  if (normalized.includes("commercial") || normalized.includes("18 wheeler") || normalized.includes("truck")) {
    return "Commercial / 18 Wheeler";
  }
  if (normalized.includes("dog")) return "Dog Bite";
  if (
    normalized.includes("pedestrian") ||
    normalized.includes("bicycle") ||
    normalized.includes("scooter") ||
    normalized.includes("motorcycle")
  ) {
    return "Pedestrian / Bicycle / Scooter";
  }
  if (normalized.includes("premises")) return "Premises Liability";
  if (normalized.includes("sexual") || normalized.includes("child")) return "Sexual Assault / Child Abuse";
  if (normalized.includes("work")) return "Work Injury";
  if (normalized.includes("wrongful")) return "Wrongful Death";
  if (normalized === "other" || normalized.includes("other injury")) return "Other Injury";

  const legacyMap: Record<string, (typeof CASE_TYPE_OPTIONS)[number]> = {
    car: "Auto Accident",
    premises: "Premises Liability",
    trucking: "Commercial / 18 Wheeler",
    motorcycle: "Pedestrian / Bicycle / Scooter",
    bicycle: "Pedestrian / Bicycle / Scooter",
    products: "Other Injury",
    assault: "Other Injury",
    medmal: "Other Injury",
    "gun shot": "Other Injury",
    other: "Other Injury",
  };
  if (legacyMap[normalized]) return legacyMap[normalized];

  return trimmed;
}

/** Read case type from shared `cases.case_type`; empty when unset (no default). */
export function caseTypeFromCasesTable(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  return normalizeCaseType(trimmed);
}

/** Dropdown options for case type, including the current value when it is not in the standard list. */
export function caseTypeSelectOptions(currentValue?: string | null): string[] {
  const normalized = currentValue?.trim() ? normalizeCaseType(currentValue) : "";
  if (!normalized || CASE_TYPE_OPTIONS.includes(normalized as (typeof CASE_TYPE_OPTIONS)[number])) {
    return [...CASE_TYPE_OPTIONS];
  }
  return [normalized, ...CASE_TYPE_OPTIONS];
}

export const LIABILITY_OPTIONS = ["Accepted", "Denied", "Disputed"] as const;

/** Dropdown options for liability, including the current value when it is a legacy label. */
export function liabilitySelectOptions(currentValue?: string | null): string[] {
  const trimmed = currentValue?.trim() ?? "";
  if (!trimmed || LIABILITY_OPTIONS.includes(trimmed as (typeof LIABILITY_OPTIONS)[number])) {
    return [...LIABILITY_OPTIONS];
  }
  return [trimmed, ...LIABILITY_OPTIONS];
}

export const CASE_SIZE_OPTIONS = ["$0-30k", "$30k-$100k", ">$100k", "N/A"] as const;

export type CaseSizeOption = (typeof CASE_SIZE_OPTIONS)[number];

/** Case size buckets from minimum case value (same thresholds as the sheet). */
export function deriveCaseSizeFromMinimumValue(minimumValue: number | null | undefined): CaseSizeOption | null {
  if (minimumValue == null || minimumValue <= 0) return null;
  if (minimumValue <= 30_000) return "$0-30k";
  if (minimumValue <= 100_000) return "$30k-$100k";
  return ">$100k";
}

export const CASE_STAGE_OPTIONS = [
  "Onboarding",
  "Txt",
  "Dmd",
  "Lit",
  "Settled",
  "Disengaged",
  "Referred",
  "Terminated",
] satisfies CaseStage[];

export const EXPECTED_LITIGATION_OPTIONS = ["Pre", "Expect", "Lit"] satisfies ExpectedLitigationStatus[];

export function formatExpectedLitigationLabel(value: ExpectedLitigationStatus | null | undefined) {
  if (value == null) return "Need Info";
  if (value === "Expect") return "Expected";
  return value;
}

/** When stage is Lit, expected lit is always Lit. */
export function coerceExpectedLitigationForStage(
  stage: CaseStage,
  expectedLitigation: ExpectedLitigationStatus | null,
): ExpectedLitigationStatus | null {
  if (stage === "Lit") return "Lit";
  return expectedLitigation;
}

export const EXPECTED_LITIGATION_FILTER_OPTIONS = [
  { value: "needs-info", label: "Need Info" },
  { value: "Pre", label: "Pre" },
  { value: "Expect", label: "Expected" },
  { value: "Lit", label: "Lit" },
] as const;

export const NOT_SET_FILTER_VALUE = "__not-set__";

export function notSetFilterOption() {
  return { value: NOT_SET_FILTER_VALUE, label: "Not set" } as const;
}

export function matchesOptionalFieldFilter(filter: string, value: string | null | undefined) {
  if (filter === "all") return true;
  if (filter === NOT_SET_FILTER_VALUE) return value == null || value.trim() === "";
  return value === filter;
}

export function matchesTargetPeriodFilter(filter: string, value: string | null | undefined) {
  if (filter === "all") return true;
  const standard = toStandardTargetPeriodLabel(value);
  if (filter === NOT_SET_FILTER_VALUE) return standard == null;
  return standard === filter;
}

export function matchesExpectedLitigationFilter(filter: string, value: ExpectedLitigationStatus | null) {
  if (filter === "all") return true;
  if (filter === "needs-info") return value == null;
  return value === filter;
}

export const RELEASE_STATUS_OPTIONS = ["No", "Signed"] satisfies ReleaseStatus[];
export const CLOSING_STATUS_OPTIONS = ["No", "Drafted", "Approved", "Signed"] satisfies ClosingStatus[];
export const CHECK_STATUS_OPTIONS = ["Deposited", "No", "Sent"] satisfies CheckStatus[];
export const DISBURSED_STATUS_OPTIONS = ["No", "Yes"] satisfies DisbursedStatus[];
export const REDUCTIONS_MANUAL_STATUS_OPTIONS = [
  "Not Complete",
  "To Be Sent",
  "Sent, Not Approved",
  "Approved",
] satisfies ReductionsStatus[];

/** @deprecated Use REDUCTIONS_MANUAL_STATUS_OPTIONS */
export const REDUCTIONS_STATUS_OPTIONS = REDUCTIONS_MANUAL_STATUS_OPTIONS;

/** Map stored values (including legacy labels) to a selectable reductions status. */
export function coerceReductionsStatus(value: string | null | undefined): ReductionsStatus {
  const trimmed = value?.trim() ?? "";
  if (
    trimmed === "Not Complete" ||
    trimmed === "To Be Sent" ||
    trimmed === "Sent, Not Approved" ||
    trimmed === "Approved"
  ) {
    return trimmed;
  }
  if (trimmed === "Sent") return "Sent, Not Approved";
  if (trimmed === "Deposited" || trimmed === "N/A" || !trimmed) return "Not Complete";
  return "Not Complete";
}

/** Forecast quarter when the case is expected to disburse (planning field on the tracker). */
/** Actual quarter from disburse date on the results tab (auto-derived from the sheet). */
export const RESULT_QUARTER_LABEL = "Result quarter";

export const TARGET_PERIOD_LABEL_PATTERN = /^Q[1-4]-\d{2}$/i;

export function getTargetPeriodOptions(date = new Date()) {
  const currentYear = date.getFullYear() % 100;
  const years = Array.from({ length: 6 }, (_, index) => currentYear - 1 + index);

  return years.flatMap((year) => {
    const yy = String(year).padStart(2, "0");
    return [`Q1-${yy}`, `Q2-${yy}`, `Q3-${yy}`, `Q4-${yy}`];
  });
}

export function isStandardTargetPeriodLabel(label: string | null | undefined) {
  return Boolean(label?.trim() && TARGET_PERIOD_LABEL_PATTERN.test(label.trim()));
}

/** Convert stored quarter text to canonical Q#-YY (e.g. Q4-26). Returns null for invalid/legacy values like N/A. */
export function toStandardTargetPeriodLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const direct = parseTargetPeriodLabel(trimmed);
  if (direct) {
    const yy = String(direct.year % 100).padStart(2, "0");
    return `Q${direct.quarter}-${yy}`;
  }

  const normalized = normalizeTargetQuarter(trimmed);
  if (!normalized) return null;

  const longMatch = normalized.match(/^(\d{4})\s*Q([1-4])$/i);
  if (longMatch) {
    const yy = String(Number(longMatch[1]) % 100).padStart(2, "0");
    return `Q${longMatch[2]}-${yy}`;
  }

  return null;
}

export function parseTargetPeriodLabel(label: string): { year: number; quarter: number } | null {
  const match = label.trim().match(/^Q([1-4])-(\d{2})$/i);
  if (!match) return null;
  return { quarter: Number(match[1]), year: 2000 + Number(match[2]) };
}

export function getCurrentTargetPeriodLabel(date = new Date()) {
  const yy = String(date.getFullYear() % 100).padStart(2, "0");
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return `Q${quarter}-${yy}`;
}

export function isTargetPeriodCurrentOrFuture(label: string | null | undefined, date = new Date()) {
  if (!label?.trim()) return false;
  const parsed = parseTargetPeriodLabel(label);
  if (!parsed) return true;
  const current = parseTargetPeriodLabel(getCurrentTargetPeriodLabel(date));
  if (!current) return true;
  return parsed.year * 10 + parsed.quarter >= current.year * 10 + current.quarter;
}

/** Expected disbursement quarters attorneys can pick (current quarter and later). */
export function getSelectableTargetPeriodOptions(date = new Date()) {
  return getTargetPeriodOptions(date).filter((label) => isTargetPeriodCurrentOrFuture(label, date));
}

/** Column filter options — standard Q#-YY labels only (current quarter and later). */
export function getTargetPeriodFilterOptions(date = new Date()) {
  return getSelectableTargetPeriodOptions(date);
}

/** Dropdown options for a case, keeping an existing past standard quarter visible when already set. */
export function getTargetPeriodSelectOptions(currentValue: string | null | undefined, date = new Date()) {
  const selectable = getSelectableTargetPeriodOptions(date);
  const standardCurrent = toStandardTargetPeriodLabel(currentValue);
  if (standardCurrent && !selectable.includes(standardCurrent)) {
    return [standardCurrent, ...selectable];
  }
  return selectable;
}

/** Calendar quarter label (`YYYY Q#`) from a disburse / settlement date. */
export function deriveResultQuarterFromDisburseDate(disburseDate: string | null | undefined): string | null {
  const trimmed = disburseDate?.trim().slice(0, 10) ?? "";
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
    const quarter = Math.floor((month - 1) / 3) + 1;
    return `${year} Q${quarter}`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const quarter = Math.floor(parsed.getMonth() / 3) + 1;
  return `${parsed.getFullYear()} Q${quarter}`;
}

export function applyDerivedResultQuarter<T extends { disburseDate: string | null; resultQuarter: string | null }>(
  result: T,
): T {
  return { ...result, resultQuarter: deriveResultQuarterFromDisburseDate(result.disburseDate) };
}

/** When the case is fully disbursed, downstream workflow steps are implied from the disburse date. */
export function applyDerivedWorkflowFromDisburseDate<T extends SettlementResult>(result: T): T {
  if (result.disbursedStatus !== "Yes" || !result.disburseDate?.trim()) {
    return result.disbursedStatus === "No" ? { ...result, checkDisbursedAt: null } : result;
  }

  const dateOnly = result.disburseDate.trim().slice(0, 10);
  const checkDisbursedAt = /^\d{4}-\d{2}-\d{2}$/.test(dateOnly)
    ? new Date(`${dateOnly}T12:00:00.000Z`).toISOString()
    : new Date(result.disburseDate).toISOString();

  return {
    ...result,
    releaseStatus: "Signed",
    closingStatus: "Signed",
    checkStatus: "Deposited",
    reductionsStatus: "Approved",
    disbursedStatus: "Yes",
    checkDisbursedAt,
  };
}

export function applyDerivedResultFields<T extends SettlementResult>(result: T): T {
  return applyDerivedWorkflowFromDisburseDate(applyDerivedResultQuarter(result));
}

export type ApplyDerivedSettlementResultOptions = {
  /** When true, do not roll disbursement party rows up into case-level result fields (manual edits). */
  skipDisbursementAggregation?: boolean;
  /** When true, keep fee percent and attorney fees from the result instead of recalculating. */
  skipFeeRecalculation?: boolean;
};

export function applyDerivedSettlementResult<
  TResult extends SettlementResult,
  TTracker extends {
    caseStage: CaseStage;
    expectedLitigation: ExpectedLitigationStatus | null;
    referralFee: number | null;
    disbursements?: TrackerEntry["disbursements"];
    multipleDisbursementsEnabled?: boolean;
    expectedDisbursementCount?: number;
  },
>(result: TResult, tracker: TTracker, options?: ApplyDerivedSettlementResultOptions): TResult {
  const withWorkflow = applyDerivedResultFields(result);
  const aggregated =
    !options?.skipDisbursementAggregation && tracker.disbursements && tracker.disbursements.length > 0
      ? getAggregatedResultFromDisbursements({
          disbursements: tracker.disbursements,
          multipleDisbursementsEnabled: tracker.multipleDisbursementsEnabled ?? false,
          expectedDisbursementCount: tracker.expectedDisbursementCount ?? 1,
          result: withWorkflow,
        })
      : null;

  if (aggregated) {
    const rollUpCaseClosure = tracker.caseStage === "Settled";
    return applyDerivedResultFields({
      ...withWorkflow,
      settlementAmount: aggregated.settlementAmount ?? withWorkflow.settlementAmount,
      attorneyFees: aggregated.attorneyFees ?? withWorkflow.attorneyFees,
      feePercent: aggregated.feePercent ?? withWorkflow.feePercent,
      settlementDate: aggregated.settlementDate ?? withWorkflow.settlementDate,
      ...(rollUpCaseClosure
        ? {
            disburseDate: aggregated.disburseDate,
            disbursedStatus: aggregated.disbursedStatus,
            checkDisbursedAt: aggregated.checkDisbursedAt,
            resultQuarter: aggregated.resultQuarter,
          }
        : {}),
    });
  }

  if (options?.skipFeeRecalculation) {
    return withWorkflow;
  }

  const feePercent =
    tracker.caseStage === "Settled"
      ? resolveSettledFeePercent({
          feePercent: withWorkflow.feePercent,
          expectedLitigation: tracker.expectedLitigation,
          referralFee: tracker.referralFee,
        })
      : deriveForecastFeePercent(tracker);

  return {
    ...withWorkflow,
    feePercent,
    attorneyFees: getCalculatedAttorneyFees(withWorkflow.settlementAmount, feePercent),
  };
}

/** Calendar years for attorney fee goals (supports year rollover). */
export function getGoalYearOptions(date = new Date()) {
  const currentYear = date.getFullYear();
  return Array.from({ length: 5 }, (_, index) => currentYear - 1 + index);
}
