import { type CaseRecord, type LitigationEventKey, type LitigationEvents, type LitigationEventStatus } from "@/lib/types";

export const LITIGATION_EVENT_STATUS_OPTIONS = ["To Schedule", "Scheduled", "Complete"] as const satisfies LitigationEventStatus[];

export const LITIGATION_EVENT_DEFINITIONS: Array<{ key: LitigationEventKey; label: string }> = [
  { key: "plaintiffDeposition", label: "Plaintiff Deposition" },
  { key: "defendantDeposition", label: "Defendant Deposition" },
  { key: "mediation", label: "Mediation" },
  { key: "trial", label: "Trial" },
];

export const EMPTY_LITIGATION_EVENTS: LitigationEvents = {
  plaintiffDeposition: { person: "", status: null },
  defendantDeposition: { person: "", status: null },
  mediation: { person: "", status: null },
  trial: { person: "", status: null },
};

export function isLitigationTabCase(record: CaseRecord) {
  return record.tracker.caseStage === "Lit";
}

export function formatLitigationEventStatus(status: LitigationEventStatus | null | undefined) {
  return status ?? "—";
}

export function formatLitigationEventSummary(event: LitigationEvents[LitigationEventKey]) {
  const person = event.person.trim();
  const status = event.status;
  if (!person && !status) return "—";
  if (!person) return status ?? "—";
  if (!status) return person;
  return `${person} · ${status}`;
}
