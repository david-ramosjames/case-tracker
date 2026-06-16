import { deriveResultFeePercent } from "@/lib/calculations";
import {
  deriveCaseSizeFromMinimumValue,
  deriveResultQuarterFromDisburseDate,
  normalizeCaseType,
  normalizeTargetQuarter,
} from "@/lib/case-options";
import {
  cleanCaseNumber,
  getCsvCell,
  getCsvCellAny,
  hasCsvHeaderAny,
  parseCsv,
  parseSheetDate,
} from "@/lib/csv/parse";
import {
  type CaseStage,
  type CaseStatus,
  type CheckStatus,
  type ClosingStatus,
  type DisbursedStatus,
  type ExpectedLitigationStatus,
  type ReductionsStatus,
  type ReleaseStatus,
  type SettlementResult,
  type TrackerUpdateInput,
} from "@/lib/types";

export const CASE_BACKFILL_CASE_NUMBER_HEADERS = ["Case #", "Case Number", "Case No", "Case No."] as const;
export const CASE_BACKFILL_DOL_HEADERS = ["DOL", "Date of Loss", "Date of loss", "DOI", "Date of Incident"] as const;
export const CASE_BACKFILL_DATE_SIGNED_HEADERS = [
  "Date Signed",
  "Date signed",
  "Date Created",
  "Date created",
  "Signed Date",
] as const;
export const CASE_BACKFILL_STATUS_HEADERS = ["Status", "Case Status"] as const;
export const CASE_BACKFILL_REFERRAL_FEE_HEADERS = ["Referral Fee", "Referral fee"] as const;
export const CASE_BACKFILL_SETTLEMENT_AMOUNT_HEADERS = ["Settlement Amount", "Settlement amount"] as const;
export const CASE_BACKFILL_ATTORNEY_FEES_HEADERS = ["RJL Attorney Fees", "Attorney Fees", "RJL Fees"] as const;
export const CASE_BACKFILL_REQUIRED_HEADERS = ["Case #"] as const;

export const CASE_BACKFILL_HEADER_GROUPS = [
  {
    label: "Required",
    headers: ["Case #"],
  },
  {
    label: "Optional DocketFlow / tracker fields (only filled cells update)",
    headers: ["DOL", "Date Signed", "Type", "Status"],
  },
  {
    label: "Tracker fields",
    headers: [
      "Liability",
      "Quarter",
      "Case Size",
      "Minimum Value",
      "Referral Fee",
      "Policy Limits",
      "Stage",
      "Expected Lit",
      "Sources",
      "Injuries",
      "Description",
      "Status Notes",
    ],
  },
  {
    label: "Results fields",
    headers: [
      "Settlement Date",
      "Settlement Amount",
      "RJL Attorney Fees",
      "Fee Percent",
      "Release",
      "Closing",
      "Check",
      "Disbursed",
      "Release Signed Date",
      "Closing Signed Date",
      "Check Deposited Date",
      "Check Disbursed Date",
      "Disburse Date",
      "Result Quarter",
    ],
  },
] as const;

export const CASE_BACKFILL_ALL_HEADERS = CASE_BACKFILL_HEADER_GROUPS.flatMap((group) => group.headers);

export type ParsedCaseBackfillRow = {
  caseNumber: string;
  shared: {
    caseType?: string;
    dateOfIncident?: string | null;
    dateSigned?: string;
    status?: CaseStatus;
  };
  tracker: TrackerUpdateInput;
  result: Partial<SettlementResult>;
};

export function parseCaseBackfillCsv(csvText: string): ParsedCaseBackfillRow[] {
  const rows = parseCsv(csvText).filter((row) => row.some((cell) => cell.trim()));
  const headerRowIndex = rows.findIndex((row) => hasCsvHeaderAny(row, [...CASE_BACKFILL_CASE_NUMBER_HEADERS]));
  if (headerRowIndex === -1) return [];

  const headers = rows[headerRowIndex].map((header) => header.trim());
  const dataRows = rows.slice(headerRowIndex + 1);

  return dataRows
    .map((row): ParsedCaseBackfillRow | null => {
      const caseNumber = cleanCaseNumber(getCsvCellAny(row, headers, [...CASE_BACKFILL_CASE_NUMBER_HEADERS]));
      if (!caseNumber) return null;

      const shared: ParsedCaseBackfillRow["shared"] = {};
      const caseType = getCsvCell(row, headers, "Type");
      const dol = getCsvCellAny(row, headers, [...CASE_BACKFILL_DOL_HEADERS]);
      const dateSigned = getCsvCellAny(row, headers, [...CASE_BACKFILL_DATE_SIGNED_HEADERS]);

      if (caseType) shared.caseType = normalizeCaseType(caseType);
      const parsedDol = parseBackfillDate(dol);
      if (parsedDol) shared.dateOfIncident = parsedDol;
      const parsedDateSigned = parseBackfillDate(dateSigned);
      if (parsedDateSigned) shared.dateSigned = parsedDateSigned.slice(0, 10);

      const status = getCsvCellAny(row, headers, [...CASE_BACKFILL_STATUS_HEADERS]);
      const normalizedStatus = status ? normalizeCaseStatus(status) : null;
      if (normalizedStatus) shared.status = normalizedStatus;

      const stage = getCsvCell(row, headers, "Stage");
      const minimumValue = parseMoney(getCsvCell(row, headers, "Minimum Value"));
      const expectedLit = getCsvCell(row, headers, "Expected Lit");
      const tracker: TrackerUpdateInput = {};

      if (stage) tracker.caseStage = normalizeStage(stage);
      if (minimumValue != null) {
        tracker.minimumValue = minimumValue;
        tracker.estimatedSettlementValue = minimumValue;
        tracker.caseSize = deriveCaseSizeFromMinimumValue(minimumValue);
        const normalizedExpected = expectedLit ? normalizeExpectedLitigation(expectedLit, tracker.caseStage ?? "Onboarding") : null;
        if (minimumValue != null) {
          tracker.estimatedFeeValue = Math.round(
            minimumValue *
              deriveResultFeePercent({
                caseStage: tracker.caseStage ?? "Onboarding",
                expectedLitigation: normalizedExpected,
                referralFee: tracker.referralFee ?? null,
              }),
          );
        }
      }
      if (expectedLit) tracker.expectedLitigation = normalizeExpectedLitigation(expectedLit, tracker.caseStage ?? "Onboarding");

      const quarter = getCsvCell(row, headers, "Quarter");
      if (quarter) tracker.targetResolutionQuarter = normalizeTargetQuarter(quarter) ?? undefined;

      const liability = getCsvCell(row, headers, "Liability");
      if (liability) tracker.liability = liability;

      const referralFee = getCsvCellAny(row, headers, [...CASE_BACKFILL_REFERRAL_FEE_HEADERS]);
      if (referralFee) {
        const parsedReferralFee = parsePercent(referralFee);
        if (parsedReferralFee != null) {
          tracker.referralFee = parsedReferralFee;
          tracker.referralFeeArrangement = `Imported referral fee: ${referralFee.trim()}`;
        }
      }

      const policyLimits = getCsvCell(row, headers, "Policy Limits");
      if (policyLimits) tracker.policyLimits = parseMoney(policyLimits);

      const sources = getCsvCell(row, headers, "Sources");
      if (sources) {
        tracker.sources = sources;
        tracker.policyInfoSource = sources;
        tracker.sourceOfEstimate = sources;
      }

      const injuries = getCsvCell(row, headers, "Injuries");
      if (injuries) tracker.injuries = injuries;

      const description = getCsvCell(row, headers, "Description");
      if (description) tracker.caseDescription = description;

      const statusNotes = getCsvCell(row, headers, "Status Notes");
      if (statusNotes) tracker.statusNotes = statusNotes;

      const result: Partial<SettlementResult> = {};
      const settlementDate = getCsvCell(row, headers, "Settlement Date");
      if (settlementDate) result.settlementDate = parseSheetDate(settlementDate);

      const settlementAmount = getCsvCellAny(row, headers, [...CASE_BACKFILL_SETTLEMENT_AMOUNT_HEADERS]);
      if (settlementAmount) result.settlementAmount = parseMoney(settlementAmount);

      const attorneyFees = getCsvCellAny(row, headers, [...CASE_BACKFILL_ATTORNEY_FEES_HEADERS]);
      if (attorneyFees) result.attorneyFees = parseMoney(attorneyFees);

      const feePercent = getCsvCell(row, headers, "Fee Percent");
      if (feePercent) {
        const parsedFeePercent = parsePercent(feePercent);
        if (parsedFeePercent != null) {
          result.feePercent = parsedFeePercent > 1 ? parsedFeePercent / 100 : parsedFeePercent;
        }
      }

      const release = getCsvCell(row, headers, "Release");
      if (release) result.releaseStatus = normalizeReleaseStatus(release);

      const closing = getCsvCell(row, headers, "Closing");
      if (closing) result.closingStatus = normalizeClosingStatus(closing);

      const check = getCsvCell(row, headers, "Check");
      if (check) result.checkStatus = normalizeCheckStatus(check);

      const disbursed = getCsvCell(row, headers, "Disbursed");
      if (disbursed) result.disbursedStatus = normalizeDisbursedStatus(disbursed);

      const reductions = getCsvCell(row, headers, "Reductions");

      const releaseSigned = getCsvCell(row, headers, "Release Signed Date");
      if (releaseSigned) result.releaseSignedAt = parseSheetDate(releaseSigned);

      const closingSigned = getCsvCell(row, headers, "Closing Signed Date");
      if (closingSigned) result.closingSignedAt = parseSheetDate(closingSigned);

      const checkDeposited = getCsvCell(row, headers, "Check Deposited Date");
      if (checkDeposited) result.checkDepositedAt = parseSheetDate(checkDeposited);

      const checkDisbursed = getCsvCell(row, headers, "Check Disbursed Date");
      if (checkDisbursed) result.checkDisbursedAt = parseSheetDate(checkDisbursed);

      const disburseDate = getCsvCell(row, headers, "Disburse Date");
      if (disburseDate) result.disburseDate = parseSheetDate(disburseDate);

      const resultQuarter = getCsvCell(row, headers, "Result Quarter");
      if (result.disburseDate) {
        result.resultQuarter = deriveResultQuarterFromDisburseDate(result.disburseDate) ?? undefined;
      } else {
        if (resultQuarter) result.resultQuarter = normalizeTargetQuarter(resultQuarter) ?? undefined;
      }
      if (reductions) result.reductionsStatus = normalizeReductionsStatus(reductions);

      if (result.feePercent == null && (result.settlementAmount != null || result.settlementDate)) {
        result.feePercent = deriveResultFeePercent({
          caseStage: tracker.caseStage ?? "Onboarding",
          expectedLitigation: tracker.expectedLitigation ?? null,
          referralFee: tracker.referralFee ?? null,
        });
      }

      return { caseNumber, shared, tracker, result };
    })
    .filter((row): row is ParsedCaseBackfillRow => Boolean(row));
}

export function hasCaseBackfillHeaders(csvText: string) {
  const rows = parseCsv(csvText).filter((row) => row.some((cell) => cell.trim()));
  const headerRow = rows.find((row) => hasCsvHeaderAny(row, [...CASE_BACKFILL_CASE_NUMBER_HEADERS]));
  return Boolean(headerRow);
}

function parseBackfillDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase().replace(/[.\s_-]+/g, "");
  if (
    normalized === "notset" ||
    normalized === "na" ||
    normalized === "n/a" ||
    normalized === "none" ||
    normalized === "unknown" ||
    normalized === "tbd"
  ) {
    return null;
  }
  return parseSheetDate(trimmed);
}

function parseMoney(value: string) {
  const numeric = Number(value.replace(/[$,%\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function parsePercent(value: string) {
  const numeric = Number(value.trim().replace(/%$/, "").replace(/[,\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeCaseStatus(value: string): CaseStatus | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "active" || normalized === "open") return "Active";
  if (normalized === "closed" || normalized === "archived" || normalized === "archive") return "Closed";
  return null;
}

function normalizeStage(value: string): CaseStage {
  const normalized = value.trim().toLowerCase();
  if (normalized === "lit" || normalized.includes("litigation")) return "Lit";
  if (normalized === "txt" || normalized.includes("treatment")) return "Txt";
  if (normalized === "dmd" || normalized.includes("demand")) return "Dmd";
  if (normalized.includes("settled")) return "Settled";
  if (normalized.includes("diseng")) return "Disengaged";
  if (normalized.includes("refer")) return "Referred";
  if (normalized.includes("termin") || normalized.includes("closed")) return "Terminated";
  return "Onboarding";
}

function normalizeExpectedLitigation(value: string, stage: CaseStage): ExpectedLitigationStatus {
  const normalized = value.trim().toLowerCase();
  if (normalized === "lit" || normalized.includes("litigation") || stage === "Lit") return "Lit";
  if (normalized.includes("expected") || normalized === "expect") return "Expect";
  return "Pre";
}

function normalizeReleaseStatus(value: string): ReleaseStatus {
  const normalized = value.trim().toLowerCase();
  return normalized === "signed" || normalized === "yes" ? "Signed" : "No";
}

function normalizeClosingStatus(value: string): ClosingStatus {
  const normalized = value.trim().toLowerCase();
  if (normalized === "drafted") return "Drafted";
  if (normalized === "approved") return "Approved";
  if (normalized === "signed" || normalized === "yes") return "Signed";
  return "No";
}

function normalizeCheckStatus(value: string): CheckStatus {
  const normalized = value.trim().toLowerCase();
  if (normalized === "deposited") return "Deposited";
  if (normalized === "sent") return "Sent";
  return "No";
}

function normalizeDisbursedStatus(value: string): DisbursedStatus {
  const normalized = value.trim().toLowerCase();
  return normalized === "yes" || normalized === "disbursed" ? "Yes" : "No";
}

function normalizeReductionsStatus(value: string): ReductionsStatus {
  const normalized = value.trim().toLowerCase();
  if (normalized === "sent") return "Sent";
  if (normalized === "approved") return "Approved";
  if (normalized === "deposited") return "Not Complete";
  if (normalized === "n/a" || normalized === "na" || normalized === "not applicable") return "N/A";
  return "Not Complete";
}
