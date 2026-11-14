import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countClientsInName,
  deliverableCredit,
  formatMetricValue,
} from "@/lib/performance/client-share";

describe("client share for multi-client closings", () => {
  it("counts clients separated by &, and, or slash", () => {
    assert.equal(countClientsInName("Jane Doe"), 1);
    assert.equal(countClientsInName("Jane Doe & John Doe"), 2);
    assert.equal(countClientsInName("Jane and John Doe"), 2);
    assert.equal(countClientsInName("A / B / C"), 3);
  });

  it("weights settlement and disbursement by client count", () => {
    assert.equal(deliverableCredit("settlement", "A & B"), 2);
    assert.equal(deliverableCredit("disbursement", "A & B & C"), 3);
    assert.equal(deliverableCredit("demand_sent", "A & B"), 1);
  });

  it("formats fractional totals for display", () => {
    assert.equal(formatMetricValue(2), "2");
    assert.equal(formatMetricValue(1.5), "1.5");
    assert.equal(formatMetricValue(2.9), "2.9");
  });
});
