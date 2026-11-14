import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeJonQuarterlyFeeProjection,
  computeSignedCasePacing,
  isEligibleForQuarterProjection,
} from "./pacing";

describe("performance pacing", () => {
  it("projects signed cases linearly", () => {
    const result = computeSignedCasePacing({
      signedMtd: 12,
      year: 2026,
      month1to12: 11,
      dayOfMonth: 10,
      monthlyGoal: 40,
    });
    assert.equal(result.daysInMonth, 30);
    assert.equal(result.projectedMonthEnd, 36);
    assert.equal(result.projectedAttainment, 0.9);
    assert.equal(result.variance, -4);
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

  it("sums disbursed + eligible settled for Jon fee projection", () => {
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
        },
        {
          caseId: "b",
          caseNumber: "2",
          clientName: "B",
          attorneyName: "Y",
          expectedAttorneyFees: 80_000,
          settlementDate: "2026-03-20",
          daysOutstanding: 5,
        },
      ],
      quarterlyGoal: 200_000,
      quarterEndYmd: "2026-03-31",
      lagDays: 42,
    });
    assert.equal(result.eligibleSettledUndisbursedFees, 50_000);
    assert.equal(result.projectedQuarterlyFees, 150_000);
    assert.equal(result.excludedCases.length, 1);
  });
});
