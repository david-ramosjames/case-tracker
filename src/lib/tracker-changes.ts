import {
  type DisbursementPartyOverrideInput,
  type LitigationEvents,
  type ManualDisbursementInput,
  type SettlementResult,
  type TrackerEntry,
  type TrackerUpdateInput,
} from "@/lib/types";
import { LITIGATION_EVENT_DEFINITIONS } from "@/lib/litigation-events";

const TRACKER_FIELD_LABELS: Record<string, string> = {
  caseStage: "Case stage",
  estimatedSettlementValue: "Estimated settlement value",
  estimatedFeeValue: "Projected firm fee",
  targetResolutionQuarter: "Expected disbursement quarter",
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
  injuries: "Injuries",
  caseDescription: "Description",
  statusNotes: "Status",
  forecastNotes: "Forecast notes",
  lastQuarterlyCheckInAt: "Last quarterly check-in",
  lastSourcesLitUpdatedAt: "Sources & litigation updated",
  multipleDisbursementsEnabled: "Multiple disbursements",
  expectedDisbursementCount: "Expected disbursement count",
  clientPhone: "Client phone",
  gvNotes: "GV notes",
  lrjNotes: "LRJ notes",
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
  reductionsStatus: "Reductions",
  releaseSignedAt: "Release signed",
  closingSignedAt: "Closing signed",
  checkDepositedAt: "Check deposited",
  checkDisbursedAt: "Check disbursed",
  disburseDate: "Disburse date",
  resultQuarter: "Result quarter",
  financialBackfillLocked: "Financial backfill locked",
};

const SHARED_FIELD_LABELS: Record<string, string> = {
  status: "Status",
  caseType: "Type",
  dateSigned: "Date signed",
  dateOfIncident: "DOL",
};

function valuesEqual(before: unknown, after: unknown) {
  if (before === after) return true;
  if (before == null && after == null) return true;
  if (typeof before === "number" && typeof after === "number") return before === after;
  return String(before ?? "") === String(after ?? "");
}

function litigationEventsEqual(before: LitigationEvents, after: LitigationEvents) {
  for (const { key } of LITIGATION_EVENT_DEFINITIONS) {
    const previous = before[key];
    const next = after[key];
    if (!valuesEqual(previous.person, next.person) || !valuesEqual(previous.status, next.status)) {
      return false;
    }
  }
  return true;
}

function describeLitigationEventChanges(before: LitigationEvents, after: LitigationEvents) {
  const labels: string[] = [];
  for (const { key, label } of LITIGATION_EVENT_DEFINITIONS) {
    const previous = before[key];
    const next = after[key];
    if (!valuesEqual(previous.person, next.person) || !valuesEqual(previous.status, next.status)) {
      labels.push(label);
    }
  }
  return labels;
}

export function describeTrackerChanges(
  before: TrackerEntry,
  input: TrackerUpdateInput & { result?: SettlementResult },
  shared?: {
    before?: { status?: string; caseType?: string; dateSigned?: string; dateOfIncident?: string | null };
    after?: { status?: string; caseType?: string; dateSigned?: string; dateOfIncident?: string | null };
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

  if (input.litigationEvents) {
    labels.push(...describeLitigationEventChanges(before.litigationEvents, input.litigationEvents));
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

/** Build a PATCH payload with only fields that differ from the last server snapshot. */
export function buildTrackerChangeInput(
  next: TrackerEntry,
  baseline: TrackerEntry,
  extras?: {
    manualDisbursements?: ManualDisbursementInput[];
    disbursementOverrides?: DisbursementPartyOverrideInput[];
  },
): TrackerUpdateInput & {
  result?: SettlementResult;
  manualDisbursements?: ManualDisbursementInput[];
  disbursementOverrides?: DisbursementPartyOverrideInput[];
} {
  const input: TrackerUpdateInput & {
    result?: SettlementResult;
    manualDisbursements?: ManualDisbursementInput[];
    disbursementOverrides?: DisbursementPartyOverrideInput[];
  } = {};

  for (const key of Object.keys(TRACKER_FIELD_LABELS)) {
    const field = key as keyof TrackerEntry;
    const nextValue = next[field];
    const baselineValue = baseline[field];
    if (!valuesEqual(nextValue, baselineValue)) {
      (input as Record<string, unknown>)[field] = nextValue;
    }
  }

  let resultChanged = false;
  const resultPatch: Record<string, unknown> = {};
  for (const key of Object.keys(RESULT_FIELD_LABELS)) {
    const field = key as keyof SettlementResult;
    const nextValue = next.result[field];
    const baselineValue = baseline.result[field];
    if (!valuesEqual(nextValue, baselineValue)) {
      resultPatch[field] = nextValue;
      resultChanged = true;
    }
  }
  if (resultChanged) {
    input.result = { ...next.result };
  }

  if (!litigationEventsEqual(baseline.litigationEvents, next.litigationEvents)) {
    input.litigationEvents = { ...next.litigationEvents };
  }

  if (extras?.manualDisbursements) {
    input.manualDisbursements = extras.manualDisbursements;
  }
  if (extras?.disbursementOverrides) {
    input.disbursementOverrides = extras.disbursementOverrides;
  }

  return input;
}

export function buildTrackerActivityDescription(changedFields: string[], markReviewed: boolean) {
  if (changedFields.length === 0) {
    return markReviewed ? "Case marked reviewed." : "Tracker saved.";
  }

  const fieldList = changedFields.join(", ");
  return markReviewed ? `Updated ${fieldList}. Case marked reviewed.` : `Updated ${fieldList}.`;
}
