import { normalizeTargetQuarter } from "@/lib/case-options";
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
    const quarterMatch = line.match(
      /^(?:quarter|expected disbursement quarter|expected completion quarter|target quarter|disbursement quarter)\s*:\s*(.+)$/i,
    );
    if (quarterMatch) {
      tracker.targetResolutionQuarter = normalizeTargetQuarter(quarterMatch[1]) ?? undefined;
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

    const liabilityMatch = line.match(/^liability\s*:\s*(.+)$/i);
    if (liabilityMatch) {
      tracker.liability = liabilityMatch[1].trim();
      continue;
    }

    const policyMatch = line.match(/^policy\s*limits?\s*:\s*(.+)$/i);
    if (policyMatch) {
      const value = parseMoney(policyMatch[1]);
      if (value != null) tracker.policyLimits = value;
      continue;
    }

    const expectedLitMatch = line.match(/^(?:expected\s*lit(?:igation)?|expected litigation)\s*:\s*(.+)$/i);
    if (expectedLitMatch) {
      const normalized = expectedLitMatch[1].trim().toLowerCase();
      if (normalized.includes("litigation") || normalized === "lit") tracker.expectedLitigation = "Lit";
      else if (normalized.includes("expected")) tracker.expectedLitigation = "Expect";
      else if (normalized.includes("pre")) tracker.expectedLitigation = "Pre";
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

/** User-facing labels for Slack confirmation (matches reminder wording). */
export function describeSlackThreadAppliedLabels(patch: TrackerUpdateInput): string[] {
  const labels: string[] = [];
  if (patch.targetResolutionQuarter != null) labels.push("Expected disbursement quarter");
  if (patch.minimumValue != null) labels.push("Minimum value");
  if (patch.sources != null) labels.push("Sources & litigation detail");
  if (patch.injuries != null) labels.push("Injuries");
  if (patch.caseDescription != null) labels.push("Case description");
  if (patch.statusNotes != null) labels.push("Status notes");
  if (patch.caseStage != null) labels.push("Case stage");
  if (patch.estimatedFeeValue != null) labels.push("Projected firm fee");
  if (patch.confidenceLevel != null) labels.push("Confidence level");
  if (patch.policyLimits != null) labels.push("Policy limits");
  if (patch.liability != null) labels.push("Liability");
  if (patch.expectedLitigation != null) labels.push("Expected litigation");
  return labels;
}

export function formatSlackThreadAppliedMessage(labels: string[]) {
  if (labels.length === 0) return "Thanks — saved your update to the case tracker.";
  return `Thanks — updated the case tracker: *${labels.join("*, *")}*.`;
}

export function caseNumberFromSlackText(text: string) {
  const match = text.match(/case\s*#\s*([^\s)]+)/i);
  return match ? cleanCaseNumber(match[1]) : "";
}

function parseMoney(value: string) {
  const numeric = Number(value.replace(/[$,\s]/g, "").replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}
