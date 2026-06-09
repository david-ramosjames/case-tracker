import { LIABILITY_OPTIONS, normalizeTargetQuarter } from "@/lib/case-options";
import { type FieldReminderKey, type TrackerUpdateInput } from "@/lib/types";

const CONFIRM_RE = /^(?:yes|yeah|yep|confirmed?|correct|approve[d]?|ok(?:ay)?|✅|👍|still\s+correct|unchanged)$/i;

export type ParsedFieldReminderReply =
  | { kind: "confirm" }
  | { kind: "dismiss" }
  | { kind: "update"; patch: TrackerUpdateInput; labels: string[] };

function normalizeExpectedLitReply(raw: string) {
  const normalized = raw.trim().toLowerCase();
  if (normalized.includes("litigation") || normalized === "lit") return "Lit" as const;
  if (normalized.includes("expected")) return "Expect" as const;
  if (normalized.includes("pre")) return "Pre" as const;
  return null;
}

function matchLiabilityOption(raw: string) {
  const trimmed = raw.trim();
  const exact = LIABILITY_OPTIONS.find((option) => option.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;
  if (/^pending$/i.test(trimmed)) return "Pending";
  if (/^denied$/i.test(trimmed)) return "Denied";
  if (/^n\/a$/i.test(trimmed)) return "N/A";
  return null;
}

function parseMoney(value: string) {
  const numeric = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

export function parseFieldReminderReply(text: string, fieldKey: FieldReminderKey): ParsedFieldReminderReply | null {
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

  for (const line of lines) {
    if (fieldKey === "liability") {
      const match = line.match(/^liability\s*:\s*(.+)$/i);
      if (match) {
        const value = matchLiabilityOption(match[1]);
        if (value) {
          patch.liability = value;
          labels.push("Liability");
        }
      }
    }

    if (fieldKey === "targetResolutionQuarter") {
      const match = line.match(
        /^(?:quarter|expected disbursement quarter|expected completion quarter|target quarter|disbursement quarter)\s*:\s*(.+)$/i,
      );
      if (match) {
        const value = normalizeTargetQuarter(match[1]);
        if (value) {
          patch.targetResolutionQuarter = value;
          labels.push("Expected disbursement quarter");
        }
      }
    }

    if (fieldKey === "minimumValue") {
      const match = line.match(/^(?:minimum(?:\s+value)?|min(?:\s+value)?)\s*:\s*(.+)$/i);
      if (match) {
        const value = parseMoney(match[1]);
        if (value != null) {
          patch.minimumValue = value;
          patch.estimatedSettlementValue = value;
          labels.push("Minimum value");
        }
      }
    }

    if (fieldKey === "policyLimits") {
      const match = line.match(/^policy\s*limits?\s*:\s*(.+)$/i);
      if (match) {
        const value = parseMoney(match[1]);
        if (value != null) {
          patch.policyLimits = value;
          labels.push("Policy limits");
        }
      }
    }

    if (fieldKey === "expectedLitigation") {
      const match = line.match(/^(?:expected\s*lit(?:igation)?|expected litigation)\s*:\s*(.+)$/i);
      if (match) {
        const value = normalizeExpectedLitReply(match[1]);
        if (value) {
          patch.expectedLitigation = value;
          labels.push("Expected litigation");
        }
      }
    }
  }

  if (labels.length > 0) {
    return { kind: "update", patch, labels };
  }

  return null;
}

export function isFieldConfirmationReaction(reaction: string) {
  return reaction === "white_check_mark" || reaction === "heavy_check_mark" || reaction === "+1";
}
