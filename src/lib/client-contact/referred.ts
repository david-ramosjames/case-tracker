import { type CaseRecord } from "@/lib/types";

/** Referred-out cases are stored under the placeholder attorney/paralegal named Referred. */
export function isReferredAssignment(name: string | null | undefined) {
  return /^\s*referred\b/i.test(name ?? "");
}

/**
 * Cases that should not appear on Contact / sidebar Contact badge even if still
 * marked Active (placeholder Referred staff, Slack topic, or Referred stage).
 */
export function isReferredCase(record: CaseRecord, topicStage: string | null | undefined) {
  if (record.tracker.caseStage === "Referred") return true;
  if (topicStage && /\breferred\b/i.test(topicStage)) return true;
  return (
    isReferredAssignment(record.attorney.name) ||
    isReferredAssignment(record.paralegal.name) ||
    isReferredAssignment(record.legalAssistant?.name)
  );
}
