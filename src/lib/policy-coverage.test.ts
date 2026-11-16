import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASSUMED_POLICY_LIMITS_DEFAULT,
  isPolicyCoverageValidationDue,
  limitsForCoverageChange,
  validatePolicyLimitsForCoverage,
} from "./policy-coverage";

describe("policy coverage", () => {
  it("forces $0 for No Coverage and Pending", () => {
    assert.equal(limitsForCoverageChange("no_coverage", 30_000), 0);
    assert.equal(limitsForCoverageChange("pending", 50_000), 0);
  });

  it("defaults Coverage Exists to $30k when empty, keeps custom assumptions", () => {
    assert.equal(limitsForCoverageChange("coverage_exists", null), ASSUMED_POLICY_LIMITS_DEFAULT);
    assert.equal(limitsForCoverageChange("coverage_exists", 50_000), 50_000);
  });

  it("requires verified amount for Limits Confirmed", () => {
    assert.match(validatePolicyLimitsForCoverage("limits_confirmed", 0) ?? "", /greater than/);
    assert.equal(validatePolicyLimitsForCoverage("limits_confirmed", 100_000), null);
  });

  it("flags overdue Coverage Exists when next due has passed", () => {
    assert.equal(
      isPolicyCoverageValidationDue(
        {
          policyCoverage: "coverage_exists",
          policyCoverageValidatedAt: "2026-01-01T00:00:00.000Z",
          policyCoverageNextDueAt: "2026-04-01",
          policyCoverageNeedsClassification: false,
        },
        "2026-04-02",
      ),
      true,
    );
    assert.equal(
      isPolicyCoverageValidationDue(
        {
          policyCoverage: "limits_confirmed",
          policyCoverageValidatedAt: "2026-01-01T00:00:00.000Z",
          policyCoverageNextDueAt: null,
          policyCoverageNeedsClassification: false,
        },
        "2026-11-16",
      ),
      false,
    );
  });
});
