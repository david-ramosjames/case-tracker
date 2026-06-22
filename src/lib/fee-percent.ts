import { type CaseStage, type ExpectedLitigationStatus } from "@/lib/types";

export function referralFeeToDecimal(referralFee: number | null | undefined) {
  if (referralFee == null || !Number.isFinite(referralFee)) return 0;
  return referralFee > 1 ? referralFee / 100 : referralFee;
}

export function wasEverInLitigation(input: { caseStage: CaseStage }) {
  return input.caseStage === "Lit";
}

/** Gross settlement fee % from net RJL fees, referral split, and settlement amount. */
export function deriveFeePercentFromSettlement(input: {
  settlementAmount: number | null | undefined;
  attorneyFees: number | null | undefined;
  referralFee: number | null | undefined;
}) {
  const { settlementAmount, attorneyFees, referralFee } = input;
  if (settlementAmount == null || attorneyFees == null || settlementAmount <= 0) return null;

  const netFirmShare = 1 - referralFeeToDecimal(referralFee);
  if (netFirmShare <= 0) return null;

  return attorneyFees / netFirmShare / settlementAmount;
}

/** Gross fee rate by stage; referral split is applied to get net RJL share of settlement/minimum. */
const PRE_LIT_GROSS_FEE_RATE = 1 / 3;
const LIT_GROSS_FEE_RATE = 0.4;

export function deriveForecastFeePercent(input: { caseStage: CaseStage; referralFee: number | null }) {
  const grossRate = input.caseStage === "Lit" ? LIT_GROSS_FEE_RATE : PRE_LIT_GROSS_FEE_RATE;
  return grossRate * (1 - referralFeeToDecimal(input.referralFee));
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
