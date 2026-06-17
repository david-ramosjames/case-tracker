import {
  CASE_BACKFILL_ATTORNEY_FEES_HEADERS,
  CASE_BACKFILL_CASE_NUMBER_HEADERS,
  CASE_BACKFILL_REFERRAL_FEE_HEADERS,
  CASE_BACKFILL_SETTLEMENT_AMOUNT_HEADERS,
} from "@/lib/csv/case-backfill";
import { cleanCaseNumber, getCsvCellAny, hasCsvHeaderAny, parseCsv, parseSheetDate } from "@/lib/csv/parse";
import { deriveResultQuarterFromDisburseDate } from "@/lib/case-options";
import { deriveFeePercentFromSettlement } from "@/lib/fee-percent";
import { type CaseStage, type ManualDisbursementInput, type SettlementResult, type TrackerUpdateInput } from "@/lib/types";

export const SETTLEMENT_FINANCIAL_CASE_NUMBER_HEADERS = [
  ...CASE_BACKFILL_CASE_NUMBER_HEADERS,
  "Case Num",
  "Case Number",
] as const;

export const SETTLEMENT_FINANCIAL_CLAIMANT_HEADERS = [
  "Claimant name",
  "Claimant Name",
  "Claimant",
  "Client",
  "Party",
] as const;

export const SETTLEMENT_FINANCIAL_CLOSED_DATE_HEADERS = ["Closed Date", "Close Date", "Date Closed"] as const;
export const SETTLEMENT_FINANCIAL_REFERRAL_FEE_HEADERS = [
  "Referral Fee %",
  "Referral Fee",
  ...CASE_BACKFILL_REFERRAL_FEE_HEADERS,
] as const;
export const SETTLEMENT_FINANCIAL_ATTORNEY_FEES_HEADERS = [
  "Net Attorney Fees",
  "Net Attorney Fee",
  "RJL Attorney Fees",
  ...CASE_BACKFILL_ATTORNEY_FEES_HEADERS,
] as const;
export const SETTLEMENT_FINANCIAL_SETTLEMENT_AMOUNT_HEADERS = [
  "Settlement Amount",
  "Settlement amount",
  ...CASE_BACKFILL_SETTLEMENT_AMOUNT_HEADERS,
] as const;

export type SettlementFinancialClaimLine = {
  partyLabel: string | null;
  referralFee: number | null;
  closedDate: string | null;
  settlementAmount: number | null;
  attorneyFees: number | null;
};

export type ParsedSettlementFinancialBackfillRow = {
  caseNumber: string;
  claimCount: number;
  tracker: TrackerUpdateInput;
  result: Partial<SettlementResult>;
  manualDisbursements: ManualDisbursementInput[];
  lockFinancialBackfill: boolean;
  lockReferralFee: boolean;
};

export function hasSettlementFinancialBackfillHeaders(csvText: string) {
  const rows = parseCsv(csvText).filter((row) => row.some((cell) => cell.trim()));
  const headerRow = rows.find((row) => hasCsvHeaderAny(row, [...SETTLEMENT_FINANCIAL_CASE_NUMBER_HEADERS]));
  return Boolean(headerRow);
}

export function parseSettlementFinancialBackfillCsv(csvText: string): ParsedSettlementFinancialBackfillRow[] {
  const rows = parseCsv(csvText).filter((row) => row.some((cell) => cell.trim()));
  const headerRowIndex = rows.findIndex((row) => hasCsvHeaderAny(row, [...SETTLEMENT_FINANCIAL_CASE_NUMBER_HEADERS]));
  if (headerRowIndex === -1) return [];

  const headers = rows[headerRowIndex].map((header) => header.trim());
  const claimsByCase = new Map<string, SettlementFinancialClaimLine[]>();

  for (const row of rows.slice(headerRowIndex + 1)) {
    const claim = parseClaimLine(row, headers);
    if (!claim) continue;

    const existing = claimsByCase.get(claim.caseNumber) ?? [];
    existing.push(claim.line);
    claimsByCase.set(claim.caseNumber, existing);
  }

  return [...claimsByCase.entries()]
    .map(([caseNumber, claims]) => buildGroupedBackfillRow(caseNumber, claims))
    .filter((row): row is ParsedSettlementFinancialBackfillRow => Boolean(row));
}

function parseClaimLine(
  row: string[],
  headers: string[],
): { caseNumber: string; line: SettlementFinancialClaimLine } | null {
  const caseNumber = cleanCaseNumber(getCsvCellAny(row, headers, [...SETTLEMENT_FINANCIAL_CASE_NUMBER_HEADERS]));
  if (!caseNumber) return null;

  const partyLabel = getCsvCellAny(row, headers, [...SETTLEMENT_FINANCIAL_CLAIMANT_HEADERS]) || null;

  let referralFee: number | null = null;
  const referralFeeRaw = getCsvCellAny(row, headers, [...SETTLEMENT_FINANCIAL_REFERRAL_FEE_HEADERS]);
  if (referralFeeRaw) {
    referralFee = parsePercent(referralFeeRaw);
  }

  const closedDateRaw = getCsvCellAny(row, headers, [...SETTLEMENT_FINANCIAL_CLOSED_DATE_HEADERS]);
  const closedDate = closedDateRaw ? parseSheetDate(closedDateRaw)?.slice(0, 10) ?? null : null;

  let settlementAmount: number | null = null;
  const settlementAmountRaw = getCsvCellAny(row, headers, [...SETTLEMENT_FINANCIAL_SETTLEMENT_AMOUNT_HEADERS]);
  if (settlementAmountRaw) {
    settlementAmount = parseMoney(settlementAmountRaw);
  }

  let attorneyFees: number | null = null;
  const attorneyFeesRaw = getCsvCellAny(row, headers, [...SETTLEMENT_FINANCIAL_ATTORNEY_FEES_HEADERS]);
  if (attorneyFeesRaw) {
    attorneyFees = parseMoney(attorneyFeesRaw);
  }

  const hasData =
    partyLabel ||
    referralFee != null ||
    closedDate ||
    settlementAmount != null ||
    attorneyFees != null;
  if (!hasData) return null;

  return {
    caseNumber,
    line: {
      partyLabel,
      referralFee,
      closedDate,
      settlementAmount,
      attorneyFees,
    },
  };
}

function buildGroupedBackfillRow(
  caseNumber: string,
  claims: SettlementFinancialClaimLine[],
): ParsedSettlementFinancialBackfillRow | null {
  const tracker: TrackerUpdateInput = {};
  const result: Partial<SettlementResult> = {};
  let lockReferralFee = false;
  let lockFinancialBackfill = false;

  const referralFee = claims.find((claim) => claim.referralFee != null)?.referralFee ?? null;
  if (referralFee != null) {
    tracker.referralFee = referralFee;
    tracker.referralFeeArrangement = `Financial backfill referral fee: ${referralFee}%`;
    lockReferralFee = true;
  }

  const manualDisbursements: ManualDisbursementInput[] = claims.map((claim) => ({
    partyLabel: claim.partyLabel,
    settlementDate: claim.closedDate,
    disburseDate: claim.closedDate,
    settlementAmount: claim.settlementAmount,
    attorneyFees: claim.attorneyFees,
    pendingRemaining: !claim.closedDate,
  }));

  const totalSettlementAmount = sumNullable(claims.map((claim) => claim.settlementAmount));
  const totalAttorneyFees = sumNullable(claims.map((claim) => claim.attorneyFees));

  if (totalSettlementAmount != null) {
    result.settlementAmount = totalSettlementAmount;
    lockFinancialBackfill = true;
  }
  if (totalAttorneyFees != null) {
    result.attorneyFees = totalAttorneyFees;
    lockFinancialBackfill = true;
  }

  const closedDates = claims.map((claim) => claim.closedDate).filter(Boolean) as string[];
  const allPartiesClosed = claims.length > 0 && claims.every((claim) => Boolean(claim.closedDate));
  const latestClosedDate =
    closedDates.length > 0
      ? closedDates.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0]
      : null;

  if (latestClosedDate) {
    result.disburseDate = latestClosedDate;
    result.settlementDate = latestClosedDate;
    result.checkDisbursedAt = `${latestClosedDate}T12:00:00.000Z`;
    result.disbursedStatus = allPartiesClosed ? "Yes" : "No";
    result.checkStatus = allPartiesClosed ? "Deposited" : "No";
    result.resultQuarter = deriveResultQuarterFromDisburseDate(latestClosedDate) ?? undefined;
    lockFinancialBackfill = true;
  }

  if (result.settlementAmount != null && result.attorneyFees != null) {
    const feePercent = deriveFeePercentFromSettlement({
      settlementAmount: result.settlementAmount,
      attorneyFees: result.attorneyFees,
      referralFee,
    });
    if (feePercent != null) result.feePercent = feePercent;
  }

  if (lockFinancialBackfill) {
    tracker.caseStage = "Settled" as CaseStage;
    tracker.expectedDisbursementCount = claims.length;
    tracker.multipleDisbursementsEnabled = claims.length > 1;
  }

  if (!lockFinancialBackfill && !lockReferralFee) return null;

  return {
    caseNumber,
    claimCount: claims.length,
    tracker,
    result,
    manualDisbursements,
    lockFinancialBackfill,
    lockReferralFee,
  };
}

function sumNullable(values: Array<number | null>) {
  let total = 0;
  let seen = false;
  for (const value of values) {
    if (value == null) continue;
    total += value;
    seen = true;
  }
  return seen ? total : null;
}

function parseMoney(value: string) {
  const numeric = Number(value.replace(/[$,%\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function parsePercent(value: string) {
  const numeric = Number(value.trim().replace(/%$/, "").replace(/[,\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}
