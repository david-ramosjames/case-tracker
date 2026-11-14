import { isCaseFullyDisbursed } from "@/lib/case-status";
import {
  FIRM_WEEKLY_METRICS,
  type FirmWeeklyMetricKey,
  defaultFirmWeeklyTarget,
} from "@/lib/performance/firm-metrics";
import { resolveTargetValue } from "@/lib/performance/targets";
import { type PerformanceDeliverable, type PerformanceTarget } from "@/lib/performance/types";
import { formatYmd, weekEndFromStart, weekStartMondayCt } from "@/lib/performance/weeks";
import { type CaseRecord } from "@/lib/types";

export { FIRM_WEEKLY_METRICS, type FirmWeeklyMetricKey, defaultFirmWeeklyTarget };

export type FirmWeekMetricCell = {
  key: FirmWeeklyMetricKey;
  label: string;
  actual: number;
  goal: number;
  status: "behind" | "met" | "ahead";
};

export type FirmWeekRollup = {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  metrics: FirmWeekMetricCell[];
  behindCount: number;
};

/** Shift a Monday YYYY-MM-DD by whole weeks. */
export function shiftWeekStart(weekStartYmd: string, weekDelta: number): string {
  const [y, m, d] = weekStartYmd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + weekDelta * 7));
  return formatYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

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
  return deliverables.filter((item) => {
    if (item.workflowStatus !== "done" || !item.completedAt) return false;
    if (!types.includes(item.deliverableType)) return false;
    const day = item.completedAt.slice(0, 10);
    return day >= weekStart && day <= weekEnd;
  }).length;
}

function countSignedInWeek(records: CaseRecord[], weekStart: string, weekEnd: string) {
  return records.filter((record) => {
    const signed = record.shared.dateSigned;
    return Boolean(signed && signed >= weekStart && signed <= weekEnd);
  }).length;
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

export function buildFirmWeekRollup(input: {
  weekStart: string;
  deliverables: PerformanceDeliverable[];
  records: CaseRecord[];
  targets: PerformanceTarget[];
}): FirmWeekRollup {
  const weekEnd = weekEndFromStart(input.weekStart);
  const actuals = computeFirmWeekActuals(input);
  const metrics: FirmWeekMetricCell[] = FIRM_WEEKLY_METRICS.map((metric) => {
    const goal = resolveTargetValue({
      targets: input.targets,
      metricKey: metric.key,
      onDate: input.weekStart,
      periodGrain: "week",
    });
    const actual = actuals[metric.key];
    const status = actual < goal ? "behind" : actual > goal ? "ahead" : "met";
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
