import {
  formatSlackInvalidEnumMessage,
  getStageSlackOptions,
  parseStrictSlackStage,
} from "@/lib/slack/enum-replies";
import { type CaseStage } from "@/lib/types";

const CONFIRM_RE = /^(?:yes|yeah|yep|confirmed?|correct|approve[d]?|ok(?:ay)?|✅|👍)$/i;

const STAGE_LINE_RE =
  /^(?:stage|status|case\s*stage)\s*:\s*(.+)$/i;

export type ParsedStageConfirmation =
  | { kind: "confirm_suggested" }
  | { kind: "explicit_stage"; stage: CaseStage }
  | { kind: "dismiss"; reason?: string }
  | { kind: "invalid_stage"; attempted: string; message: string };

function invalidStage(attempted: string): ParsedStageConfirmation {
  return {
    kind: "invalid_stage",
    attempted,
    message: formatSlackInvalidEnumMessage("Case stage", getStageSlackOptions(), attempted),
  };
}

export function parseStageConfirmationText(text: string, suggestedStage?: CaseStage): ParsedStageConfirmation | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (/^(?:no|nope|incorrect|wrong|not\s+correct|dismiss)(?:\s*[—-]\s*(.+))?$/i.test(trimmed)) {
    const reason = trimmed.match(/[—-]\s*(.+)$/)?.[1]?.trim();
    return { kind: "dismiss", reason };
  }

  const stageLine = trimmed.match(STAGE_LINE_RE);
  if (stageLine) {
    const attempted = stageLine[1].trim();
    const stage = parseStrictSlackStage(attempted);
    if (stage) return { kind: "explicit_stage", stage };
    return invalidStage(attempted);
  }

  if (CONFIRM_RE.test(trimmed)) {
    return { kind: "confirm_suggested" };
  }

  const confirmMatch = trimmed.match(/confirm(?:ed)?\s+(?:status\s+)?(?:is\s+)?(.+)/i);
  if (confirmMatch) {
    const attempted = confirmMatch[1].trim();
    const stage = parseStrictSlackStage(attempted);
    if (stage) return { kind: "explicit_stage", stage };
    return invalidStage(attempted);
  }

  if (trimmed.split(/\s+/).length <= 3 && trimmed.length < 40) {
    const stage = parseStrictSlackStage(trimmed);
    if (stage) {
      if (suggestedStage && stage === suggestedStage) return { kind: "confirm_suggested" };
      return { kind: "explicit_stage", stage };
    }
  }

  return null;
}

export function isStageConfirmationReaction(reaction: string) {
  return reaction === "white_check_mark" || reaction === "heavy_check_mark" || reaction === "+1";
}
