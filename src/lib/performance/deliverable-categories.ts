import { type PerformanceDeliverableType } from "@/lib/performance/types";

/** Top-level paralegal Identify Work categories. */
export const PARALEGAL_CATEGORIES = [
  { key: "demand_sent" as const, label: "Demand" },
  { key: "lawsuit_filed" as const, label: "Lawsuit" },
  { key: "lit_event_scheduled" as const, label: "Schedule Lit Event" },
  { key: "discovery_responses" as const, label: "Discovery Responses" },
  { key: "aso" as const, label: "ASO" },
  { key: "other" as const, label: "Other" },
] as const;

export type ParalegalCategoryKey = (typeof PARALEGAL_CATEGORIES)[number]["key"];

/** Top-level attorney Identify Work categories (includes Settlement). */
export const ATTORNEY_IDENTIFY_CATEGORIES = [
  { key: "demand_sent" as const, label: "Demand" },
  { key: "lawsuit_filed" as const, label: "Lawsuit" },
  { key: "lit_event_scheduled" as const, label: "Schedule Lit Event" },
  { key: "settlement" as const, label: "Settlement" },
  { key: "discovery_responses" as const, label: "Discovery Responses" },
  { key: "aso" as const, label: "ASO" },
  { key: "other" as const, label: "Other" },
] as const;

export type AttorneyIdentifyCategoryKey = (typeof ATTORNEY_IDENTIFY_CATEGORIES)[number]["key"];

/** Type field under Schedule Lit Event. */
export const LIT_EVENT_KINDS = [
  { key: "deposition", label: "Deposition" },
  { key: "mediation", label: "Mediation" },
  { key: "hearing", label: "Hearing" },
  { key: "trial", label: "Trial" },
] as const;

export type LitEventKind = (typeof LIT_EVENT_KINDS)[number]["key"];

/** Sub-type when Type is Deposition (stored on documentLabel). */
export const DEPOSITION_PARTY_ROLES = ["Defendant", "Corp Rep", "Expert", "Plaintiff"] as const;

export type DepositionPartyRole = (typeof DEPOSITION_PARTY_ROLES)[number];

/** @deprecated Prefer ATTORNEY_IDENTIFY_CATEGORIES — kept for older imports. */
export const ATTORNEY_OUTPUT_TYPES: Array<{
  key: PerformanceDeliverableType;
  label: string;
}> = ATTORNEY_IDENTIFY_CATEGORIES.map((c) => ({ key: c.key, label: c.label }));

export function litEventKindLabel(kind: string | null | undefined) {
  return LIT_EVENT_KINDS.find((k) => k.key === kind)?.label ?? kind ?? null;
}
