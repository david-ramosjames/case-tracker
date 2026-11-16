import { daysSince, parseCalendarDate } from "@/lib/utils";
import { type TrackerEntry } from "@/lib/types";

/** Working assumption when coverage exists but limits are undisclosed. */
export const ASSUMED_POLICY_LIMITS_DEFAULT = 30_000;

export const POLICY_COVERAGE_VALIDATION_DAYS = 90;

export const POLICY_COVERAGE_OPTIONS = [
  { value: "no_coverage", label: "No Coverage" },
  { value: "pending", label: "Pending" },
  { value: "coverage_exists", label: "Coverage Exists" },
  { value: "limits_confirmed", label: "Limits Confirmed" },
] as const;

export type PolicyCoverageStatus = (typeof POLICY_COVERAGE_OPTIONS)[number]["value"];

export function isPolicyCoverageStatus(value: string | null | undefined): value is PolicyCoverageStatus {
  return POLICY_COVERAGE_OPTIONS.some((option) => option.value === value);
}

export function policyCoverageLabel(status: PolicyCoverageStatus | null | undefined) {
  return POLICY_COVERAGE_OPTIONS.find((option) => option.value === status)?.label ?? "Unclassified";
}

export function policyCoverageRequiresRecurringValidation(
  status: PolicyCoverageStatus | null | undefined,
) {
  return status === "pending" || status === "coverage_exists";
}

export function policyLimitsAreReadOnly(status: PolicyCoverageStatus | null | undefined) {
  return status === "no_coverage" || status === "pending";
}

export function policyLimitsAmountLabel(status: PolicyCoverageStatus | null | undefined) {
  if (status === "coverage_exists") return "Assumed policy limits — not verified.";
  if (status === "limits_confirmed") return "Verified policy limits.";
  return null;
}

/** Apply coverage → limits defaults without inventing amounts for unclassified rows. */
export function limitsForCoverageChange(
  status: PolicyCoverageStatus,
  currentLimits: number | null | undefined,
): number {
  if (status === "no_coverage" || status === "pending") return 0;
  if (status === "coverage_exists") {
    if (currentLimits != null && currentLimits > 0) return currentLimits;
    return ASSUMED_POLICY_LIMITS_DEFAULT;
  }
  // limits_confirmed: keep current if > 0; otherwise leave 0 so UI can require entry
  return currentLimits != null && currentLimits > 0 ? currentLimits : 0;
}

export function validatePolicyLimitsForCoverage(
  status: PolicyCoverageStatus | null | undefined,
  limits: number | null | undefined,
): string | null {
  if (!status) return null;
  if (status === "no_coverage" || status === "pending") {
    if (limits != null && limits !== 0) return "Policy Limits must be $0 for this coverage status.";
    return null;
  }
  if (status === "limits_confirmed") {
    if (limits == null || limits <= 0) return "Limits Confirmed requires a verified amount greater than $0.";
    return null;
  }
  if (status === "coverage_exists") {
    if (limits == null || limits < 0) return "Enter assumed policy limits (default $30,000).";
    return null;
  }
  return null;
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function chicagoTodayYmdForPolicy(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  return `${bag.year}-${bag.month}-${bag.day}`;
}

export function nextPolicyCoverageDueDate(
  validatedAtIso: string | null | undefined,
  status: PolicyCoverageStatus | null | undefined,
): string | null {
  if (!policyCoverageRequiresRecurringValidation(status)) return null;
  if (!validatedAtIso) return chicagoTodayYmdForPolicy();
  const day = validatedAtIso.slice(0, 10);
  return addDaysYmd(day, POLICY_COVERAGE_VALIDATION_DAYS);
}

export function isPolicyCoverageValidationDue(
  tracker: Pick<
    TrackerEntry,
    | "policyCoverage"
    | "policyCoverageValidatedAt"
    | "policyCoverageNextDueAt"
    | "policyCoverageNeedsClassification"
  >,
  todayYmd = chicagoTodayYmdForPolicy(),
) {
  if (tracker.policyCoverageNeedsClassification) return true;
  if (!policyCoverageRequiresRecurringValidation(tracker.policyCoverage)) return false;
  if (tracker.policyCoverageNextDueAt) {
    return tracker.policyCoverageNextDueAt <= todayYmd;
  }
  if (!tracker.policyCoverageValidatedAt) return true;
  return daysSince(tracker.policyCoverageValidatedAt) >= POLICY_COVERAGE_VALIDATION_DAYS;
}

export function policyCoverageCompletenessOk(
  tracker: Pick<TrackerEntry, "policyCoverage" | "policyLimits" | "policyCoverageNeedsClassification">,
) {
  if (tracker.policyCoverageNeedsClassification) return false;
  if (!tracker.policyCoverage) return tracker.policyLimits != null;
  return validatePolicyLimitsForCoverage(tracker.policyCoverage, tracker.policyLimits) == null;
}

/** True when overdue for Pending / Coverage Exists revalidation (or unclassified legacy). */
export function matchesPolicyRevalidationFilter(
  tracker: Pick<
    TrackerEntry,
    | "policyCoverage"
    | "policyCoverageValidatedAt"
    | "policyCoverageNextDueAt"
    | "policyCoverageNeedsClassification"
  >,
) {
  return isPolicyCoverageValidationDue(tracker);
}

export function parsePolicyCoverageDueDate(value: string | null | undefined) {
  if (!value) return null;
  return parseCalendarDate(value.slice(0, 10));
}
