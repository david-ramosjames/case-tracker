import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildIdentityKey } from "./identity";

describe("performance identity", () => {
  it("allows multiple demands with distinct rounds", () => {
    const a = buildIdentityKey({ deliverableType: "demand_sent", roundNumber: 1 });
    const b = buildIdentityKey({ deliverableType: "demand_sent", roundNumber: 2 });
    assert.notEqual(a.identityKey, b.identityKey);
  });

  it("allows multiple depositions for different people", () => {
    const a = buildIdentityKey({ deliverableType: "deposition", litPersonName: "Jane Doe" });
    const b = buildIdentityKey({ deliverableType: "deposition", litPersonName: "John Smith" });
    assert.notEqual(a.identityKey, b.identityKey);
  });

  it("rejects demand without instance identity", () => {
    assert.throws(() => buildIdentityKey({ deliverableType: "demand_sent" }), /notes|document label|round/i);
  });

  it("allows demand identity from notes", () => {
    const a = buildIdentityKey({ deliverableType: "demand_sent", notes: "Carrier follow-up" });
    assert.match(a.identityKey, /notes:/);
  });

  it("builds lit-event label from kind + party only (notes in key, not label)", () => {
    const a = buildIdentityKey({
      deliverableType: "lit_event_scheduled",
      hearingType: "deposition",
      documentLabel: "Defendant",
      notes: "Smith adjuster — sent 2nd email",
    });
    assert.match(a.identityLabel, /deposition/i);
    assert.match(a.identityLabel, /Defendant/);
    assert.doesNotMatch(a.identityLabel, /sent 2nd email/i);
    assert.match(a.identityKey, /smith/);
  });

  it("same document label produces same identity (duplicate guard input)", () => {
    const a = buildIdentityKey({ deliverableType: "lawsuit_filed", documentLabel: "Original Petition" });
    const b = buildIdentityKey({ deliverableType: "lawsuit_filed", documentLabel: "Original Petition" });
    assert.equal(a.identityKey, b.identityKey);
  });
});
