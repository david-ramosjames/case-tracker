import { cleanCaseNumber } from "@/lib/csv/parse";
import { type TrackerUpdateInput } from "@/lib/types";

export type ParsedThreadUpdate = {
  tracker: TrackerUpdateInput;
  sharedNotes?: string;
};

export function parseSlackThreadUpdate(text: string): ParsedThreadUpdate | null {
  const tracker: TrackerUpdateInput = {};
  let sharedNotes: string | undefined;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const quarterMatch = line.match(/^(?:quarter|expected completion quarter|target quarter)\s*:\s*(.+)$/i);
    if (quarterMatch) {
      tracker.targetResolutionQuarter = normalizeQuarterInput(quarterMatch[1]);
      continue;
    }

    const minimumMatch = line.match(/^(?:minimum(?:\s+value)?|min(?:\s+value)?)\s*:\s*(.+)$/i);
    if (minimumMatch) {
      const value = parseMoney(minimumMatch[1]);
      if (value != null) {
        tracker.minimumValue = value;
        tracker.estimatedSettlementValue = value;
      }
      continue;
    }

    const sourcesMatch = line.match(/^sources\s*:\s*(.+)$/i);
    if (sourcesMatch) {
      tracker.sources = sourcesMatch[1];
      tracker.lastSourcesLitUpdatedAt = new Date().toISOString();
      continue;
    }

    const litNeededMatch = line.match(/^(?:lit events needed|litigation events)\s*:\s*(.+)$/i);
    if (litNeededMatch) {
      tracker.litEventsNeeded = litNeededMatch[1];
      tracker.lastSourcesLitUpdatedAt = new Date().toISOString();
      continue;
    }

    const litTimelineMatch = line.match(/^(?:timeline|lit timeline|lit events timeline)\s*:\s*(.+)$/i);
    if (litTimelineMatch) {
      tracker.litEventsTimeline = litTimelineMatch[1];
      tracker.lastSourcesLitUpdatedAt = new Date().toISOString();
      continue;
    }

    const injuriesMatch = line.match(/^injuries\s*:\s*(.+)$/i);
    if (injuriesMatch) {
      tracker.injuries = injuriesMatch[1];
      tracker.lastSourcesLitUpdatedAt = new Date().toISOString();
      continue;
    }

    const descriptionMatch = line.match(/^(?:description|case description)\s*:\s*(.+)$/i);
    if (descriptionMatch) {
      tracker.caseDescription = descriptionMatch[1];
      tracker.lastSourcesLitUpdatedAt = new Date().toISOString();
      continue;
    }

    const statusMatch = line.match(/^(?:status notes?|notes?)\s*:\s*(.+)$/i);
    if (statusMatch) {
      tracker.statusNotes = statusMatch[1];
      continue;
    }
  }

  if (Object.keys(tracker).length === 0) {
    const caseNumber = lines.find((line) => /^case\s*#/i.test(line));
    if (!caseNumber && lines.length >= 2) {
      sharedNotes = text.trim();
    }
    return null;
  }

  tracker.lastQuarterlyCheckInAt = new Date().toISOString();
  return { tracker, sharedNotes };
}

export function caseNumberFromSlackText(text: string) {
  const match = text.match(/case\s*#\s*([^\s)]+)/i);
  return match ? cleanCaseNumber(match[1]) : "";
}

function normalizeQuarterInput(value: string) {
  const trimmed = value.trim();
  if (/^\d{4}$/.test(trimmed)) return `${trimmed} Q4`;
  return trimmed;
}

function parseMoney(value: string) {
  const numeric = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}
