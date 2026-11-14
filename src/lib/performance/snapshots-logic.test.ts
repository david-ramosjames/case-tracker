import assert from "node:assert/strict";
import { describe, it } from "node:test";

type Commitment = { id: string; deliverableId: string; outcome: string; createdAt: string };

function captureMonday(commitments: Commitment[]) {
  return {
    commitmentIds: commitments.filter((c) => c.outcome === "promised").map((c) => c.id),
    frozenAt: "2026-11-10T15:30:00Z",
  };
}

function classifyAgainstMonday(
  monday: { commitmentIds: string[] },
  live: Commitment[],
  completedUnplanned: string[],
) {
  const mondaySet = new Set(monday.commitmentIds);
  return {
    inMondayPlan: live.filter((c) => mondaySet.has(c.id)),
    addedAfter: live.filter((c) => c.outcome === "promised" && !mondaySet.has(c.id)),
    completedUnplanned,
  };
}

describe("monday snapshot vs live plan", () => {
  it("freezes monday commitments while live plan can grow", () => {
    const initial: Commitment[] = [
      { id: "c1", deliverableId: "d1", outcome: "promised", createdAt: "2026-11-10T10:00:00Z" },
    ];
    const monday = captureMonday(initial);
    const live: Commitment[] = [
      ...initial,
      { id: "c2", deliverableId: "d2", outcome: "promised", createdAt: "2026-11-12T14:00:00Z" },
    ];
    const view = classifyAgainstMonday(monday, live, ["d3"]);
    assert.deepEqual(monday.commitmentIds, ["c1"]);
    assert.equal(view.inMondayPlan.length, 1);
    assert.equal(view.addedAfter.length, 1);
    assert.equal(view.addedAfter[0]?.id, "c2");
    assert.deepEqual(view.completedUnplanned, ["d3"]);
  });
});
