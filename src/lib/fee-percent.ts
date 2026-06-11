import { type CaseStage, type ExpectedLitigationStatus } from "@/lib/types";

export function referralFeeToDecimal(referralFee: number | null | undefined) {
  if (referralFee == null || !Number.isFinite(referralFee)) return 0;
  return referralFee > 1 ? referralFee / 100 : referralFee;
}

export function wasEverInLitigation(input: {
  caseStage: CaseStage;
  expectedLitigation: ExpectedLitigationStatus | null;
}) {
  if (input.caseStage === "Lit") return true;
  return input.expectedLitigation === "Lit" || input.expectedLitigation === "Expect";
}

/** Settlement / forecast fee rate: 40% if ever in litigation, else one-third net of referral fee. */
export function deriveResultFeePercent(input: {
  caseStage: CaseStage;
  expectedLitigation: ExpectedLitigationStatus | null;
  referralFee: number | null;
}) {
  if (wasEverInLitigation(input)) return 0.4;
  return (1 / 3) * (1 - referralFeeToDecimal(input.referralFee));
}
