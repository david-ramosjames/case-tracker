import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attorneyPlanDoesNotMutateCases } from "@/lib/performance/attorney-plans";
import { buildPairWeekRollup, findMatchingPair } from "@/lib/performance/pair-rollup";
import { pairsActiveOn } from "@/lib/performance/pairs";
import { type PerformanceDeliverable, type PerformancePair } from "@/lib/performance/types";

function pair(partial: Partial<PerformancePair> & Pick<PerformancePair, "id">): PerformancePair {
  return {
    attorneyContactId: "att-1",
    paralegalContactId: "par-1",
    attorneyLabel: null,
    paralegalLabel: null,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

function done(partial: Partial<PerformanceDeliverable> & Pick<PerformanceDeliverable, "id" | "deliverableType">): PerformanceDeliverable {
  return {
    caseId: "c1",
    caseNumber: "100",
    clientNameSnapshot: "Client",
    identityKey: "k",
    identityLabel: null,
    attorneyUserId: "att-1",
    assigneeUserId: "par-1",
    identifiedAt: "2026-11-01T00:00:00Z",
    identifiedBy: null,
    workflowStatus: "done",
    requestedCompletionDate: null,
    plannedDate: null,
    completedAt: "2026-11-10T15:00:00Z",
    completionSource: "manual",
    rescheduleCount: 0,
    litPersonName: null,
    hearingType: null,
    documentLabel: null,
    roundNumber: null,
    recipientLabel: null,
    docketEventId: null,
    notes: null,
    cancelReason: null,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-10T15:00:00Z",
    ...partial,
  };
}

describe("performance pairs effective dating", () => {
  it("includes pairs active on the week Monday", () => {
    const rows = [
      pair({ id: "a", effectiveFrom: "2026-11-01", effectiveTo: null }),
      pair({ id: "b", attorneyContactId: "att-2", paralegalContactId: "par-2", effectiveFrom: "2026-12-01" }),
      pair({
        id: "c",
        attorneyContactId: "att-3",
        paralegalContactId: "par-3",
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-10-31",
      }),
    ];
    const active = pairsActiveOn(rows, "2026-11-09");
    assert.deepEqual(
      active.map((p) => p.id),
      ["a"],
    );
  });
});

describe("pair week rollup", () => {
  it("counts only completions matching both attorney and paralegal", () => {
    const pairs = [pair({ id: "p1" }), pair({ id: "p2", attorneyContactId: "att-2", paralegalContactId: "par-2" })];
    const deliverables = [
      done({ id: "d1", deliverableType: "demand_sent" }),
      done({ id: "d2", deliverableType: "lawsuit_filed" }),
      done({ id: "d3", deliverableType: "discovery_responses" }),
      done({ id: "d4", deliverableType: "lit_event_scheduled" }),
      done({
        id: "d5",
        deliverableType: "demand_sent",
        attorneyUserId: "att-2",
        assigneeUserId: "par-1",
      }),
      done({
        id: "d6",
        deliverableType: "demand_sent",
        attorneyUserId: "att-2",
        assigneeUserId: "par-2",
        completedAt: "2026-11-12T12:00:00Z",
      }),
    ];
    const rows = buildPairWeekRollup({
      weekStart: "2026-11-09",
      pairs,
      deliverables,
      nameById: new Map([
        ["att-1", "Jesus"],
        ["par-1", "Adrian"],
        ["att-2", "Erin"],
        ["par-2", "Mike"],
      ]),
    });
    assert.equal(rows.length, 2);
    const adrian = rows.find((r) => r.pairId === "p1")!;
    assert.equal(adrian.label, "ADRIAN + JESUS");
    assert.equal(adrian.counts.demand_sent, 1);
    assert.equal(adrian.counts.lawsuit_filed, 1);
    assert.equal(adrian.counts.discovery_responses, 1);
    assert.equal(adrian.counts.lit_event_scheduled, 1);
    const mike = rows.find((r) => r.pairId === "p2")!;
    assert.equal(mike.counts.demand_sent, 1);
    assert.equal(mike.counts.lawsuit_filed, 0);
  });

  it("findMatchingPair requires both sides", () => {
    const pairs = [pair({ id: "p1" })];
    assert.equal(findMatchingPair(pairs, "att-1", "par-1")?.id, "p1");
    assert.equal(findMatchingPair(pairs, "att-1", null), null);
    assert.equal(findMatchingPair(pairs, "att-9", "par-1"), null);
  });
});

describe("attorney plan isolation", () => {
  it("plan helpers do not claim case mutation", () => {
    assert.equal(attorneyPlanDoesNotMutateCases(), true);
  });
});
