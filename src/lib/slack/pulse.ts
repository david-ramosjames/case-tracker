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

/** Parse a #daily-pulse recap message into per-channel stage suggestions. */
export function parseDailyPulseMessage(text: string): ParsedPulseItem[] {
  if (!PULSE_HEADER.test(text)) return [];

  const items: ParsedPulseItem[] = [];
  const lines = text.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
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

    const suggestedStage = normalizePulseStageLabel(headerMatch[2]);
    let confidence: ConfidenceLevel = "Medium";
    let reason = "";
    let excerpt = "";

    const nextLine = (lines[index + 1] ?? "").trim();
    const confidenceMatch = nextLine.match(/\((\w+)\s+confidence\)/i);
    if (confidenceMatch) {
      const level = confidenceMatch[1].toLowerCase();
      confidence = level === "high" ? "High" : level === "low" ? "Low" : "Medium";
      const reasonMatch = nextLine.match(/\(\*([^*]+)\*\)/);
      if (reasonMatch) reason = reasonMatch[1].trim();
      index += 1;
    }

    const excerptLine = (lines[index + 1] ?? "").trim();
    const quotedMatch = excerptLine.match(/^[""](.+)[""]\s*[—-]/);
    if (quotedMatch) {
      excerpt = quotedMatch[1].trim();
      index += 1;
    } else if (!confidenceMatch && excerptLine.startsWith('"')) {
      excerpt = excerptLine.replace(/^[""]|[""].*$/g, "").trim();
      index += 1;
    }

    if (!excerpt && reason) excerpt = reason;

    items.push({ channelRef, suggestedStage, confidence, reason, excerpt });
    index += 1;
  }

  return items;
}

export function channelRefMatchesSlackName(channelRef: string, slackChannelName: string) {
  return normalizePulseChannelRef(channelRef) === normalizePulseChannelRef(slackChannelName);
}
