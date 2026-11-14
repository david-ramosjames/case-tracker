/** Client-safe week-pair shapes (no DB imports). */

export const WEEK_PAIR_METRIC_KEYS = [
  "demand_sent",
  "lawsuit_filed",
  "discovery_responses",
  "lit_event_scheduled",
  "deposition",
  "mediation",
  "hearing",
  "disengagement",
  "settlement",
  "disbursement",
] as const;

export type WeekPairMetricKey = (typeof WEEK_PAIR_METRIC_KEYS)[number];

export type PerformanceWeekPair = {
  id: string;
  weekStart: string;
  seatIndex: number;
  paralegalContactId: string | null;
  attorneyContactId: string | null;
  paralegalLabel: string | null;
  attorneyLabel: string | null;
  isVacant: boolean;
};

export type PerformanceWeekPairMetric = {
  id: string;
  weekPairId: string;
  metricKey: string;
  actualValue: number;
  source: "import" | "manual" | "live";
};
