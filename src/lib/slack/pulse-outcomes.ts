import { type ParsedPulseItem } from "@/lib/slack/pulse";
import { type CaseStage } from "@/lib/types";

/** Client-safe pulse fan-out types and formatters (no server imports). */

export type PulseFanOutResult =
  | "posted"
  | "skipped_ignored_channel"
  | "skipped_no_match"
  | "skipped_no_case"
  | "skipped_already_at_stage"
  | "skipped_already_applied"
  | "skipped_inactive_tracker"
  | "skipped_handled"
  | "skipped_already_posted"
  | "skipped_post_failed"
  | "skipped_no_channel";

export type PulseItemOutcome = {
  channelRef: string;
  pulseLabel: string;
  suggestedStage: CaseStage;
  pulseSignal: ParsedPulseItem["pulseSignal"];
  applyAs: string;
  caseNumber: string | null;
  trackerStage: CaseStage | null;
  trackerDisbursed: string | null;
  result: PulseFanOutResult;
};

export function formatPulseFanOutResult(result: PulseFanOutResult) {
  return result.replace(/^skipped_/, "").replace(/_/g, " ");
}

export function describePulseItemApply(item: ParsedPulseItem) {
  if (item.pulseSignal === "disbursed") {
    return "Settled + Disbursed Yes";
  }
  return item.suggestedStage;
}
