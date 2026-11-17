import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAutoProgress,
  classifyLitDeliverableType,
  isLitigationCalendarEvent,
} from "./auto-progress";
import { type PerformanceCommitment, type PerformanceDeliverable } from "./types";
import { type CaseRecord, type DocketFlowScheduledEvent } from "@/lib/types";

function deliverable(partial: Partial<PerformanceDeliverable> & Pick<PerformanceDeliverable, "id" | "deliverableType">): PerformanceDeliverable {
  return {
    caseId: "c1",
    caseNumber: "100",
    clientNameSnapshot: "Client",
    identityKey: partial.id,
    identityLabel: null,
    attorneyUserId: "atty",
    assigneeUserId: "para",
    identifiedAt: "2026-11-10T00:00:00.000Z",
    identifiedBy: null,
    workflowStatus: "committed",
    requestedCompletionDate: null,
    plannedDate: null,
    completedAt: null,
    completionSource: null,
    rescheduleCount: 0,
    litPersonName: null,
    hearingType: null,
    documentLabel: null,
    roundNumber: null,
    recipientLabel: null,
    docketEventId: null,
    notes: null,
    cancelReason: null,
    createdAt: "2026-11-10T00:00:00.000Z",
    updatedAt: "2026-11-10T00:00:00.000Z",
    ...partial,
  };
}

function commitment(deliverableId: string): PerformanceCommitment {
  return {
    id: `cm-${deliverableId}`,
    deliverableId,
    weekStart: "2026-11-10",
    committedBy: null,
    committedAt: "2026-11-10T00:00:00.000Z",
    plannedDate: null,
    outcome: "promised",
    movedToWeekStart: null,
    mondaySnapshotId: null,
    cancelReason: null,
  };
}

describe("auto-progress", () => {
  it("classifies lit event titles", () => {
    assert.equal(classifyLitDeliverableType("Plaintiff Deposition"), "deposition");
    assert.equal(classifyLitDeliverableType("Mediation"), "mediation");
    assert.equal(classifyLitDeliverableType("Jury Trial"), "hearing_trial");
    assert.ok(isLitigationCalendarEvent({ title: "Depo of Defendant", eventKind: null, category: null }));
  });

  it("auto-completes planned settlements from case tracker dates", () => {
    const planned = deliverable({ id: "d-settle", deliverableType: "settlement" });
    const record = {
      shared: { id: "c1", caseNumber: "100", clientName: "Client", attorneyId: "atty", paralegalId: "para" },
      tracker: {
        caseStage: "Settled",
        result: { settlementDate: "2026-11-12", disburseDate: null },
        disbursements: [],
        closedAt: null,
        detectedStageSignals: [],
      },
    } as unknown as CaseRecord;

    const { autoCompletes, candidates } = buildAutoProgress({
      role: "attorney",
      personId: "atty",
      weekStart: "2026-11-10",
      records: [record],
      deliverables: [planned],
      commitments: [commitment("d-settle")],
      eventsByCaseId: {},
    });

    assert.equal(autoCompletes.length, 1);
    assert.equal(autoCompletes[0]?.deliverableId, "d-settle");
    assert.equal(candidates.filter((c) => c.kind === "settlement").length, 0);
  });

  it("requires verification for past-week docket lit events", () => {
    const event: DocketFlowScheduledEvent = {
      id: "ev1",
      caseId: "c1",
      title: "Mediation",
      date: "2026-11-11",
      deadlineEndDate: null,
      startDateTime: null,
      endDateTime: null,
      category: null,
      eventKind: "mediation",
      scheduleKind: "meeting",
      included: true,
      completed: false,
      calendarOrigin: "docketflow",
      createdAt: "2026-10-01T00:00:00.000Z",
    };
    const record = {
      shared: { id: "c1", caseNumber: "100", clientName: "Client", attorneyId: "atty", paralegalId: "para" },
      tracker: {
        caseStage: "Lit",
        result: { settlementDate: null, disburseDate: null },
        disbursements: [],
        closedAt: null,
        detectedStageSignals: [],
      },
    } as unknown as CaseRecord;

    const { candidates } = buildAutoProgress({
      role: "attorney",
      personId: "atty",
      weekStart: "2026-11-10",
      records: [record],
      deliverables: [],
      commitments: [],
      eventsByCaseId: { c1: [event] },
    });

    const lit = candidates.find((c) => c.kind === "lit_completed");
    assert.ok(lit);
    assert.equal(lit?.requiresVerification, true);
  });
});
