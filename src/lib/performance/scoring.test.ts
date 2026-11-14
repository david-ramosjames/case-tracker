import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attainmentRatio, scoreAttorneyWeek, scoreParalegalWeek } from "./scoring";

describe("performance scoring", () => {
  it("computes paralegal overall without capping at 100%", () => {
    const result = scoreParalegalWeek({
      actualDemands: 2,
      targetDemands: 1,
      actualLawsuit: 1,
      targetLawsuit: 1,
      actualDiscovery: 2,
      targetDiscovery: 2,
      actualLitEventsScheduled: 3,
      targetLitEventsScheduled: 3,
    });
    assert.equal(result.preLit, 2);
    assert.ok(result.overall != null && result.overall > 1);
  });

  it("excludes zero targets instead of dividing by zero", () => {
    assert.equal(attainmentRatio(5, 0), null);
    assert.equal(attainmentRatio(5, null), null);
    const result = scoreParalegalWeek({
      actualDemands: 1,
      targetDemands: 0,
      actualLawsuit: 1,
      targetLawsuit: 0,
      actualDiscovery: 2,
      targetDiscovery: 0,
      actualLitEventsScheduled: 3,
      targetLitEventsScheduled: 3,
    });
    assert.equal(result.preLit, null);
    assert.equal(result.litigation, null);
    assert.equal(result.scheduling, 1);
    assert.equal(result.overall, 1);
  });

  it("attorney scoring is attainment-only (no invented overall)", () => {
    const result = scoreAttorneyWeek({
      actualLitCompleted: 6,
      targetLitCompleted: 3,
      actualSettlements: 1,
      targetSettlements: 1,
      actualDisbursements: 0,
      targetDisbursements: 1,
    });
    assert.equal(result.litCompleted, 2);
    assert.equal(result.settlements, 1);
    assert.equal(result.disbursements, 0);
    assert.equal("overall" in result, false);
  });
});
