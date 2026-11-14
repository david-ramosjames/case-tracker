import { deliverableCredit } from "@/lib/performance/client-share";
import { pairDisplayName, pairsActiveOn } from "@/lib/performance/pairs";
import { type PairWeekCounts, type PairWeekRow } from "@/lib/performance/pair-metrics";
import { type PerformanceDeliverable, type PerformancePair } from "@/lib/performance/types";
import { weekEndFromStart } from "@/lib/performance/weeks";
import {
  weekPairDisplayName,
  type PerformanceWeekPair,
  type PerformanceWeekPairMetric,
} from "@/lib/performance/week-pairs";

export {
  PAIR_ATTORNEY_LIT_GOAL,
  PAIR_ATTORNEY_METRICS,
  PAIR_CHECK_METRICS,
  PAIR_CLOSING_METRICS,
  PAIR_PARALEGAL_METRICS,
  goalStatus,
  type GoalStatus,
  type PairAttorneyMetricKey,
  type PairClosingMetricKey,
  type PairParalegalMetricKey,
  type PairWeekCounts,
  type PairWeekRow,
} from "@/lib/performance/pair-metrics";

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
    const countsSource: PairWeekRow["countsSource"] = stored && stored.size > 0 ? "import" : "live";
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
