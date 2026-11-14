import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";

describe("performance never mutates case status", () => {
  it("deliverables service does not import tracker/stage mutation APIs", () => {
    const file = path.join(__dirname, "deliverables.ts");
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("updateTrackerEntry"), false);
    assert.equal(source.includes("buildStagePatchFromConfirmation"), false);
    assert.equal(source.includes("case_stage"), false);
    assert.equal(source.includes("litigationEvents"), false);
    assert.match(source, /performance_deliverables/);
  });

  it("snapshots service only writes performance tables", () => {
    const file = path.join(__dirname, "snapshots.ts");
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("updateTrackerEntry"), false);
    assert.equal(source.includes("case_tracker_entries"), false);
    assert.match(source, /performance_week_snapshots/);
  });
});
