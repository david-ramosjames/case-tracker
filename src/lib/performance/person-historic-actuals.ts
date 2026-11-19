import {
  type HistoricWeekActuals,
} from "@/lib/performance/person-scorecard";
import {
  type PerformanceWeekPair,
  type PerformanceWeekPairMetric,
} from "@/lib/performance/week-pair-types";

/** Sum pair-seat metrics for one person across weeks (Individual sheet history). */
export function historicActualsByWeekForPerson(input: {
  role: "paralegal" | "attorney";
  personId: string;
  pairs: PerformanceWeekPair[];
  metrics: PerformanceWeekPairMetric[];
}): Map<string, HistoricWeekActuals> {
  const pairIds = new Set(
    input.pairs
      .filter((p) =>
        input.role === "paralegal"
          ? p.paralegalContactId === input.personId
          : p.attorneyContactId === input.personId,
      )
      .map((p) => p.id),
  );
  const weekByPairId = new Map(input.pairs.map((p) => [p.id, p.weekStart]));
  const byWeek = new Map<string, HistoricWeekActuals>();

  for (const metric of input.metrics) {
    if (!pairIds.has(metric.weekPairId)) continue;
    const weekStart = weekByPairId.get(metric.weekPairId);
    if (!weekStart) continue;
    const row = byWeek.get(weekStart) ?? {};
    row[metric.metricKey] = (Number(row[metric.metricKey]) || 0) + (Number(metric.actualValue) || 0);
    byWeek.set(weekStart, row);
  }
  return byWeek;
}
