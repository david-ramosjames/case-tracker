import {
  classifyLitDeliverableType,
  isLitigationCalendarEvent,
} from "@/lib/performance/auto-progress";
import {
  type PerformanceCommitment,
  type PerformanceDeliverable,
  type PerformanceDeliverableType,
} from "@/lib/performance/types";
import { isDateInWeek, shiftWeekStart, weekEndFromStart } from "@/lib/performance/weeks";
import { type CaseRecord, type DocketFlowScheduledEvent } from "@/lib/types";

const LIT_COMPLETED_TYPES: PerformanceDeliverableType[] = [
  "deposition",
  "mediation",
  "hearing",
  "hearing_trial",
];

/** Settlements + completed lit event types — attorney Output board only. */
export function isAttorneyOnlyBoardType(type: PerformanceDeliverableType) {
  return type === "settlement" || LIT_COMPLETED_TYPES.includes(type);
}

/** Paralegals see shared work only (demands, lawsuits, schedule lit, discovery, etc.). */
export function isVisibleOnParalegalBoard(d: Pick<PerformanceDeliverable, "deliverableType">) {
  return !isAttorneyOnlyBoardType(d.deliverableType);
}

export type AttorneyBoardBuckets = {
  finished: PerformanceDeliverable[];
  committed: PerformanceDeliverable[];
  backlog: PerformanceDeliverable[];
};

function settlementDateFor(record: CaseRecord) {
  return (
    record.tracker.result.settlementDate ??
    record.tracker.disbursements.find((d) => d.settlementDate)?.settlementDate ??
    null
  );
}

function eventDay(event: DocketFlowScheduledEvent) {
  return (event.date || event.startDateTime || "").slice(0, 10);
}

function syntheticBase(partial: {
  id: string;
  caseId: string;
  caseNumber: string;
  clientName: string | null;
  deliverableType: PerformanceDeliverableType;
  attorneyUserId: string | null;
  assigneeUserId: string | null;
  workflowStatus: PerformanceDeliverable["workflowStatus"];
  plannedDate: string | null;
  completedAt: string | null;
  createdAt: string;
  identifiedAt: string;
  docketEventId: string | null;
  documentLabel: string | null;
  notes: string | null;
  identityKey: string;
  identityLabel: string | null;
}): PerformanceDeliverable {
  return {
    id: partial.id,
    caseId: partial.caseId,
    caseNumber: partial.caseNumber,
    clientNameSnapshot: partial.clientName,
    deliverableType: partial.deliverableType,
    identityKey: partial.identityKey,
    identityLabel: partial.identityLabel,
    attorneyUserId: partial.attorneyUserId,
    assigneeUserId: partial.assigneeUserId,
    identifiedAt: partial.identifiedAt,
    identifiedBy: null,
    workflowStatus: partial.workflowStatus,
    requestedCompletionDate: null,
    plannedDate: partial.plannedDate,
    completedAt: partial.completedAt,
    completionSource: null,
    rescheduleCount: 0,
    litPersonName: null,
    hearingType: null,
    documentLabel: partial.documentLabel,
    roundNumber: null,
    recipientLabel: null,
    docketEventId: partial.docketEventId,
    notes: partial.notes,
    cancelReason: null,
    createdAt: partial.createdAt,
    updatedAt: partial.createdAt,
  };
}

function fromDocketEvent(input: {
  event: DocketFlowScheduledEvent;
  record: CaseRecord;
  workflowStatus: PerformanceDeliverable["workflowStatus"];
  completedAt: string | null;
}): PerformanceDeliverable {
  const day = eventDay(input.event);
  const created = input.event.createdAt || `${day}T12:00:00.000Z`;
  const type = classifyLitDeliverableType(input.event.title, input.event.eventKind);
  return syntheticBase({
    id: `docket:${input.event.id}`,
    caseId: input.record.shared.id,
    caseNumber: input.record.shared.caseNumber,
    clientName: input.record.shared.clientName,
    deliverableType: type,
    attorneyUserId: input.record.shared.attorneyId,
    assigneeUserId: input.record.shared.paralegalId,
    workflowStatus: input.workflowStatus,
    plannedDate: day || null,
    completedAt: input.completedAt,
    createdAt: created,
    identifiedAt: created,
    docketEventId: input.event.id,
    documentLabel: input.event.title || null,
    notes: "From DocketFlow calendar",
    identityKey: `docket:${input.event.id}`,
    identityLabel: input.event.title || "Litigation event",
  });
}

function fromSettlement(input: {
  record: CaseRecord;
  settleDay: string;
  workflowStatus: PerformanceDeliverable["workflowStatus"];
}): PerformanceDeliverable {
  const iso = `${input.settleDay}T18:00:00.000Z`;
  return syntheticBase({
    id: `settlement-case:${input.record.shared.id}:${input.settleDay}`,
    caseId: input.record.shared.id,
    caseNumber: input.record.shared.caseNumber,
    clientName: input.record.shared.clientName,
    deliverableType: "settlement",
    attorneyUserId: input.record.shared.attorneyId,
    assigneeUserId: input.record.shared.paralegalId,
    workflowStatus: input.workflowStatus,
    plannedDate: input.settleDay,
    completedAt: input.workflowStatus === "done" ? iso : null,
    createdAt: iso,
    identifiedAt: iso,
    docketEventId: null,
    documentLabel: null,
    notes: "Settlement date from Case Tracker",
    identityKey: `settlement:${input.record.shared.id}:${input.settleDay}`,
    identityLabel: `Settlement (${input.settleDay})`,
  });
}

function dedupeById(rows: PerformanceDeliverable[]) {
  const seen = new Set<string>();
  const out: PerformanceDeliverable[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    if (row.docketEventId && seen.has(`docket:${row.docketEventId}`)) continue;
    seen.add(row.id);
    if (row.docketEventId) seen.add(`docket:${row.docketEventId}`);
    out.push(row);
  }
  return out;
}

/**
 * Attorney Output board lists:
 * - Finished last week: verified completed lit events + settlements dated last week
 * - Committed this week: DF lit events dated this week + settlements dated/committed this week
 * - In progress: DF lit events dated next week and the week after (+1 / +2)
 */
export function buildAttorneyBoardBuckets(input: {
  weekStart: string;
  lastWeekStart: string;
  personId: string;
  deliverables: PerformanceDeliverable[];
  commitments: PerformanceCommitment[];
  records: CaseRecord[];
  eventsByCaseId: Record<string, DocketFlowScheduledEvent[]>;
}): AttorneyBoardBuckets {
  const weekPlus1 = shiftWeekStart(input.weekStart, 1);
  const weekPlus2 = shiftWeekStart(input.weekStart, 2);
  const committedIds = new Set(
    input.commitments
      .filter((c) => c.weekStart === input.weekStart && (c.outcome === "promised" || c.outcome === "completed"))
      .map((c) => c.deliverableId),
  );

  const finished: PerformanceDeliverable[] = [];
  const committed: PerformanceDeliverable[] = [];
  const backlog: PerformanceDeliverable[] = [];

  const doneDocketIds = new Set(
    input.deliverables
      .filter((d) => d.workflowStatus === "done" && d.docketEventId)
      .map((d) => d.docketEventId as string),
  );

  // Verified completed lit events (confirmation creates done deliverables).
  for (const d of input.deliverables) {
    if (d.attorneyUserId !== input.personId) continue;
    if (d.workflowStatus !== "done") continue;
    const completedDay = (d.completedAt || "").slice(0, 10);
    if (!isDateInWeek(completedDay, input.lastWeekStart)) continue;
    if (LIT_COMPLETED_TYPES.includes(d.deliverableType) || d.deliverableType === "settlement") {
      finished.push(d);
    }
  }

  const finishedSettlementKeys = new Set(
    finished
      .filter((d) => d.deliverableType === "settlement")
      .map((d) => `${d.caseId}:${(d.completedAt || d.plannedDate || "").slice(0, 10)}`),
  );

  const assigned = input.records.filter((r) => r.shared.attorneyId === input.personId);

  for (const record of assigned) {
    const settleDay = settlementDateFor(record);
    if (settleDay && isDateInWeek(settleDay, input.lastWeekStart)) {
      const key = `${record.shared.id}:${settleDay}`;
      if (!finishedSettlementKeys.has(key)) {
        finished.push(
          fromSettlement({ record, settleDay, workflowStatus: "done" }),
        );
        finishedSettlementKeys.add(key);
      }
    }

    if (settleDay && isDateInWeek(settleDay, input.weekStart)) {
      const already = input.deliverables.some(
        (d) =>
          d.attorneyUserId === input.personId &&
          d.deliverableType === "settlement" &&
          d.caseId === record.shared.id &&
          (d.workflowStatus === "committed" ||
            (d.workflowStatus === "done" && isDateInWeek((d.completedAt || "").slice(0, 10), input.weekStart))),
      );
      if (!already) {
        committed.push(
          fromSettlement({
            record,
            settleDay,
            workflowStatus: "committed",
          }),
        );
      }
    }

    for (const event of input.eventsByCaseId[record.shared.id] ?? []) {
      if (!isLitigationCalendarEvent(event)) continue;
      if (!event.included || event.calendarOrigin === "google_ics_mirror") continue;
      const day = eventDay(event);
      if (!day) continue;

      // Already verified/completed — belongs in finished when completed last week, skip calendar buckets.
      if (doneDocketIds.has(event.id)) continue;

      if (isDateInWeek(day, input.weekStart)) {
        committed.push(
          fromDocketEvent({
            event,
            record,
            workflowStatus: "committed",
            completedAt: null,
          }),
        );
      } else if (isDateInWeek(day, weekPlus1) || isDateInWeek(day, weekPlus2)) {
        backlog.push(
          fromDocketEvent({
            event,
            record,
            workflowStatus: "backlog",
            completedAt: null,
          }),
        );
      }
    }
  }

  // Settlement commitments / backlog (attorney-only types).
  for (const d of input.deliverables) {
    if (d.attorneyUserId !== input.personId) continue;
    if (d.deliverableType !== "settlement") continue;
    if (d.workflowStatus === "committed" && committedIds.has(d.id)) committed.push(d);
    if (d.workflowStatus === "backlog") backlog.push(d);
  }

  // Shared deliverables (demands, lawsuits, schedule lit, discovery, ASO, other, …) on attorney board too.
  for (const d of input.deliverables) {
    if (d.attorneyUserId !== input.personId) continue;
    if (isAttorneyOnlyBoardType(d.deliverableType)) continue;
    if (d.workflowStatus === "done") {
      const completedDay = (d.completedAt || "").slice(0, 10);
      if (isDateInWeek(completedDay, input.lastWeekStart)) finished.push(d);
      continue;
    }
    if (d.workflowStatus === "committed" && committedIds.has(d.id)) committed.push(d);
    if (d.workflowStatus === "backlog") backlog.push(d);
  }

  const sortFinished = (a: PerformanceDeliverable, b: PerformanceDeliverable) =>
    (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
  const sortPlanned = (a: PerformanceDeliverable, b: PerformanceDeliverable) =>
    (a.plannedDate ?? a.createdAt).localeCompare(b.plannedDate ?? b.createdAt);

  return {
    finished: dedupeById(finished).sort(sortFinished),
    committed: dedupeById(committed).sort(sortPlanned),
    backlog: dedupeById(backlog).sort(sortPlanned),
  };
}

export function isSyntheticBoardDeliverable(id: string) {
  return id.startsWith("docket:") || id.startsWith("settlement-case:");
}

export function attorneyBoardDateWindow(weekStart: string, lastWeekStart: string) {
  return {
    dateFrom: lastWeekStart,
    dateTo: weekEndFromStart(shiftWeekStart(weekStart, 2)),
  };
}
