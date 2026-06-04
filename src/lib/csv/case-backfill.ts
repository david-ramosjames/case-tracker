import { CASE_TYPE_OPTIONS, normalizeCaseType, normalizeTargetQuarter } from "@/lib/case-options";
import { cleanCaseNumber, getCsvCell, hasCsvHeader, parseCsv } from "@/lib/csv/parse";
import {
  type CaseStage,
  type CaseStatus,
  type CheckStatus,
  type ClosingStatus,
  type DisbursedStatus,
  type ExpectedLitigationStatus,
  type ReleaseStatus,
  type SettlementResult,
  type TrackerUpdateInput,
} from "@/lib/types";

export const CASE_BACKFILL_REQUIRED_HEADERS = ["Case #"] as const;

export const CASE_BACKFILL_HEADER_GROUPS = [
  {
    label: "Required",
    headers: ["Case #"],
  },
  {
    label: "Optional DocketFlow fields (only filled cells update)",
    headers: ["DOL", "Case Status", "Type"],
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
      "Lit Events Needed",
      "Timeline for Lit Events",
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
    status?: CaseStatus;
    caseType?: string;
    dateOfIncident?: string | null;
  };
  tracker: TrackerUpdateInput;
  result: Partial<SettlementResult>;
};

export function parseCaseBackfillCsv(csvText: string): ParsedCaseBackfillRow[] {
  const rows = parseCsv(csvText).filter((row) => row.some((cell) => cell.trim()));
  const headerRowIndex = rows.findIndex((row) => hasCsvHeader(row, "Case #"));
  if (headerRowIndex === -1) return [];

  const headers = rows[headerRowIndex].map((header) => header.trim());
  const dataRows = rows.slice(headerRowIndex + 1);

  return dataRows
    .map((row): ParsedCaseBackfillRow | null => {
      const caseNumber = cleanCaseNumber(getCsvCell(row, headers, "Case #"));
      if (!caseNumber) return null;

      const shared: ParsedCaseBackfillRow["shared"] = {};
      const caseStatus = getCsvCell(row, headers, "Case Status");
      const caseType = getCsvCell(row, headers, "Type");
      const dol = getCsvCell(row, headers, "DOL");

      if (caseStatus) shared.status = normalizeCaseStatus(caseStatus);
      if (caseType) shared.caseType = normalizeCaseType(caseType);
      if (dol) shared.dateOfIncident = parseOptionalDate(dol);

      const stage = getCsvCell(row, headers, "Stage");
      const minimumValue = parseMoney(getCsvCell(row, headers, "Minimum Value"));
      const expectedLit = getCsvCell(row, headers, "Expected Lit");
      const tracker: TrackerUpdateInput = {};

      if (stage) tracker.caseStage = normalizeStage(stage);
      if (minimumValue != null) {
        tracker.minimumValue = minimumValue;
        tracker.estimatedSettlementValue = minimumValue;
        const normalizedExpected = expectedLit ? normalizeExpectedLitigation(expectedLit, tracker.caseStage ?? "Onboarding") : null;
        const feePercent = normalizedExpected === "Pre" ? 0.3 : normalizedExpected ? 0.4 : null;
        if (feePercent != null) tracker.estimatedFeeValue = Math.round(minimumValue * feePercent);
      }
      if (expectedLit) tracker.expectedLitigation = normalizeExpectedLitigation(expectedLit, tracker.caseStage ?? "Onboarding");

      const quarter = getCsvCell(row, headers, "Quarter");
      if (quarter) tracker.targetResolutionQuarter = normalizeTargetQuarter(quarter) ?? undefined;

      const liability = getCsvCell(row, headers, "Liability");
      if (liability) tracker.liability = liability;

      const caseSize = getCsvCell(row, headers, "Case Size");
      if (caseSize) tracker.caseSize = normalizeCaseSize(caseSize) ?? caseSize;

      const referralFee = getCsvCell(row, headers, "Referral Fee");
      if (referralFee) {
        tracker.referralFee = parseMoney(referralFee);
        tracker.referralFeeArrangement = `Imported referral fee: ${referralFee}`;
      }

      const policyLimits = getCsvCell(row, headers, "Policy Limits");
      if (policyLimits) tracker.policyLimits = parseMoney(policyLimits);

      const sources = getCsvCell(row, headers, "Sources");
      if (sources) {
        tracker.sources = sources;
        tracker.policyInfoSource = sources;
        tracker.sourceOfEstimate = sources;
      }

      const litEventsNeeded = getCsvCell(row, headers, "Lit Events Needed");
      if (litEventsNeeded) tracker.litEventsNeeded = litEventsNeeded;

      const litTimeline = getCsvCell(row, headers, "Timeline for Lit Events");
      if (litTimeline) tracker.litEventsTimeline = litTimeline;

      const injuries = getCsvCell(row, headers, "Injuries");
      if (injuries) tracker.injuries = injuries;

      const description = getCsvCell(row, headers, "Description");
      if (description) tracker.caseDescription = description;

      const statusNotes = getCsvCell(row, headers, "Status Notes");
      if (statusNotes) tracker.statusNotes = statusNotes;

      const result: Partial<SettlementResult> = {};
      const settlementDate = getCsvCell(row, headers, "Settlement Date");
      if (settlementDate) result.settlementDate = parseOptionalDate(settlementDate);

      const settlementAmount = getCsvCell(row, headers, "Settlement Amount");
      if (settlementAmount) result.settlementAmount = parseMoney(settlementAmount);

      const feePercent = getCsvCell(row, headers, "Fee Percent");
      if (feePercent) result.feePercent = parseFeePercent(feePercent);

      const release = getCsvCell(row, headers, "Release");
      if (release) result.releaseStatus = normalizeReleaseStatus(release);

      const closing = getCsvCell(row, headers, "Closing");
      if (closing) result.closingStatus = normalizeClosingStatus(closing);

      const check = getCsvCell(row, headers, "Check");
      if (check) result.checkStatus = normalizeCheckStatus(check);

      const disbursed = getCsvCell(row, headers, "Disbursed");
      if (disbursed) result.disbursedStatus = normalizeDisbursedStatus(disbursed);

      const releaseSigned = getCsvCell(row, headers, "Release Signed Date");
      if (releaseSigned) result.releaseSignedAt = parseOptionalDate(releaseSigned);

      const closingSigned = getCsvCell(row, headers, "Closing Signed Date");
      if (closingSigned) result.closingSignedAt = parseOptionalDate(closingSigned);

      const checkDeposited = getCsvCell(row, headers, "Check Deposited Date");
      if (checkDeposited) result.checkDepositedAt = parseOptionalDate(checkDeposited);

      const checkDisbursed = getCsvCell(row, headers, "Check Disbursed Date");
      if (checkDisbursed) result.checkDisbursedAt = parseOptionalDate(checkDisbursed);

      const disburseDate = getCsvCell(row, headers, "Disburse Date");
      if (disburseDate) result.disburseDate = parseOptionalDate(disburseDate);

      const resultQuarter = getCsvCell(row, headers, "Result Quarter");
      if (resultQuarter) result.resultQuarter = normalizeTargetQuarter(resultQuarter) ?? undefined;

      return { caseNumber, shared, tracker, result };
    })
    .filter((row): row is ParsedCaseBackfillRow => Boolean(row));
}

export function hasCaseBackfillHeaders(csvText: string) {
  const rows = parseCsv(csvText).filter((row) => row.some((cell) => cell.trim()));
  const headerRow = rows.find((row) => hasCsvHeader(row, "Case #"));
  return Boolean(headerRow);
}

function parseMoney(value: string) {
  const numeric = Number(value.replace(/[$,%\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function parseFeePercent(value: string) {
  const numeric = Number(value.replace(/[%\s]/g, ""));
  if (!Number.isFinite(numeric)) return null;
  return numeric > 1 ? numeric / 100 : numeric;
}

function parseOptionalDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 25000) {
    return new Date(Date.UTC(1899, 11, 30) + numeric * 24 * 60 * 60 * 1000).toISOString();
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeCaseStatus(value: string): CaseStatus {
  const normalized = value.trim().toLowerCase();
  return normalized === "closed" || normalized === "inactive" || normalized === "disengaged" || normalized === "terminated"
    ? "Closed"
    : "Active";
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

function normalizeCaseSize(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s/g, "");
  if (!normalized || normalized === "n/a" || normalized === "na") return "N/A";
  if (normalized.includes("0-30")) return "$0-30k";
  if (normalized.includes("30") && normalized.includes("100")) return "$30k-$100k";
  if (normalized.includes(">100") || normalized.includes("100k+")) return ">$100k";
  return null;
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
