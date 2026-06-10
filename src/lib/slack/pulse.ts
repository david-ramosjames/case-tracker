import { normalizePulseStageLabel } from "@/lib/stage-triggers";
import { type CaseStage, type ConfidenceLevel } from "@/lib/types";

export type ParsedPulseItem = {
  channelRef: string;
  suggestedStage: CaseStage;
  confidence: ConfidenceLevel;
  reason: string;
  excerpt: string;
};

const PULSE_HEADER = /pulse\s*[—-]\s*potential case status changes/i;

const DEFAULT_IGNORED_PULSE_CHANNELS = new Set(["lead-calls", "daily-pulse"]);

export function normalizePulseChannelRef(channelRef: string) {
  return channelRef.trim().toLowerCase().replace(/^#/, "");
}

function getIgnoredPulseChannelRefs() {
  const ignored = new Set(DEFAULT_IGNORED_PULSE_CHANNELS);
  const extra = process.env.SLACK_PULSE_IGNORED_CHANNELS?.split(",") ?? [];
  for (const ref of extra) {
    const normalized = normalizePulseChannelRef(ref);
    if (normalized) ignored.add(normalized);
  }
  return ignored;
}

/** Non-case Slack channels (firm-wide) — skip these in pulse stage fan-out. */
export function isIgnoredPulseChannelRef(channelRef: string) {
  return getIgnoredPulseChannelRefs().has(normalizePulseChannelRef(channelRef));
}

function stripPulseLinePrefix(line: string) {
  return line.trim().replace(/^[\s•·▪\-\*]+/, "").trim();
}

function parseConfidenceLevel(raw: string): ConfidenceLevel {
  const level = raw.toLowerCase();
  if (level === "high") return "High";
  if (level === "low") return "Low";
  return "Medium";
}

function parseConfidenceAndReason(text: string) {
  let remainder = text.trim();
  let confidence: ConfidenceLevel | undefined;
  let reason = "";

  const confidenceMatch = remainder.match(/\((\w+)\s+confidence\)/i);
  if (confidenceMatch) {
    confidence = parseConfidenceLevel(confidenceMatch[1]);
    remainder = remainder.replace(confidenceMatch[0], "").trim();
  }

  const reasonMatch = remainder.match(/\(\*([^*]+)\*\)/);
  if (reasonMatch) {
    reason = reasonMatch[1].trim();
    remainder = remainder.replace(reasonMatch[0], "").trim();
  }

  return { remainder, confidence, reason };
}

function parseExcerptFromLine(line: string) {
  const trimmed = stripPulseLinePrefix(line);
  const quotedMatch = trimmed.match(/^[""'](.+?)[""']\s*[—-]/);
  if (quotedMatch) return quotedMatch[1].trim();
  if (/^[""']/.test(trimmed)) return trimmed.replace(/^[""']|[""'].*$/g, "").trim();
  return null;
}

/** Parse a #daily-pulse recap message into per-channel stage suggestions. */
export function parseDailyPulseMessage(text: string): ParsedPulseItem[] {
  if (!PULSE_HEADER.test(text)) return [];

  const items: ParsedPulseItem[] = [];
  const lines = text.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const line = stripPulseLinePrefix(lines[index]);
    const headerMatch = line.match(/^#?([\w.-]+)\s*→\s*(.+)$/i);
    if (!headerMatch) {
      index += 1;
      continue;
    }

    const channelRef = headerMatch[1].replace(/^#/, "").trim();
    if (isIgnoredPulseChannelRef(channelRef)) {
      index += 1;
      continue;
    }

    const inline = parseConfidenceAndReason(headerMatch[2]);
    let confidence: ConfidenceLevel = inline.confidence ?? "Medium";
    let reason = inline.reason;
    let excerpt = "";

    if (!inline.confidence) {
      const nextLine = stripPulseLinePrefix(lines[index + 1] ?? "");
      const confidenceMatch = nextLine.match(/\((\w+)\s+confidence\)/i);
      if (confidenceMatch) {
        confidence = parseConfidenceLevel(confidenceMatch[1]);
        const reasonMatch = nextLine.match(/\(\*([^*]+)\*\)/);
        if (reasonMatch) reason = reasonMatch[1].trim();
        index += 1;
      }
    }

    const excerptLine = stripPulseLinePrefix(lines[index + 1] ?? "");
    const parsedExcerpt = parseExcerptFromLine(excerptLine);
    if (parsedExcerpt) {
      excerpt = parsedExcerpt;
      index += 1;
    }

    if (!excerpt && reason) excerpt = reason;

    items.push({
      channelRef,
      suggestedStage: normalizePulseStageLabel(inline.remainder),
      confidence,
      reason,
      excerpt,
    });
    index += 1;
  }

  return items;
}

export function channelRefMatchesSlackName(channelRef: string, slackChannelName: string) {
  return normalizePulseChannelRef(channelRef) === normalizePulseChannelRef(slackChannelName);
}
