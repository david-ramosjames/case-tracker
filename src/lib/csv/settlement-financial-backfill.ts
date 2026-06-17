import {
  CASE_BACKFILL_ATTORNEY_FEES_HEADERS,
  CASE_BACKFILL_CASE_NUMBER_HEADERS,
  CASE_BACKFILL_REFERRAL_FEE_HEADERS,
  CASE_BACKFILL_SETTLEMENT_AMOUNT_HEADERS,
} from "@/lib/csv/case-backfill";
import { cleanCaseNumber, getCsvCellAny, hasCsvHeaderAny, parseCsv, parseSheetDate } from "@/lib/csv/parse";
import { deriveResultQuarterFromDisburseDate } from "@/lib/case-options";
import { deriveFeePercentFromSettlement } from "@/lib/fee-percent";
import { type CaseStage, type SettlementResult, type TrackerUpdateInput } from "@/lib/types";

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

export const SETTLEMENT_FINANCIAL_HEADERS = [
  "Case #",
  ...SETTLEMENT_FINANCIAL_REFERRAL_FEE_HEADERS,
  ...SETTLEMENT_FINANCIAL_CLOSED_DATE_HEADERS,
  ...SETTLEMENT_FINANCIAL_SETTLEMENT_AMOUNT_HEADERS,
  ...SETTLEMENT_FINANCIAL_ATTORNEY_FEES_HEADERS,
] as const;

export type ParsedSettlementFinancialBackfillRow = {
  caseNumber: string;
  tracker: TrackerUpdateInput;
  result: Partial<SettlementResult>;
  lockFinancialBackfill: boolean;
  lockReferralFee: boolean;
};

export function hasSettlementFinancialBackfillHeaders(csvText: string) {
  const rows = parseCsv(csvText).filter((row) => row.some((cell) => cell.trim()));
  const headerRow = rows.find((row) => hasCsvHeaderAny(row, [...CASE_BACKFILL_CASE_NUMBER_HEADERS]));
  return Boolean(headerRow);
}

export function parseSettlementFinancialBackfillCsv(csvText: string): ParsedSettlementFinancialBackfillRow[] {
  const rows = parseCsv(csvText).filter((row) => row.some((cell) => cell.trim()));
  const headerRowIndex = rows.findIndex((row) => hasCsvHeaderAny(row, [...CASE_BACKFILL_CASE_NUMBER_HEADERS]));
  if (headerRowIndex === -1) return [];

  const headers = rows[headerRowIndex].map((header) => header.trim());
  const dataRows = rows.slice(headerRowIndex + 1);

  return dataRows
    .map((row): ParsedSettlementFinancialBackfillRow | null => {
      const caseNumber = cleanCaseNumber(getCsvCellAny(row, headers, [...CASE_BACKFILL_CASE_NUMBER_HEADERS]));
      if (!caseNumber) return null;

      const tracker: TrackerUpdateInput = {};
      const result: Partial<SettlementResult> = {};
      let lockReferralFee = false;
      let lockFinancialBackfill = false;

      const referralFee = getCsvCellAny(row, headers, [...SETTLEMENT_FINANCIAL_REFERRAL_FEE_HEADERS]);
      if (referralFee) {
        const parsedReferralFee = parsePercent(referralFee);
        if (parsedReferralFee != null) {
          tracker.referralFee = parsedReferralFee;
          tracker.referralFeeArrangement = `Financial backfill referral fee: ${referralFee.trim()}`;
          lockReferralFee = true;
        }
      }

      const closedDate = getCsvCellAny(row, headers, [...SETTLEMENT_FINANCIAL_CLOSED_DATE_HEADERS]);
      const parsedClosedDate = closedDate ? parseSheetDate(closedDate) : null;
      if (parsedClosedDate) {
        const dateOnly = parsedClosedDate.slice(0, 10);
        result.disburseDate = dateOnly;
        result.settlementDate = result.settlementDate ?? dateOnly;
        result.checkDisbursedAt = `${dateOnly}T12:00:00.000Z`;
        result.disbursedStatus = "Yes";
        result.checkStatus = "Deposited";
        result.resultQuarter = deriveResultQuarterFromDisburseDate(dateOnly) ?? undefined;
        lockFinancialBackfill = true;
      }

      const settlementAmount = getCsvCellAny(row, headers, [...SETTLEMENT_FINANCIAL_SETTLEMENT_AMOUNT_HEADERS]);
      if (settlementAmount) {
        const parsedAmount = parseMoney(settlementAmount);
        if (parsedAmount != null) {
          result.settlementAmount = parsedAmount;
          lockFinancialBackfill = true;
        }
      }

      const attorneyFees = getCsvCellAny(row, headers, [...SETTLEMENT_FINANCIAL_ATTORNEY_FEES_HEADERS]);
      if (attorneyFees) {
        const parsedFees = parseMoney(attorneyFees);
        if (parsedFees != null) {
          result.attorneyFees = parsedFees;
          lockFinancialBackfill = true;
        }
      }

      if (result.settlementAmount != null && result.attorneyFees != null) {
        const feePercent = deriveFeePercentFromSettlement({
          settlementAmount: result.settlementAmount,
          attorneyFees: result.attorneyFees,
          referralFee: tracker.referralFee ?? null,
        });
        if (feePercent != null) result.feePercent = feePercent;
      }

      if (lockFinancialBackfill && (parsedClosedDate || result.settlementAmount != null)) {
        tracker.caseStage = "Settled" as CaseStage;
      }

      if (!lockFinancialBackfill && !lockReferralFee) return null;

      return {
        caseNumber,
        tracker,
        result,
        lockFinancialBackfill,
        lockReferralFee,
      };
    })
    .filter((row): row is ParsedSettlementFinancialBackfillRow => Boolean(row));
}

function parseMoney(value: string) {
  const numeric = Number(value.replace(/[$,%\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function parsePercent(value: string) {
  const numeric = Number(value.trim().replace(/%$/, "").replace(/[,\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}
