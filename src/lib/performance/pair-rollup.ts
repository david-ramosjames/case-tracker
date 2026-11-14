import { pairDisplayName, pairsActiveOn } from "@/lib/performance/pairs";
import { DEFAULT_ATTORNEY_TARGETS, DEFAULT_PARALEGAL_TARGETS } from "@/lib/performance/scoring";
import { type PerformanceDeliverable, type PerformancePair } from "@/lib/performance/types";
import { weekEndFromStart } from "@/lib/performance/weeks";

/** Paralegal weekly check metrics (pair row). */
export const PAIR_PARALEGAL_METRICS = [
  {
    key: "demand_sent" as const,
    label: "DEMANDS",
    detail: "1 Demand SENT",
    goal: DEFAULT_PARALEGAL_TARGETS.demand_sent,
  },
  {
    key: "lawsuit_filed" as const,
    label: "LAWSUIT FILED",
    detail: "1 Lawsuit Drafted and Filed",
    goal: DEFAULT_PARALEGAL_TARGETS.lawsuit_filed,
  },
  {
    key: "discovery_responses" as const,
    label: "DISCOVERY",
    detail: "2 Set of Discovery Responses Answered",
    goal: DEFAULT_PARALEGAL_TARGETS.discovery_responses,
  },
  {
    key: "lit_event_scheduled" as const,
    label: "SCHEDULED LIT EVENT",
    detail: "3 Litigation Events Scheduled (Deposition, Mediation, Hearing)",
    goal: DEFAULT_PARALEGAL_TARGETS.lit_event_scheduled,
  },
];

/** Attorney lit completed — depositions, mediations, hearings (combined goal). */
export const PAIR_ATTORNEY_METRICS = [
  { key: "deposition" as const, label: "DEPOSITIONS", detail: "Depositions completed" },
  { key: "mediation" as const, label: "MEDIATIONS", detail: "Mediations completed" },
  { key: "hearing" as const, label: "HEARINGS", detail: "Hearings / trials completed" },
] as const;

export const PAIR_ATTORNEY_LIT_GOAL = DEFAULT_ATTORNEY_TARGETS.lit_completed_combined;

/** Closings per pair. */
export const PAIR_CLOSING_METRICS = [
  { key: "disengagement" as const, label: "DISENGAGEMENTS", detail: "Disengagements", goal: null as number | null },
  {
    key: "settlement" as const,
    label: "SETTLEMENTS",
    detail: "1 Settlement",
    goal: DEFAULT_ATTORNEY_TARGETS.settlement,
  },
  {
    key: "disbursement" as const,
    label: "DISBURSEMENTS",
    detail: "1 Disbursement",
    goal: DEFAULT_ATTORNEY_TARGETS.disbursement,
  },
];

export type PairParalegalMetricKey = (typeof PAIR_PARALEGAL_METRICS)[number]["key"];
export type PairAttorneyMetricKey = (typeof PAIR_ATTORNEY_METRICS)[number]["key"];
export type PairClosingMetricKey = (typeof PAIR_CLOSING_METRICS)[number]["key"];

export type PairWeekCounts = Record<
  PairParalegalMetricKey | PairAttorneyMetricKey | PairClosingMetricKey,
  number
>;

export type PairWeekRow = {
  pairId: string;
  label: string;
  attorneyName: string;
  paralegalName: string;
  attorneyContactId: string | null;
  paralegalContactId: string | null;
  counts: PairWeekCounts;
  attorneyLitTotal: number;
};

/** @deprecated use PAIR_PARALEGAL_METRICS */
export const PAIR_CHECK_METRICS = PAIR_PARALEGAL_METRICS;

export type GoalStatus = "behind" | "met" | "ahead" | "neutral";

export function goalStatus(actual: number, goal: number | null | undefined): GoalStatus {
  if (goal == null || goal <= 0) return "neutral";
  if (actual < goal) return "behind";
  if (actual > goal) return "ahead";
  return "met";
}

function emptyCounts(): PairWeekCounts {
  return {
    demand_sent: 0,
    lawsuit_filed: 0,
    discovery_responses: 0,
    lit_event_scheduled: 0,
    deposition: 0,
    mediation: 0,
    hearing: 0,
    disengagement: 0,
    settlement: 0,
    disbursement: 0,
  };
}

function completedInWeek(item: PerformanceDeliverable, weekStart: string, weekEnd: string) {
  if (item.workflowStatus !== "done" || !item.completedAt) return false;
  const day = item.completedAt.slice(0, 10);
  return day >= weekStart && day <= weekEnd;
}

function metricKeyForType(type: string): keyof PairWeekCounts | null {
  if (type === "demand_sent") return "demand_sent";
  if (type === "lawsuit_filed") return "lawsuit_filed";
  if (type === "discovery_responses") return "discovery_responses";
  if (type === "lit_event_scheduled") return "lit_event_scheduled";
  if (type === "deposition") return "deposition";
  if (type === "mediation") return "mediation";
  if (type === "hearing" || type === "hearing_trial") return "hearing";
  if (type === "disengagement") return "disengagement";
  if (type === "settlement") return "settlement";
  if (type === "disbursement") return "disbursement";
  return null;
}

/**
 * Attribute a completion to a pair only when both attorney and paralegal match.
 * Unmatched completions are excluded from pair cells (still visible on personal tabs).
 */
export function findMatchingPair(
  pairs: PerformancePair[],
  attorneyContactId: string | null,
  paralegalContactId: string | null,
): PerformancePair | null {
  if (!attorneyContactId || !paralegalContactId) return null;
  return (
    pairs.find(
      (pair) =>
        pair.attorneyContactId === attorneyContactId && pair.paralegalContactId === paralegalContactId,
    ) ?? null
  );
}

export function buildPairWeekRollup(input: {
  weekStart: string;
  pairs: PerformancePair[];
  deliverables: PerformanceDeliverable[];
  nameById: Map<string, string>;
}): PairWeekRow[] {
  const weekEnd = weekEndFromStart(input.weekStart);
  const active = pairsActiveOn(input.pairs, input.weekStart);
  const rows = active.map((pair) => {
    const names = pairDisplayName(pair, input.nameById);
    const counts = emptyCounts();
    return {
      pairId: pair.id,
      label: names.label,
      attorneyName: names.attorney,
      paralegalName: names.paralegal,
      attorneyContactId: pair.attorneyContactId,
      paralegalContactId: pair.paralegalContactId,
      counts,
      attorneyLitTotal: 0,
    } satisfies PairWeekRow;
  });
  const byId = new Map(rows.map((row) => [row.pairId, row]));

  for (const item of input.deliverables) {
    if (!completedInWeek(item, input.weekStart, weekEnd)) continue;
    const metric = metricKeyForType(item.deliverableType);
    if (!metric) continue;
    const pair = findMatchingPair(active, item.attorneyUserId, item.assigneeUserId);
    if (!pair) continue;
    const row = byId.get(pair.id);
    if (!row) continue;
    row.counts[metric] += 1;
  }

  for (const row of rows) {
    row.attorneyLitTotal = row.counts.deposition + row.counts.mediation + row.counts.hearing;
  }

  return rows;
}
