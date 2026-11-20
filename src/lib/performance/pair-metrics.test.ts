import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { goalStatus } from "./pair-metrics";

describe("goalStatus attainment bands", () => {
  it("marks <60% critical, 60–90% behind, 90–110% met, >110% ahead", () => {
    assert.equal(goalStatus(0.59, 1), "critical");
    assert.equal(goalStatus(0.6, 1), "behind");
    assert.equal(goalStatus(0.89, 1), "behind");
    assert.equal(goalStatus(0.9, 1), "met");
    assert.equal(goalStatus(1, 1), "met");
    assert.equal(goalStatus(1.1, 1), "met");
    assert.equal(goalStatus(1.11, 1), "ahead");
  });

  it("uses actual ÷ goal for count metrics", () => {
    assert.equal(goalStatus(1, 2), "critical"); // 50%
    assert.equal(goalStatus(1.5, 2), "behind"); // 75%
    assert.equal(goalStatus(2, 2), "met"); // 100%
    assert.equal(goalStatus(2.5, 2), "ahead"); // 125%
  });

  it("returns neutral for vacant or missing goals", () => {
    assert.equal(goalStatus(1, 2, { vacant: true }), "neutral");
    assert.equal(goalStatus(1, null), "neutral");
    assert.equal(goalStatus(1, 0), "neutral");
  });
});
