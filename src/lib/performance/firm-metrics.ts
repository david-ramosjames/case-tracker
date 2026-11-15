export const FIRM_WEEKLY_METRICS = [
  { key: "demand_sent", label: "DS OUT", defaultTarget: 5 },
  { key: "lawsuit_filed", label: "LAWSUIT", defaultTarget: 5 },
  { key: "discovery_responses", label: "DISCOVERY", defaultTarget: 10 },
  { key: "lit_event_scheduled", label: "LIT EVENTS", defaultTarget: 15 },
  { key: "deposition", label: "DEPOSITIONS", defaultTarget: 4 },
  { key: "mediation", label: "MEDIATIONS", defaultTarget: 4 },
  { key: "hearing", label: "HEARINGS/TRIAL", defaultTarget: 4 },
  { key: "disengagement", label: "DISENGAGE", defaultTarget: 0 },
  { key: "settlement", label: "SETTLEMENTS", defaultTarget: 4 },
  { key: "disbursement", label: "DISBURSEMENTS", defaultTarget: 4 },
  { key: "new_case", label: "NEW CASES", defaultTarget: 10 },
] as const;

export type FirmWeeklyMetricKey = (typeof FIRM_WEEKLY_METRICS)[number]["key"];

/** Visual groupings on Team → Firm activity; `tab` jumps to the matching Team tab. */
export const FIRM_METRIC_GROUPS = [
  {
    id: "paralegals" as const,
    label: "Paralegals",
    tab: "paralegals" as const,
    keys: ["demand_sent", "lawsuit_filed", "discovery_responses", "lit_event_scheduled"] as const,
  },
  {
    id: "attorneys" as const,
    label: "Attorneys",
    tab: "attorneys" as const,
    keys: ["deposition", "mediation", "hearing"] as const,
  },
  {
    id: "closings" as const,
    label: "Closings",
    tab: "closings" as const,
    keys: ["disengagement", "settlement", "disbursement"] as const,
  },
];

export function defaultFirmWeeklyTarget(metricKey: string): number {
  return FIRM_WEEKLY_METRICS.find((m) => m.key === metricKey)?.defaultTarget ?? 0;
}

/** Client-safe firm week rollup shapes (computed on the server, rendered on the client). */
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
