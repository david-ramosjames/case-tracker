import { deriveResultFeePercent } from "@/lib/calculations";
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
} from "@/lib/types";
import { getCalculatedAttorneyFees } from "@/lib/utils";

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

export const LIABILITY_OPTIONS = ["Accepted 100%", "50/50", "Pending", "Denied - Dispute", "Denied", "N/A"] as const;

export const CASE_SIZE_OPTIONS = ["$0-30k", "$30k-$100k", ">$100k", "N/A"] as const;

export type CaseSizeOption = (typeof CASE_SIZE_OPTIONS)[number];

/** Case size buckets from minimum case value (same thresholds as the sheet). */
export function deriveCaseSizeFromMinimumValue(minimumValue: number | null | undefined): CaseSizeOption | null {
  if (minimumValue == null || minimumValue <= 0) return null;
  if (minimumValue <= 30_000) return "$0-30k";
  if (minimumValue <= 100_000) return "$30k-$100k";
  return ">$100k";
}

export const CASE_STAGE_OPTIONS = ["Lit", "Txt", "Dmd", "Settled", "Onboarding", "Disengaged", "Referred", "Terminated"] satisfies CaseStage[];

export const EXPECTED_LITIGATION_OPTIONS = ["Pre", "Lit", "Expect"] satisfies ExpectedLitigationStatus[];

export const RELEASE_STATUS_OPTIONS = ["No", "Signed"] satisfies ReleaseStatus[];
export const CLOSING_STATUS_OPTIONS = ["No", "Drafted", "Approved", "Signed"] satisfies ClosingStatus[];
export const CHECK_STATUS_OPTIONS = ["Deposited", "No", "Sent"] satisfies CheckStatus[];
export const DISBURSED_STATUS_OPTIONS = ["No", "Yes"] satisfies DisbursedStatus[];
export const REDUCTIONS_MANUAL_STATUS_OPTIONS = ["Not Complete", "Sent", "Approved", "N/A"] satisfies ReductionsStatus[];
export const REDUCTIONS_STATUS_OPTIONS = [...REDUCTIONS_MANUAL_STATUS_OPTIONS, "Deposited"] satisfies ReductionsStatus[];

/** Forecast quarter when the case is expected to disburse (planning field on the tracker). */
export const EXPECTED_DISBURSEMENT_QUARTER_LABEL = "Expected disbursement quarter";

/** Actual quarter from disburse date on the results tab (auto-derived from the sheet). */
export const RESULT_QUARTER_LABEL = "Result quarter";

export function getTargetPeriodOptions(date = new Date()) {
  const currentYear = date.getFullYear() % 100;
  const years = Array.from({ length: 6 }, (_, index) => currentYear - 1 + index);

  return years.flatMap((year) => [`Q1-${year}`, `Q2-${year}`, `Q3-${year}`, `Q4-${year}`]);
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

/** When disburse date is set, reductions are treated as deposited. */
export function deriveReductionsStatusFromDisburseDate(
  disburseDate: string | null | undefined,
): ReductionsStatus | null {
  return disburseDate?.trim() ? "Deposited" : null;
}

export function applyDerivedReductionsStatus<T extends { disburseDate: string | null; reductionsStatus: ReductionsStatus }>(
  result: T,
): T {
  const derived = deriveReductionsStatusFromDisburseDate(result.disburseDate);
  return derived ? { ...result, reductionsStatus: derived } : result;
}

export function applyDerivedResultFields<
  T extends { disburseDate: string | null; resultQuarter: string | null; reductionsStatus: ReductionsStatus },
>(result: T): T {
  return applyDerivedReductionsStatus(applyDerivedResultQuarter(result));
}

export function applyDerivedSettlementResult<
  TResult extends SettlementResult,
  TTracker extends { caseStage: CaseStage; expectedLitigation: ExpectedLitigationStatus | null; referralFee: number | null },
>(result: TResult, tracker: TTracker): TResult {
  const withWorkflow = applyDerivedResultFields(result);
  const feePercent = deriveResultFeePercent(tracker);
  return {
    ...withWorkflow,
    feePercent,
    attorneyFees: getCalculatedAttorneyFees(withWorkflow.settlementAmount, feePercent),
  };
}

/** Normalize quarter text to a standard value; maps legacy 1H/2H to Q2/Q4. */
export function normalizeTargetQuarter(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}$/.test(trimmed)) return `${trimmed} Q4`;

  const qDash = trimmed.match(/^Q([1-4])-(\d{2,4})$/i);
  if (qDash) {
    const year = qDash[2].length === 2 ? `20${qDash[2]}` : qDash[2];
    return `${year} Q${qDash[1]}`;
  }

  const longQ = trimmed.match(/^(\d{4})\s*Q([1-4])$/i);
  if (longQ) return `${longQ[1]} Q${longQ[2]}`;

  const halfDash = trimmed.match(/^([12])H-(\d{2})$/i);
  if (halfDash) {
    const quarter = halfDash[1] === "1" ? "2" : "4";
    return `20${halfDash[2]} Q${quarter}`;
  }

  const halfSpace = trimmed.match(/^(\d{4})\s*([12])H$/i);
  if (halfSpace) {
    const quarter = halfSpace[2] === "1" ? "2" : "4";
    return `${halfSpace[1]} Q${quarter}`;
  }

  return trimmed;
}

/** Calendar years for attorney fee goals (supports year rollover). */
export function getGoalYearOptions(date = new Date()) {
  const currentYear = date.getFullYear();
  return Array.from({ length: 5 }, (_, index) => currentYear - 1 + index);
}
