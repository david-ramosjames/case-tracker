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

/**
 * Top-level attorney Identify Work categories (includes Settlement).
 * `completed_lit_event` is a form-only category — it creates deposition/mediation/
 * hearing/hearing_trial deliverables marked done for last week (off-calendar completions).
 */
export const ATTORNEY_IDENTIFY_CATEGORIES = [
  { key: "demand_sent" as const, label: "Demand" },
  { key: "lawsuit_filed" as const, label: "Lawsuit" },
  { key: "lit_event_scheduled" as const, label: "Schedule Lit Event" },
  { key: "completed_lit_event" as const, label: "Completed Lit Event" },
  { key: "settlement" as const, label: "Settlement" },
  { key: "discovery_responses" as const, label: "Discovery Responses" },
  { key: "aso" as const, label: "ASO" },
  { key: "other" as const, label: "Other" },
] as const;

export type AttorneyIdentifyCategoryKey = (typeof ATTORNEY_IDENTIFY_CATEGORIES)[number]["key"];

/** Form categories that collect lit event Type / Sub-type fields. */
export function isLitEventIdentifyCategory(category: string) {
  return category === "lit_event_scheduled" || category === "completed_lit_event";
}

/** Type field under Schedule / Completed Lit Event. */
export const LIT_EVENT_KINDS = [
  { key: "deposition", label: "Deposition" },
  { key: "mediation", label: "Mediation" },
  { key: "hearing", label: "Hearing" },
  { key: "trial", label: "Trial" },
] as const;

export type LitEventKind = (typeof LIT_EVENT_KINDS)[number]["key"];

/** Sub-type when Type is Deposition (stored on documentLabel). */
export const DEPOSITION_PARTY_ROLES = ["Defendant", "Corp Rep", "Expert", "Plaintiff", "Other"] as const;

export type DepositionPartyRole = (typeof DEPOSITION_PARTY_ROLES)[number];

/** Map Identify Type → stored deliverable type for a completed (attended) lit event. */
export function completedLitEventDeliverableType(kind: LitEventKind): PerformanceDeliverableType {
  if (kind === "trial") return "hearing_trial";
  return kind;
}

/** @deprecated Prefer ATTORNEY_IDENTIFY_CATEGORIES — kept for older imports. */
export const ATTORNEY_OUTPUT_TYPES: Array<{
  key: PerformanceDeliverableType;
  label: string;
}> = ATTORNEY_IDENTIFY_CATEGORIES.filter((c) => c.key !== "completed_lit_event").map((c) => ({
  key: c.key as PerformanceDeliverableType,
  label: c.label,
}));

export function litEventKindLabel(kind: string | null | undefined) {
  return LIT_EVENT_KINDS.find((k) => k.key === kind)?.label ?? kind ?? null;
}
