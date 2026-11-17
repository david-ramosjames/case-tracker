import { deliverableCredit } from "@/lib/performance/client-share";
import {
  DEFAULT_ATTORNEY_TARGETS,
  DEFAULT_PARALEGAL_TARGETS,
  scoreAttorneyWeek,
  scoreParalegalWeek,
} from "@/lib/performance/scoring";
import { resolveTargetValue } from "@/lib/performance/target-resolve";
import {
  type PerformanceCommitment,
  type PerformanceDeliverable,
  type PerformanceTarget,
} from "@/lib/performance/types";
import { formatWeekRangeLabel, shiftWeekStart, weekEndFromStart } from "@/lib/performance/weeks";

export const PARALEGAL_SCORE_METRICS = [
  { key: "demand_sent" as const, label: "Demands SENT", group: "Pre-Lit" },
  { key: "lawsuit_filed" as const, label: "Lawsuit Drafted and Filed", group: "Litigation" },
  {
    key: "discovery_responses" as const,
    label: "Set of Discovery Responses Answered",
    group: "Litigation",
  },
  {
    key: "lit_event_scheduled" as const,
    label: "Litigation events scheduled",
    group: "Scheduling",
  },
] as const;

export const ATTORNEY_SCORE_METRICS = [
  { key: "lit_completed_combined" as const, label: "Lit events completed (depo / med / hearing)" },
  { key: "settlement" as const, label: "Settlements" },
  { key: "disbursement" as const, label: "Disbursements" },
  { key: "demand_sent" as const, label: "Demands sent" },
  { key: "lawsuit_filed" as const, label: "Lawsuits filed" },
] as const;

export type ParalegalMetricKey = (typeof PARALEGAL_SCORE_METRICS)[number]["key"];
export type AttorneyMetricKey = (typeof ATTORNEY_SCORE_METRICS)[number]["key"];

export type ScoreMetricRow = {
  key: string;
  label: string;
  group?: string;
  target: number;
  actual: number;
  ratio: number | null;
};

export type PersonWeekScorecard = {
  weekStart: string;
  weekLabel: string;
  role: "paralegal" | "attorney";
  rows: ScoreMetricRow[];
  overall: number | null;
};

export type PersonScorecardBundle = {
  lastWeek: PersonWeekScorecard;
  thisWeekExpected: PersonWeekScorecard;
  trend: Array<{ weekStart: string; weekLabel: string; overall: number | null }>;
};

function emptyParalegalCounts(): Record<ParalegalMetricKey, number> {
  return {
    demand_sent: 0,
    lawsuit_filed: 0,
    discovery_responses: 0,
    lit_event_scheduled: 0,
  };
}

function emptyAttorneyCounts(): Record<AttorneyMetricKey, number> {
  return {
    lit_completed_combined: 0,
    settlement: 0,
    disbursement: 0,
    demand_sent: 0,
    lawsuit_filed: 0,
  };
}

function completedInWeek(item: PerformanceDeliverable, weekStart: string) {
  if (item.workflowStatus !== "done" || !item.completedAt) return false;
  const day = item.completedAt.slice(0, 10);
  return day >= weekStart && day <= weekEndFromStart(weekStart);
}

function creditFor(item: PerformanceDeliverable) {
  return deliverableCredit(item.deliverableType, item.clientNameSnapshot);
}

function addParalegalActual(counts: Record<ParalegalMetricKey, number>, item: PerformanceDeliverable) {
  const type = item.deliverableType;
  if (type === "demand_sent") counts.demand_sent += creditFor(item);
  else if (type === "lawsuit_filed") counts.lawsuit_filed += creditFor(item);
  else if (type === "discovery_responses") counts.discovery_responses += creditFor(item);
  else if (type === "lit_event_scheduled") counts.lit_event_scheduled += creditFor(item);
}

function addAttorneyActual(counts: Record<AttorneyMetricKey, number>, item: PerformanceDeliverable) {
  const type = item.deliverableType;
  if (type === "deposition" || type === "mediation" || type === "hearing" || type === "hearing_trial") {
    counts.lit_completed_combined += creditFor(item);
  } else if (type === "settlement") counts.settlement += creditFor(item);
  else if (type === "disbursement") counts.disbursement += creditFor(item);
  else if (type === "demand_sent") counts.demand_sent += creditFor(item);
  else if (type === "lawsuit_filed") counts.lawsuit_filed += creditFor(item);
}

function belongsToPerson(
  item: PerformanceDeliverable,
  personId: string,
  role: "paralegal" | "attorney",
) {
  return role === "attorney" ? item.attorneyUserId === personId : item.assigneeUserId === personId;
}

export function countParalegalCompletions(
  deliverables: PerformanceDeliverable[],
  personId: string,
  weekStart: string,
) {
  const counts = emptyParalegalCounts();
  for (const item of deliverables) {
    if (!belongsToPerson(item, personId, "paralegal")) continue;
    if (!completedInWeek(item, weekStart)) continue;
    addParalegalActual(counts, item);
  }
  return counts;
}

export function countAttorneyCompletions(
  deliverables: PerformanceDeliverable[],
  personId: string,
  weekStart: string,
) {
  const counts = emptyAttorneyCounts();
  for (const item of deliverables) {
    if (!belongsToPerson(item, personId, "attorney")) continue;
    if (!completedInWeek(item, weekStart)) continue;
    addAttorneyActual(counts, item);
  }
  return counts;
}

/** Expected = items committed for the week (still open or already done). */
export function countParalegalExpected(
  deliverables: PerformanceDeliverable[],
  commitments: PerformanceCommitment[],
  personId: string,
  weekStart: string,
) {
  const committedIds = new Set(
    commitments.filter((c) => c.weekStart === weekStart && c.outcome !== "cancelled").map((c) => c.deliverableId),
  );
  const counts = emptyParalegalCounts();
  for (const item of deliverables) {
    if (!belongsToPerson(item, personId, "paralegal")) continue;
    if (!committedIds.has(item.id)) continue;
    addParalegalActual(counts, item);
  }
  return counts;
}

export function countAttorneyExpected(
  deliverables: PerformanceDeliverable[],
  commitments: PerformanceCommitment[],
  personId: string,
  weekStart: string,
) {
  const committedIds = new Set(
    commitments.filter((c) => c.weekStart === weekStart && c.outcome !== "cancelled").map((c) => c.deliverableId),
  );
  const counts = emptyAttorneyCounts();
  for (const item of deliverables) {
    if (!belongsToPerson(item, personId, "attorney")) continue;
    if (!committedIds.has(item.id)) continue;
    addAttorneyActual(counts, item);
  }
  return counts;
}

function resolveParalegalTargets(
  targets: PerformanceTarget[],
  personId: string,
  onDate: string,
): Record<ParalegalMetricKey, number> {
  const out = emptyParalegalCounts();
  for (const key of Object.keys(out) as ParalegalMetricKey[]) {
    out[key] = resolveTargetValue({
      targets,
      metricKey: key,
      onDate,
      userId: personId,
      role: "paralegal",
      periodGrain: "week",
    });
    if (out[key] === 0 && key in DEFAULT_PARALEGAL_TARGETS) {
      // resolveTargetValue already applies defaults; keep explicit fallback
      out[key] = DEFAULT_PARALEGAL_TARGETS[key];
    }
  }
  return out;
}

function resolveAttorneyTargets(
  targets: PerformanceTarget[],
  personId: string,
  onDate: string,
): Record<AttorneyMetricKey, number> {
  const out = emptyAttorneyCounts();
  for (const key of Object.keys(out) as AttorneyMetricKey[]) {
    out[key] = resolveTargetValue({
      targets,
      metricKey: key,
      onDate,
      userId: personId,
      role: "attorney",
      periodGrain: "week",
    });
    if (out[key] === 0 && key in DEFAULT_ATTORNEY_TARGETS) {
      out[key] = DEFAULT_ATTORNEY_TARGETS[key as keyof typeof DEFAULT_ATTORNEY_TARGETS];
    }
  }
  return out;
}

function buildParalegalScorecard(
  weekStart: string,
  counts: Record<ParalegalMetricKey, number>,
  goals: Record<ParalegalMetricKey, number>,
): PersonWeekScorecard {
  const scored = scoreParalegalWeek({
    actualDemands: counts.demand_sent,
    targetDemands: goals.demand_sent,
    actualLawsuit: counts.lawsuit_filed,
    targetLawsuit: goals.lawsuit_filed,
    actualDiscovery: counts.discovery_responses,
    targetDiscovery: goals.discovery_responses,
    actualLitEventsScheduled: counts.lit_event_scheduled,
    targetLitEventsScheduled: goals.lit_event_scheduled,
  });
  return {
    weekStart,
    weekLabel: formatWeekRangeLabel(weekStart),
    role: "paralegal",
    rows: PARALEGAL_SCORE_METRICS.map((m) => ({
      key: m.key,
      label: m.label,
      group: m.group,
      target: goals[m.key],
      actual: counts[m.key],
      ratio: goals[m.key] > 0 ? counts[m.key] / goals[m.key] : null,
    })),
    overall: scored.overall,
  };
}

function buildAttorneyScorecard(
  weekStart: string,
  counts: Record<AttorneyMetricKey, number>,
  goals: Record<AttorneyMetricKey, number>,
): PersonWeekScorecard {
  const scored = scoreAttorneyWeek({
    actualLitCompleted: counts.lit_completed_combined,
    targetLitCompleted: goals.lit_completed_combined,
    actualSettlements: counts.settlement,
    targetSettlements: goals.settlement,
    actualDisbursements: counts.disbursement,
    targetDisbursements: goals.disbursement,
    actualDemands: counts.demand_sent,
    targetDemands: goals.demand_sent,
    actualLawsuit: counts.lawsuit_filed,
    targetLawsuit: goals.lawsuit_filed,
  });
  const ratioParts = [
    scored.litCompleted,
    scored.settlements,
    scored.disbursements,
    scored.demands,
    scored.lawsuit,
  ].filter((v): v is number => typeof v === "number");
  const overall =
    ratioParts.length > 0 ? ratioParts.reduce((a, b) => a + b, 0) / ratioParts.length : null;
  return {
    weekStart,
    weekLabel: formatWeekRangeLabel(weekStart),
    role: "attorney",
    rows: ATTORNEY_SCORE_METRICS.map((m) => ({
      key: m.key,
      label: m.label,
      target: goals[m.key],
      actual: counts[m.key],
      ratio:
        m.key === "lit_completed_combined"
          ? scored.litCompleted
          : m.key === "settlement"
            ? scored.settlements
            : m.key === "disbursement"
              ? scored.disbursements
              : m.key === "demand_sent"
                ? scored.demands
                : scored.lawsuit,
    })),
    overall,
  };
}

export function buildPersonScorecardBundle(input: {
  role: "paralegal" | "attorney";
  personId: string;
  weekStart: string;
  lastWeekStart: string;
  deliverables: PerformanceDeliverable[];
  commitments: PerformanceCommitment[];
  targets: PerformanceTarget[];
  trendWeeks?: number;
}): PersonScorecardBundle {
  const trendWeeks = input.trendWeeks ?? 13;
  if (input.role === "paralegal") {
    const lastGoals = resolveParalegalTargets(input.targets, input.personId, input.lastWeekStart);
    const thisGoals = resolveParalegalTargets(input.targets, input.personId, input.weekStart);
    const lastCounts = countParalegalCompletions(input.deliverables, input.personId, input.lastWeekStart);
    const expectedCounts = countParalegalExpected(
      input.deliverables,
      input.commitments,
      input.personId,
      input.weekStart,
    );
    const trend: PersonScorecardBundle["trend"] = [];
    for (let i = trendWeeks - 1; i >= 0; i -= 1) {
      const ws = shiftWeekStart(input.weekStart, -i);
      // Skip current open week in trend (use completed weeks only through last week)
      if (ws >= input.weekStart) continue;
      const goals = resolveParalegalTargets(input.targets, input.personId, ws);
      const counts = countParalegalCompletions(input.deliverables, input.personId, ws);
      const card = buildParalegalScorecard(ws, counts, goals);
      trend.push({ weekStart: ws, weekLabel: card.weekLabel, overall: card.overall });
    }
    return {
      lastWeek: buildParalegalScorecard(input.lastWeekStart, lastCounts, lastGoals),
      thisWeekExpected: buildParalegalScorecard(input.weekStart, expectedCounts, thisGoals),
      trend,
    };
  }

  const lastGoals = resolveAttorneyTargets(input.targets, input.personId, input.lastWeekStart);
  const thisGoals = resolveAttorneyTargets(input.targets, input.personId, input.weekStart);
  const lastCounts = countAttorneyCompletions(input.deliverables, input.personId, input.lastWeekStart);
  const expectedCounts = countAttorneyExpected(
    input.deliverables,
    input.commitments,
    input.personId,
    input.weekStart,
  );
  const trend: PersonScorecardBundle["trend"] = [];
  for (let i = trendWeeks - 1; i >= 0; i -= 1) {
    const ws = shiftWeekStart(input.weekStart, -i);
    if (ws >= input.weekStart) continue;
    const goals = resolveAttorneyTargets(input.targets, input.personId, ws);
    const counts = countAttorneyCompletions(input.deliverables, input.personId, ws);
    const card = buildAttorneyScorecard(ws, counts, goals);
    trend.push({ weekStart: ws, weekLabel: card.weekLabel, overall: card.overall });
  }
  return {
    lastWeek: buildAttorneyScorecard(input.lastWeekStart, lastCounts, lastGoals),
    thisWeekExpected: buildAttorneyScorecard(input.weekStart, expectedCounts, thisGoals),
    trend,
  };
}

export function formatAttainmentPct(ratio: number | null) {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${Math.round(ratio * 100)}%`;
}
