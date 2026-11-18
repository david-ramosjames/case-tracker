import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSettledUndisbursedSendWindow } from "./daily-cron-run";

describe("isSettledUndisbursedSendWindow", () => {
  it("allows Monday 10:00 Central", () => {
    // 2026-11-16 10:00 America/Chicago = 16:00 UTC (CST)
    assert.equal(isSettledUndisbursedSendWindow(new Date("2026-11-16T16:00:00.000Z")), true);
  });

  it("allows Wednesday 12:00 Central", () => {
    // 2026-11-18 12:00 America/Chicago = 18:00 UTC (CST)
    assert.equal(isSettledUndisbursedSendWindow(new Date("2026-11-18T18:00:00.000Z")), true);
  });

  it("rejects Wednesday morning and other weekdays", () => {
    assert.equal(isSettledUndisbursedSendWindow(new Date("2026-11-18T16:00:00.000Z")), false); // Wed 10 CT
    assert.equal(isSettledUndisbursedSendWindow(new Date("2026-11-17T16:00:00.000Z")), false); // Tue 10 CT
    assert.equal(isSettledUndisbursedSendWindow(new Date("2026-11-16T18:00:00.000Z")), false); // Mon noon CT
  });
});
