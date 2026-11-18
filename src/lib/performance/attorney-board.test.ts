import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAttorneyBoardBuckets } from "./attorney-board";
import { type PerformanceDeliverable } from "@/lib/performance/types";
import { type CaseRecord, type DocketFlowScheduledEvent } from "@/lib/types";

function record(partial: {
  id: string;
  caseNumber: string;
  attorneyId: string;
  settlementDate?: string | null;
}): CaseRecord {
  return {
    shared: {
      id: partial.id,
      caseNumber: partial.caseNumber,
      clientName: "Client",
      attorneyId: partial.attorneyId,
      paralegalId: "para-1",
    },
    tracker: {
      result: { settlementDate: partial.settlementDate ?? null },
      disbursements: [],
    },
  } as CaseRecord;
}

function event(partial: Partial<DocketFlowScheduledEvent> & Pick<DocketFlowScheduledEvent, "id" | "date" | "title">): DocketFlowScheduledEvent {
  return {
    caseId: "c1",
    deadlineEndDate: null,
    startDateTime: null,
    endDateTime: null,
    category: "Litigation",
    eventKind: "deposition",
    scheduleKind: "meeting",
    included: true,
    completed: false,
    calendarOrigin: "docketflow",
    createdAt: `${partial.date}T12:00:00.000Z`,
    ...partial,
  };
}

function doneLit(partial: Partial<PerformanceDeliverable> & Pick<PerformanceDeliverable, "id" | "completedAt">): PerformanceDeliverable {
  return {
    caseId: "c1",
    caseNumber: "100",
    clientNameSnapshot: "Client",
    deliverableType: "deposition",
    identityKey: partial.id,
    identityLabel: null,
    attorneyUserId: "atty",
    assigneeUserId: "para-1",
    identifiedAt: "2026-11-10T00:00:00.000Z",
    identifiedBy: null,
    workflowStatus: "done",
    requestedCompletionDate: null,
    plannedDate: null,
    completionSource: "manual",
    rescheduleCount: 0,
    litPersonName: null,
    hearingType: null,
    documentLabel: "Depo",
    roundNumber: null,
    recipientLabel: null,
    docketEventId: "ev-done",
    notes: null,
    cancelReason: null,
    createdAt: "2026-11-10T00:00:00.000Z",
    updatedAt: "2026-11-10T00:00:00.000Z",
    ...partial,
  };
}

describe("buildAttorneyBoardBuckets", () => {
  it("puts verified last-week lit + settlements in finished, this-week DF lit in committed, +1/+2 in backlog", () => {
    const weekStart = "2026-11-16";
    const lastWeekStart = "2026-11-09";
    const personId = "atty";
    const c1 = record({ id: "c1", caseNumber: "100", attorneyId: personId, settlementDate: "2026-11-12" });
    const c2 = record({ id: "c2", caseNumber: "200", attorneyId: personId, settlementDate: "2026-11-18" });

    const buckets = buildAttorneyBoardBuckets({
      weekStart,
      lastWeekStart,
      personId,
      deliverables: [
        doneLit({
          id: "d-lit",
          completedAt: "2026-11-11T18:00:00.000Z",
          docketEventId: "ev-done",
        }),
      ],
      commitments: [],
      records: [c1, c2],
      eventsByCaseId: {
        c1: [
          event({ id: "ev-this", date: "2026-11-18", title: "Plaintiff Deposition", caseId: "c1" }),
          event({ id: "ev-plus1", date: "2026-11-25", title: "Mediation", caseId: "c1", eventKind: "mediation" }),
          event({ id: "ev-plus2", date: "2026-12-02", title: "Hearing", caseId: "c1", eventKind: "hearing" }),
        ],
        c2: [],
      },
    });

    assert.equal(buckets.finished.some((r) => r.id === "d-lit"), true);
    assert.equal(buckets.finished.some((r) => r.deliverableType === "settlement"), true);
    assert.equal(buckets.committed.some((r) => r.id === "docket:ev-this"), true);
    assert.equal(buckets.committed.some((r) => r.deliverableType === "settlement"), true);
    assert.equal(buckets.backlog.some((r) => r.id === "docket:ev-plus1"), true);
    assert.equal(buckets.backlog.some((r) => r.id === "docket:ev-plus2"), true);
    assert.equal(buckets.committed.some((r) => r.id === "docket:ev-done"), false);
  });

  it("includes shared deliverables on the attorney board alongside attorney-only rows", () => {
    const weekStart = "2026-11-16";
    const lastWeekStart = "2026-11-09";
    const personId = "atty";
    const demand: PerformanceDeliverable = {
      ...doneLit({ id: "d-demand", completedAt: "2026-11-10T18:00:00.000Z" }),
      deliverableType: "demand_sent",
      workflowStatus: "done",
      docketEventId: null,
    };
    const buckets = buildAttorneyBoardBuckets({
      weekStart,
      lastWeekStart,
      personId,
      deliverables: [demand],
      commitments: [],
      records: [record({ id: "c1", caseNumber: "100", attorneyId: personId })],
      eventsByCaseId: {},
    });
    assert.equal(buckets.finished.some((r) => r.id === "d-demand"), true);
  });
});
