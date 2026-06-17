import { caseRequiresOngoingUpdates } from "@/lib/case-status";
import { EXPECTED_DISBURSEMENT_QUARTER_LABEL } from "@/lib/case-labels";
import { isActivePipelineCase } from "@/lib/auth/access";
import { daysSince } from "@/lib/utils";
import { type AttorneyGoal, type CaseRecord } from "@/lib/types";

export const ATTORNEY_SCORE_VALIDATION_DAYS = 90;
export const COMPLETENESS_SCORE_WEIGHT = 0.4;
export const FRESHNESS_SCORE_WEIGHT = 0.6;

export const COMPLETENESS_FIELDS = [
  { id: "caseType", label: "Case type" },
  { id: "liability", label: "Liability" },
  { id: "quarter", label: EXPECTED_DISBURSEMENT_QUARTER_LABEL },
  { id: "minimumValue", label: "Minimum value" },
  { id: "referralFee", label: "Referral fee" },
  { id: "policyLimits", label: "Policy limits" },
  { id: "sources", label: "Sources" },
] as const;

export type CompletenessFieldId = (typeof COMPLETENESS_FIELDS)[number]["id"];

export const VALIDATION_FIELDS = [
  { id: "liability", label: "Liability", validatedAtKey: "liabilityValidatedAt" as const },
  {
    id: "targetResolutionQuarter",
    label: EXPECTED_DISBURSEMENT_QUARTER_LABEL,
    validatedAtKey: "targetResolutionQuarterValidatedAt" as const,
  },
  { id: "minimumValue", label: "Minimum value", validatedAtKey: "minimumValueValidatedAt" as const },
  { id: "policyLimits", label: "Policy limits", validatedAtKey: "policyLimitsValidatedAt" as const },
] as const;

export type ValidationFieldId = (typeof VALIDATION_FIELDS)[number]["id"];

export type CaseAttorneyScore = {
  percent: number;
  completenessPercent: number;
  freshnessPercent: number;
  completenessCompleted: number;
  completenessTotal: number;
  freshnessCompleted: number;
  freshnessTotal: number;
  outdatedValidationFields: ValidationFieldId[];
};

export type AttorneyScoreRollup = {
  attorneyId: string;
  caseCount: number;
  averageScore: number;
  averageCompleteness: number;
  averageFreshness: number;
  casesWithOutdatedValidation: number;
};

export function hasCompletenessField(record: CaseRecord, fieldId: CompletenessFieldId) {
  const { shared, tracker } = record;

  switch (fieldId) {
    case "caseType":
      return Boolean(shared.caseType?.trim());
    case "liability":
      return Boolean(tracker.liability?.trim());
    case "quarter":
      return Boolean(tracker.targetResolutionQuarter?.trim());
    case "minimumValue":
      return tracker.minimumValue != null && tracker.minimumValue > 0;
    case "referralFee":
      return tracker.referralFee != null;
    case "policyLimits":
      return tracker.policyLimits != null && tracker.policyLimits > 0;
    case "sources":
      return Boolean(tracker.sources?.trim());
    default:
      return false;
  }
}

export function hasValidationFieldValue(record: CaseRecord, fieldId: ValidationFieldId) {
  const { tracker } = record;

  switch (fieldId) {
    case "liability":
      return Boolean(tracker.liability?.trim());
    case "targetResolutionQuarter":
      return Boolean(tracker.targetResolutionQuarter?.trim());
    case "minimumValue":
      return tracker.minimumValue != null && tracker.minimumValue > 0;
    case "policyLimits":
      return tracker.policyLimits != null && tracker.policyLimits > 0;
    default:
      return false;
  }
}

export function getValidationFieldValidatedAt(record: CaseRecord, fieldId: ValidationFieldId) {
  const field = VALIDATION_FIELDS.find((item) => item.id === fieldId);
  if (!field) return null;
  return record.tracker[field.validatedAtKey];
}

export function isValidationFieldFresh(record: CaseRecord, fieldId: ValidationFieldId) {
  const validatedAt = getValidationFieldValidatedAt(record, fieldId);
  if (!validatedAt) return false;
  return daysSince(validatedAt) < ATTORNEY_SCORE_VALIDATION_DAYS;
}

/** Fields missing or not validated within 90 days — triggers alerts. */
export function getOutdatedValidationFields(record: CaseRecord): ValidationFieldId[] {
  if (!caseRequiresOngoingUpdates(record)) return [];
  return VALIDATION_FIELDS.filter((field) => {
    if (field.id === "liability") {
      const liability = record.tracker.liability?.trim();
      if (!liability) return true;
      if (liability !== "Pending") return false;
      return !isValidationFieldFresh(record, field.id);
    }
    if (!hasValidationFieldValue(record, field.id)) return true;
    return !isValidationFieldFresh(record, field.id);
  }).map((field) => field.id);
}

export function getValidationFieldLabel(fieldId: ValidationFieldId) {
  return VALIDATION_FIELDS.find((field) => field.id === fieldId)?.label ?? fieldId;
}

export function getCaseAttorneyScore(record: CaseRecord): CaseAttorneyScore {
  const requiresUpdates = caseRequiresOngoingUpdates(record);
  const completenessCompleted = COMPLETENESS_FIELDS.filter((field) => hasCompletenessField(record, field.id)).length;
  const completenessTotal = COMPLETENESS_FIELDS.length;
  const completenessPercent =
    completenessTotal > 0 ? Math.round((completenessCompleted / completenessTotal) * 100) : 0;

  const freshnessTotal = VALIDATION_FIELDS.length;
  const freshnessCompleted = requiresUpdates
    ? VALIDATION_FIELDS.filter((field) => {
        if (field.id === "liability" && record.tracker.liability?.trim() && record.tracker.liability.trim() !== "Pending") {
          return true;
        }
        return hasValidationFieldValue(record, field.id) && isValidationFieldFresh(record, field.id);
      }).length
    : freshnessTotal;
  const freshnessPercent = freshnessTotal > 0 ? Math.round((freshnessCompleted / freshnessTotal) * 100) : 0;

  const percent = Math.round(
    completenessPercent * COMPLETENESS_SCORE_WEIGHT + freshnessPercent * FRESHNESS_SCORE_WEIGHT,
  );

  return {
    percent,
    completenessPercent,
    freshnessPercent,
    completenessCompleted,
    completenessTotal,
    freshnessCompleted,
    freshnessTotal,
    outdatedValidationFields: getOutdatedValidationFields(record),
  };
}

export function getAttorneyScoreRollups(records: CaseRecord[], goals: AttorneyGoal[] = []): AttorneyScoreRollup[] {
  const byAttorney = new Map<string, CaseRecord[]>();

  for (const record of records) {
    if (!isActivePipelineCase(record, goals)) continue;
    const list = byAttorney.get(record.shared.attorneyId) ?? [];
    list.push(record);
    byAttorney.set(record.shared.attorneyId, list);
  }

  return [...byAttorney.entries()]
    .map(([attorneyId, attorneyRecords]) => {
      const scores = attorneyRecords.map(getCaseAttorneyScore);
      const averageScore =
        scores.length > 0 ? Math.round(scores.reduce((sum, score) => sum + score.percent, 0) / scores.length) : 0;
      const averageCompleteness =
        scores.length > 0
          ? Math.round(scores.reduce((sum, score) => sum + score.completenessPercent, 0) / scores.length)
          : 0;
      const averageFreshness =
        scores.length > 0
          ? Math.round(scores.reduce((sum, score) => sum + score.freshnessPercent, 0) / scores.length)
          : 0;

      return {
        attorneyId,
        caseCount: attorneyRecords.length,
        averageScore,
        averageCompleteness,
        averageFreshness,
        casesWithOutdatedValidation: scores.filter((score) => score.outdatedValidationFields.length > 0).length,
      };
    })
    .sort((a, b) => b.averageScore - a.averageScore);
}

export function buildFieldValidationRowPatch(
  changeInput: Record<string, unknown>,
  existingTracker: CaseRecord["tracker"] | null,
  mergedInput: Record<string, unknown>,
  now: string,
) {
  const patch: Record<string, string> = {};

  if ("liability" in changeInput && changeInput.liability !== undefined) {
    patch.liability_validated_at = now;
  }
  if ("targetResolutionQuarter" in changeInput && changeInput.targetResolutionQuarter !== undefined) {
    patch.target_resolution_quarter_validated_at = now;
  }
  if (
    ("minimumValue" in changeInput && changeInput.minimumValue !== undefined) ||
    ("estimatedSettlementValue" in changeInput && changeInput.estimatedSettlementValue !== undefined)
  ) {
    patch.minimum_value_validated_at = now;
  }
  if ("policyLimits" in changeInput && changeInput.policyLimits !== undefined) {
    patch.policy_limits_validated_at = now;
  }
  if ("expectedLitigation" in changeInput && changeInput.expectedLitigation !== undefined) {
    patch.expected_litigation_validated_at = now;
  }

  if ("lastQuarterlyCheckInAt" in changeInput && changeInput.lastQuarterlyCheckInAt) {
    const liability = mergedInput.liability ?? existingTracker?.liability;
    const quarter = mergedInput.targetResolutionQuarter ?? existingTracker?.targetResolutionQuarter;
    const minimum = mergedInput.minimumValue ?? mergedInput.estimatedSettlementValue ?? existingTracker?.minimumValue;
    const policyLimits = mergedInput.policyLimits ?? existingTracker?.policyLimits;

    if (liability) patch.liability_validated_at = now;
    if (quarter) patch.target_resolution_quarter_validated_at = now;
    if (minimum != null && Number(minimum) > 0) patch.minimum_value_validated_at = now;
    if (policyLimits != null && Number(policyLimits) > 0) patch.policy_limits_validated_at = now;
  }

  return patch;
}
