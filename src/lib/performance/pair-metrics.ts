import { DEFAULT_ATTORNEY_TARGETS, DEFAULT_PARALEGAL_TARGETS } from "@/lib/performance/scoring";

/** Paralegal weekly check metrics (pair row). Client-safe — no DB imports. */
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
