import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Pure model of carryover: one canonical deliverable + commitment history. */
function applyMove(state: {
  deliverableId: string;
  identifiedAt: string;
  rescheduleCount: number;
  commitments: Array<{ id: string; weekStart: string; outcome: string }>;
}, toWeekStart: string) {
  const open = state.commitments.find((c) => c.outcome === "promised");
  if (!open) throw new Error("no open commitment");
  return {
    deliverableId: state.deliverableId,
    identifiedAt: state.identifiedAt,
    rescheduleCount: state.rescheduleCount + 1,
    commitments: [
      ...state.commitments.map((c) =>
        c.id === open.id ? { ...c, outcome: "moved", movedTo: toWeekStart } : c,
      ),
      { id: "c2", weekStart: toWeekStart, outcome: "promised" },
    ],
  };
}

describe("performance carryover", () => {
  it("keeps one deliverable and increments reschedule count", () => {
    const before = {
      deliverableId: "d1",
      identifiedAt: "2026-11-03T12:00:00Z",
      rescheduleCount: 0,
      commitments: [{ id: "c1", weekStart: "2026-11-03", outcome: "promised" }],
    };
    const after = applyMove(before, "2026-11-10");
    assert.equal(after.deliverableId, "d1");
    assert.equal(after.identifiedAt, before.identifiedAt);
    assert.equal(after.rescheduleCount, 1);
    assert.equal(after.commitments.filter((c) => c.outcome === "promised").length, 1);
    assert.equal(after.commitments.filter((c) => c.outcome === "moved").length, 1);
  });
});
