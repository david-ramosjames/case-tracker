import { isCaseFullyDisbursed } from "@/lib/case-status";
import { deliverableCredit } from "@/lib/performance/client-share";
import {
  FIRM_WEEKLY_METRICS,
  type FirmWeekMetricCell,
  type FirmWeekRollup,
  type FirmWeeklyMetricKey,
} from "@/lib/performance/firm-metrics";
import { resolveTargetValue } from "@/lib/performance/targets";
import { type PerformanceDeliverable, type PerformanceTarget } from "@/lib/performance/types";
import {
  shiftWeekStart,
  weekEndFromStart,
  weekStartMondayCt,
} from "@/lib/performance/weeks";
import { type CaseRecord } from "@/lib/types";

export {
  FIRM_WEEKLY_METRICS,
  type FirmWeeklyMetricKey,
  defaultFirmWeeklyTarget,
  type FirmWeekMetricCell,
  type FirmWeekRollup,
} from "@/lib/performance/firm-metrics";
export { shiftWeekStart } from "@/lib/performance/weeks";

export function listRecentWeekStarts(currentWeekStart = weekStartMondayCt(), count = 16): string[] {
  const weeks: string[] = [];
  for (let i = 0; i < count; i += 1) {
    weeks.push(shiftWeekStart(currentWeekStart, -i));
  }
  return weeks;
}

function isoWeekNumber(weekStartYmd: string): number {
  const [y, m, d] = weekStartYmd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + yearStart.getUTCDay() + 1) / 7);
}

function weekLabel(weekStart: string) {
  const [, m, d] = weekStart.split("-");
  return `W${isoWeekNumber(weekStart)} · ${m}/${d}`;
}

function countDeliverableType(
  deliverables: PerformanceDeliverable[],
  types: string[],
  weekStart: string,
  weekEnd: string,
) {
  let total = 0;
  for (const item of deliverables) {
    if (item.workflowStatus !== "done" || !item.completedAt) continue;
    if (!types.includes(item.deliverableType)) continue;
    const day = item.completedAt.slice(0, 10);
    if (day < weekStart || day > weekEnd) continue;
    total += deliverableCredit(item.deliverableType, item.clientNameSnapshot);
  }
  return total;
}

function countSignedInWeek(records: CaseRecord[], weekStart: string, weekEnd: string) {
  return records.filter((record) => {
    const signed = record.shared.dateSigned;
    return Boolean(signed && signed >= weekStart && signed <= weekEnd);
  }).length;
}

export function countNewCasesInWeek(records: CaseRecord[], weekStart: string) {
  return countSignedInWeek(records, weekStart, weekEndFromStart(weekStart));
}

/** Sum imported/live pair metrics by week_start for firm history. */
export function sumStoredPairMetricsByWeek(input: {
  weekPairs: Array<{ id: string; weekStart: string; isVacant: boolean }>;
  metrics: Array<{ weekPairId: string; metricKey: string; actualValue: number }>;
}): Map<string, Partial<Record<FirmWeeklyMetricKey, number>>> {
  const pairWeek = new Map(input.weekPairs.map((p) => [p.id, p]));
  const byWeek = new Map<string, Partial<Record<FirmWeeklyMetricKey, number>>>();
  for (const metric of input.metrics) {
    const pair = pairWeek.get(metric.weekPairId);
    if (!pair || pair.isVacant) continue;
    if (!FIRM_WEEKLY_METRICS.some((m) => m.key === metric.metricKey)) continue;
    const key = metric.metricKey as FirmWeeklyMetricKey;
    if (key === "new_case") continue;
    const bucket = byWeek.get(pair.weekStart) ?? {};
    bucket[key] = (bucket[key] ?? 0) + (Number(metric.actualValue) || 0);
    byWeek.set(pair.weekStart, bucket);
  }
  return byWeek;
}

function countSettlementsInWeek(records: CaseRecord[], weekStart: string, weekEnd: string) {
  let count = 0;
  for (const record of records) {
    const settlementDate =
      record.tracker.result.settlementDate ??
      record.tracker.disbursements.find((d) => d.settlementDate)?.settlementDate ??
      null;
    if (!settlementDate) continue;
    if (settlementDate < weekStart || settlementDate > weekEnd) continue;
    if (record.tracker.caseStage === "Settled" || (record.tracker.result.attorneyFees ?? 0) > 0) {
      count += 1;
    }
  }
  return count;
}

function countDisbursementsInWeek(records: CaseRecord[], weekStart: string, weekEnd: string) {
  let count = 0;
  for (const record of records) {
    for (const d of record.tracker.disbursements) {
      if (!d.disburseDate) continue;
      if (d.disburseDate >= weekStart && d.disburseDate <= weekEnd) count += 1;
    }
    if (
      record.tracker.disbursements.length === 0 &&
      isCaseFullyDisbursed(record.tracker.result) &&
      record.tracker.result.disburseDate
    ) {
      const day = record.tracker.result.disburseDate;
      if (day >= weekStart && day <= weekEnd) count += 1;
    }
  }
  return count;
}

export function computeFirmWeekActuals(input: {
  weekStart: string;
  deliverables: PerformanceDeliverable[];
  records: CaseRecord[];
}): Record<FirmWeeklyMetricKey, number> {
  const weekEnd = weekEndFromStart(input.weekStart);
  const fromDeliverables = {
    demand_sent: countDeliverableType(input.deliverables, ["demand_sent"], input.weekStart, weekEnd),
    lawsuit_filed: countDeliverableType(input.deliverables, ["lawsuit_filed"], input.weekStart, weekEnd),
    discovery_responses: countDeliverableType(
      input.deliverables,
      ["discovery_responses"],
      input.weekStart,
      weekEnd,
    ),
    lit_event_scheduled: countDeliverableType(
      input.deliverables,
      ["lit_event_scheduled"],
      input.weekStart,
      weekEnd,
    ),
    deposition: countDeliverableType(input.deliverables, ["deposition"], input.weekStart, weekEnd),
    mediation: countDeliverableType(input.deliverables, ["mediation"], input.weekStart, weekEnd),
    hearing: countDeliverableType(
      input.deliverables,
      ["hearing", "hearing_trial"],
      input.weekStart,
      weekEnd,
    ),
    disengagement: countDeliverableType(
      input.deliverables,
      ["disengagement"],
      input.weekStart,
      weekEnd,
    ),
    settlement: countDeliverableType(input.deliverables, ["settlement"], input.weekStart, weekEnd),
    disbursement: countDeliverableType(input.deliverables, ["disbursement"], input.weekStart, weekEnd),
    new_case: countSignedInWeek(input.records, input.weekStart, weekEnd),
  };

  // Prefer Performance completions; fall back to Case Tracker settlement/disbursement dates.
  if (fromDeliverables.settlement === 0) {
    fromDeliverables.settlement = countSettlementsInWeek(input.records, input.weekStart, weekEnd);
  }
  if (fromDeliverables.disbursement === 0) {
    fromDeliverables.disbursement = countDisbursementsInWeek(input.records, input.weekStart, weekEnd);
  }

  return fromDeliverables;
}

function cellsFromActuals(input: {
  weekStart: string;
  actuals: Record<FirmWeeklyMetricKey, number>;
  targets: PerformanceTarget[];
}): FirmWeekRollup {
  const weekEnd = weekEndFromStart(input.weekStart);
  const metrics: FirmWeekMetricCell[] = FIRM_WEEKLY_METRICS.map((metric) => {
    const goal = resolveTargetValue({
      targets: input.targets,
      metricKey: metric.key,
      onDate: input.weekStart,
      periodGrain: "week",
    });
    const actual = input.actuals[metric.key] ?? 0;
    // Metrics with no weekly target (e.g. disengagements) are informational only.
    const status =
      goal <= 0 ? "met" : actual < goal ? "behind" : actual > goal ? "ahead" : "met";
    return {
      key: metric.key,
      label: metric.label,
      actual,
      goal,
      status,
    };
  });

  return {
    weekStart: input.weekStart,
    weekEnd,
    weekLabel: weekLabel(input.weekStart),
    metrics,
    behindCount: metrics.filter((m) => m.status === "behind").length,
  };
}

export function buildFirmWeekRollup(input: {
  weekStart: string;
  deliverables: PerformanceDeliverable[];
  records: CaseRecord[];
  targets: PerformanceTarget[];
}): FirmWeekRollup {
  return cellsFromActuals({
    weekStart: input.weekStart,
    actuals: computeFirmWeekActuals(input),
    targets: input.targets,
  });
}

/** Sum non-vacant pair/team cells into firm actuals (how firm activity is derived). */
export function sumPairRowsToFirmActuals(
  pairRows: Array<{ isVacant: boolean; counts: Partial<Record<string, number>> }>,
): Record<FirmWeeklyMetricKey, number> {
  const actuals = Object.fromEntries(FIRM_WEEKLY_METRICS.map((m) => [m.key, 0])) as Record<
    FirmWeeklyMetricKey,
    number
  >;
  for (const row of pairRows) {
    if (row.isVacant) continue;
    for (const metric of FIRM_WEEKLY_METRICS) {
      if (metric.key === "new_case") continue;
      actuals[metric.key] += Number(row.counts[metric.key]) || 0;
    }
  }
  return actuals;
}

/** Firm week from summed pair activity + new-case count from Case Tracker. */
export function buildFirmWeekRollupFromPairActuals(input: {
  weekStart: string;
  pairActuals: Partial<Record<FirmWeeklyMetricKey, number>>;
  newCaseCount: number;
  targets: PerformanceTarget[];
}): FirmWeekRollup {
  const actuals = Object.fromEntries(FIRM_WEEKLY_METRICS.map((m) => [m.key, 0])) as Record<
    FirmWeeklyMetricKey,
    number
  >;
  for (const metric of FIRM_WEEKLY_METRICS) {
    if (metric.key === "new_case") {
      actuals.new_case = input.newCaseCount;
    } else {
      actuals[metric.key] = Number(input.pairActuals[metric.key]) || 0;
    }
  }
  return cellsFromActuals({
    weekStart: input.weekStart,
    actuals,
    targets: input.targets,
  });
}

export function buildFirmWeekRollupFromPairRows(input: {
  weekStart: string;
  pairRows: Array<{ isVacant: boolean; counts: Partial<Record<string, number>> }>;
  newCaseCount: number;
  targets: PerformanceTarget[];
}): FirmWeekRollup {
  return buildFirmWeekRollupFromPairActuals({
    weekStart: input.weekStart,
    pairActuals: sumPairRowsToFirmActuals(input.pairRows),
    newCaseCount: input.newCaseCount,
    targets: input.targets,
  });
}

export function buildFirmWeekHistory(input: {
  weekStarts: string[];
  deliverables: PerformanceDeliverable[];
  records: CaseRecord[];
  targets: PerformanceTarget[];
}): FirmWeekRollup[] {
  return input.weekStarts.map((weekStart) =>
    buildFirmWeekRollup({
      weekStart,
      deliverables: input.deliverables,
      records: input.records,
      targets: input.targets,
    }),
  );
}
