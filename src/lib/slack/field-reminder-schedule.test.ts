import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getFieldReminderScheduleSkipReason,
  nextFieldReminderAllowedOnAfterSend,
  normalizeFieldReminderFrequencyDays,
} from "./field-reminder-schedule";

describe("field reminder schedule", () => {
  it("defaults frequency to weekly and clamps", () => {
    assert.equal(normalizeFieldReminderFrequencyDays(undefined), 7);
    assert.equal(normalizeFieldReminderFrequencyDays(0), 7);
    assert.equal(normalizeFieldReminderFrequencyDays(14), 14);
    assert.equal(normalizeFieldReminderFrequencyDays(200), 90);
  });

  it("blocks scheduled sends before next allowed date", () => {
    const reason = getFieldReminderScheduleSkipReason(
      { fieldReminderNextAllowedOn: "2026-11-25" },
      new Date("2026-11-19T16:00:00.000Z"),
    );
    assert.equal(reason, "next batch 2026-11-25");
  });

  it("allows scheduled sends on/after next allowed date", () => {
    assert.equal(
      getFieldReminderScheduleSkipReason(
        { fieldReminderNextAllowedOn: "2026-11-25" },
        new Date("2026-11-25T16:00:00.000Z"),
      ),
      null,
    );
    assert.equal(
      getFieldReminderScheduleSkipReason({ fieldReminderNextAllowedOn: null }, new Date()),
      null,
    );
  });

  it("advances next allowed date by frequency days", () => {
    assert.equal(
      nextFieldReminderAllowedOnAfterSend(7, new Date("2026-11-25T16:00:00.000Z")),
      "2026-12-02",
    );
  });
});
