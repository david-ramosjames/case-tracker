import { type SettlementResult, type TrackerEntry, type TrackerUpdateInput } from "@/lib/types";

const TRACKER_FIELD_LABELS: Record<string, string> = {
  caseStage: "Case stage",
  estimatedSettlementValue: "Estimated settlement value",
  estimatedFeeValue: "Projected firm fee",
  targetResolutionQuarter: "Quarter",
  confidenceLevel: "Confidence level",
  sourceOfEstimate: "Source of estimate",
  liability: "Liability",
  caseSize: "Case size",
  minimumValue: "Minimum value",
  referralFee: "Referral fee",
  referralFeeArrangement: "Referral fee arrangement",
  balanceCtaInfo: "Balance / CTA info",
  policyLimits: "Policy limits",
  policyInfoSource: "Source of policy information",
  expectedLitigation: "Expected litigation",
  sources: "Sources",
  litEventsNeeded: "Lit events needed",
  litEventsTimeline: "Timeline for lit events",
  injuries: "Injuries",
  caseDescription: "Description",
  statusNotes: "Status",
  forecastNotes: "Forecast notes",
  lastQuarterlyCheckInAt: "Last quarterly check-in",
  lastSourcesLitUpdatedAt: "Sources & litigation updated",
};

const RESULT_FIELD_LABELS: Record<keyof SettlementResult, string> = {
  settlementDate: "Settlement date",
  settlementAmount: "Settlement amount",
  feePercent: "Fee percent",
  attorneyFees: "RJL attorney fees",
  releaseStatus: "Release",
  closingStatus: "Closing",
  checkStatus: "Check",
  disbursedStatus: "Disbursed",
  releaseSignedAt: "Release signed",
  closingSignedAt: "Closing signed",
  checkDepositedAt: "Check deposited",
  checkDisbursedAt: "Check disbursed",
  disburseDate: "Disburse date",
  resultQuarter: "Result quarter",
};

const SHARED_FIELD_LABELS: Record<string, string> = {
  status: "Status",
  caseType: "Type",
  dateOfIncident: "DOL",
};

function valuesEqual(before: unknown, after: unknown) {
  if (before === after) return true;
  if (before == null && after == null) return true;
  if (typeof before === "number" && typeof after === "number") return before === after;
  return String(before ?? "") === String(after ?? "");
}

export function describeTrackerChanges(
  before: TrackerEntry,
  input: TrackerUpdateInput & { result?: SettlementResult },
  shared?: {
    before?: { status?: string; caseType?: string; dateOfIncident?: string | null };
    after?: { status?: string; caseType?: string; dateOfIncident?: string | null };
  },
): string[] {
  const labels: string[] = [];

  for (const [key, label] of Object.entries(TRACKER_FIELD_LABELS)) {
    if (!(key in input)) continue;
    const nextValue = input[key as keyof TrackerUpdateInput];
    if (nextValue === undefined) continue;
    const previousValue = before[key as keyof TrackerEntry];
    if (!valuesEqual(previousValue, nextValue)) labels.push(label);
  }

  if (input.result) {
    for (const [key, label] of Object.entries(RESULT_FIELD_LABELS)) {
      const resultKey = key as keyof SettlementResult;
      const nextValue = input.result[resultKey];
      if (nextValue === undefined) continue;
      const previousValue = before.result[resultKey];
      if (!valuesEqual(previousValue, nextValue)) labels.push(label);
    }
  }

  if (shared?.after) {
    for (const [key, label] of Object.entries(SHARED_FIELD_LABELS)) {
      const sharedKey = key as keyof NonNullable<typeof shared.after>;
      if (shared.after[sharedKey] === undefined) continue;
      const previousValue = shared.before?.[sharedKey];
      if (!valuesEqual(previousValue, shared.after[sharedKey])) labels.push(label);
    }
  }

  return labels;
}

export function buildTrackerActivityDescription(changedFields: string[], markReviewed: boolean) {
  if (changedFields.length === 0) {
    return markReviewed ? "Case marked reviewed." : "Tracker saved.";
  }

  const fieldList = changedFields.join(", ");
  return markReviewed ? `Updated ${fieldList}. Case marked reviewed.` : `Updated ${fieldList}.`;
}
