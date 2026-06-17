import { type CaseStage, type ExpectedLitigationStatus } from "@/lib/types";

export function referralFeeToDecimal(referralFee: number | null | undefined) {
  if (referralFee == null || !Number.isFinite(referralFee)) return 0;
  return referralFee > 1 ? referralFee / 100 : referralFee;
}

export function wasEverInLitigation(input: { caseStage: CaseStage }) {
  return input.caseStage === "Lit";
}

/** Active-pipeline forecast fee: Lit = 40%, all other non-settled stages = 1/3 net of referral fee. */
export function deriveForecastFeePercent(input: { caseStage: CaseStage; referralFee: number | null }) {
  if (input.caseStage === "Lit") return 0.4;
  return (1 / 3) * (1 - referralFeeToDecimal(input.referralFee));
}

/** @deprecated Use deriveForecastFeePercent for active cases. */
export function deriveResultFeePercent(input: { caseStage: CaseStage; referralFee: number | null }) {
  return deriveForecastFeePercent(input);
}

/** Settled-case fee: keep stored %, else infer from pre-settlement stage (or litigation history). */
export function resolveSettledFeePercent(input: {
  feePercent: number | null | undefined;
  priorCaseStage?: CaseStage | null;
  expectedLitigation: ExpectedLitigationStatus | null;
  referralFee: number | null;
}) {
  if (input.feePercent != null) return input.feePercent;

  if (input.priorCaseStage && input.priorCaseStage !== "Settled") {
    return deriveForecastFeePercent({ caseStage: input.priorCaseStage, referralFee: input.referralFee });
  }

  const litigationStage: CaseStage = input.expectedLitigation === "Lit" ? "Lit" : "Txt";
  return deriveForecastFeePercent({ caseStage: litigationStage, referralFee: input.referralFee });
}
