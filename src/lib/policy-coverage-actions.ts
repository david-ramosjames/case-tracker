import {
  limitsForCoverageChange,
  nextPolicyCoverageDueDate,
  type PolicyCoverageStatus,
  validatePolicyLimitsForCoverage,
} from "@/lib/policy-coverage";
import { type TrackerEntry, type TrackerUpdateInput } from "@/lib/types";

/** Patch when the user changes Policy Coverage (updates limits defaults + validation clock). */
export function buildPolicyCoverageChangePatch(input: {
  status: PolicyCoverageStatus;
  current: Pick<TrackerEntry, "policyLimits" | "policyVerificationNotes">;
  actorContactId?: string | null;
  nowIso?: string;
}): TrackerUpdateInput {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const limits = limitsForCoverageChange(input.status, input.current.policyLimits);
  const error = validatePolicyLimitsForCoverage(input.status, limits);
  if (error) {
    // Still apply coverage + forced $0 statuses; limits_confirmed with 0 stays 0 for UI to fix.
  }
  return {
    policyCoverage: input.status,
    policyLimits: limits,
    policyCoverageNeedsClassification: false,
    policyCoverageValidatedAt: nowIso,
    policyCoverageValidatedBy: input.actorContactId ?? null,
    policyCoverageNextDueAt: nextPolicyCoverageDueDate(nowIso, input.status),
  };
}

/** Explicit revalidation — does not change coverage status or dollar amount. */
export function buildPolicyCoverageConfirmPatch(input: {
  status: PolicyCoverageStatus | null;
  actorContactId?: string | null;
  notes?: string | null;
  nowIso?: string;
}): TrackerUpdateInput {
  const nowIso = input.nowIso ?? new Date().toISOString();
  return {
    policyCoverageValidatedAt: nowIso,
    policyCoverageValidatedBy: input.actorContactId ?? null,
    policyCoverageNextDueAt: nextPolicyCoverageDueDate(nowIso, input.status),
    ...(input.notes !== undefined ? { policyVerificationNotes: input.notes } : {}),
  };
}
