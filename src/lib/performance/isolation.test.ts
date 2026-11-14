import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("performance isolation boundaries", () => {
  it("does not alter contacts or operational tables in performance migration SQL", () => {
    for (const fileName of ["082_performance_module.sql", "083_performance_pairs_plans.sql"]) {
      const sql = readFileSync(path.join(__dirname, "../../../supabase/sql", fileName), "utf8");
      assert.equal(/alter table public\.contacts/i.test(sql), false, fileName);
      assert.equal(/alter table public\.cases/i.test(sql), false, fileName);
      assert.equal(/case_tracker_entries/i.test(sql), false, fileName);
      assert.equal(/case_tracker_activity/i.test(sql), false, fileName);
      assert.equal(/case_tracker_results/i.test(sql), false, fileName);
    }
    const base = readFileSync(path.join(__dirname, "../../../supabase/sql/082_performance_module.sql"), "utf8");
    assert.match(base, /create table if not exists public\.performance_deliverables/i);
    assert.match(base, /create table if not exists public\.performance_staff_dates/i);
    const pairs = readFileSync(path.join(__dirname, "../../../supabase/sql/083_performance_pairs_plans.sql"), "utf8");
    assert.match(pairs, /create table if not exists public\.performance_pairs/i);
    assert.match(pairs, /create table if not exists public\.performance_attorney_plan_lines/i);
  });

  it("performance write modules never touch case_tracker_activity or tracker updates", () => {
    for (const name of [
      "deliverables.ts",
      "snapshots.ts",
      "staff-dates.ts",
      "pairs.ts",
      "attorney-plans.ts",
      "confirm-event.ts",
    ]) {
      const file =
        name === "confirm-event.ts"
          ? path.join(__dirname, "../../app/api/performance/confirm-event/route.ts")
          : path.join(__dirname, name);
      const source = readFileSync(file, "utf8");
      assert.equal(source.includes("case_tracker_activity"), false, name);
      assert.equal(source.includes("updateTrackerEntry"), false, name);
      assert.equal(source.includes('from("case_events")'), false, name);
      assert.equal(source.includes(".update(") && source.includes("case_events"), false, name);
    }
  });

  it("shared getUsers select remains contacts fields only (no employment columns)", () => {
    const source = readFileSync(path.join(__dirname, "../supabase/services.ts"), "utf8");
    assert.match(source, /select\("id,name,email,role,slack_user_id,slack_display_name"\)/);
    assert.equal(source.includes("employment_start_date"), false);
  });

  it("Jon pacing helpers live outside calculations.ts (do not replace /goals plan)", () => {
    const calc = readFileSync(path.join(__dirname, "../calculations.ts"), "utf8");
    const pacing = readFileSync(path.join(__dirname, "pacing.ts"), "utf8");
    assert.match(calc, /export function getProjectedFeeValue/);
    assert.match(calc, /getAttorneyCommissionQuarterRows/);
    assert.equal(calc.includes("computeJonQuarterlyFeeProjection"), false);
    assert.match(pacing, /computeJonQuarterlyFeeProjection/);
    assert.match(pacing, /computeSignedCasePacing/);
  });
});
