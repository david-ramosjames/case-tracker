import { getOutdatedValidationFields } from "@/lib/attorney-score";
import { isMissingInfo, isStale, needsQuarterlyCheckIn } from "@/lib/calculations";
import { type CaseRecord, type CaseTrackerSettings } from "@/lib/types";

export const CASE_LIST_QUALITY_FILTERS = [
  "missing-fields",
  "stale-review",
  "quarterly-check-in",
  "validation-overdue",
  "settled-not-disbursed",
] as const;

export type CaseListQualityFilter = (typeof CASE_LIST_QUALITY_FILTERS)[number];

export function parseCaseListQualityFilter(value: string | undefined | null): CaseListQualityFilter | null {
  if (!value?.trim()) return null;
  return CASE_LIST_QUALITY_FILTERS.includes(value.trim() as CaseListQualityFilter)
    ? (value.trim() as CaseListQualityFilter)
    : null;
}

export function getCaseListQualityFilterLabel(filter: CaseListQualityFilter) {
  switch (filter) {
    case "missing-fields":
      return "Missing required fields";
    case "stale-review":
      return "Not reviewed recently";
    case "quarterly-check-in":
      return "Quarterly check-ins due";
    case "validation-overdue":
      return "Validation overdue";
    case "settled-not-disbursed":
      return "Settled not disbursed";
  }
}

export function matchesCaseListQualityFilter(
  record: CaseRecord,
  filter: CaseListQualityFilter,
  settings: Pick<CaseTrackerSettings, "staleReviewThresholdDays">,
) {
  switch (filter) {
    case "missing-fields":
      return isMissingInfo(record, settings);
    case "stale-review":
      return isStale(record, settings);
    case "quarterly-check-in":
      return needsQuarterlyCheckIn(record);
    case "validation-overdue":
      return getOutdatedValidationFields(record).length > 0;
    case "settled-not-disbursed":
      return record.tracker.caseStage === "Settled" && !record.tracker.result.checkDisbursedAt;
  }
}
