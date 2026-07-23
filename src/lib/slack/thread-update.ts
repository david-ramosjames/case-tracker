import { cleanCaseNumber } from "@/lib/csv/parse";
import {
  formatInvalidMinimumValueMessage,
  formatInvalidPolicyLimitsMessage,
  formatInvalidReferralFeeMessage,
  formatInvalidTargetQuarterMessage,
  formatSlackInvalidEnumMessage,
  getCaseTypeSlackOptions,
  getExpectedLitigationSlackOptions,
  getLiabilitySlackOptions,
  parseStrictCaseType,
  parseStrictExpectedLitigation,
  parseStrictLiability,
  parseStrictMinimumValue,
  parseStrictPolicyLimits,
  parseStrictReferralFee,
  parseStrictTargetQuarter,
} from "@/lib/slack/enum-replies";
import { type TrackerUpdateInput } from "@/lib/types";

export type ParsedThreadUpdate = {
  tracker: TrackerUpdateInput;
  shared?: { caseType?: string };
  sharedNotes?: string;
  validationErrors: string[];
};

export function parseSlackThreadUpdate(
  text: string,
  options?: { currentTargetQuarter?: string | null },
): ParsedThreadUpdate | null {
  const tracker: TrackerUpdateInput = {};
  const shared: { caseType?: string } = {};
  let sharedNotes: string | undefined;
  const validationErrors: string[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const typeMatch = line.match(/^(?:type|case\s*type)\s*:\s*(.+)$/i);
    if (typeMatch) {
      const attempted = typeMatch[1].trim();
      const value = parseStrictCaseType(attempted);
      if (value) {
        shared.caseType = value;
      } else {
        validationErrors.push(formatSlackInvalidEnumMessage("Case type", getCaseTypeSlackOptions(), attempted));
      }
      continue;
    }

    const quarterMatch = line.match(
      /^(?:quarter|expected disbursement quarter|expected completion quarter|target quarter|disbursement quarter)\s*:\s*(.+)$/i,
    );
    if (quarterMatch) {
      const attempted = quarterMatch[1].trim();
      const value = parseStrictTargetQuarter(attempted, { currentValue: options?.currentTargetQuarter });
      if (value) {
        tracker.targetResolutionQuarter = value;
      } else {
        validationErrors.push(formatInvalidTargetQuarterMessage(attempted, options?.currentTargetQuarter));
      }
      continue;
    }

    const minimumMatch = line.match(/^(?:minimum(?:\s+value)?|min(?:\s+value)?)\s*:\s*(.+)$/i);
    if (minimumMatch) {
      const attempted = minimumMatch[1].trim();
      const value = parseStrictMinimumValue(attempted);
      if (value != null) {
        tracker.minimumValue = value;
        tracker.estimatedSettlementValue = value;
      } else {
        validationErrors.push(formatInvalidMinimumValueMessage(attempted));
      }
      continue;
    }

    const sourcesMatch = line.match(/^sources\s*:\s*(.+)$/i);
    if (sourcesMatch) {
      tracker.sources = sourcesMatch[1];
      tracker.lastSourcesLitUpdatedAt = new Date().toISOString();
      continue;
    }

    const injuriesMatch = line.match(/^injuries\s*:\s*(.+)$/i);
    if (injuriesMatch) {
      tracker.injuries = injuriesMatch[1];
      tracker.lastSourcesLitUpdatedAt = new Date().toISOString();
      continue;
    }

    const descriptionMatch = line.match(/^(?:description|case description)\s*:\s*(.+)$/i);
    if (descriptionMatch) {
      tracker.caseDescription = descriptionMatch[1];
      tracker.lastSourcesLitUpdatedAt = new Date().toISOString();
      continue;
    }

    const statusMatch = line.match(/^(?:status notes?|notes?)\s*:\s*(.+)$/i);
    if (statusMatch) {
      tracker.statusNotes = statusMatch[1];
      continue;
    }

    const liabilityMatch = line.match(/^liability\s*:\s*(.+)$/i);
    if (liabilityMatch) {
      const attempted = liabilityMatch[1].trim();
      const value = parseStrictLiability(attempted);
      if (value) {
        tracker.liability = value;
      } else {
        validationErrors.push(formatSlackInvalidEnumMessage("Liability", getLiabilitySlackOptions(), attempted));
      }
      continue;
    }

    const policyMatch = line.match(/^policy\s*limits?\s*:\s*(.+)$/i);
    if (policyMatch) {
      const attempted = policyMatch[1].trim();
      const value = parseStrictPolicyLimits(attempted);
      if (value != null) {
        tracker.policyLimits = value;
      } else {
        validationErrors.push(formatInvalidPolicyLimitsMessage(attempted));
      }
      continue;
    }

    const policySourceMatch = line.match(
      /^(?:policy\s*source|policy\s*info(?:rmation)?\s*source|source of policy(?:\s*info(?:rmation)?)?)\s*:\s*(.+)$/i,
    );
    if (policySourceMatch) {
      tracker.policyInfoSource = policySourceMatch[1].trim();
      continue;
    }

    const expectedLitMatch = line.match(/^(?:expected\s*lit(?:igation)?|expected litigation)\s*:\s*(.+)$/i);
    if (expectedLitMatch) {
      const attempted = expectedLitMatch[1].trim();
      const value = parseStrictExpectedLitigation(attempted);
      if (value) {
        tracker.expectedLitigation = value;
      } else {
        validationErrors.push(
          formatSlackInvalidEnumMessage("Expected litigation", getExpectedLitigationSlackOptions(), attempted),
        );
      }
      continue;
    }

    const referralFeeMatch = line.match(/^referral\s*fee\s*:\s*(.+)$/i);
    if (referralFeeMatch) {
      const attempted = referralFeeMatch[1].trim();
      const value = parseStrictReferralFee(attempted);
      if (value != null) {
        tracker.referralFee = value;
      } else {
        validationErrors.push(formatInvalidReferralFeeMessage(attempted));
      }
      continue;
    }
  }

  const hasTrackerPatch = Object.keys(tracker).length > 0;
  const hasSharedPatch = Boolean(shared.caseType);

  if (!hasTrackerPatch && !hasSharedPatch) {
    const caseNumber = lines.find((line) => /^case\s*#/i.test(line));
    if (!caseNumber && lines.length >= 2) {
      sharedNotes = text.trim();
    }
    return null;
  }

  if (validationErrors.length > 0) {
    return {
      tracker: {},
      validationErrors,
    };
  }

  if (hasTrackerPatch) {
    tracker.lastQuarterlyCheckInAt = new Date().toISOString();
  }

  return {
    tracker,
    ...(shared.caseType ? { shared } : {}),
    sharedNotes,
    validationErrors: [],
  };
}

/** User-facing labels for Slack confirmation (matches reminder wording). */
export function describeSlackThreadAppliedLabels(patch: TrackerUpdateInput): string[] {
  const labels: string[] = [];
  if (patch.targetResolutionQuarter != null) labels.push("Expected disbursement quarter");
  if (patch.minimumValue != null) labels.push("Minimum value");
  if (patch.sources != null) labels.push("Sources & litigation detail");
  if (patch.injuries != null) labels.push("Injuries");
  if (patch.caseDescription != null) labels.push("Case description");
  if (patch.statusNotes != null) labels.push("Status notes");
  if (patch.caseStage != null) labels.push("Case stage");
  if (patch.estimatedFeeValue != null) labels.push("Projected firm fee");
  if (patch.confidenceLevel != null) labels.push("Confidence level");
  if (patch.policyLimits != null) labels.push("Policy limits");
  if (patch.policyInfoSource != null) labels.push("Policy Source");
  if (patch.liability != null) labels.push("Liability");
  if (patch.expectedLitigation != null) labels.push("Expected litigation");
  if (patch.referralFee != null) labels.push("Referral fee");
  return labels;
}

export function describeSlackThreadSharedLabels(shared?: { caseType?: string }) {
  const labels: string[] = [];
  if (shared?.caseType) labels.push("Case type");
  return labels;
}

export function formatSlackThreadAppliedMessage(labels: string[]) {
  if (labels.length === 0) return "Thanks — saved your update to the case tracker.";
  return `Thanks — updated the case tracker: *${labels.join("*, *")}*.`;
}

export function formatSlackThreadValidationErrors(errors: string[]) {
  return errors.join("\n");
}

export function caseNumberFromSlackText(text: string) {
  const match = text.match(/case\s*#\s*([^\s)]+)/i);
  return match ? cleanCaseNumber(match[1]) : "";
}
