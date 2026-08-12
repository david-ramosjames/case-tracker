import {
  ATTORNEY_SCORE_VALIDATION_DAYS,
  COMPLETENESS_FIELDS,
  getCaseAttorneyScore,
  getValidationFieldLabel,
  hasCompletenessField,
  hasValidationFieldValue,
  isValidationFieldFresh,
} from "@/lib/attorney-score";
import {
  EXPECTED_DISBURSEMENT_QUARTER_LABEL,
} from "@/lib/case-options";
import { caseRequiresOngoingUpdates } from "@/lib/case-status";
import {
  getExpectedLitigationSlackOptions,
  getLiabilitySlackOptions,
  getTargetQuarterSlackOptions,
} from "@/lib/slack/enum-replies";
import { type CaseRecord, type FieldReminderKey } from "@/lib/types";
import { daysSince, formatCurrency } from "@/lib/utils";

export const FIELD_REMINDER_COOLDOWN_DAYS = 3;

export const FIELD_REMINDER_META: Record<
  FieldReminderKey,
  { label: string; shortPrompt: string }
> = {
  liability: {
    label: "Liability",
    shortPrompt: "Confirm liability is still correct, or reply with an update.",
  },
  targetResolutionQuarter: {
    label: EXPECTED_DISBURSEMENT_QUARTER_LABEL,
    shortPrompt: "Confirm when you still expect this case to disburse, or reply with an update.",
  },
  minimumValue: {
    label: "Minimum value",
    shortPrompt: "Confirm the minimum case value, or reply with an update.",
  },
  policyLimits: {
    label: "Policy limits",
    shortPrompt: "Confirm policy limits are still accurate, or reply with an update.",
  },
  expectedLitigation: {
    label: "Expected litigation",
    shortPrompt: "Confirm expected litigation status, or reply with an update.",
  },
};

export function caseHasEverBeenLitigation(record: CaseRecord) {
  return record.tracker.hasEverBeenLitigation || record.tracker.caseStage === "Lit";
}

function liabilityReminderDue(record: CaseRecord) {
  const liability = record.tracker.liability?.trim();
  if (liability !== "Pending") return false;
  if (!hasValidationFieldValue(record, "liability")) return true;
  return !isValidationFieldFresh(record, "liability");
}

function validationFieldReminderDue(record: CaseRecord, fieldId: "targetResolutionQuarter" | "minimumValue" | "policyLimits") {
  if (!hasValidationFieldValue(record, fieldId)) return true;
  return !isValidationFieldFresh(record, fieldId);
}

function expectedLitigationReminderDue(record: CaseRecord) {
  if (caseHasEverBeenLitigation(record)) return false;
  if (record.tracker.expectedLitigation === "Lit") return false;
  const validatedAt = record.tracker.expectedLitigationValidatedAt;
  if (!record.tracker.expectedLitigation) return true;
  if (!validatedAt) return daysSince(record.tracker.updatedAt) >= ATTORNEY_SCORE_VALIDATION_DAYS;
  return daysSince(validatedAt) >= ATTORNEY_SCORE_VALIDATION_DAYS;
}

/** Fields that need a Slack reminder post today. */
export function getDueFieldReminders(record: CaseRecord): FieldReminderKey[] {
  if (!record.tracker.isActive || !caseRequiresOngoingUpdates(record)) return [];

  const due: FieldReminderKey[] = [];
  if (liabilityReminderDue(record)) due.push("liability");
  if (validationFieldReminderDue(record, "targetResolutionQuarter")) due.push("targetResolutionQuarter");
  if (validationFieldReminderDue(record, "minimumValue")) due.push("minimumValue");
  if (validationFieldReminderDue(record, "policyLimits")) due.push("policyLimits");
  if (expectedLitigationReminderDue(record)) due.push("expectedLitigation");
  return due;
}

export function getFieldReminderAttentionSummary(record: CaseRecord) {
  const due = getDueFieldReminders(record);
  return due.map((key) => FIELD_REMINDER_META[key].label);
}

export function getIncompleteCompletenessLabels(record: CaseRecord) {
  return COMPLETENESS_FIELDS.filter((field) => !hasCompletenessField(record, field.id)).map((field) => field.label);
}

function formatFieldValue(record: CaseRecord, fieldKey: FieldReminderKey) {
  const { tracker } = record;
  switch (fieldKey) {
    case "liability":
      return tracker.liability?.trim() || "_not set_";
    case "targetResolutionQuarter":
      return tracker.targetResolutionQuarter?.trim() || "_not set_";
    case "minimumValue":
      return tracker.minimumValue != null ? formatCurrency(tracker.minimumValue) : "_not set_";
    case "policyLimits":
      return tracker.policyLimits != null ? formatCurrency(tracker.policyLimits) : "_not set_";
    case "expectedLitigation": {
      if (tracker.expectedLitigation === "Lit") return "Litigation";
      if (tracker.expectedLitigation === "Expect") return "Expected litigation";
      if (tracker.expectedLitigation === "Pre") return "Pre-lit";
      return "_not set_";
    }
    default:
      return "_not set_";
  }
}

function fieldOptionsBlock(fieldKey: FieldReminderKey, record: CaseRecord) {
  switch (fieldKey) {
    case "liability":
      return getLiabilitySlackOptions().map((option) => `\`Liability: ${option}\``).join(" · ");
    case "targetResolutionQuarter": {
      return getTargetQuarterSlackOptions(record.tracker.targetResolutionQuarter)
        .map((quarter) => `\`Expected disbursement quarter: ${quarter}\``)
        .join(" · ");
    }
    case "minimumValue":
      return "`Minimum: 75000` · `Minimum value: $85,000`";
    case "policyLimits":
      return "`Policy limits: 100000` · `Policy limits: $250,000`";
    case "expectedLitigation":
      return getExpectedLitigationSlackOptions().map((label) => `\`Expected lit: ${label}\``).join(" · ");
    default:
      return "";
  }
}

export function buildFieldReminderMessage(
  record: CaseRecord,
  fieldKey: FieldReminderKey,
  appUrl: string,
  options?: { includeCaseSummary?: boolean; topicMentions?: string },
) {
  const meta = FIELD_REMINDER_META[fieldKey];
  const caseLink = `${appUrl}/cases/${record.shared.id}`;
  const lines: string[] = [];
  const mentionPrefix = options?.topicMentions ? `${options.topicMentions} ` : "";

  if (options?.includeCaseSummary) {
    const score = getCaseAttorneyScore(record);
    const stillNeeded = getIncompleteCompletenessLabels(record);
    const dueToday = getFieldReminderAttentionSummary(record);
    lines.push(`${mentionPrefix}*Case #${record.shared.caseNumber}* (${record.shared.clientName})`);
    lines.push(
      `Case Tracker Score: *${score.percent}%* (completeness ${score.completenessPercent}% · freshness ${score.freshnessPercent}%)`,
    );
    if (stillNeeded.length > 0) {
      lines.push(`Still needed: *${stillNeeded.join(", ")}*`);
    }
    if (dueToday.length > 0) {
      lines.push(`Due for review today: *${dueToday.join(", ")}*`);
    }
    lines.push("");
  } else {
    lines.push(`*${meta.label}* · Case #${record.shared.caseNumber}`);
  }

  if (options?.includeCaseSummary) {
    lines.push(`*${meta.label}*`);
  }

  lines.push(
    `Current: ${formatFieldValue(record, fieldKey)}`,
    meta.shortPrompt,
    `Options: ${fieldOptionsBlock(fieldKey, record)}`,
    "",
    `React ✅ or reply \`confirmed\` / \`yes\` if unchanged · <${caseLink}|Open in Case Tracker>`,
  );

  return lines.join("\n");
}

export function fieldReminderValidationPatch(fieldKey: FieldReminderKey, now: string) {
  switch (fieldKey) {
    case "liability":
      return { liability_validated_at: now };
    case "targetResolutionQuarter":
      return { target_resolution_quarter_validated_at: now };
    case "minimumValue":
      return { minimum_value_validated_at: now };
    case "policyLimits":
      return { policy_limits_validated_at: now };
    case "expectedLitigation":
      return { expected_litigation_validated_at: now };
    default:
      return {};
  }
}

export function fieldKeyFromValidationFieldId(fieldId: string): FieldReminderKey | null {
  if (
    fieldId === "liability" ||
    fieldId === "targetResolutionQuarter" ||
    fieldId === "minimumValue" ||
    fieldId === "policyLimits"
  ) {
    return fieldId;
  }
  return null;
}

export function getValidationFieldLabelForReminder(fieldKey: FieldReminderKey) {
  if (fieldKey === "expectedLitigation") return "Expected litigation";
  return getValidationFieldLabel(fieldKey);
}
