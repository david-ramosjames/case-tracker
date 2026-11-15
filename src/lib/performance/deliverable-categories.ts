import { type PerformanceDeliverableType } from "@/lib/performance/types";

/** Top-level paralegal identify-work categories. */
export const PARALEGAL_CATEGORIES = [
  { key: "demand_sent" as const, label: "Send Demand" },
  { key: "lawsuit_filed" as const, label: "File Lawsuit" },
  { key: "discovery_responses" as const, label: "Discovery Responses" },
  { key: "lit_event_scheduled" as const, label: "Schedule Litigation Event" },
  { key: "aso" as const, label: "ASO" },
] as const;

export type ParalegalCategoryKey = (typeof PARALEGAL_CATEGORIES)[number]["key"];

/** Sub-types under Schedule Litigation Event (stored on hearingType). */
export const LIT_EVENT_KINDS = [
  { key: "deposition", label: "Deposition" },
  { key: "mediation", label: "Mediation" },
  { key: "hearing", label: "Hearing" },
  { key: "trial", label: "Trial" },
] as const;

export type LitEventKind = (typeof LIT_EVENT_KINDS)[number]["key"];

/** Further sub-type when lit event kind is Deposition (stored on documentLabel). */
export const DEPOSITION_PARTY_ROLES = ["Defendant", "Plaintiff", "Corp Rep", "Expert"] as const;

export type DepositionPartyRole = (typeof DEPOSITION_PARTY_ROLES)[number];

/** Attorney output identify-work types. */
export const ATTORNEY_OUTPUT_TYPES: Array<{
  key: PerformanceDeliverableType;
  label: string;
}> = [
  { key: "demand_sent", label: "Demands to be sent" },
  { key: "deposition", label: "Deposition" },
  { key: "mediation", label: "Mediation" },
  { key: "hearing", label: "Hearing" },
  { key: "hearing_trial", label: "Trial" },
  { key: "settlement", label: "Settlement" },
  { key: "other", label: "Other" },
];

export function litEventKindLabel(kind: string | null | undefined) {
  return LIT_EVENT_KINDS.find((k) => k.key === kind)?.label ?? kind ?? null;
}
