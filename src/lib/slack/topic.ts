import { sanitizeSlackTopic } from "@/lib/slack/reminders";
import { type CaseRecord, type CaseSlackChannel, type CaseStage } from "@/lib/types";

/** Tracker stage → text shown in channel topic parentheses. */
const CASE_STAGE_TOPIC_STATUS: Record<CaseStage, string> = {
  Onboarding: "Onboarding",
  Lit: "Litigation",
  Txt: "Treatment",
  Dmd: "Demand",
  Settled: "Settled",
  Disengaged: "Disengaged",
  Referred: "Referred",
  Terminated: "Terminated",
};

export function caseStageToTopicStatusLabel(stage: CaseStage) {
  return CASE_STAGE_TOPIC_STATUS[stage] ?? stage;
}

/**
 * Status in parentheses for the channel topic.
 * On stage save we use the tracker stage label; otherwise prefer sheet column F (topic_stage).
 */
export function resolveTopicStatusLabel(
  record: CaseRecord,
  mapping: CaseSlackChannel | null,
  options?: { fromTrackerStage?: boolean },
) {
  if (options?.fromTrackerStage) {
    return caseStageToTopicStatusLabel(record.tracker.caseStage);
  }
  const sheetStatus = mapping?.topicStage?.trim();
  if (sheetStatus) return sheetStatus;
  return caseStageToTopicStatusLabel(record.tracker.caseStage);
}

/** Firm format: Attorney @Name | Paralegal @Name (Status) */
export function buildSlackChannelTopic(record: CaseRecord, statusInParens: string) {
  const attorney = record.attorney.name.trim();
  const paralegal = record.paralegal.name.trim();
  const status = statusInParens.trim();
  return sanitizeSlackTopic(`Attorney @${attorney} | Paralegal @${paralegal} (${status})`);
}
