import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recordIsFullySettled } from "@/lib/results-period";
import { type CaseDisbursement, type CaseRecord, type CaseStage } from "@/lib/types";

function party(
  partial: Partial<CaseDisbursement> & Pick<CaseDisbursement, "id" | "partyLabel">,
): CaseDisbursement {
  return {
    id: partial.id,
    partyLabel: partial.partyLabel,
    disburseDate: null,
    settlementDate: null,
    weight: 0.5,
    sheetRowKey: null,
    syncedAt: null,
    pendingRemaining: false,
    settlementAmount: null,
    attorneyFees: null,
    disburseDateLocked: false,
    settlementDateLocked: false,
    ...partial,
  };
}

function record(input: {
  caseStage: CaseStage | "Settlement";
  disbursements?: CaseDisbursement[];
  settlementDate?: string | null;
  disbursedStatus?: "Yes" | "No";
  disburseDate?: string | null;
  expectedDisbursementCount?: number;
}): CaseRecord {
  const disbursements = input.disbursements ?? [];
  return {
    shared: {
      id: "case",
      caseNumber: "1024",
      clientName: "Client",
      attorneyId: "atty",
      paralegalId: "para",
    },
    tracker: {
      caseStage: input.caseStage as CaseStage,
      result: {
        settlementDate: input.settlementDate ?? null,
        settlementAmount: null,
        disbursedStatus: input.disbursedStatus ?? "No",
        disburseDate: input.disburseDate ?? null,
      },
      disbursements,
      expectedDisbursementCount: input.expectedDisbursementCount ?? Math.max(1, disbursements.length),
      multipleDisbursementsEnabled: disbursements.length > 1,
    },
  } as CaseRecord;
}

describe("recordIsFullySettled", () => {
  it("treats Settled-stage multi-party cases as fully settled when every party has a settlement date", () => {
    assert.equal(
      recordIsFullySettled(
        record({
          caseStage: "Settled",
          settlementDate: "2026-11-06",
          disbursements: [
            party({
              id: "p1",
              partyLabel: "Mary Banda",
              settlementDate: "2026-11-06",
              pendingRemaining: true,
            }),
            party({
              id: "p2",
              partyLabel: "Jazmine Bradford",
              settlementDate: "2026-11-06",
              pendingRemaining: true,
            }),
          ],
        }),
      ),
      true,
    );
  });

  it("flags Settled-stage multi-party as partial when a co-client still lacks a settlement date (e.g. 1345)", () => {
    assert.equal(
      recordIsFullySettled(
        record({
          caseStage: "Settlement",
          settlementDate: "2026-03-27",
          expectedDisbursementCount: 2,
          disbursements: [
            party({
              id: "krystal",
              partyLabel: "Krystal Garcia",
              settlementDate: "2026-03-27",
              disburseDate: "2026-04-08",
              settlementAmount: 30000,
              attorneyFees: 10000,
            }),
            party({
              id: "eric",
              partyLabel: "Eric Cano",
              settlementDate: null,
              pendingRemaining: true,
              settlementAmount: 0,
              attorneyFees: 0,
            }),
          ],
        }),
      ),
      false,
    );
  });

  it("accepts fully disbursed multi-party cases with all settlement dates (e.g. 1394/980/1289)", () => {
    assert.equal(
      recordIsFullySettled(
        record({
          caseStage: "Settlement",
          settlementDate: "2026-02-18",
          disbursedStatus: "Yes",
          disburseDate: "2026-06-30",
          disbursements: [
            party({
              id: "p1",
              partyLabel: "Regina Parker",
              settlementDate: "2026-02-18",
              disburseDate: "2026-06-30",
            }),
            party({
              id: "p2",
              partyLabel: "Regina Parker (1P - Prove Up)",
              settlementDate: "2026-02-18",
              disburseDate: "2026-04-21",
            }),
          ],
        }),
      ),
      true,
    );
  });

  it("does not treat a settlement date as fully settled when column G kept the case off Settled (e.g. 899)", () => {
    assert.equal(
      recordIsFullySettled(
        record({
          caseStage: "Lit",
          settlementDate: "2026-05-15",
          disbursements: [
            party({
              id: "p1",
              partyLabel: "Nina Rodriguez",
              settlementDate: "2026-05-15",
              settlementAmount: 52500,
              weight: 1,
            }),
          ],
        }),
      ),
      false,
    );
  });

  it("excludes Treatment/other stages with party settlement dates (e.g. 782)", () => {
    assert.equal(
      recordIsFullySettled(
        record({
          caseStage: "Txt",
          settlementDate: "2024-04-29",
          disbursements: [
            party({ id: "bi", partyLabel: "BI", settlementDate: "2024-04-10" }),
            party({ id: "uim", partyLabel: "UIM", settlementDate: "2024-04-29" }),
          ],
        }),
      ),
      false,
    );
  });
});
