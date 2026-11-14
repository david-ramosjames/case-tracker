import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFirmWeekRollup, shiftWeekStart } from "./team-rollup";

describe("firm weekly rollup", () => {
  it("marks metrics behind when actual < goal", () => {
    const rollup = buildFirmWeekRollup({
      weekStart: "2026-11-10",
      deliverables: [],
      records: [],
      targets: [
        {
          id: "1",
          metricKey: "lawsuit_filed",
          periodGrain: "week",
          targetValue: 5,
          scope: "firm",
          scopeRole: null,
          scopeUserId: null,
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          notes: null,
        },
      ],
    });
    const lawsuit = rollup.metrics.find((m) => m.key === "lawsuit_filed");
    assert.equal(lawsuit?.goal, 5);
    assert.equal(lawsuit?.actual, 0);
    assert.equal(lawsuit?.status, "behind");
  });

  it("shifts week starts by whole weeks", () => {
    assert.equal(shiftWeekStart("2026-11-10", -1), "2026-11-03");
    assert.equal(shiftWeekStart("2026-11-10", 1), "2026-11-17");
  });
});
