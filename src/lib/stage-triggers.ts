import { deriveForecastFeePercent, resolveSettledFeePercent } from "@/lib/calculations";
import { type CaseRecord, type CaseStage, type ExpectedLitigationStatus, type SettlementResult } from "@/lib/types";
import { daysSince, getCalculatedAttorneyFees } from "@/lib/utils";

export type PulseSignal = "disbursed";

/** Days after date signed before auto-promoting Onboarding → Treatment (Txt). */
export const TREATMENT_AUTO_DAYS = 10;

const CONFIRMATION_REQUIRED_STAGES = new Set<CaseStage>([
  "Onboarding",
  "Txt",
  "Dmd",
  "Lit",
  "Settled",
  "Disengaged",
  "Terminated",
  "Referred",
]);

export function stageRequiresSlackConfirmation(stage: CaseStage) {
  return CONFIRMATION_REQUIRED_STAGES.has(stage);
}

export function deriveExpectedLitigationForStage(stage: CaseStage): ExpectedLitigationStatus {
  if (stage === "Lit") return "Lit";
  if (stage === "Dmd") return "Expect";
  return "Pre";
}

function stripSlackMarkdown(text: string) {
  return text
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/** Detect pulse-specific signals before stage mapping (e.g. Disbursed → Settled + result). */
export function detectPulseSignal(raw: string): PulseSignal | null {
  const normalized = stripSlackMarkdown(raw).toLowerCase();
  if (normalized.includes("disbursed")) return "disbursed";
  return null;
}

/** Parse a stage label from daily-pulse text — returns null when unrecognized. */
export function parsePulseStageLabel(raw: string): CaseStage | null {
  const normalized = stripSlackMarkdown(raw).toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("disengaged")) return "Disengaged";
  if (normalized.includes("terminated")) return "Terminated";
  if (normalized.includes("referred")) return "Referred";
  if (detectPulseSignal(raw) === "disbursed" || normalized.includes("settled") || normalized.includes("settlement")) {
    return "Settled";
  }
  if (normalized.includes("litigation") || normalized === "lit") return "Lit";
  if (normalized.includes("demand") || normalized === "dmd") return "Dmd";
  if (normalized.includes("treatment") || normalized === "txt") return "Txt";
  if (normalized.includes("onboarding") || normalized.includes("intake")) return "Onboarding";
  return null;
}

/** Lenient stage label parsing for Slack thread replies. */
export function normalizePulseStageLabel(raw: string): CaseStage {
  return parsePulseStageLabel(raw) ?? "Onboarding";
}

export function shouldSkipPulseSuggestion(
  record: CaseRecord,
  item: { suggestedStage: CaseStage; pulseSignal?: PulseSignal | null },
) {
  if (item.pulseSignal === "disbursed") {
    if (record.tracker.caseStage === "Settled" && record.tracker.result.disbursedStatus === "Yes") {
      return "already_applied";
    }
    return null;
  }

  if (record.tracker.caseStage === item.suggestedStage) return "already_at_stage";

  if (
    !record.tracker.isActive &&
    item.suggestedStage !== "Disengaged" &&
    item.suggestedStage !== "Terminated" &&
    item.suggestedStage !== "Referred"
  ) {
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
  options?: { markDisbursed?: boolean },
) {
  const patch: {
    caseStage: CaseStage;
    expectedLitigation?: ExpectedLitigationStatus;
    estimatedFeeValue?: number;
    result?: SettlementResult;
  } = {
    caseStage: stage,
  };

  if (stage === "Lit") {
    patch.expectedLitigation = "Lit";
  }

  const priorStage = record.tracker.caseStage;
  const forecastRate =
    stage === "Settled"
      ? resolveSettledFeePercent({
          feePercent: record.tracker.result.feePercent,
          priorCaseStage: priorStage,
          expectedLitigation: record.tracker.expectedLitigation,
          referralFee: record.tracker.referralFee,
        })
      : deriveForecastFeePercent({ caseStage: stage, referralFee: record.tracker.referralFee });

  if (record.tracker.minimumValue) {
    patch.estimatedFeeValue = Math.round(record.tracker.minimumValue * forecastRate);
  }

  if (stage === "Settled") {
    patch.result = {
      ...record.tracker.result,
      feePercent: forecastRate,
      attorneyFees:
        getCalculatedAttorneyFees(record.tracker.result.settlementAmount, forecastRate) ??
        record.tracker.result.attorneyFees,
    };
  }

  if (options?.markDisbursed) {
    const now = new Date().toISOString();
    patch.result = {
      ...record.tracker.result,
      disbursedStatus: "Yes",
      checkDisbursedAt: record.tracker.result.checkDisbursedAt ?? now,
    };
  }

  return patch;
}
