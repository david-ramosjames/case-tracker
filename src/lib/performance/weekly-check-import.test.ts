import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  matchContactId,
  meetingDateToWorkWeekStart,
  splitTeamLabel,
} from "@/lib/performance/weekly-check-import";
import { computeIsVacant } from "@/lib/performance/week-pairs";

describe("weekly check import helpers", () => {
  it("maps meeting dates back one week to the work week", () => {
    // Spreadsheet Week 21 / meeting 6/1/26 → work week Monday 5/25 (ISO 21).
    assert.equal(meetingDateToWorkWeekStart(new Date("2026-06-01T00:00:00.000Z")), "2026-05-25");
    // Spreadsheet Week 44 / meeting 11/9/26 → work week Monday 11/2 (ISO 44).
    assert.equal(meetingDateToWorkWeekStart(new Date("2026-11-09T01:00:00.000Z")), "2026-11-02");
  });

  it("splits team labels and matches contact first names", () => {
    assert.deepEqual(splitTeamLabel("ADRIAN + JESUS"), {
      paralegalToken: "ADRIAN",
      attorneyToken: "JESUS",
    });
    const contacts = [
      { id: "1", name: "Adrian" },
      { id: "2", name: "Jesus Zuniga" },
      { id: "3", name: "Valeria Flores" },
    ];
    assert.equal(matchContactId("ADRIAN", contacts), "1");
    assert.equal(matchContactId("JESUS", contacts), "2");
    assert.equal(matchContactId("VALERIA", contacts), "3");
    assert.equal(matchContactId("TBD", contacts), null);
  });

  it("treats one TBD as a team and both TBD as vacant", () => {
    assert.equal(
      computeIsVacant({ paralegalContactId: null, attorneyContactId: "a", paralegalLabel: "TBD" }),
      false,
    );
    assert.equal(
      computeIsVacant({
        paralegalContactId: null,
        attorneyContactId: null,
        paralegalLabel: "TBD",
        attorneyLabel: "TBD",
      }),
      true,
    );
  });
});
