import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attainmentRatio,
  scoreAttorneyWeek,
  scoreParalegalWeek,
  weightedAverage,
} from "./scoring";

describe("performance scoring", () => {
  it("computes paralegal overall as equal 1/3 sections without capping at 100%", () => {
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

  it("attorney overall weights Pre-Lit 20% / Litigation 40% / Closing 40%", () => {
    const result = scoreAttorneyWeek({
      actualDemands: 2,
      targetDemands: 2,
      actualLawsuit: 2,
      targetLawsuit: 2,
      actualLitEventsScheduled: 4,
      targetLitEventsScheduled: 4,
      actualLitCompleted: 3,
      targetLitCompleted: 3,
      actualSettlements: 1,
      targetSettlements: 1,
      actualDisbursements: 1,
      targetDisbursements: 1,
    });
    assert.equal(result.preLit, 1);
    assert.equal(result.litigation, 1);
    assert.equal(result.closing, 1);
    assert.equal(result.overall, 1);
  });

  it("attorney overall applies section weights when sections differ", () => {
    // Pre-Lit 0, Lit 1, Closing 1 → 0*0.2 + 1*0.4 + 1*0.4 = 0.8
    const result = scoreAttorneyWeek({
      actualDemands: 0,
      targetDemands: 2,
      actualLawsuit: 2,
      targetLawsuit: 2,
      actualLitEventsScheduled: 4,
      targetLitEventsScheduled: 4,
      actualLitCompleted: 3,
      targetLitCompleted: 3,
      actualSettlements: 1,
      targetSettlements: 1,
      actualDisbursements: 1,
      targetDisbursements: 1,
    });
    assert.equal(result.overall, 0.8);
  });

  it("weightedAverage re-normalizes when a section is missing", () => {
    const result = weightedAverage([
      { value: null, weight: 0.2 },
      { value: 1, weight: 0.4 },
      { value: 0.5, weight: 0.4 },
    ]);
    assert.ok(result != null);
    assert.ok(Math.abs(result - 0.75) < 1e-9);
  });
});
