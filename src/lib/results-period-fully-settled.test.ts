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
  caseStage: CaseStage;
  disbursements?: CaseDisbursement[];
  settlementDate?: string | null;
}): CaseRecord {
  return {
    shared: {
      id: "case",
      caseNumber: "1024",
      clientName: "Client",
      attorneyId: "atty",
      paralegalId: "para",
    },
    tracker: {
      caseStage: input.caseStage,
      result: {
        settlementDate: input.settlementDate ?? null,
        settlementAmount: null,
      },
      disbursements: input.disbursements ?? [],
      expectedDisbursementCount: Math.max(1, (input.disbursements ?? []).length),
      multipleDisbursementsEnabled: (input.disbursements ?? []).length > 1,
    },
  } as CaseRecord;
}

describe("recordIsFullySettled", () => {
  it("treats Settled-stage multi-party cases as fully settled even if disbursement is still open", () => {
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
