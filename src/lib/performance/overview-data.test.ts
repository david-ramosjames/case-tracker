import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectExpectedDisbursementThisQuarter, collectSettledUndisbursed } from "./overview-data";
import { type CaseDisbursement, type CaseRecord } from "@/lib/types";

function party(partial: Partial<CaseDisbursement> & Pick<CaseDisbursement, "id" | "partyLabel">): CaseDisbursement {
  return {
    disburseDate: null,
    settlementDate: null,
    settlementAmount: null,
    attorneyFees: null,
    weight: 1,
    pendingRemaining: true,
    sheetRowKey: null,
    disburseDateLocked: false,
    settlementDateLocked: false,
    syncedAt: null,
    ...partial,
  };
}

function record(partial: {
  id?: string;
  caseNumber?: string;
  clientName?: string;
  attorneyId?: string;
  caseStage?: CaseRecord["tracker"]["caseStage"];
  settlementDate?: string | null;
  attorneyFees?: number | null;
  disbursedStatus?: CaseRecord["tracker"]["result"]["disbursedStatus"];
  disburseDate?: string | null;
  targetResolutionQuarter?: string | null;
  isActive?: boolean;
  estimatedFeeValue?: number | null;
  minimumValue?: number | null;
  disbursements?: CaseDisbursement[];
}): CaseRecord {
  return {
    shared: {
      id: partial.id ?? "case-1",
      caseNumber: partial.caseNumber ?? "1345",
      clientName: partial.clientName ?? "Krystal Garcia",
      attorneyId: partial.attorneyId ?? "atty-1",
    },
    tracker: {
      caseStage: partial.caseStage ?? "Settled",
      isActive: partial.isActive ?? true,
      targetResolutionQuarter: partial.targetResolutionQuarter ?? null,
      estimatedFeeValue: partial.estimatedFeeValue ?? null,
      minimumValue: partial.minimumValue ?? null,
      result: {
        settlementDate: partial.settlementDate ?? "2026-03-27",
        attorneyFees: partial.attorneyFees ?? 10_000,
        disbursedStatus: partial.disbursedStatus ?? "No",
        disburseDate: partial.disburseDate ?? null,
      },
      disbursements: partial.disbursements ?? [],
      actualFeeValue: null,
    },
  } as CaseRecord;
}

describe("collectSettledUndisbursed", () => {
  it("ages only parties with their own settlement date (skips unsettled co-party)", () => {
    const rows = collectSettledUndisbursed(
      [
        record({
          disbursements: [
            party({
              id: "krystal",
              partyLabel: "Krystal Garcia",
              settlementDate: "2026-03-27",
              attorneyFees: 10_000,
              pendingRemaining: true,
            }),
            party({
              id: "eric",
              partyLabel: "Eric Cano",
              settlementDate: null,
              pendingRemaining: true,
            }),
          ],
        }),
      ],
      new Map([["atty-1", "Jesus Zuniga"]]),
      "2026-11-15",
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.clientName, "Krystal Garcia");
    assert.equal(rows[0]?.settlementDate, "2026-03-27");
    assert.equal(rows[0]?.daysOutstanding, 233);
    assert.equal(rows[0]?.expectedAttorneyFees, 10_000);
  });

  it("excludes the case when only an unsettled co-party remains pending", () => {
    const rows = collectSettledUndisbursed(
      [
        record({
          settlementDate: "2026-03-27",
          disbursements: [
            party({
              id: "krystal",
              partyLabel: "Krystal Garcia",
              settlementDate: "2026-03-27",
              disburseDate: "2026-05-01",
              pendingRemaining: false,
              attorneyFees: 10_000,
            }),
            party({
              id: "eric",
              partyLabel: "Eric Cano",
              settlementDate: null,
              pendingRemaining: true,
            }),
          ],
        }),
      ],
      new Map([["atty-1", "Jesus Zuniga"]]),
      "2026-11-15",
    );

    assert.equal(rows.length, 0);
  });

  it("falls back to case-level when there are no party rows", () => {
    const rows = collectSettledUndisbursed(
      [
        record({
          disbursements: [],
          settlementDate: "2026-01-01",
          attorneyFees: 5_000,
          targetResolutionQuarter: "Q1-26",
        }),
      ],
      new Map([["atty-1", "Jesus Zuniga"]]),
      "2026-01-31",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.daysOutstanding, 30);
    assert.equal(rows[0]?.clientName, "Krystal Garcia");
    assert.equal(rows[0]?.targetResolutionQuarter, "Q1-26");
  });

  it("excludes parties when case is not Settled (column G not Y), e.g. 782", () => {
    const rows = collectSettledUndisbursed(
      [
        record({
          caseNumber: "782",
          clientName: "Nathaniel Vasquez",
          caseStage: "Treatment",
          settlementDate: "2024-04-29",
          disbursements: [
            party({
              id: "bi",
              partyLabel: "Nathaniel Vasquez - BI",
              settlementDate: "2024-04-10",
              pendingRemaining: false,
              attorneyFees: 0,
            }),
            party({
              id: "uim",
              partyLabel: "Nathaniel Vasquez - UIM",
              settlementDate: "2024-04-29",
              pendingRemaining: false,
              attorneyFees: 0,
            }),
          ],
        }),
      ],
      new Map([["atty-1", "Jesus Zuniga"]]),
      "2026-11-15",
    );

    assert.equal(rows.length, 0);
  });
});

describe("collectExpectedDisbursementThisQuarter", () => {
  it("includes active cases planned for the current quarter and excludes others", () => {
    const asOf = new Date("2026-11-15T18:00:00Z");
    const rows = collectExpectedDisbursementThisQuarter(
      [
        record({
          id: "in-q",
          caseNumber: "100",
          caseStage: "Lit",
          targetResolutionQuarter: "Q4-26",
          estimatedFeeValue: 40_000,
          settlementDate: null,
          attorneyFees: null,
        }),
        record({
          id: "other-q",
          caseNumber: "101",
          caseStage: "Dmd",
          targetResolutionQuarter: "Q1-27",
          estimatedFeeValue: 20_000,
          settlementDate: null,
          attorneyFees: null,
        }),
        record({
          id: "inactive",
          caseNumber: "102",
          caseStage: "Settled",
          isActive: false,
          targetResolutionQuarter: "Q4-26",
          attorneyFees: 15_000,
        }),
        record({
          id: "disbursed",
          caseNumber: "103",
          caseStage: "Settled",
          targetResolutionQuarter: "Q4-26",
          attorneyFees: 12_000,
          disbursedStatus: "Yes",
          disburseDate: "2026-10-01",
        }),
        record({
          id: "disengaged",
          caseNumber: "104",
          caseStage: "Disengaged",
          targetResolutionQuarter: "Q4-26",
          estimatedFeeValue: 30_000,
          settlementDate: null,
          attorneyFees: null,
        }),
        record({
          id: "settled-outstanding",
          caseNumber: "105",
          caseStage: "Settled",
          targetResolutionQuarter: "Q4-26",
          attorneyFees: 25_000,
          settlementDate: "2026-09-22",
        }),
      ],
      new Map([["atty-1", "Jesus Zuniga"]]),
      asOf,
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.caseNumber, "100");
    assert.equal(rows[0]?.expectedAttorneyFees, 40_000);
    assert.equal(rows[0]?.targetResolutionQuarter, "Q4-26");
  });
});
