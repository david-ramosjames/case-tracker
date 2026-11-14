import { deliverableCredit } from "@/lib/performance/client-share";
import { pairDisplayName, pairsActiveOn } from "@/lib/performance/pairs";
import { DEFAULT_ATTORNEY_TARGETS, DEFAULT_PARALEGAL_TARGETS } from "@/lib/performance/scoring";
import { type PerformanceDeliverable, type PerformancePair } from "@/lib/performance/types";
import { weekEndFromStart } from "@/lib/performance/weeks";
import {
  weekPairDisplayName,
  type PerformanceWeekPair,
  type PerformanceWeekPairMetric,
} from "@/lib/performance/week-pairs";

/** Paralegal weekly check metrics (pair row). */
export const PAIR_PARALEGAL_METRICS = [
  {
    key: "demand_sent" as const,
    label: "Demand sent",
    secondary: "Goal 1",
    goal: DEFAULT_PARALEGAL_TARGETS.demand_sent,
  },
  {
    key: "lawsuit_filed" as const,
    label: "Lawsuit filed",
    secondary: "Goal 1",
    goal: DEFAULT_PARALEGAL_TARGETS.lawsuit_filed,
  },
  {
    key: "discovery_responses" as const,
    label: "Discovery responses",
    secondary: "Goal 2",
    goal: DEFAULT_PARALEGAL_TARGETS.discovery_responses,
  },
  {
    key: "lit_event_scheduled" as const,
    label: "Events scheduled",
    secondary: "Goal 3 · depo / mediation / hearing",
    goal: DEFAULT_PARALEGAL_TARGETS.lit_event_scheduled,
  },
];

/** Attorney lit completed — depositions, mediations, hearings (combined goal). */
export const PAIR_ATTORNEY_METRICS = [
  { key: "deposition" as const, label: "Depositions", secondary: null as string | null },
  { key: "mediation" as const, label: "Mediations", secondary: null as string | null },
  { key: "hearing" as const, label: "Hearings", secondary: null as string | null },
] as const;

export const PAIR_ATTORNEY_LIT_GOAL = DEFAULT_ATTORNEY_TARGETS.lit_completed_combined;

/** Closings per pair. */
export const PAIR_CLOSING_METRICS = [
  {
    key: "disengagement" as const,
    label: "Disengagements",
    secondary: null as string | null,
    goal: null as number | null,
  },
  {
    key: "settlement" as const,
    label: "Settlements",
    secondary: "Goal 1",
    goal: DEFAULT_ATTORNEY_TARGETS.settlement,
  },
  {
    key: "disbursement" as const,
    label: "Disbursements",
    secondary: "Goal 1",
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
  isVacant: boolean;
  countsSource: "import" | "live" | "mixed";
};

/** @deprecated use PAIR_PARALEGAL_METRICS */
export const PAIR_CHECK_METRICS = PAIR_PARALEGAL_METRICS;

export type GoalStatus = "behind" | "met" | "ahead" | "neutral";

export function goalStatus(
  actual: number,
  goal: number | null | undefined,
  options?: { vacant?: boolean },
): GoalStatus {
  if (options?.vacant) return "neutral";
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

function findMatchingWeekPair(
  pairs: PerformanceWeekPair[],
  attorneyContactId: string | null,
  paralegalContactId: string | null,
): PerformanceWeekPair | null {
  if (!attorneyContactId || !paralegalContactId) return null;
  return (
    pairs.find(
      (pair) =>
        !pair.isVacant &&
        pair.attorneyContactId === attorneyContactId &&
        pair.paralegalContactId === paralegalContactId,
    ) ?? null
  );
}

/** Legacy effective-dated pairs rollup (still used when no week seats exist). */
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
      isVacant: false,
      countsSource: "live" as const,
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
    row.counts[metric] += deliverableCredit(item.deliverableType, item.clientNameSnapshot);
  }

  for (const row of rows) {
    row.attorneyLitTotal = row.counts.deposition + row.counts.mediation + row.counts.hearing;
  }

  return rows;
}

/**
 * Preferred rollup: per-week seats. Stored metrics (import/manual) win when present;
 * otherwise live deliverable completions fill the cells.
 */
export function buildWeekSeatRollup(input: {
  weekStart: string;
  weekPairs: PerformanceWeekPair[];
  metrics: PerformanceWeekPairMetric[];
  deliverables: PerformanceDeliverable[];
  nameById: Map<string, string>;
}): PairWeekRow[] {
  const weekEnd = weekEndFromStart(input.weekStart);
  const metricsByPair = new Map<string, Map<string, number>>();
  for (const metric of input.metrics) {
    if (!metricsByPair.has(metric.weekPairId)) metricsByPair.set(metric.weekPairId, new Map());
    metricsByPair.get(metric.weekPairId)!.set(metric.metricKey, metric.actualValue);
  }

  const rows = input.weekPairs.map((pair) => {
    const names = weekPairDisplayName(pair, input.nameById);
    const counts = emptyCounts();
    const stored = metricsByPair.get(pair.id);
    let countsSource: PairWeekRow["countsSource"] = stored && stored.size > 0 ? "import" : "live";
    if (stored) {
      for (const key of Object.keys(counts) as Array<keyof PairWeekCounts>) {
        if (stored.has(key)) counts[key] = stored.get(key) ?? 0;
      }
    }
    return {
      pairId: pair.id,
      label: names.label,
      attorneyName: names.attorney,
      paralegalName: names.paralegal,
      attorneyContactId: pair.attorneyContactId,
      paralegalContactId: pair.paralegalContactId,
      counts,
      attorneyLitTotal: 0,
      isVacant: pair.isVacant,
      countsSource,
    } satisfies PairWeekRow;
  });

  const byId = new Map(rows.map((row) => [row.pairId, row]));
  const needsLive = rows.some((row) => row.countsSource === "live" && !row.isVacant);

  if (needsLive) {
    for (const item of input.deliverables) {
      if (!completedInWeek(item, input.weekStart, weekEnd)) continue;
      const metric = metricKeyForType(item.deliverableType);
      if (!metric) continue;
      const pair = findMatchingWeekPair(input.weekPairs, item.attorneyUserId, item.assigneeUserId);
      if (!pair) continue;
      const row = byId.get(pair.id);
      if (!row || row.countsSource !== "live") continue;
      row.counts[metric] += deliverableCredit(item.deliverableType, item.clientNameSnapshot);
    }
  }

  for (const row of rows) {
    row.attorneyLitTotal = row.counts.deposition + row.counts.mediation + row.counts.hearing;
  }

  return rows;
}
