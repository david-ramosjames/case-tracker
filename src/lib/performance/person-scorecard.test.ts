import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPersonScorecardBundle, formatAttainmentPct } from "./person-scorecard";
import { type PerformanceCommitment, type PerformanceDeliverable } from "@/lib/performance/types";

function deliverable(
  partial: Partial<PerformanceDeliverable> &
    Pick<PerformanceDeliverable, "id" | "deliverableType" | "assigneeUserId" | "workflowStatus">,
): PerformanceDeliverable {
  return {
    caseId: "c1",
    caseNumber: "1",
    clientNameSnapshot: "Client",
    identityKey: partial.id,
    identityLabel: null,
    attorneyUserId: "atty",
    identifiedAt: "2026-11-10T12:00:00.000Z",
    identifiedBy: "para",
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
    createdAt: "2026-11-10T12:00:00.000Z",
    updatedAt: "2026-11-10T12:00:00.000Z",
    ...partial,
  };
}

describe("person scorecard", () => {
  it("matches sheet overall for last week (1/1/2/4 vs 1/1/2/3 → 111%)", () => {
    const lastWeekStart = "2026-11-03";
    const weekStart = "2026-11-10";
    const personId = "para";
    const deliverables: PerformanceDeliverable[] = [
      deliverable({
        id: "d1",
        deliverableType: "demand_sent",
        assigneeUserId: personId,
        workflowStatus: "done",
        completedAt: "2026-11-04T18:00:00.000Z",
      }),
      deliverable({
        id: "d2",
        deliverableType: "lawsuit_filed",
        assigneeUserId: personId,
        workflowStatus: "done",
        completedAt: "2026-11-05T18:00:00.000Z",
      }),
      deliverable({
        id: "d3",
        deliverableType: "discovery_responses",
        assigneeUserId: personId,
        workflowStatus: "done",
        completedAt: "2026-11-05T18:00:00.000Z",
      }),
      deliverable({
        id: "d4",
        deliverableType: "discovery_responses",
        assigneeUserId: personId,
        workflowStatus: "done",
        completedAt: "2026-11-06T18:00:00.000Z",
      }),
      deliverable({
        id: "d5",
        deliverableType: "lit_event_scheduled",
        assigneeUserId: personId,
        workflowStatus: "done",
        completedAt: "2026-11-07T18:00:00.000Z",
      }),
      deliverable({
        id: "d6",
        deliverableType: "lit_event_scheduled",
        assigneeUserId: personId,
        workflowStatus: "done",
        completedAt: "2026-11-07T18:00:00.000Z",
      }),
      deliverable({
        id: "d7",
        deliverableType: "lit_event_scheduled",
        assigneeUserId: personId,
        workflowStatus: "done",
        completedAt: "2026-11-08T18:00:00.000Z",
      }),
      deliverable({
        id: "d8",
        deliverableType: "lit_event_scheduled",
        assigneeUserId: personId,
        workflowStatus: "done",
        completedAt: "2026-11-09T18:00:00.000Z",
      }),
    ];
    const commitments: PerformanceCommitment[] = [];
    const bundle = buildPersonScorecardBundle({
      role: "paralegal",
      personId,
      weekStart,
      lastWeekStart,
      deliverables,
      commitments,
      targets: [],
    });
    assert.equal(bundle.lastWeek.rows.find((r) => r.key === "demand_sent")?.actual, 1);
    assert.equal(bundle.lastWeek.rows.find((r) => r.key === "lawsuit_filed")?.actual, 1);
    assert.equal(bundle.lastWeek.rows.find((r) => r.key === "discovery_responses")?.actual, 2);
    assert.equal(bundle.lastWeek.rows.find((r) => r.key === "lit_event_scheduled")?.actual, 4);
    assert.ok(bundle.lastWeek.overall != null);
    assert.equal(formatAttainmentPct(bundle.lastWeek.overall), "111%");
  });
});
