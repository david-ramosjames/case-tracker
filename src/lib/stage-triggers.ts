import { deriveResultFeePercent } from "@/lib/calculations";
import { type CaseRecord, type CaseStage, type ExpectedLitigationStatus } from "@/lib/types";
import { daysSince } from "@/lib/utils";

/** Days after date signed before auto-promoting Onboarding → Treatment (Txt). */
export const TREATMENT_AUTO_DAYS = 10;

const CONFIRMATION_REQUIRED_STAGES = new Set<CaseStage>(["Dmd", "Lit", "Disengaged", "Terminated", "Referred"]);

export function stageRequiresSlackConfirmation(stage: CaseStage) {
  return CONFIRMATION_REQUIRED_STAGES.has(stage);
}

export function deriveExpectedLitigationForStage(stage: CaseStage): ExpectedLitigationStatus {
  if (stage === "Lit") return "Lit";
  if (stage === "Dmd") return "Expect";
  return "Pre";
}

export function normalizePulseStageLabel(raw: string): CaseStage {
  const normalized = raw.trim().toLowerCase();
  if (normalized.includes("disengaged")) return "Disengaged";
  if (normalized.includes("terminated")) return "Terminated";
  if (normalized.includes("referred")) return "Referred";
  if (normalized.includes("settled") || normalized.includes("settlement")) return "Settled";
  if (normalized.includes("litigation") || normalized === "lit") return "Lit";
  if (normalized.includes("demand") || normalized === "dmd") return "Dmd";
  if (normalized.includes("treatment") || normalized === "txt") return "Txt";
  if (normalized.includes("onboarding") || normalized.includes("intake")) return "Onboarding";
  return "Onboarding";
}

export function shouldSkipPulseSuggestion(record: CaseRecord, suggestedStage: CaseStage) {
  if (record.tracker.caseStage === suggestedStage) return "already_at_stage";
  if (!record.tracker.isActive && suggestedStage !== "Disengaged" && suggestedStage !== "Terminated") {
    return "inactive_tracker";
  }
  return null;
}

export function recordsEligibleForTreatmentPromotion(records: CaseRecord[], minDays = TREATMENT_AUTO_DAYS) {
  return records.filter((record) => {
    if (!record.tracker.isActive) return false;
    if (record.tracker.caseStage !== "Onboarding") return false;
    if (!record.shared.dateSigned) return false;
    return daysSince(record.shared.dateSigned) >= minDays;
  });
}

export function buildStagePatchFromConfirmation(
  record: CaseRecord,
  stage: CaseStage,
): { caseStage: CaseStage; expectedLitigation: ExpectedLitigationStatus; estimatedFeeValue?: number } {
  const expectedLitigation = deriveExpectedLitigationForStage(stage);
  const patch: {
    caseStage: CaseStage;
    expectedLitigation: ExpectedLitigationStatus;
    estimatedFeeValue?: number;
  } = { caseStage: stage, expectedLitigation };

  if (record.tracker.minimumValue) {
    patch.estimatedFeeValue = Math.round(
      record.tracker.minimumValue *
        deriveResultFeePercent({
          caseStage: stage,
          expectedLitigation,
          referralFee: record.tracker.referralFee,
        }),
    );
  }

  return patch;
}
