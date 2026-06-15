import type { CaseRecord, CaseStage, CaseStatus, DisbursedStatus } from "@/lib/types";

/** Active pipeline stages (UI labels: Onboarding, Treatment, Demand, Litigation, Settled). */
export const ACTIVE_CASE_STAGES = new Set<CaseStage>(["Onboarding", "Txt", "Dmd", "Lit", "Settled"]);

/** Closed pipeline stages (Disengaged, Terminated, Referred). Disbursed is handled via result.disbursedStatus. */
export const CLOSED_CASE_STAGES = new Set<CaseStage>(["Disengaged", "Terminated", "Referred"]);

/**
 * Overall case status (Active / Closed) is derived from tracker stage + disbursement — not edited manually.
 */
export function deriveCaseStatusFromTracker(stage: CaseStage, disbursedStatus: DisbursedStatus): CaseStatus {
  if (disbursedStatus === "Yes") return "Closed";
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
