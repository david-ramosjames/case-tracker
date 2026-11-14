import { pairDisplayName, pairsActiveOn } from "@/lib/performance/pairs";
import { DEFAULT_PARALEGAL_TARGETS } from "@/lib/performance/scoring";
import { type PerformanceDeliverable, type PerformancePair } from "@/lib/performance/types";
import { weekEndFromStart } from "@/lib/performance/weeks";

export const PAIR_CHECK_METRICS = [
  { key: "demand_sent" as const, label: "DEMANDS", weight: DEFAULT_PARALEGAL_TARGETS.demand_sent },
  { key: "lawsuit_filed" as const, label: "LAWSUIT FILED", weight: DEFAULT_PARALEGAL_TARGETS.lawsuit_filed },
  {
    key: "discovery_responses" as const,
    label: "DISCOVERY",
    weight: DEFAULT_PARALEGAL_TARGETS.discovery_responses,
  },
  {
    key: "lit_event_scheduled" as const,
    label: "SCHEDULED LIT EVENT",
    weight: DEFAULT_PARALEGAL_TARGETS.lit_event_scheduled,
  },
];

export type PairCheckMetricKey = (typeof PAIR_CHECK_METRICS)[number]["key"];

export type PairWeekCounts = Record<PairCheckMetricKey, number>;

export type PairWeekRow = {
  pairId: string;
  label: string;
  attorneyName: string;
  paralegalName: string;
  attorneyContactId: string | null;
  paralegalContactId: string | null;
  counts: PairWeekCounts;
};

function emptyCounts(): PairWeekCounts {
  return {
    demand_sent: 0,
    lawsuit_filed: 0,
    discovery_responses: 0,
    lit_event_scheduled: 0,
  };
}

function completedInWeek(item: PerformanceDeliverable, weekStart: string, weekEnd: string) {
  if (item.workflowStatus !== "done" || !item.completedAt) return false;
  const day = item.completedAt.slice(0, 10);
  return day >= weekStart && day <= weekEnd;
}

function metricKeyForType(type: string): PairCheckMetricKey | null {
  if (type === "demand_sent") return "demand_sent";
  if (type === "lawsuit_filed") return "lawsuit_filed";
  if (type === "discovery_responses") return "discovery_responses";
  if (type === "lit_event_scheduled") return "lit_event_scheduled";
  return null;
}

/**
 * Attribute a completion to a pair only when both attorney and paralegal match.
 * Unmatched completions are excluded from pair cells (still visible on My Work).
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
    return {
      pairId: pair.id,
      label: names.label,
      attorneyName: names.attorney,
      paralegalName: names.paralegal,
      attorneyContactId: pair.attorneyContactId,
      paralegalContactId: pair.paralegalContactId,
      counts: emptyCounts(),
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

  return rows;
}
