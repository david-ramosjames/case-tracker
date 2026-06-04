import { getOutdatedValidationFields, getValidationFieldLabel } from "@/lib/attorney-score";
import { getDataQualityFlags, sourcesLitNeedsReview } from "@/lib/calculations";
import { QUARTERLY_REVIEW_DAYS } from "@/lib/slack/config";
import { type CaseRecord, type CaseTrackerSettings, type SlackReminderReason } from "@/lib/types";
import { daysSince } from "@/lib/utils";

const SOURCES_LIT_FIELDS = ["sources", "litEventsNeeded", "litEventsTimeline", "injuries", "caseDescription"] as const;

export function getSlackReminderReasons(
  record: CaseRecord,
  settings: Pick<CaseTrackerSettings, "staleReviewThresholdDays">,
): SlackReminderReason[] {
  const reasons: SlackReminderReason[] = [];
  const { tracker } = record;

  if (!tracker.targetResolutionQuarter) reasons.push("missing_quarter");
  if (!tracker.minimumValue) reasons.push("missing_minimum_value");
  if (sourcesLitNeedsReview(record)) reasons.push("sources_lit_stale");

  const outdatedValidation = getOutdatedValidationFields(record);
  if (outdatedValidation.length > 0) {
    reasons.push("validation_stale");
  }

  const quarterlyStale = daysSince(tracker.lastQuarterlyCheckInAt) >= QUARTERLY_REVIEW_DAYS;
  if (quarterlyStale && (reasons.includes("missing_quarter") || reasons.includes("missing_minimum_value") || reasons.includes("sources_lit_stale"))) {
    reasons.push("quarterly_review");
  } else if (quarterlyStale) {
    reasons.push("quarterly_review");
  }

  const missingFlags = getDataQualityFlags(record, settings).filter((flag) => flag.id.startsWith("missing"));
  if (missingFlags.length > 0 && !reasons.includes("missing_fields")) {
    reasons.push("missing_fields");
  }

  return [...new Set(reasons)];
}

export function buildSlackReminderMessage(record: CaseRecord, reasons: SlackReminderReason[], appUrl: string) {
  const caseLink = `${appUrl}/cases/${record.shared.id}`;
  const lines: string[] = [
    `*Case tracker update needed* — ${record.shared.caseNumber} (${record.shared.clientName})`,
    `<${caseLink}|Open in Case Tracker>`,
    "",
  ];

  if (reasons.includes("validation_stale")) {
    const outdated = getOutdatedValidationFields(record);
    lines.push("*90-day validation overdue* — confirm or update in the tracker:");
    for (const fieldId of outdated) {
      lines.push(`• *${getValidationFieldLabel(fieldId)}*`);
    }
    lines.push("");
  }

  if (reasons.includes("quarterly_review") || reasons.includes("missing_quarter") || reasons.includes("missing_minimum_value") || reasons.includes("sources_lit_stale")) {
    lines.push("*90-day review* — please confirm or update:");
    if (reasons.includes("missing_quarter") || reasons.includes("quarterly_review")) {
      lines.push("• Expected completion *Quarter*");
    }
    if (reasons.includes("missing_minimum_value") || reasons.includes("quarterly_review")) {
      lines.push("• *Minimum value*");
    }
    if (reasons.includes("sources_lit_stale") || reasons.includes("quarterly_review")) {
      lines.push("• *Sources and Litigation Detail* (save that section in the tracker)");
    }
    lines.push("");
    lines.push("_Reply in this thread with updates, for example:_");
    lines.push("```");
    lines.push("Quarter: 2026 Q3");
    lines.push("Minimum: 75000");
    lines.push("Sources: Updated treatment status...");
    lines.push("```");
  }

  if (reasons.includes("missing_fields")) {
    const flags = getDataQualityFlags(record, { staleReviewThresholdDays: 30 }).filter((f) => f.id.startsWith("missing"));
    lines.push("*Other incomplete fields:*");
    for (const flag of flags) {
      lines.push(`• ${flag.label}`);
    }
  }

  return lines.join("\n");
}

export function trackerTouchesSourcesLit(patch: Record<string, unknown>) {
  return SOURCES_LIT_FIELDS.some((field) => field in patch && patch[field] !== undefined);
}
