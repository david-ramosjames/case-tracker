export const FIRM_WEEKLY_METRICS = [
  { key: "demand_sent", label: "DS OUT", defaultTarget: 5 },
  { key: "lawsuit_filed", label: "LAWSUIT", defaultTarget: 5 },
  { key: "discovery_responses", label: "DISCOVERY", defaultTarget: 10 },
  { key: "lit_event_scheduled", label: "LIT EVENTS", defaultTarget: 15 },
  { key: "deposition", label: "DEPOSITIONS", defaultTarget: 4 },
  { key: "mediation", label: "MEDIATIONS", defaultTarget: 4 },
  { key: "hearing", label: "HEARINGS/TRIAL", defaultTarget: 4 },
  { key: "settlement", label: "SETTLEMENTS", defaultTarget: 4 },
  { key: "disbursement", label: "DISBURSEMENTS", defaultTarget: 4 },
  { key: "new_case", label: "NEW CASES", defaultTarget: 10 },
] as const;

export type FirmWeeklyMetricKey = (typeof FIRM_WEEKLY_METRICS)[number]["key"];

export function defaultFirmWeeklyTarget(metricKey: string): number {
  return FIRM_WEEKLY_METRICS.find((m) => m.key === metricKey)?.defaultTarget ?? 0;
}
