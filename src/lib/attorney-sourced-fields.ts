import { caseRequiresOngoingUpdates } from "@/lib/case-status";
import { EXPECTED_DISBURSEMENT_QUARTER_LABEL } from "@/lib/case-options";
import { sourcesLitNeedsReview } from "@/lib/calculations";
import {
  getOutdatedValidationFields,
  getValidationFieldValidatedAt,
  isValidationFieldFresh,
  type ValidationFieldId,
} from "@/lib/attorney-score";
import { daysSince } from "@/lib/utils";
import type { CaseRecord } from "@/lib/types";

export type AttorneySourcedFieldId =
  | "liability"
  | "targetResolutionQuarter"
  | "minimumValue"
  | "referralFee"
  | "policyLimits"
  | "policyInfoSource"
  | "injuries"
  | "caseDescription";

export type AttorneyFieldReviewKind = "none" | "validation_90d" | "sources_lit_90d";

export type AttorneySourcedFieldMeta = {
  id: AttorneySourcedFieldId;
  label: string;
  shortLabel: string;
  reviewKind: AttorneyFieldReviewKind;
  validationFieldId?: ValidationFieldId;
};

export const ATTORNEY_SOURCED_FIELDS: AttorneySourcedFieldMeta[] = [
  { id: "liability", label: "Liability", shortLabel: "Liability", reviewKind: "validation_90d", validationFieldId: "liability" },
  {
    id: "targetResolutionQuarter",
    label: EXPECTED_DISBURSEMENT_QUARTER_LABEL,
    shortLabel: "Exp. disburse Q",
    reviewKind: "validation_90d",
    validationFieldId: "targetResolutionQuarter",
  },
  {
    id: "minimumValue",
    label: "Minimum value",
    shortLabel: "Minimum value",
    reviewKind: "validation_90d",
    validationFieldId: "minimumValue",
  },
  { id: "referralFee", label: "Referral fee", shortLabel: "Referral fee", reviewKind: "none" },
  {
    id: "policyLimits",
    label: "Policy limits",
    shortLabel: "Policy limits",
    reviewKind: "validation_90d",
    validationFieldId: "policyLimits",
  },
  {
    id: "policyInfoSource",
    label: "Policy Source",
    shortLabel: "Policy Source",
    reviewKind: "none",
  },
  { id: "injuries", label: "Injuries", shortLabel: "Injuries", reviewKind: "none" },
  { id: "caseDescription", label: "Description", shortLabel: "Description", reviewKind: "none" },
];

export const ATTORNEY_SOURCED_FIELD_BY_ID = Object.fromEntries(
  ATTORNEY_SOURCED_FIELDS.map((field) => [field.id, field]),
) as Record<AttorneySourcedFieldId, AttorneySourcedFieldMeta>;

export type AttorneyFieldStatus = "missing" | "stale" | "current";

function hasAttorneyFieldValue(record: CaseRecord, fieldId: AttorneySourcedFieldId): boolean {
  const { tracker } = record;
  switch (fieldId) {
    case "liability":
      return Boolean(tracker.liability?.trim());
    case "targetResolutionQuarter":
      return Boolean(tracker.targetResolutionQuarter?.trim());
    case "minimumValue":
      return tracker.minimumValue != null && tracker.minimumValue > 0;
    case "referralFee":
      return tracker.referralFee != null;
    case "policyLimits":
      return tracker.policyLimits != null && tracker.policyLimits > 0;
    case "policyInfoSource":
      return Boolean(tracker.policyInfoSource?.trim());
    case "injuries":
      return Boolean(tracker.injuries?.trim());
    case "caseDescription":
      return Boolean(tracker.caseDescription?.trim());
    default:
      return false;
  }
}

export function getAttorneySourcedFieldStatus(record: CaseRecord, fieldId: AttorneySourcedFieldId): AttorneyFieldStatus {
  const meta = ATTORNEY_SOURCED_FIELD_BY_ID[fieldId];
  if (!hasAttorneyFieldValue(record, fieldId)) return "missing";
  if (!caseRequiresOngoingUpdates(record)) return "current";

  if (meta.reviewKind === "validation_90d" && meta.validationFieldId) {
    if (fieldId === "liability" && record.tracker.liability?.trim() !== "Pending") return "current";
    const outdated = getOutdatedValidationFields(record);
    if (outdated.includes(meta.validationFieldId)) return "stale";
    return "current";
  }

  if (meta.reviewKind === "sources_lit_90d") {
    if (sourcesLitNeedsReview(record)) return "stale";
    return "current";
  }

  return "current";
}

export function getAttorneyFieldLastReviewedLabel(record: CaseRecord, fieldId: AttorneySourcedFieldId): string | null {
  const meta = ATTORNEY_SOURCED_FIELD_BY_ID[fieldId];
  const { tracker } = record;

  if (meta.reviewKind === "validation_90d" && meta.validationFieldId) {
    const validatedAt = getValidationFieldValidatedAt(record, meta.validationFieldId);
    if (!validatedAt) return null;
    const days = daysSince(validatedAt);
    return isValidationFieldFresh(record, meta.validationFieldId) ? `Confirmed ${days}d ago` : `Last confirmed ${days}d ago`;
  }

  if (meta.reviewKind === "sources_lit_90d" && tracker.lastSourcesLitUpdatedAt) {
    const days = daysSince(tracker.lastSourcesLitUpdatedAt);
    return sourcesLitNeedsReview(record) ? `Last updated ${days}d ago` : `Updated ${days}d ago`;
  }

  return null;
}
