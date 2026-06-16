import { cleanCaseNumber } from "@/lib/csv/parse";
import { detectPulseSignal, parsePulseStageLabel, type PulseSignal } from "@/lib/stage-triggers";
import { type CaseStage, type ConfidenceLevel } from "@/lib/types";

export type ParsedPulseItem = {
  channelRef: string;
  /** Raw pulse label before mapping (e.g. Disbursed, Settled). */
  pulseLabel: string;
  pulseSignal: PulseSignal | null;
  suggestedStage: CaseStage;
  confidence: ConfidenceLevel;
  reason: string;
  excerpt: string;
};

/** Pulse app title line — allow en/em dash and optional date suffix. */
const PULSE_HEADER = /pulse\s*[\u2013\u2014–—\-]\s*potential\s+case\s+status\s+changes/i;

const PULSE_ARROW = /(?:→|->|➜|➔|—>)/;

const DEFAULT_IGNORED_PULSE_CHANNELS = new Set(["lead-calls", "daily-pulse"]);

export function normalizePulseChannelRef(channelRef: string) {
  return channelRef.trim().toLowerCase().replace(/^#/, "").replace(/^<|>$/g, "");
}

/** Case number suffix from pulse channel refs like `nicolasmacdonald-1208`. */
export function caseNumberFromPulseChannelRef(channelRef: string) {
  const normalized = normalizePulseChannelRef(channelRef);
  if (!normalized) return null;
  const hyphenSuffix = normalized.match(/-(\d+)$/);
  if (hyphenSuffix) return cleanCaseNumber(hyphenSuffix[1]);
  if (/^\d+$/.test(normalized)) return cleanCaseNumber(normalized);
  return null;
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

export function isPulseStatusRecapMessage(text: string) {
  if (/daily\s+flags/i.test(text)) return false;
  return PULSE_HEADER.test(text) || /potential\s+case\s+status\s+changes/i.test(text);
}

/** Expand Slack mrkdwn channel links to #channel-name for parsing. */
export function normalizeSlackMessageMarkup(text: string) {
  return text
    .replace(/<#[^|>]+\|([^>]+)>/gi, "#$1")
    .replace(/<#([CGD][A-Z0-9]+)>/gi, (_, id: string) => `#${id}`)
    .replace(/<!subteam\^[^|>]+\|([^>]+)>/gi, "#$1");
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

  const starredReasonMatch = remainder.match(/\(\*([^*]+)\*\)/);
  if (starredReasonMatch) {
    reason = starredReasonMatch[1].trim();
    remainder = remainder.replace(starredReasonMatch[0], "").trim();
  }

  const plainReasonMatch = remainder.match(/\(([^)]+)\)\s*$/);
  if (plainReasonMatch && !plainReasonMatch[1].toLowerCase().includes("confidence")) {
    reason = reason || plainReasonMatch[1].trim();
    remainder = remainder.replace(plainReasonMatch[0], "").trim();
  }

  return { remainder, confidence, reason };
}

function parseExcerptFromLine(line: string) {
  const trimmed = stripPulseLinePrefix(line);
  const quotedMatch = trimmed.match(/^[""'\u201c\u201d](.+?)[""'\u201c\u201d]\s*[\u2013\u2014–—\-]/);
  if (quotedMatch) return quotedMatch[1].trim();
  if (/^[""'\u201c\u201d]/.test(trimmed)) {
    return trimmed.replace(/^[""'\u201c\u201d]|[""'\u201c\u201d].*$/g, "").trim();
  }
  return null;
}

function parsePulseItemLine(line: string, nextLine?: string) {
  const normalized = stripPulseLinePrefix(line);
  const arrowPattern = new RegExp(`^#?([\\w<>.|@-]+)\\s*${PULSE_ARROW.source}\\s*(.*)$`, "i");
  const headerMatch = normalized.match(arrowPattern);
  if (!headerMatch) return null;

  const channelRef = headerMatch[1].replace(/^#/, "").replace(/^<|>$/g, "").trim();
  if (isIgnoredPulseChannelRef(channelRef)) return null;

  const inline = parseConfidenceAndReason(headerMatch[2]);
  let consumedNextLine = false;

  if (!inline.remainder.trim() && nextLine) {
    const continuation = parseConfidenceAndReason(stripPulseLinePrefix(nextLine));
    if (continuation.remainder.trim()) {
      inline.remainder = continuation.remainder;
      inline.confidence = inline.confidence ?? continuation.confidence;
      inline.reason = inline.reason || continuation.reason;
      consumedNextLine = true;
    }
  }

  return { channelRef, inline, consumedNextLine };
}

function extractPulseItemsFromLines(lines: string[]) {
  const items: ParsedPulseItem[] = [];
  let index = 0;

  while (index < lines.length) {
    const parsedLine = parsePulseItemLine(lines[index], lines[index + 1]);
    if (!parsedLine) {
      index += 1;
      continue;
    }

    const { channelRef, inline, consumedNextLine } = parsedLine;
    const pulseLabel = inline.remainder.trim();
    const pulseSignal = detectPulseSignal(pulseLabel);
    const suggestedStage = parsePulseStageLabel(pulseLabel);
    if (!suggestedStage) {
      index += consumedNextLine ? 2 : 1;
      continue;
    }

    let confidence: ConfidenceLevel = inline.confidence ?? "Medium";
    let reason = inline.reason;
    let excerpt = "";
    let lineOffset = consumedNextLine ? 1 : 0;

    if (!inline.confidence && !consumedNextLine) {
      const nextLine = stripPulseLinePrefix(lines[index + 1] ?? "");
      const confidenceMatch = nextLine.match(/\((\w+)\s+confidence\)/i);
      if (confidenceMatch) {
        confidence = parseConfidenceLevel(confidenceMatch[1]);
        const reasonMatch = nextLine.match(/\(\*([^*]+)\*\)/) ?? nextLine.match(/\(([^)]+)\)/);
        if (reasonMatch) reason = reasonMatch[1].trim();
        lineOffset += 1;
      }
    }

    const excerptLine = stripPulseLinePrefix(lines[index + lineOffset + 1] ?? "");
    const parsedExcerpt = parseExcerptFromLine(excerptLine);
    if (parsedExcerpt) {
      excerpt = parsedExcerpt;
      lineOffset += 1;
    }

    if (!excerpt && reason) excerpt = reason;

    items.push({
      channelRef,
      pulseLabel,
      pulseSignal,
      suggestedStage,
      confidence,
      reason,
      excerpt,
    });
    index += lineOffset + 1;
  }

  return items;
}

/** Parse a #daily-pulse recap message into per-channel stage suggestions. */
export function parseDailyPulseMessage(text: string): ParsedPulseItem[] {
  const normalizedText = normalizeSlackMessageMarkup(text);
  const lines = normalizedText.split(/\r?\n/);
  const items = extractPulseItemsFromLines(lines);
  if (items.length > 0) return items;
  if (!isPulseStatusRecapMessage(normalizedText)) return [];
  return items;
}

export function channelRefMatchesSlackName(channelRef: string, slackChannelName: string) {
  return normalizePulseChannelRef(channelRef) === normalizePulseChannelRef(slackChannelName);
}
