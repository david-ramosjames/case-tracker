import {
  classifyLitDeliverableType,
  isLitigationAttendanceEvent,
} from "@/lib/performance/auto-progress";
import {
  type PerformanceCommitment,
  type PerformanceDeliverable,
  type PerformanceDeliverableType,
} from "@/lib/performance/types";
import {
  asDateText,
  asYmdPrefix,
  isDateInWeek,
  shiftWeekStart,
  weekEndFromStart,
} from "@/lib/performance/weeks";
import { coerceDisbursementPlan } from "@/lib/results-workflow-ui";
import { type CaseRecord, type DocketFlowScheduledEvent } from "@/lib/types";

const LIT_COMPLETED_TYPES: PerformanceDeliverableType[] = [
  "deposition",
  "mediation",
  "hearing",
  "hearing_trial",
];

/** Settlements / disbursements + completed lit event types — attorney Output board only. */
export function isAttorneyOnlyBoardType(type: PerformanceDeliverableType) {
  return type === "settlement" || type === "disbursement" || LIT_COMPLETED_TYPES.includes(type);
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
    record.tracker?.result?.settlementDate ??
    record.tracker?.disbursements?.find((d) => d.settlementDate)?.settlementDate ??
    null
  );
}

function eventDay(event: DocketFlowScheduledEvent) {
  return asYmdPrefix(event.date) || asYmdPrefix(event.startDateTime);
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
  /** Paralegal scheduling credit uses lit_event_scheduled; attorneys use attendance type. */
  asScheduledCredit?: boolean;
}): PerformanceDeliverable {
  const day = eventDay(input.event);
  const created =
    asDateText(input.event.createdAt) || (day ? `${day}T12:00:00.000Z` : new Date().toISOString());
  const attendanceType = classifyLitDeliverableType(input.event.title, input.event.eventKind);
  const type = input.asScheduledCredit ? "lit_event_scheduled" : attendanceType;
  const row = syntheticBase({
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
  if (input.asScheduledCredit) {
    const kind =
      input.event.eventKind?.trim() ||
      (attendanceType === "hearing_trial" ? "trial" : attendanceType);
    return { ...row, hearingType: kind };
  }
  return row;
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

/** Results tab Plan → attorney Output board (This Week = committed, Next Week = in progress). */
function fromDisbursementPlan(input: {
  record: CaseRecord;
  plannedDate: string;
  workflowStatus: "committed" | "backlog";
}): PerformanceDeliverable {
  const iso = `${input.plannedDate}T18:00:00.000Z`;
  const planLabel = input.workflowStatus === "committed" ? "This Week" : "Next Week";
  return syntheticBase({
    id: `disbursement-plan:${input.record.shared.id}`,
    caseId: input.record.shared.id,
    caseNumber: input.record.shared.caseNumber,
    clientName: input.record.shared.clientName,
    deliverableType: "disbursement",
    attorneyUserId: input.record.shared.attorneyId,
    assigneeUserId: input.record.shared.paralegalId,
    workflowStatus: input.workflowStatus,
    plannedDate: input.plannedDate,
    completedAt: null,
    createdAt: iso,
    identifiedAt: iso,
    docketEventId: null,
    documentLabel: null,
    notes: `Results plan: ${planLabel}`,
    identityKey: `disbursement-plan:${input.record.shared.id}`,
    identityLabel: `Disbursement (${planLabel})`,
  });
}

function hasOpenDisbursementForCase(
  deliverables: PerformanceDeliverable[],
  personId: string,
  caseId: string,
) {
  return deliverables.some(
    (d) =>
      d.attorneyUserId === personId &&
      d.caseId === caseId &&
      d.deliverableType === "disbursement" &&
      (d.workflowStatus === "committed" || d.workflowStatus === "backlog"),
  );
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
 * - Finished last week: verified completed lit events + settlements/disbursements dated last week
 * - Committed this week: DF lit events dated this week + settlements/disbursements dated/committed this week
 *   + Results Plan = This Week (undisbursed)
 * - In progress: DF lit events dated next week and the week after (+1 / +2)
 *   + Results Plan = Next Week (undisbursed)
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
  const dismissedDocketIds = new Set(
    input.deliverables
      .filter((d) => d.workflowStatus === "cancelled" && d.docketEventId)
      .map((d) => d.docketEventId as string),
  );

  // Verified completed lit events + closing metrics (confirmation / Case Tracker sync).
  for (const d of input.deliverables) {
    if (d.attorneyUserId !== input.personId) continue;
    if (d.workflowStatus !== "done") continue;
    const completedDay = asYmdPrefix(d.completedAt);
    if (!completedDay || !isDateInWeek(completedDay, input.lastWeekStart)) continue;
    if (
      LIT_COMPLETED_TYPES.includes(d.deliverableType) ||
      d.deliverableType === "settlement" ||
      d.deliverableType === "disbursement"
    ) {
      finished.push(d);
    }
  }

  const finishedSettlementKeys = new Set(
    finished
      .filter((d) => d.deliverableType === "settlement")
      .map((d) => `${d.caseId}:${asYmdPrefix(d.completedAt) || asYmdPrefix(d.plannedDate) || ""}`),
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
      const already = input.deliverables.some((d) => {
        if (d.attorneyUserId !== input.personId) return false;
        if (d.deliverableType !== "settlement") return false;
        if (d.caseId !== record.shared.id) return false;
        if (d.workflowStatus === "committed") return true;
        if (d.workflowStatus !== "done") return false;
        const completedDay = asYmdPrefix(d.completedAt);
        return Boolean(completedDay && isDateInWeek(completedDay, input.weekStart));
      });
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
      // Attendance events only — ignore DF deadlines/notices/motions around a trial.
      if (!isLitigationAttendanceEvent(event)) continue;
      if (!event.included || event.calendarOrigin === "google_ics_mirror") continue;
      const day = eventDay(event);
      if (!day) continue;

      // Already verified/completed or removed from the board — skip calendar buckets.
      if (doneDocketIds.has(event.id) || dismissedDocketIds.has(event.id)) continue;

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

    // Results Plan drives undisbursed disbursement placement on the attorney board.
    const result = record.tracker?.result;
    if (result && result.disbursedStatus !== "Yes") {
      const plan = coerceDisbursementPlan(result.disbursementPlan);
      if (
        (plan === "This Week" || plan === "Next Week") &&
        !hasOpenDisbursementForCase(input.deliverables, input.personId, record.shared.id)
      ) {
        if (plan === "This Week") {
          committed.push(
            fromDisbursementPlan({
              record,
              plannedDate: input.weekStart,
              workflowStatus: "committed",
            }),
          );
        } else {
          backlog.push(
            fromDisbursementPlan({
              record,
              plannedDate: weekPlus1,
              workflowStatus: "backlog",
            }),
          );
        }
      }
    }
  }

  // Settlement / disbursement commitments, this-week completions, and backlog (attorney-only).
  for (const d of input.deliverables) {
    if (d.attorneyUserId !== input.personId) continue;
    if (d.deliverableType !== "settlement" && d.deliverableType !== "disbursement") continue;
    if (d.workflowStatus === "done") {
      const completedDay = asYmdPrefix(d.completedAt);
      if (completedDay && isDateInWeek(completedDay, input.weekStart)) committed.push(d);
      continue;
    }
    if (d.workflowStatus === "committed" && committedIds.has(d.id)) committed.push(d);
    if (d.workflowStatus === "backlog") backlog.push(d);
  }

  // Shared deliverables (demands, lawsuits, schedule lit, discovery, ASO, other, …) on attorney board too.
  for (const d of input.deliverables) {
    if (d.attorneyUserId !== input.personId) continue;
    if (isAttorneyOnlyBoardType(d.deliverableType)) continue;
    if (d.workflowStatus === "done") {
      const completedDay = asYmdPrefix(d.completedAt);
      if (completedDay && isDateInWeek(completedDay, input.lastWeekStart)) finished.push(d);
      // Still show on Committed this week when they finished a this-week commitment.
      if (committedIds.has(d.id)) committed.push(d);
      continue;
    }
    if (d.workflowStatus === "committed" && committedIds.has(d.id)) committed.push(d);
    if (d.workflowStatus === "backlog") backlog.push(d);
  }

  const sortFinished = (a: PerformanceDeliverable, b: PerformanceDeliverable) =>
    (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
  const sortPlanned = (a: PerformanceDeliverable, b: PerformanceDeliverable) =>
    (a.plannedDate ?? a.createdAt ?? "").localeCompare(b.plannedDate ?? b.createdAt ?? "");
  const sortCommitted = (a: PerformanceDeliverable, b: PerformanceDeliverable) => {
    const aDone = a.workflowStatus === "done" ? 1 : 0;
    const bDone = b.workflowStatus === "done" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return sortPlanned(a, b);
  };

  return {
    finished: dedupeById(finished).sort(sortFinished),
    committed: dedupeById(committed).sort(sortCommitted),
    backlog: dedupeById(backlog).sort(sortPlanned),
  };
}

export function isSyntheticBoardDeliverable(id: string | null | undefined) {
  return (
    typeof id === "string" &&
    (id.startsWith("docket:") ||
      id.startsWith("settlement-case:") ||
      id.startsWith("disbursement-plan:"))
  );
}

export function attorneyBoardDateWindow(weekStart: string, lastWeekStart: string) {
  return {
    dateFrom: lastWeekStart,
    dateTo: weekEndFromStart(shiftWeekStart(weekStart, 2)),
  };
}

/**
 * Paralegal board:
 * - Finished last week: completed deliverables + DF attendance events *created* last week
 *   (event date may be any future date). No deadlines/reminders.
 * - Committed / In progress: deliverables only — never DF calendar synthetics.
 */
export function buildParalegalBoardBuckets(input: {
  weekStart: string;
  lastWeekStart: string;
  personId: string;
  deliverables: PerformanceDeliverable[];
  commitments: PerformanceCommitment[];
  records: CaseRecord[];
  eventsByCaseId: Record<string, DocketFlowScheduledEvent[]>;
}): AttorneyBoardBuckets {
  const committedIds = new Set(
    input.commitments
      .filter((c) => c.weekStart === input.weekStart && (c.outcome === "promised" || c.outcome === "completed"))
      .map((c) => c.deliverableId),
  );

  const dismissedDocketIds = new Set(
    input.deliverables
      .filter((d) => d.workflowStatus === "cancelled" && d.docketEventId)
      .map((d) => d.docketEventId as string),
  );
  const doneDocketIds = new Set(
    input.deliverables
      .filter((d) => d.workflowStatus === "done" && d.docketEventId)
      .map((d) => d.docketEventId as string),
  );

  const mine = input.deliverables.filter(
    (d) => d.assigneeUserId === input.personId && isVisibleOnParalegalBoard(d),
  );

  const finished: PerformanceDeliverable[] = mine.filter((d) => {
    if (d.workflowStatus !== "done") return false;
    const completedDay = asYmdPrefix(d.completedAt);
    return Boolean(completedDay && isDateInWeek(completedDay, input.lastWeekStart));
  });

  const committed: PerformanceDeliverable[] = mine.filter((d) => {
    if (d.workflowStatus === "committed") {
      const c = input.commitments.find((row) => row.deliverableId === d.id);
      return !c || c.weekStart === input.weekStart;
    }
    if (d.workflowStatus === "done") return committedIds.has(d.id);
    return false;
  });

  const backlog: PerformanceDeliverable[] = mine.filter((d) => d.workflowStatus === "backlog");

  const assigned = input.records.filter((r) => r.shared.paralegalId === input.personId);
  for (const record of assigned) {
    for (const event of input.eventsByCaseId[record.shared.id] ?? []) {
      if (!isLitigationAttendanceEvent(event)) continue;
      if (!event.included || event.calendarOrigin === "google_ics_mirror") continue;
      if (doneDocketIds.has(event.id) || dismissedDocketIds.has(event.id)) continue;

      const createdDay = asYmdPrefix(event.createdAt);
      if (!createdDay || !isDateInWeek(createdDay, input.lastWeekStart)) continue;

      const completedAt = asDateText(event.createdAt) || `${createdDay}T18:00:00.000Z`;
      finished.push(
        fromDocketEvent({
          event,
          record,
          workflowStatus: "done",
          completedAt,
          asScheduledCredit: true,
        }),
      );
    }
  }

  const sortFinished = (a: PerformanceDeliverable, b: PerformanceDeliverable) =>
    (b.completedAt ?? b.createdAt ?? "").localeCompare(a.completedAt ?? a.createdAt ?? "");
  const sortPlanned = (a: PerformanceDeliverable, b: PerformanceDeliverable) =>
    (a.plannedDate ?? a.createdAt ?? "").localeCompare(b.plannedDate ?? b.createdAt ?? "");
  const sortCommitted = (a: PerformanceDeliverable, b: PerformanceDeliverable) => {
    const aDone = a.workflowStatus === "done" ? 1 : 0;
    const bDone = b.workflowStatus === "done" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return sortPlanned(a, b);
  };

  return {
    finished: dedupeById(finished).sort(sortFinished),
    committed: dedupeById(committed).sort(sortCommitted),
    backlog: dedupeById(backlog).sort(sortPlanned),
  };
}

/** Fetch window for paralegal Finished DF pull: created last week; event date unrestricted. */
export function paralegalFinishedDocketCreatedWindow(lastWeekStart: string, weekStart: string) {
  return {
    createdFrom: lastWeekStart,
    createdToExclusive: weekStart,
  };
}
