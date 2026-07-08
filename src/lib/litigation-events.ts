import { type CaseRecord, type LitigationEventKey, type LitigationEvents, type LitigationEventStatus } from "@/lib/types";
import { formatOptionalDate } from "@/lib/utils";

export const LITIGATION_EVENT_STATUS_OPTIONS = ["To Schedule", "Scheduled", "Complete"] as const satisfies LitigationEventStatus[];

export const LITIGATION_EVENT_DEFINITIONS: Array<{ key: LitigationEventKey; label: string }> = [
  { key: "plaintiffDeposition", label: "Plaintiff Deposition" },
  { key: "defendantDeposition", label: "Defendant Deposition" },
  { key: "mediation", label: "Mediation" },
  { key: "trial", label: "Trial" },
];

export const EMPTY_LITIGATION_EVENTS: LitigationEvents = {
  plaintiffDeposition: { date: null, status: null },
  defendantDeposition: { date: null, status: null },
  mediation: { date: null, status: null },
  trial: { date: null, status: null },
};

export function isLitigationTabCase(record: CaseRecord) {
  return record.tracker.caseStage === "Lit";
}

export function formatLitigationEventStatus(status: LitigationEventStatus | null | undefined) {
  return status ?? "—";
}

export function formatLitigationEventSummary(event: LitigationEvents[LitigationEventKey]) {
  const dateLabel = formatOptionalDate(event.date);
  const status = event.status;
  if (dateLabel === "—" && !status) return "—";
  if (dateLabel === "—") return status ?? "—";
  if (!status) return dateLabel;
  return `${dateLabel} · ${status}`;
}
