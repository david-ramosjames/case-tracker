import { sanitizeSlackTopic } from "@/lib/slack/reminders";
import { type CaseSlackChannel, type CaseStage } from "@/lib/types";

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
  stage: CaseStage,
  mapping: CaseSlackChannel | null,
  options?: { fromTrackerStage?: boolean },
) {
  if (options?.fromTrackerStage) {
    return caseStageToTopicStatusLabel(stage);
  }
  const sheetStatus = mapping?.topicStage?.trim();
  if (sheetStatus) return sheetStatus;
  return caseStageToTopicStatusLabel(stage);
}

/** Keeps Attorney | Paralegal mentions; strips trailing (Status). */
export function extractTopicPrefix(fullTopic: string) {
  const trimmed = fullTopic.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^(.+)\s+\([^)]*\)\s*$/);
  return (match?.[1] ?? trimmed).trim();
}

/** Rebuild topic: existing prefix + new (Status) only. */
export function buildTopicFromPrefix(prefix: string, statusInParens: string) {
  const base = prefix.trim();
  const status = statusInParens.trim();
  if (!base || !status) return "";
  return sanitizeSlackTopic(`${base} (${status})`);
}
