import { normalizePulseStageLabel } from "@/lib/stage-triggers";
import { type CaseStage } from "@/lib/types";

const CONFIRM_RE = /^(?:yes|yeah|yep|confirmed?|correct|approve[d]?|ok(?:ay)?|✅|👍)$/i;

const STAGE_LINE_RE =
  /^(?:stage|status|case\s*stage)\s*:\s*(.+)$/i;

export type ParsedStageConfirmation =
  | { kind: "confirm_suggested" }
  | { kind: "explicit_stage"; stage: CaseStage }
  | { kind: "dismiss"; reason?: string };

export function parseStageConfirmationText(text: string, suggestedStage?: CaseStage): ParsedStageConfirmation | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (/^(?:no|nope|incorrect|wrong|not\s+correct|dismiss)(?:\s*[—-]\s*(.+))?$/i.test(trimmed)) {
    const reason = trimmed.match(/[—-]\s*(.+)$/)?.[1]?.trim();
    return { kind: "dismiss", reason };
  }

  const stageLine = trimmed.match(STAGE_LINE_RE);
  if (stageLine) {
    return { kind: "explicit_stage", stage: normalizePulseStageLabel(stageLine[1]) };
  }

  if (CONFIRM_RE.test(trimmed)) {
    return { kind: "confirm_suggested" };
  }

  const singleWord = trimmed.split(/\s+/).length <= 3 ? normalizePulseStageLabel(trimmed) : null;
  if (singleWord && singleWord !== "Onboarding" && trimmed.length < 40) {
    if (suggestedStage && singleWord === suggestedStage) return { kind: "confirm_suggested" };
    return { kind: "explicit_stage", stage: singleWord };
  }

  if (/confirm(?:ed)?\s+(?:status\s+)?(?:is\s+)?(.+)/i.test(trimmed)) {
    const match = trimmed.match(/confirm(?:ed)?\s+(?:status\s+)?(?:is\s+)?(.+)/i);
    if (match) return { kind: "explicit_stage", stage: normalizePulseStageLabel(match[1]) };
  }

  return null;
}

export function isStageConfirmationReaction(reaction: string) {
  return reaction === "white_check_mark" || reaction === "heavy_check_mark" || reaction === "+1";
}
