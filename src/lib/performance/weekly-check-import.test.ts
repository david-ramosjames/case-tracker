import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import {
  matchContactId,
  meetingDateToWorkWeekStart,
  parseGoalsIndividualWorkbook,
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

  it("parses Individual solo vs pair weeks with role split and N/A→0", async (t) => {
    const path = "C:/Users/david/Downloads/RJL 2026 GOALS (1).xlsx";
    if (!existsSync(path)) {
      t.skip("RJL 2026 GOALS workbook not present on this machine");
      return;
    }
    const contacts = [
      { id: "a", name: "Adrian", role: "paralegal" },
      { id: "v", name: "Aivet Lopez", role: "paralegal" },
      { id: "j", name: "Jorge", role: "paralegal" },
      { id: "o", name: "Josslyn", role: "paralegal" },
      { id: "l", name: "Lyliana", role: "paralegal" },
      { id: "ar", name: "Arielle Allen", role: "attorney" },
      { id: "k", name: "Kody Garza", role: "attorney" },
      { id: "r", name: "Ryan Toomey", role: "attorney" },
      { id: "la", name: "Laura Ramos James", role: "attorney" },
    ];
    const rows = await parseGoalsIndividualWorkbook(path, contacts, { year: 2026 });
    const week6 = rows.filter((r) => r.weekLabel.includes("Week 6"));
    assert.equal(week6.length, 8);
    const adrian = week6.find((r) => r.teamLabel === "ADRIAN");
    assert.ok(adrian);
    assert.equal(adrian.paralegalToken, "ADRIAN");
    assert.equal(adrian.attorneyToken, "TBD");
    assert.equal(adrian.metrics.demand_sent, 0);
    assert.equal(adrian.metrics.lawsuit_filed, 1);
    assert.equal(adrian.metrics.discovery_responses, 2);
    assert.equal(adrian.metrics.lit_event_scheduled, 2);
    assert.equal(adrian.metrics.deposition, 0);
    assert.equal(adrian.metrics.settlement, 0);

    const arielle = week6.find((r) => r.teamLabel === "ARIELLE");
    assert.ok(arielle);
    assert.equal(arielle.paralegalToken, "TBD");
    assert.equal(arielle.attorneyToken, "ARIELLE");
    assert.equal(arielle.metrics.demand_sent, 0);
    assert.equal(arielle.metrics.deposition, 2);
    assert.equal(arielle.metrics.mediation, 1);
    assert.equal(arielle.metrics.settlement, 4);

    const week7 = rows.filter((r) => r.weekLabel.includes("Week 7"));
    assert.equal(week7.length, 5);
    const pair = week7.find((r) => r.teamLabel === "JOSSLYN + ARIELLE");
    assert.ok(pair);
    assert.equal(pair.paralegalToken, "JOSSLYN");
    assert.equal(pair.attorneyToken, "ARIELLE");
    assert.equal(pair.metrics.demand_sent, 2);
    assert.equal(pair.metrics.deposition, 1);
    assert.equal(pair.metrics.settlement, 2);
    assert.equal(pair.metrics.disbursement, 2);

    const lauraPair = week7.find((r) => r.teamLabel === "LYLIANA + LAURA");
    assert.ok(lauraPair);
    assert.equal(lauraPair.metrics.deposition, 0);
    assert.equal(lauraPair.metrics.mediation, 0);
  });
});
