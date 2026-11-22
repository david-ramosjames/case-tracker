import { getDocketFlowCaseUrl } from "@/lib/docketflow/links";
import { asYmdPrefix, weekEndFromStart } from "@/lib/performance/weeks";
import {
  type PerformanceCommitment,
  type PerformanceDeliverable,
  type PerformanceDeliverableType,
} from "@/lib/performance/types";
import { type CaseRecord, type DocketFlowScheduledEvent, type StageSuggestion } from "@/lib/types";

export type AutoProgressKind =
  | "lit_completed"
  | "lit_scheduled"
  | "settlement"
  | "disbursement"
  | "demand_sent"
  | "lawsuit_filed"
  | "disengagement";

export type AutoProgressEvidenceSource = "slack" | "docketflow" | "case_tracker";

export type AutoProgressCandidate = {
  id: string;
  kind: AutoProgressKind;
  deliverableType: PerformanceDeliverableType;
  caseId: string;
  caseNumber: string;
  clientName: string;
  label: string;
  signalDate: string;
  requiresVerification: boolean;
  /** Matched planned/in-progress deliverable when available. */
  deliverableId: string | null;
  docketEventId: string | null;
  stageSuggestionId: string | null;
  attorneyUserId: string | null;
  assigneeUserId: string | null;
  reason: string;
  /** Short evidence line (Slack excerpt, calendar title, etc.). */
  evidenceExcerpt: string | null;
  /** Link to Slack post, DocketFlow case, or Case Tracker case. */
  evidenceUrl: string | null;
  evidenceSource: AutoProgressEvidenceSource | null;
};

function evidenceFromSuggestion(suggestion: StageSuggestion): Pick<
  AutoProgressCandidate,
  "evidenceExcerpt" | "evidenceUrl" | "evidenceSource"
> {
  const excerpt = suggestion.excerpt?.trim() || null;
  if (suggestion.sourceUrl) {
    return { evidenceExcerpt: excerpt, evidenceUrl: suggestion.sourceUrl, evidenceSource: "slack" };
  }
  return { evidenceExcerpt: excerpt, evidenceUrl: null, evidenceSource: excerpt ? "slack" : null };
}

function evidenceFromDocket(input: {
  caseId: string;
  event: DocketFlowScheduledEvent;
  createdOrEventDay: string;
}): Pick<AutoProgressCandidate, "evidenceExcerpt" | "evidenceUrl" | "evidenceSource"> {
  const title = input.event.title?.trim() || "Litigation calendar event";
  return {
    evidenceExcerpt: `${title} · ${input.createdOrEventDay}`,
    evidenceUrl: getDocketFlowCaseUrl(input.caseId),
    evidenceSource: "docketflow",
  };
}

function evidenceFromCaseTracker(caseId: string, excerpt: string): Pick<
  AutoProgressCandidate,
  "evidenceExcerpt" | "evidenceUrl" | "evidenceSource"
> {
  return {
    evidenceExcerpt: excerpt,
    evidenceUrl: `/cases/${caseId}`,
    evidenceSource: "case_tracker",
  };
}

export type AutoCompleteAction = {
  deliverableId: string;
  completedAt: string;
  kind: "settlement" | "disbursement";
  caseNumber: string;
  label: string;
};

const LIT_COMPLETED_TYPES: PerformanceDeliverableType[] = [
  "deposition",
  "mediation",
  "hearing",
  "hearing_trial",
];

export function classifyLitDeliverableType(
  title: string | null | undefined,
  eventKind?: string | null,
): PerformanceDeliverableType {
  const hay = `${title ?? ""} ${eventKind ?? ""}`.toLowerCase();
  if (hay.includes("depo")) return "deposition";
  if (hay.includes("mediat")) return "mediation";
  if (/\b(jury\s+)?(bench\s+)?trial\b/.test(hay) && !/\b(deadline|notice|motion|expert|limine|exchange)\b/.test(hay)) {
    return "hearing_trial";
  }
  if (hay.includes("hearing") || hay.includes("pretrial")) return "hearing";
  if (hay.includes("arbitration")) return "hearing";
  return "hearing";
}

/** Titles that are deadlines / filings around a lit event — not the appearance itself. */
const LIT_PERIPHERAL_TITLE_RE =
  /\b(deadline|due date|notice|motion|limine|reminder|exchange of|expert witness|file\b|filing|discovery|disclosure|subpoena|continuance|exhibit|designation|proposal for|pre-?trial order|witness list|jury charge|charge conference)\b/i;

/** Title clearly is the attendance event. */
const LIT_MAIN_EVENT_TITLE_RE =
  /\b((jury|bench)\s+)?trial\b|\bdeposition\b|\bmediation\b|\bhearing\b|\barbitration\b|\bdepo\b/i;

/**
 * True for the litigation appearance itself (depo / mediation / hearing / trial),
 * not surrounding deadlines, notices, or motion filings.
 */
export function isLitigationAttendanceEvent(
  event: Pick<DocketFlowScheduledEvent, "title" | "eventKind" | "category" | "scheduleKind">,
) {
  // DocketFlow deadlines / date-range tasks are never the attendance event.
  if (event.scheduleKind === "deadline") return false;

  const title = (event.title ?? "").trim();
  const kind = (event.eventKind ?? "").trim().toLowerCase();
  const category = (event.category ?? "").trim().toLowerCase();
  const hay = `${title} ${kind} ${category}`;

  if (!/\b(depo(?:sition)?|mediat(?:ion)?|hearing|trial|arbitration)\b/i.test(hay)) return false;
  if (/\b(deadline|reminder|notice|task)\b/.test(kind)) return false;

  if (title && LIT_PERIPHERAL_TITLE_RE.test(title)) {
    // Keep only when the title itself is the main event (e.g. "Jury Trial", "Plaintiff Deposition").
    if (!LIT_MAIN_EVENT_TITLE_RE.test(title)) return false;
    // "Trial — File motions in limine" / "Trial deadline" still peripheral.
    if (/\b(file|deadline|motion|notice|exchange|expert)\b/i.test(title)) return false;
  }

  return true;
}

/** @deprecated Prefer isLitigationAttendanceEvent — kept for older call sites. */
export function isLitigationCalendarEvent(
  event: Pick<DocketFlowScheduledEvent, "title" | "eventKind" | "category" | "scheduleKind">,
) {
  return isLitigationAttendanceEvent(event);
}

function inWeek(day: string | null | undefined, weekStart: string) {
  const ymd = asYmdPrefix(day);
  if (!ymd) return false;
  return ymd >= weekStart && ymd <= weekEndFromStart(weekStart);
}

function openPlannedItems(
  deliverables: PerformanceDeliverable[],
  commitments: PerformanceCommitment[],
  weekStart: string,
) {
  const committedIds = new Set(
    commitments
      .filter((c) => c.weekStart === weekStart && (c.outcome === "promised" || c.outcome === "completed"))
      .map((c) => c.deliverableId),
  );
  return deliverables.filter(
    (d) =>
      (d.workflowStatus === "committed" || d.workflowStatus === "backlog") &&
      (committedIds.has(d.id) || d.workflowStatus === "committed"),
  );
}

function matchDeliverable(input: {
  open: PerformanceDeliverable[];
  caseId: string | null;
  caseNumber: string;
  types: PerformanceDeliverableType[];
  personId: string;
  role: "attorney" | "paralegal";
  docketEventId?: string | null;
}) {
  const personMatch = (d: PerformanceDeliverable) =>
    input.role === "attorney" ? d.attorneyUserId === input.personId : d.assigneeUserId === input.personId;

  if (input.docketEventId) {
    const byEvent = input.open.find(
      (d) =>
        personMatch(d) &&
        input.types.includes(d.deliverableType) &&
        (d.docketEventId === input.docketEventId || d.identityKey === `docket:${input.docketEventId}`),
    );
    if (byEvent) return byEvent;
  }

  return (
    input.open.find(
      (d) =>
        personMatch(d) &&
        input.types.includes(d.deliverableType) &&
        ((input.caseId && d.caseId === input.caseId) ||
          d.caseNumber.toLowerCase() === input.caseNumber.toLowerCase()),
    ) ?? null
  );
}

function settlementDateFor(record: CaseRecord) {
  return (
    record.tracker.result.settlementDate ??
    record.tracker.disbursements.find((d) => d.settlementDate)?.settlementDate ??
    null
  );
}

function disbursementDatesFor(record: CaseRecord) {
  const dates = record.tracker.disbursements
    .map((d) => d.disburseDate)
    .filter((d): d is string => Boolean(d));
  if (dates.length > 0) return [...new Set(dates)];
  if (record.tracker.result.disburseDate) return [record.tracker.result.disburseDate];
  return [];
}

/** Idempotency key so Case Tracker settlement/disbursement sync does not recreate rows. */
export function closingSignalDoneKey(
  type: "settlement" | "disbursement",
  caseId: string | null | undefined,
  day: string | null | undefined,
) {
  const ymd = asYmdPrefix(day);
  if (!caseId || !ymd) return null;
  return `${type}:${caseId}:${ymd}`;
}

/** Build confirmation queue + system auto-complete actions for a person's planned work. */
export function buildAutoProgress(input: {
  role: "attorney" | "paralegal";
  personId: string;
  weekStart: string;
  records: CaseRecord[];
  deliverables: PerformanceDeliverable[];
  commitments: PerformanceCommitment[];
  /** Docket events for assigned cases (include createdAt when available). */
  eventsByCaseId: Record<string, DocketFlowScheduledEvent[]>;
}): { candidates: AutoProgressCandidate[]; autoCompletes: AutoCompleteAction[] } {
  const open = openPlannedItems(input.deliverables, input.commitments, input.weekStart);
  const doneKeys = new Set(
    input.deliverables
      .filter((d) => d.workflowStatus === "done")
      .flatMap((d) => {
        const keys: Array<string | null> = [
          d.id,
          d.docketEventId ? `docket:${d.docketEventId}` : null,
          `${d.deliverableType}:${d.caseNumber}`,
        ];
        if (d.deliverableType === "settlement" || d.deliverableType === "disbursement") {
          keys.push(
            closingSignalDoneKey(
              d.deliverableType,
              d.caseId,
              asYmdPrefix(d.completedAt) || asYmdPrefix(d.plannedDate),
            ),
          );
        }
        return keys;
      })
      .filter(Boolean) as string[],
  );
  // Cancelled rows with a docket id mean the calendar signal was dismissed.
  const dismissedDocketIds = new Set(
    input.deliverables
      .filter((d) => d.workflowStatus === "cancelled" && d.docketEventId)
      .map((d) => d.docketEventId as string),
  );

  const candidates: AutoProgressCandidate[] = [];
  const autoCompletes: AutoCompleteAction[] = [];

  const assigned = input.records.filter((r) =>
    input.role === "attorney"
      ? r.shared.attorneyId === input.personId
      : r.shared.paralegalId === input.personId,
  );

  for (const record of assigned) {
    const events = input.eventsByCaseId[record.shared.id] ?? [];

    if (input.role === "attorney") {
      for (const event of events) {
        if (!isLitigationCalendarEvent(event)) continue;
        const eventDay = asYmdPrefix(event.date) || asYmdPrefix(event.startDateTime) || "";
        if (!inWeek(eventDay, input.weekStart)) continue;
        if (doneKeys.has(`docket:${event.id}`) || dismissedDocketIds.has(event.id)) continue;
        const type = classifyLitDeliverableType(event.title, event.eventKind);
        const matched = matchDeliverable({
          open,
          caseId: record.shared.id,
          caseNumber: record.shared.caseNumber,
          types: LIT_COMPLETED_TYPES,
          personId: input.personId,
          role: "attorney",
          docketEventId: event.id,
        });
        candidates.push({
          id: `lit-completed:${event.id}`,
          kind: "lit_completed",
          deliverableType: type,
          caseId: record.shared.id,
          caseNumber: record.shared.caseNumber,
          clientName: record.shared.clientName,
          label: event.title || "Litigation event",
          signalDate: eventDay,
          requiresVerification: true,
          deliverableId: matched?.id ?? null,
          docketEventId: event.id,
          stageSuggestionId: null,
          attorneyUserId: record.shared.attorneyId,
          assigneeUserId: record.shared.paralegalId,
          reason: matched
            ? "Past-week DocketFlow event matches a planned lit item — confirm it occurred."
            : "Past-week DocketFlow lit event — confirm to count (no matching plan item yet).",
          ...evidenceFromDocket({
            caseId: record.shared.id,
            event,
            createdOrEventDay: eventDay,
          }),
        });
      }

      const settleDay = settlementDateFor(record);
      if (inWeek(settleDay, input.weekStart)) {
        const signalKey = closingSignalDoneKey("settlement", record.shared.id, settleDay);
        const matched = matchDeliverable({
          open,
          caseId: record.shared.id,
          caseNumber: record.shared.caseNumber,
          types: ["settlement"],
          personId: input.personId,
          role: "attorney",
        });
        if (matched && !doneKeys.has(matched.id)) {
          autoCompletes.push({
            deliverableId: matched.id,
            completedAt: `${settleDay}T18:00:00.000Z`,
            kind: "settlement",
            caseNumber: record.shared.caseNumber,
            label: `Settlement dated ${settleDay}`,
          });
          if (signalKey) doneKeys.add(signalKey);
        } else if (!matched && signalKey && !doneKeys.has(signalKey)) {
          candidates.push({
            id: `settlement:${record.shared.id}:${settleDay}`,
            kind: "settlement",
            deliverableType: "settlement",
            caseId: record.shared.id,
            caseNumber: record.shared.caseNumber,
            clientName: record.shared.clientName,
            label: `Settlement (${settleDay})`,
            signalDate: settleDay!,
            requiresVerification: false,
            deliverableId: null,
            docketEventId: null,
            stageSuggestionId: null,
            attorneyUserId: record.shared.attorneyId,
            assigneeUserId: record.shared.paralegalId,
            reason: "Settlement date in week — counts from Case Tracker (no verification).",
            ...evidenceFromCaseTracker(
              record.shared.id,
              `Settlement date ${settleDay} on the case record`,
            ),
          });
          doneKeys.add(signalKey);
        }
      }

      for (const disburseDay of disbursementDatesFor(record)) {
        if (!inWeek(disburseDay, input.weekStart)) continue;
        const signalKey = closingSignalDoneKey("disbursement", record.shared.id, disburseDay);
        if (signalKey && doneKeys.has(signalKey)) continue;
        const matched = matchDeliverable({
          open,
          caseId: record.shared.id,
          caseNumber: record.shared.caseNumber,
          types: ["disbursement"],
          personId: input.personId,
          role: "attorney",
        });
        if (matched && !doneKeys.has(matched.id)) {
          autoCompletes.push({
            deliverableId: matched.id,
            completedAt: `${disburseDay}T18:00:00.000Z`,
            kind: "disbursement",
            caseNumber: record.shared.caseNumber,
            label: `Disbursement dated ${disburseDay}`,
          });
          if (signalKey) doneKeys.add(signalKey);
        } else if (!matched && signalKey) {
          candidates.push({
            id: `disbursement:${record.shared.id}:${disburseDay}`,
            kind: "disbursement",
            deliverableType: "disbursement",
            caseId: record.shared.id,
            caseNumber: record.shared.caseNumber,
            clientName: record.shared.clientName,
            label: `Disbursement (${disburseDay})`,
            signalDate: disburseDay,
            requiresVerification: false,
            deliverableId: null,
            docketEventId: null,
            stageSuggestionId: null,
            attorneyUserId: record.shared.attorneyId,
            assigneeUserId: record.shared.paralegalId,
            reason: "Disbursement date in week — counts from Case Tracker (no verification).",
            ...evidenceFromCaseTracker(
              record.shared.id,
              `Disbursement date ${disburseDay} on the case record`,
            ),
          });
          doneKeys.add(signalKey);
        }
      }
    }

    if (input.role === "paralegal") {
      for (const event of events) {
        if (!isLitigationCalendarEvent(event)) continue;
        // Scheduling credit requires DocketFlow created_at in the week (not event date).
        const createdDay = asYmdPrefix(event.createdAt) || "";
        if (!createdDay || !inWeek(createdDay, input.weekStart)) continue;
        if (doneKeys.has(`docket:${event.id}`) || dismissedDocketIds.has(event.id)) continue;
        const matched = matchDeliverable({
          open,
          caseId: record.shared.id,
          caseNumber: record.shared.caseNumber,
          types: ["lit_event_scheduled"],
          personId: input.personId,
          role: "paralegal",
          docketEventId: event.id,
        });
        candidates.push({
          id: `lit-scheduled:${event.id}`,
          kind: "lit_scheduled",
          deliverableType: "lit_event_scheduled",
          caseId: record.shared.id,
          caseNumber: record.shared.caseNumber,
          clientName: record.shared.clientName,
          label: event.title || "Litigation event scheduled",
          signalDate: createdDay,
          requiresVerification: true,
          deliverableId: matched?.id ?? null,
          docketEventId: event.id,
          stageSuggestionId: null,
          attorneyUserId: record.shared.attorneyId,
          assigneeUserId: record.shared.paralegalId,
          reason: matched
            ? "DocketFlow event created this week matches a planned schedule item — confirm."
            : "DocketFlow lit event created this week — confirm to count as scheduled.",
          ...evidenceFromDocket({
            caseId: record.shared.id,
            event,
            createdOrEventDay: createdDay,
          }),
        });
      }
    }

    // Demand / lawsuit signals from open/recent stage suggestions on this case.
    const recordSuggestions = record.tracker.detectedStageSignals ?? [];
    for (const suggestion of recordSuggestions) {
      if (suggestion.dismissedAt) continue;
      const signalDay = asYmdPrefix(suggestion.confirmedAt) || asYmdPrefix(suggestion.detectedAt) || "";
      const isOpen = !suggestion.confirmedAt && !suggestion.dismissedAt;
      if (!isOpen && !inWeek(signalDay, input.weekStart)) continue;

      if (suggestion.suggestedStage === "Dmd") {
        const matched = matchDeliverable({
          open,
          caseId: record.shared.id,
          caseNumber: record.shared.caseNumber,
          types: ["demand_sent"],
          personId: input.personId,
          role: input.role,
        });
        if (doneKeys.has(`demand_sent:${record.shared.caseNumber}`)) continue;
        candidates.push({
          id: `demand:${suggestion.id}`,
          kind: "demand_sent",
          deliverableType: "demand_sent",
          caseId: record.shared.id,
          caseNumber: record.shared.caseNumber,
          clientName: record.shared.clientName,
          label: "Demand sent",
          signalDate: signalDay || input.weekStart,
          requiresVerification: true,
          deliverableId: matched?.id ?? null,
          docketEventId: null,
          stageSuggestionId: suggestion.id,
          attorneyUserId: record.shared.attorneyId,
          assigneeUserId: record.shared.paralegalId,
          reason: matched
            ? "Slack/stage Demand signal matches planned demand — confirm before counting."
            : "Slack/stage Demand signal — confirm to count (or add manually).",
          ...evidenceFromSuggestion(suggestion),
        });
      }

      if (suggestion.suggestedStage === "Lit") {
        const matched = matchDeliverable({
          open,
          caseId: record.shared.id,
          caseNumber: record.shared.caseNumber,
          types: ["lawsuit_filed"],
          personId: input.personId,
          role: input.role,
        });
        if (doneKeys.has(`lawsuit_filed:${record.shared.caseNumber}`)) continue;
        candidates.push({
          id: `lawsuit:${suggestion.id}`,
          kind: "lawsuit_filed",
          deliverableType: "lawsuit_filed",
          caseId: record.shared.id,
          caseNumber: record.shared.caseNumber,
          clientName: record.shared.clientName,
          label: "Lawsuit filed",
          signalDate: signalDay || input.weekStart,
          requiresVerification: true,
          deliverableId: matched?.id ?? null,
          docketEventId: null,
          stageSuggestionId: suggestion.id,
          attorneyUserId: record.shared.attorneyId,
          assigneeUserId: record.shared.paralegalId,
          reason: matched
            ? "Slack/stage Litigation signal matches planned lawsuit — confirm before counting."
            : "Slack/stage Litigation signal — confirm to count (or add manually).",
          ...evidenceFromSuggestion(suggestion),
        });
      }
    }

    // Case in Lit with a planned lawsuit and no Lit suggestion — still needs verify.
    if (record.tracker.caseStage === "Lit") {
      const litHints = recordSuggestions.some((s) => s.suggestedStage === "Lit" && !s.dismissedAt);
      if (!litHints) {
        const matched = matchDeliverable({
          open,
          caseId: record.shared.id,
          caseNumber: record.shared.caseNumber,
          types: ["lawsuit_filed"],
          personId: input.personId,
          role: input.role,
        });
        if (matched && !doneKeys.has(matched.id)) {
          candidates.push({
            id: `lawsuit-stage:${record.shared.id}`,
            kind: "lawsuit_filed",
            deliverableType: "lawsuit_filed",
            caseId: record.shared.id,
            caseNumber: record.shared.caseNumber,
            clientName: record.shared.clientName,
            label: "Case in Litigation",
            signalDate: input.weekStart,
            requiresVerification: true,
            deliverableId: matched.id,
            docketEventId: null,
            stageSuggestionId: null,
            attorneyUserId: record.shared.attorneyId,
            assigneeUserId: record.shared.paralegalId,
            reason: "Case stage is Lit and a lawsuit item is planned — confirm filing occurred this week.",
            ...evidenceFromCaseTracker(
              record.shared.id,
              "Case stage is currently Lit on the case record",
            ),
          });
        }
      }
    }

    // Disengagements (attorney informational; verify).
    if (input.role === "attorney" && record.tracker.caseStage === "Disengaged") {
      const closedDay = asYmdPrefix(record.tracker.closedAt) || "";
      if (inWeek(closedDay, input.weekStart) || !closedDay) {
        const matched = matchDeliverable({
          open,
          caseId: record.shared.id,
          caseNumber: record.shared.caseNumber,
          types: ["disengagement"],
          personId: input.personId,
          role: "attorney",
        });
        candidates.push({
          id: `disengage:${record.shared.id}`,
          kind: "disengagement",
          deliverableType: "disengagement",
          caseId: record.shared.id,
          caseNumber: record.shared.caseNumber,
          clientName: record.shared.clientName,
          label: "Disengaged",
          signalDate: closedDay || input.weekStart,
          requiresVerification: true,
          deliverableId: matched?.id ?? null,
          docketEventId: null,
          stageSuggestionId: null,
          attorneyUserId: record.shared.attorneyId,
          assigneeUserId: record.shared.paralegalId,
          reason: "Case moved to Disengaged — confirm to count (no weekly target).",
          ...evidenceFromCaseTracker(
            record.shared.id,
            closedDay ? `Case closed / Disengaged on ${closedDay}` : "Case stage is Disengaged",
          ),
        });
      }
    }
  }

  return { candidates, autoCompletes };
}
