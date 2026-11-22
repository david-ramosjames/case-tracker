import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  shouldUpdateCaseStageOnProgressConfirm,
  targetStageForProgressConfirm,
} from "./confirm-stage";

describe("confirm-stage", () => {
  it("maps demand / lawsuit / disengagement to tracker stages", () => {
    assert.equal(targetStageForProgressConfirm("demand_sent"), "Dmd");
    assert.equal(targetStageForProgressConfirm("lawsuit_filed"), "Lit");
    assert.equal(targetStageForProgressConfirm("disengagement"), "Disengaged");
    assert.equal(targetStageForProgressConfirm("settlement"), null);
  });

  it("does not move Lit back to Demand", () => {
    assert.equal(shouldUpdateCaseStageOnProgressConfirm("Lit", "Dmd"), false);
  });

  it("does not change Settled for any of these confirms", () => {
    assert.equal(shouldUpdateCaseStageOnProgressConfirm("Settled", "Dmd"), false);
    assert.equal(shouldUpdateCaseStageOnProgressConfirm("Settled", "Lit"), false);
    assert.equal(shouldUpdateCaseStageOnProgressConfirm("Settled", "Disengaged"), false);
  });

  it("advances earlier stages when appropriate", () => {
    assert.equal(shouldUpdateCaseStageOnProgressConfirm("Txt", "Dmd"), true);
    assert.equal(shouldUpdateCaseStageOnProgressConfirm("Dmd", "Lit"), true);
    assert.equal(shouldUpdateCaseStageOnProgressConfirm("Lit", "Disengaged"), true);
  });

  it("skips when already at the target stage", () => {
    assert.equal(shouldUpdateCaseStageOnProgressConfirm("Dmd", "Dmd"), false);
    assert.equal(shouldUpdateCaseStageOnProgressConfirm("Lit", "Lit"), false);
  });
});
