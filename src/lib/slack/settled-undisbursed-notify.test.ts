import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSettledUndisbursedProgressMessage,
  isSettledNotDisbursedResultsCase,
} from "./settled-undisbursed-notify";
import { type CaseRecord } from "@/lib/types";

function record(partial: {
  caseStage?: string;
  disbursedStatus?: "No" | "Yes";
  checkDisbursedAt?: string | null;
  disburseDate?: string | null;
  releaseStatus?: string;
  reductionsStatus?: string;
  checkStatus?: string;
  closingStatus?: string;
  resultQuarter?: string | null;
}): CaseRecord {
  return {
    shared: {
      id: "c1",
      caseNumber: "1234",
      clientName: "Test Client",
      attorneyId: "a1",
      paralegalId: "p1",
    },
    attorney: { id: "a1", name: "Attorney", email: "a@example.com", slackUserId: "U123" },
    paralegal: { id: "p1", name: "Paralegal", email: "p@example.com" },
    tracker: {
      caseStage: partial.caseStage ?? "Settled",
      disbursements: [],
      result: {
        releaseStatus: partial.releaseStatus ?? "Signed by Client",
        reductionsStatus: partial.reductionsStatus ?? "Gathering Bills",
        checkStatus: partial.checkStatus ?? "Not Issued",
        closingStatus: partial.closingStatus ?? "Drafted",
        disbursedStatus: partial.disbursedStatus ?? "No",
        resultQuarter: partial.resultQuarter ?? null,
        checkDisbursedAt: partial.checkDisbursedAt ?? null,
        disburseDate: partial.disburseDate ?? null,
        settlementDate: "2026-11-01",
        settlementAmount: 10000,
        feePercent: 33,
        attorneyFees: 3300,
      },
    },
  } as unknown as CaseRecord;
}

describe("settled undisbursed slack notify", () => {
  it("matches settled not disbursed cases", () => {
    assert.equal(isSettledNotDisbursedResultsCase(record({})), true);
    assert.equal(
      isSettledNotDisbursedResultsCase(
        record({ disbursedStatus: "Yes", checkDisbursedAt: "2026-11-10", disburseDate: "2026-11-10" }),
      ),
      false,
    );
    assert.equal(isSettledNotDisbursedResultsCase(record({ caseStage: "Lit" })), false);
  });

  it("includes workflow fields and attorney-facing links", () => {
    const text = buildSettledUndisbursedProgressMessage(record({}), "https://app.example.com", {
      topicMentions: "<@U123>",
    });
    assert.match(text, /<@U123>/);
    assert.match(text, /\*Release:\* Signed by Client/);
    assert.match(text, /\*Reductions:\* Gathering Bills/);
    assert.match(text, /\*Check:\* Not Issued/);
    assert.match(text, /\*Closing:\* Drafted/);
    assert.match(text, /\*Disbursed:\* No/);
    assert.match(text, /\*Plan:\* 2\+ Weeks/);
    assert.match(text, /\*Result quarter:\* —/);
    assert.match(text, /results\?disbursed=No/);
  });

  it("appends free-form status note when present", () => {
    const withNote = record({});
    withNote.tracker.result.disbursementStatusNote = "Pending Progressive check";
    withNote.tracker.result.disbursementPlan = "This Week";
    const text = buildSettledUndisbursedProgressMessage(withNote, "https://app.example.com");
    assert.match(text, /\*Plan:\* This Week/);
    assert.match(text, /\*Status:\* Pending Progressive check/);
  });
});
