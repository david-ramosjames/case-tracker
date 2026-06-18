import type { CaseRecord, CaseStage, CaseStatus, SettlementResult, TrackerEntry } from "@/lib/types";

/** Active pipeline stages (UI labels: Onboarding, Treatment, Demand, Litigation, Settled). */
export const ACTIVE_CASE_STAGES = new Set<CaseStage>(["Onboarding", "Txt", "Dmd", "Lit", "Settled"]);

/** Closed pipeline stages (Disengaged, Terminated, Referred). Disbursed is handled via result.disbursedStatus. */
export const CLOSED_CASE_STAGES = new Set<CaseStage>(["Disengaged", "Terminated", "Referred"]);

export function isCaseFullyDisbursed(result: Pick<SettlementResult, "disbursedStatus" | "disburseDate">): boolean {
  return result.disbursedStatus === "Yes" && Boolean(result.disburseDate?.trim());
}

/** Partial or missing disbursement keeps the case open (Active) without forcing pipeline stage. */
export function applyOpenSettledTrackerFallback<T extends Pick<TrackerEntry, "caseStage" | "result" | "disbursements">>(
  tracker: T,
): T {
  if (isCaseFullyDisbursed(tracker.result)) return tracker;
  if (CLOSED_CASE_STAGES.has(tracker.caseStage)) return tracker;

  return {
    ...tracker,
    result: {
      ...tracker.result,
      disbursedStatus: "No",
      disburseDate: null,
      checkDisbursedAt: null,
      resultQuarter: null,
    },
  };
}

/**
 * Overall case status (Active / Closed) is derived from tracker stage + disbursement — not edited manually.
 * A case only closes once it has a case-level disburse date and disbursed status Yes.
 */
export function deriveCaseStatusFromTracker(
  stage: CaseStage,
  result: Pick<SettlementResult, "disbursedStatus" | "disburseDate">,
): CaseStatus {
  if (isCaseFullyDisbursed(result)) return "Closed";
  if (CLOSED_CASE_STAGES.has(stage)) return "Closed";
  if (ACTIVE_CASE_STAGES.has(stage)) return "Active";
  return "Active";
}

export function isClosedCase(record: Pick<CaseRecord, "shared">) {
  return record.shared.status === "Closed";
}

/** Active pipeline cases still need periodic attorney review and Slack reminders. */
export function caseRequiresOngoingUpdates(record: Pick<CaseRecord, "shared">) {
  return !isClosedCase(record);
}
