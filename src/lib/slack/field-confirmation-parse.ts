import {
  formatInvalidMinimumValueMessage,
  formatInvalidPolicyLimitsMessage,
  formatInvalidTargetQuarterMessage,
  formatSlackInvalidEnumMessage,
  getExpectedLitigationSlackOptions,
  getLiabilitySlackOptions,
  parseStrictExpectedLitigation,
  parseStrictLiability,
  parseStrictMinimumValue,
  parseStrictPolicyLimits,
  parseStrictTargetQuarter,
} from "@/lib/slack/enum-replies";
import { type FieldReminderKey, type TrackerUpdateInput } from "@/lib/types";

const CONFIRM_RE = /^(?:yes|yeah|yep|confirmed?|correct|approve[d]?|ok(?:ay)?|✅|👍|still\s+correct|unchanged)$/i;

export type ParsedFieldReminderReply =
  | { kind: "confirm" }
  | { kind: "dismiss" }
  | { kind: "update"; patch: TrackerUpdateInput; labels: string[] }
  | { kind: "invalid"; message: string };

export function parseFieldReminderReply(
  text: string,
  fieldKey: FieldReminderKey,
  options?: { currentTargetQuarter?: string | null },
): ParsedFieldReminderReply | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (/^(?:no|nope|incorrect|wrong|dismiss)(?:\s|$)/i.test(trimmed)) {
    return { kind: "dismiss" };
  }

  if (CONFIRM_RE.test(trimmed)) {
    return { kind: "confirm" };
  }

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const patch: TrackerUpdateInput = {};
  const labels: string[] = [];
  let invalidMessage: string | null = null;

  for (const line of lines) {
    if (fieldKey === "liability") {
      const match = line.match(/^liability\s*:\s*(.+)$/i);
      if (match) {
        const attempted = match[1].trim();
        const value = parseStrictLiability(attempted);
        if (value) {
          patch.liability = value;
          labels.push("Liability");
        } else {
          invalidMessage = formatSlackInvalidEnumMessage("Liability", getLiabilitySlackOptions(), attempted);
        }
      }
    }

    if (fieldKey === "targetResolutionQuarter") {
      const match = line.match(
        /^(?:quarter|expected disbursement quarter|expected completion quarter|target quarter|disbursement quarter)\s*:\s*(.+)$/i,
      );
      if (match) {
        const attempted = match[1].trim();
        const value = parseStrictTargetQuarter(attempted, { currentValue: options?.currentTargetQuarter });
        if (value) {
          patch.targetResolutionQuarter = value;
          labels.push("Expected disbursement quarter");
        } else {
          invalidMessage = formatInvalidTargetQuarterMessage(attempted, options?.currentTargetQuarter);
        }
      }
    }

    if (fieldKey === "minimumValue") {
      const match = line.match(/^(?:minimum(?:\s+value)?|min(?:\s+value)?)\s*:\s*(.+)$/i);
      if (match) {
        const attempted = match[1].trim();
        const value = parseStrictMinimumValue(attempted);
        if (value != null) {
          patch.minimumValue = value;
          patch.estimatedSettlementValue = value;
          labels.push("Minimum value");
        } else {
          invalidMessage = formatInvalidMinimumValueMessage(attempted);
        }
      }
    }

    if (fieldKey === "policyLimits") {
      const match = line.match(/^policy\s*limits?\s*:\s*(.+)$/i);
      if (match) {
        const attempted = match[1].trim();
        const value = parseStrictPolicyLimits(attempted);
        if (value != null) {
          patch.policyLimits = value;
          labels.push("Policy limits");
        } else {
          invalidMessage = formatInvalidPolicyLimitsMessage(attempted);
        }
      }
    }

    if (fieldKey === "expectedLitigation") {
      const match = line.match(/^(?:expected\s*lit(?:igation)?|expected litigation)\s*:\s*(.+)$/i);
      if (match) {
        const attempted = match[1].trim();
        const value = parseStrictExpectedLitigation(attempted);
        if (value) {
          patch.expectedLitigation = value;
          labels.push("Expected litigation");
        } else {
          invalidMessage = formatSlackInvalidEnumMessage(
            "Expected litigation",
            getExpectedLitigationSlackOptions(),
            attempted,
          );
        }
      }
    }
  }

  if (invalidMessage) {
    return { kind: "invalid", message: invalidMessage };
  }

  if (labels.length > 0) {
    return { kind: "update", patch, labels };
  }

  return null;
}

export function isFieldConfirmationReaction(reaction: string) {
  return reaction === "white_check_mark" || reaction === "heavy_check_mark" || reaction === "+1";
}
