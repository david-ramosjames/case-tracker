import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { historicActualsByWeekForPerson } from "./person-historic-actuals";
import { type PerformanceWeekPair, type PerformanceWeekPairMetric } from "./week-pair-types";

describe("historicActualsByWeekForPerson", () => {
  it("sums only the selected paralegal's seats", () => {
    const pairs: PerformanceWeekPair[] = [
      {
        id: "p1",
        weekStart: "2026-11-09",
        seatIndex: 0,
        paralegalContactId: "aivet",
        attorneyContactId: "ryan",
        paralegalLabel: null,
        attorneyLabel: null,
        isVacant: false,
      },
      {
        id: "p2",
        weekStart: "2026-11-09",
        seatIndex: 1,
        paralegalContactId: "adrian",
        attorneyContactId: "jesus",
        paralegalLabel: null,
        attorneyLabel: null,
        isVacant: false,
      },
    ];
    const metrics: PerformanceWeekPairMetric[] = [
      { id: "m1", weekPairId: "p1", metricKey: "demand_sent", actualValue: 2, source: "import" },
      { id: "m2", weekPairId: "p1", metricKey: "lawsuit_filed", actualValue: 1, source: "import" },
      { id: "m3", weekPairId: "p2", metricKey: "demand_sent", actualValue: 9, source: "import" },
    ];
    const byWeek = historicActualsByWeekForPerson({
      role: "paralegal",
      personId: "aivet",
      pairs,
      metrics,
    });
    assert.deepEqual(byWeek.get("2026-11-09"), { demand_sent: 2, lawsuit_filed: 1 });
  });
});
