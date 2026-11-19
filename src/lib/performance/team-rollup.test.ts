import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFirmWeekRollup,
  buildFirmWeekRollupFromPairActuals,
  buildFirmWeekRollupFromPairRows,
  shiftWeekStart,
  sumPairRowsToFirmActuals,
} from "./team-rollup";

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

  it("sums pair rows into firm activity", () => {
    const actuals = sumPairRowsToFirmActuals([
      { isVacant: false, counts: { demand_sent: 1, lawsuit_filed: 0.5, settlement: 1 } },
      { isVacant: false, counts: { demand_sent: 2, lawsuit_filed: 1, settlement: 0 } },
      { isVacant: true, counts: { demand_sent: 9, lawsuit_filed: 9, settlement: 9 } },
    ]);
    assert.equal(actuals.demand_sent, 3);
    assert.equal(actuals.lawsuit_filed, 1.5);
    assert.equal(actuals.settlement, 1);
    assert.equal(actuals.new_case, 0);

    const rollup = buildFirmWeekRollupFromPairRows({
      weekStart: "2026-11-02",
      pairRows: [
        { isVacant: false, counts: { demand_sent: 1 } },
        { isVacant: false, counts: { demand_sent: 1 } },
      ],
      newCaseCount: 3,
      targets: [],
    });
    assert.equal(rollup.metrics.find((m) => m.key === "demand_sent")?.actual, 2);
    assert.equal(rollup.metrics.find((m) => m.key === "new_case")?.actual, 3);
  });

  it("prefers Team-sheet firm actuals over summed pair seats", () => {
    const rollup = buildFirmWeekRollupFromPairActuals({
      weekStart: "2026-11-09",
      pairActuals: { demand_sent: 2, lawsuit_filed: 9, settlement: 1 },
      newCaseCount: 99,
      targets: [],
      firmSheetActuals: {
        demand_sent: 3,
        lawsuit_filed: 7,
        discovery_responses: 10,
        lit_event_scheduled: 15,
        deposition: 1,
        mediation: 1,
        hearing: 0,
        disengagement: 0,
        settlement: 5,
        disbursement: 3.5,
        new_case: 10,
      },
    });
    assert.equal(rollup.metrics.find((m) => m.key === "demand_sent")?.actual, 3);
    assert.equal(rollup.metrics.find((m) => m.key === "lawsuit_filed")?.actual, 7);
    assert.equal(rollup.metrics.find((m) => m.key === "settlement")?.actual, 5);
    assert.equal(rollup.metrics.find((m) => m.key === "disbursement")?.actual, 3.5);
    assert.equal(rollup.metrics.find((m) => m.key === "new_case")?.actual, 10);
  });
});
