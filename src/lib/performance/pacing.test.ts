import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeJonQuarterlyFeeProjection,
  computeSignedCasePacing,
  isEligibleForQuarterProjection,
} from "./pacing";

describe("performance pacing", () => {
  it("projects signed cases linearly using completed days (today incomplete)", () => {
    const result = computeSignedCasePacing({
      signedMtd: 12,
      year: 2026,
      month1to12: 11,
      dayOfMonth: 10,
      monthlyGoal: 40,
    });
    // Nov 10 → 9 completed days: 12/9*30 = 40
    assert.equal(result.daysInMonth, 30);
    assert.equal(result.daysElapsed, 9);
    assert.equal(result.projectedMonthEnd, 40);
    assert.equal(result.projectedAttainment, 1);
    assert.equal(result.variance, 0);
  });

  it("paces Nov 16 MTD as 15 completed days", () => {
    const result = computeSignedCasePacing({
      signedMtd: 24,
      year: 2026,
      month1to12: 11,
      dayOfMonth: 16,
      monthlyGoal: 40,
    });
    // 24/15*30 = 48; variance +8 vs goal 40 → 120%
    assert.equal(result.daysElapsed, 15);
    assert.equal(result.projectedMonthEnd, 48);
    assert.equal(result.projectedAttainment, 1.2);
    assert.equal(result.variance, 8);
  });

  it("excludes settled cases that cannot disburse before quarter end", () => {
    assert.equal(
      isEligibleForQuarterProjection({
        settlementDate: "2026-03-20",
        quarterEndYmd: "2026-03-31",
        lagDays: 42,
      }),
      false,
    );
    assert.equal(
      isEligibleForQuarterProjection({
        settlementDate: "2026-01-01",
        quarterEndYmd: "2026-03-31",
        lagDays: 42,
      }),
      true,
    );
  });

  it("sums disbursed + settled planned for current quarter only", () => {
    const result = computeJonQuarterlyFeeProjection({
      feesDisbursedInQuarter: 100_000,
      settledUndisbursed: [
        {
          caseId: "a",
          caseNumber: "1",
          clientName: "A",
          attorneyName: "X",
          expectedAttorneyFees: 50_000,
          settlementDate: "2026-01-01",
          daysOutstanding: 10,
          targetResolutionQuarter: "Q1-26",
        },
        {
          caseId: "b",
          caseNumber: "2",
          clientName: "B",
          attorneyName: "Y",
          // Lag would include this, but Exp. disburse Q is next quarter — exclude.
          expectedAttorneyFees: 80_000,
          settlementDate: "2026-01-01",
          daysOutstanding: 5,
          targetResolutionQuarter: "Q2-26",
        },
        {
          caseId: "c",
          caseNumber: "3",
          clientName: "C",
          attorneyName: "Z",
          expectedAttorneyFees: 40_000,
          settlementDate: "2025-06-01",
          daysOutstanding: 200,
          targetResolutionQuarter: null,
        },
      ],
      quarterlyGoal: 200_000,
      quarterEndYmd: "2026-03-31",
      lagDays: 42,
      currentQuarterLabel: "Q1-26",
    });
    assert.equal(result.eligibleSettledUndisbursedFees, 50_000);
    assert.equal(result.unsettledExpectedFees, 0);
    assert.equal(result.projectedQuarterlyFees, 150_000);
    assert.equal(result.excludedCases.length, 2);
  });

  it("adds unsettled expected-this-quarter fees into projected total", () => {
    const result = computeJonQuarterlyFeeProjection({
      feesDisbursedInQuarter: 100_000,
      settledUndisbursed: [
        {
          caseId: "a",
          caseNumber: "1",
          clientName: "A",
          attorneyName: "X",
          expectedAttorneyFees: 50_000,
          settlementDate: "2026-01-01",
          daysOutstanding: 10,
          targetResolutionQuarter: "Q1-26",
        },
      ],
      unsettledExpectedFees: 25_000,
      quarterlyGoal: 200_000,
      quarterEndYmd: "2026-03-31",
      lagDays: 42,
      currentQuarterLabel: "Q1-26",
    });
    assert.equal(result.eligibleSettledUndisbursedFees, 50_000);
    assert.equal(result.unsettledExpectedFees, 25_000);
    assert.equal(result.projectedQuarterlyFees, 175_000);
  });
});
